import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateControl, provisionTenant, setPropertyRoles, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import {
  DEVICE_COOKIE,
  createAuth,
  createEnrolment,
  createPinUser,
  createStaffUser,
  deviceByToken,
  getTenantSession,
  listDevices,
  pinEvents,
  pinStates,
  redeemEnrolment,
  revokeDevice,
  setPin,
  signInToTenant,
  type Auth,
} from "../src/index";

/**
 * Seam: PIN Sign-in on an enrolled Device. The Device is enrolled once with a
 * one-time code; floor roles then sign in by PIN, only with the Device's
 * token; revoking the Device ends its sessions at once.
 */
const APP_DOMAIN = "localhost:3000";
const PROPERTY = "11111111-1111-4111-8111-111111111111";

function cookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");
}

describe("devices and PIN sign-in", () => {
  let pool: Pool;
  let auth: Auth;
  let alpha: Tenant;
  let beta: Tenant;
  let managerId: string;
  let deskId: string;
  let hannaId: string;
  let deviceToken: string;
  let deviceId: string;

  const pinSignIn = (body: { userId: string; pin: string }, opts: { slug?: string; device?: string | null } = {}) => {
    const slug = opts.slug ?? "alpha";
    const headers: Record<string, string> = { "content-type": "application/json", host: `${slug}.${APP_DOMAIN}`, origin: `http://${slug}.${APP_DOMAIN}` };
    const device = opts.device === undefined ? deviceToken : opts.device;
    if (device) headers.cookie = `${DEVICE_COOKIE}=${device}`;
    return auth.handler(new Request(`http://${slug}.${APP_DOMAIN}/api/auth/device/pin-sign-in`, { method: "POST", headers, body: JSON.stringify(body) }));
  };
  const sessionHeaders = (res: Response, device: string | null = deviceToken) =>
    new Headers({ host: `alpha.${APP_DOMAIN}`, cookie: [cookies(res), device ? `${DEVICE_COOKIE}=${device}` : ""].filter(Boolean).join("; ") });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha Hotels" }, tenantMigrations());
    beta = await provisionTenant(pool, { slug: "beta", name: "Beta Resorts" }, tenantMigrations());
    auth = createAuth({ pool, appDomain: APP_DOMAIN, secret: "test-secret-with-at-least-32-characters", baseURL: `http://${APP_DOMAIN}` });
    managerId = (await createStaffUser(auth, pool, { tenantId: alpha.id, email: "pm@example.com", username: "pat.pm", name: "Pat", password: "manager password 1" })).id;
    deskId = (await createStaffUser(auth, pool, { tenantId: alpha.id, email: "desk@example.com", username: "desk", name: "Dee", password: "front desk password 1" })).id;
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: deskId, propertyId: PROPERTY, roles: ["front_desk"] });
    hannaId = (await createPinUser(auth, pool, { tenantId: alpha.id, propertyId: PROPERTY, username: "hanna", name: "Hanna", role: "housekeeper", pin: "4826", createdBy: managerId })).id;
    const { code } = await createEnrolment(pool, { tenantId: alpha.id, propertyId: PROPERTY, kind: "staff", name: "Floor 2 tablet", userIds: [hannaId, deskId], createdBy: managerId });
    ({ token: deviceToken, deviceId } = await redeemEnrolment(pool, { tenantId: alpha.id, code }));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("an enrolment code works once, only at its own tenant", async () => {
    const { code } = await createEnrolment(pool, { tenantId: alpha.id, propertyId: PROPERTY, kind: "staff", name: "Spare", createdBy: managerId });
    await expect(redeemEnrolment(pool, { tenantId: beta.id, code })).rejects.toThrow(/not valid/);
    await redeemEnrolment(pool, { tenantId: alpha.id, code });
    await expect(redeemEnrolment(pool, { tenantId: alpha.id, code })).rejects.toThrow(/not valid/);
  });

  it("PIN works only on an enrolled Device; the same PIN from a normal browser is refused", async () => {
    const ok = await pinSignIn({ userId: hannaId, pin: "4826" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ mustChange: true });
    expect((await getTenantSession(auth, pool, sessionHeaders(ok), alpha.id))?.user.id).toBe(hannaId);
    // the session cookie alone, without the Device's token, is not enough
    expect(await getTenantSession(auth, pool, sessionHeaders(ok, null), alpha.id)).toBeNull();

    expect((await pinSignIn({ userId: hannaId, pin: "4826" }, { device: null })).status).toBe(403);
    expect((await pinSignIn({ userId: hannaId, pin: "4826" }, { device: "made-up-token" })).status).toBe(403);
    // another tenant's host with this Device's token
    expect((await pinSignIn({ userId: hannaId, pin: "4826" }, { slug: "beta" })).status).toBe(403);
    // a PIN-only user has no password to sign in with
    expect((await signInToTenant(auth, pool, { tenantId: alpha.id, login: "hanna", password: "4826", headers: new Headers({ host: `alpha.${APP_DOMAIN}` }) })).ok).toBe(false);

    const devices = await listDevices(pool, alpha.id);
    expect(devices.find((d) => d.id === deviceId)).toMatchObject({ name: "Floor 2 tablet", lastUserId: hannaId });
  });

  it("a new PIN sign-in on the Device ends the previous one", async () => {
    const first = await pinSignIn({ userId: hannaId, pin: "4826" });
    const second = await pinSignIn({ userId: hannaId, pin: "4826" });
    expect(await getTenantSession(auth, pool, sessionHeaders(first), alpha.id)).toBeNull();
    expect(await getTenantSession(auth, pool, sessionHeaders(second), alpha.id)).not.toBeNull();
  });

  it("Front Desk and other full-credential roles cannot use PIN Sign-in", async () => {
    // even with a PIN set and allowed on the Device
    await setPin((await auth.$context).password.hash, pool, { tenantId: alpha.id, userId: deskId, pin: "7391", byUserId: managerId, mustChange: false });
    const res = await pinSignIn({ userId: deskId, pin: "7391" });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/username and password/);
  });

  it("refuses simple PINs", async () => {
    const hash = (await auth.$context).password.hash;
    for (const pin of ["1111", "1234", "9876", "1212", "1987", "12a4", "123"]) {
      await expect(setPin(hash, pool, { tenantId: alpha.id, userId: hannaId, pin, byUserId: managerId, mustChange: true })).rejects.toThrow();
    }
  });

  it("Lockout after five wrong tries is logged with device and time", async () => {
    for (let i = 1; i <= 4; i++) expect((await pinSignIn({ userId: hannaId, pin: "0000" })).status).toBe(401);
    const fifth = await pinSignIn({ userId: hannaId, pin: "0000" });
    expect((await fifth.json()).message).toMatch(/Locked/);
    // locked: even the right PIN is refused, on every Device
    expect((await pinSignIn({ userId: hannaId, pin: "4826" })).status).toBe(403);
    expect((await pinStates(pool, alpha.id)).get(hannaId)).toMatchObject({ locked: true });
    const lock = (await pinEvents(pool, alpha.id, hannaId)).find((e) => e.kind === "lock");
    expect(lock).toMatchObject({ deviceId });
    expect(Date.now() - lock!.at.getTime()).toBeLessThan(60_000);

    // the supervisor sets a new PIN, which unlocks
    await setPin((await auth.$context).password.hash, pool, { tenantId: alpha.id, userId: hannaId, pin: "5173", byUserId: managerId, mustChange: true });
    expect((await pinSignIn({ userId: hannaId, pin: "5173" })).status).toBe(200);
  });

  it("Revoked Device cannot reach the service and shows a wipe notice", async () => {
    const signedIn = await pinSignIn({ userId: hannaId, pin: "5173" });
    await revokeDevice(pool, alpha.id, deviceId, managerId);
    expect(await getTenantSession(auth, pool, sessionHeaders(signedIn), alpha.id)).toBeNull();
    const again = await pinSignIn({ userId: hannaId, pin: "5173" });
    expect(again.status).toBe(403);
    expect((await again.json()).message).toMatch(/wiped/);
    expect(await deviceByToken(pool, deviceToken)).toMatchObject({ revoked: true });
    // a password session in the same browser is refused while it carries the revoked Device's token
    const pm = await signInToTenant(auth, pool, { tenantId: alpha.id, login: "pat.pm", password: "manager password 1", headers: new Headers({ host: `alpha.${APP_DOMAIN}` }) });
    if (!pm.ok) throw new Error("sign-in failed");
    expect(await getTenantSession(auth, pool, sessionHeaders(pm.response), alpha.id)).toBeNull();
    expect(await getTenantSession(auth, pool, sessionHeaders(pm.response, null), alpha.id)).not.toBeNull();
  });
});
