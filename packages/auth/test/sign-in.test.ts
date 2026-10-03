import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateControl, provisionTenant, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { createAuth, createStaffUser, getTenantSession, signInToTenant, verifyTenantCredentials, type Auth } from "../src/index";

/**
 * Seam: sign-in at a tenant subdomain. A user signs in only at their own
 * tenant; the session is accepted only for that tenant.
 */
const APP_DOMAIN = "localhost:3000";

function headersFor(slug: string, cookie?: string): Headers {
  const h = new Headers({ host: `${slug}.${APP_DOMAIN}`, origin: `http://${slug}.${APP_DOMAIN}` });
  if (cookie) h.set("cookie", cookie);
  return h;
}

function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");
}

describe("tenant-scoped sign-in", () => {
  let pool: Pool;
  let auth: Auth;
  let alpha: Tenant;
  let beta: Tenant;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>(
      "select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'",
    );
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha Hotels" }, tenantMigrations());
    beta = await provisionTenant(pool, { slug: "beta", name: "Beta Resorts" }, tenantMigrations());
    auth = createAuth({ pool, appDomain: APP_DOMAIN, secret: "test-secret-with-at-least-32-characters", baseURL: `http://${APP_DOMAIN}` });
    await createStaffUser(auth, pool, { tenantId: alpha.id, email: "bob@example.com", username: "bob", name: "Bob", password: "correct horse battery" });
    await createStaffUser(auth, pool, { tenantId: beta.id, email: "carol@example.com", username: "carol", name: "Carol", password: "another good password" });
    // the same Username may exist at another tenant
    await createStaffUser(auth, pool, { tenantId: beta.id, email: "bob.beta@example.com", username: "Bob", name: "Other Bob", password: "other bob password" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("signs a user in by Username at their own tenant and the session carries the tenant", async () => {
    const result = await signInToTenant(auth, pool, {
      tenantId: alpha.id,
      login: " BOB ",
      password: "correct horse battery",
      headers: headersFor("alpha"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cookie = cookieHeader(result.response);
    expect(cookie).toMatch(/session_token/);

    const session = await getTenantSession(auth, headersFor("alpha", cookie), alpha.id);
    expect(session?.user).toMatchObject({ email: "bob@example.com", username: "bob", name: "Bob", tenantId: alpha.id });
  });

  it("the same Username at another tenant signs in that tenant's user", async () => {
    const result = await signInToTenant(auth, pool, { tenantId: beta.id, login: "bob", password: "other bob password", headers: headersFor("beta") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = await getTenantSession(auth, headersFor("beta", cookieHeader(result.response)), beta.id);
    expect(session?.user.email).toBe("bob.beta@example.com");
  });

  it("the email still works as login", async () => {
    const result = await signInToTenant(auth, pool, { tenantId: alpha.id, login: "Bob@Example.com", password: "correct horse battery", headers: headersFor("alpha") });
    expect(result.ok).toBe(true);
  });

  it("refuses a duplicate Username within a tenant", async () => {
    await expect(
      createStaffUser(auth, pool, { tenantId: alpha.id, email: "bob2@example.com", username: "BOB", name: "Bob 2", password: "bob two password" }),
    ).rejects.toThrow(/already taken/i);
  });

  it("refuses the same credentials at another tenant without creating a session", async () => {
    const before = await pool.query<{ n: number }>("select count(*)::int as n from control.session");
    const result = await signInToTenant(auth, pool, {
      tenantId: beta.id,
      login: "bob@example.com",
      password: "correct horse battery",
      headers: headersFor("beta"),
    });
    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
    const after = await pool.query<{ n: number }>("select count(*)::int as n from control.session");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("refuses a wrong password with the same error", async () => {
    const result = await signInToTenant(auth, pool, {
      tenantId: alpha.id,
      login: "bob",
      password: "wrong password here",
      headers: headersFor("alpha"),
    });
    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("does not accept an alpha session as a beta session", async () => {
    const result = await signInToTenant(auth, pool, {
      tenantId: alpha.id,
      login: "bob",
      password: "correct horse battery",
      headers: headersFor("alpha"),
    });
    if (!result.ok) throw new Error("sign-in failed");
    const cookie = cookieHeader(result.response);
    expect(await getTenantSession(auth, headersFor("beta", cookie), beta.id)).toBeNull();
  });

  it("refuses the raw sign-in endpoint for a user of another tenant", async () => {
    const before = await pool.query<{ n: number }>("select count(*)::int as n from control.session");
    const res = await auth.handler(
      new Request(`http://beta.${APP_DOMAIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", host: `beta.${APP_DOMAIN}`, origin: `http://beta.${APP_DOMAIN}` },
        body: JSON.stringify({ email: "bob@example.com", password: "correct horse battery" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().join("")).not.toMatch(/session_token=[^;]/);
    const after = await pool.query<{ n: number }>("select count(*)::int as n from control.session");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("accepts the raw sign-in endpoint at the user's own tenant", async () => {
    const res = await auth.handler(
      new Request(`http://alpha.${APP_DOMAIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", host: `alpha.${APP_DOMAIN}`, origin: `http://alpha.${APP_DOMAIN}` },
        body: JSON.stringify({ email: "bob@example.com", password: "correct horse battery" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join("")).toMatch(/session_token=[^;]/);
  });

  it("refuses the raw sign-in endpoint on the bare app domain", async () => {
    const res = await auth.handler(
      new Request(`http://${APP_DOMAIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", host: APP_DOMAIN, origin: `http://${APP_DOMAIN}` },
        body: JSON.stringify({ email: "bob@example.com", password: "correct horse battery" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("has no public sign-up", async () => {
    const res = await auth.handler(
      new Request(`http://alpha.${APP_DOMAIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: `http://alpha.${APP_DOMAIN}` },
        body: JSON.stringify({ email: "mallory@example.com", password: "mallory password 1", name: "Mallory" }),
      }),
    );
    expect(res.ok).toBe(false);
    const { rowCount } = await pool.query("select 1 from control.\"user\" where email = 'mallory@example.com'");
    expect(rowCount).toBe(0);
  });

  it("verifies a user's credentials at their tenant without creating a session (a manager approving on another user's screen)", async () => {
    const before = await pool.query<{ n: number }>("select count(*)::int as n from control.session");
    const bob = await verifyTenantCredentials(auth, pool, { tenantId: alpha.id, login: "bob", password: "correct horse battery" });
    expect(bob).toMatch(/.+/);
    expect(await verifyTenantCredentials(auth, pool, { tenantId: alpha.id, login: "bob", password: "wrong password here" })).toBeNull();
    // another tenant's user is unknown here
    expect(await verifyTenantCredentials(auth, pool, { tenantId: alpha.id, login: "carol", password: "another good password" })).toBeNull();
    expect(await verifyTenantCredentials(auth, pool, { tenantId: alpha.id, login: "carol@example.com", password: "another good password" })).toBeNull();
    const after = await pool.query<{ n: number }>("select count(*)::int as n from control.session");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });
});
