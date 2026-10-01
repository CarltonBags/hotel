import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateControl, provisionTenant, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { loadActor } from "@hoteloftware/db";
import { createAuth, createStaffUser, signInToTenant, type Auth } from "../src/index";
import { acceptInvitation, inviteUser, invitationByToken, pendingUserByEmail } from "../src/invitations";

/**
 * Seam: inviting a user. The invitation creates the user with their roles and
 * a one-time link; the person opens it at the tenant's subdomain, sets their
 * password and can then sign in. Until then they cannot.
 */
const APP_DOMAIN = "localhost:3000";
const PROPERTY_A = "11111111-1111-4111-8111-111111111111";

describe("invitations", () => {
  let pool: Pool;
  let auth: Auth;
  let alpha: Tenant;
  let beta: Tenant;
  let adminId: string;

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
    adminId = (await createStaffUser(auth, pool, { tenantId: alpha.id, email: "admin@example.com", username: "admin", name: "Admin", password: "admin password 123" })).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("invites a user with roles, who cannot sign in before accepting", async () => {
    const invite = await inviteUser(pool, {
      tenantId: alpha.id,
      invitedBy: adminId,
      email: "Dana@Example.com",
      username: "dana.desk",
      name: "Dana",
      propertyRoles: [{ propertyId: PROPERTY_A, role: "front_desk" }],
    });
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);

    expect(await loadActor(pool, alpha.id, invite.userId)).toEqual({
      tenantRole: undefined,
      propertyRoles: [{ propertyId: PROPERTY_A, role: "front_desk" }],
    });

    const pending = await invitationByToken(pool, invite.token);
    expect(pending).toMatchObject({ tenantId: alpha.id, email: "dana@example.com", name: "Dana" });

    const before = await signInToTenant(auth, pool, {
      tenantId: alpha.id,
      login: "dana.desk",
      password: "anything at all",
      headers: new Headers({ host: `alpha.${APP_DOMAIN}` }),
    });
    expect(before.ok).toBe(false);
  });

  it("accepting sets the password, consumes the token and allows sign-in", async () => {
    const invite = await inviteUser(pool, { tenantId: alpha.id, invitedBy: adminId, email: "finn@example.com", username: "finn", name: "Finn", propertyRoles: [] });
    const accepted = await acceptInvitation(auth, pool, { token: invite.token, password: "finn strong password" });
    expect(accepted).toMatchObject({ userId: invite.userId, tenantId: alpha.id });

    const after = await signInToTenant(auth, pool, {
      tenantId: alpha.id,
      login: "finn",
      password: "finn strong password",
      headers: new Headers({ host: `alpha.${APP_DOMAIN}` }),
    });
    expect(after.ok).toBe(true);

    expect(await invitationByToken(pool, invite.token)).toBeNull();
    await expect(acceptInvitation(auth, pool, { token: invite.token, password: "again" })).rejects.toThrow(/invalid|used|expired/i);
  });

  it("refuses to accept at another tenant's address and keeps the invitation usable", async () => {
    const invite = await inviteUser(pool, { tenantId: alpha.id, invitedBy: adminId, email: "ivy@example.com", username: "ivy", name: "Ivy", propertyRoles: [] });
    await expect(
      acceptInvitation(auth, pool, { token: invite.token, password: "ivy strong password", expectedTenantId: beta.id }),
    ).rejects.toThrow(/another hotel company/i);
    expect(await invitationByToken(pool, invite.token)).not.toBeNull();
    await acceptInvitation(auth, pool, { token: invite.token, password: "ivy strong password", expectedTenantId: alpha.id });
  });

  it("refuses an expired invitation and a wrong token", async () => {
    const invite = await inviteUser(pool, { tenantId: alpha.id, invitedBy: adminId, email: "gina@example.com", username: "gina", name: "Gina", propertyRoles: [] });
    await pool.query("update control.invitations set expires_at = now() - interval '1 minute' where user_id = $1", [invite.userId]);
    expect(await invitationByToken(pool, invite.token)).toBeNull();
    await expect(acceptInvitation(auth, pool, { token: "not-a-real-token-at-all-000000000", password: "x".repeat(12) })).rejects.toThrow(
      /invalid|used|expired/i,
    );
  });

  it("refuses an email that already belongs to a user, without saying where (platform-wide unique in v1)", async () => {
    await expect(
      inviteUser(pool, { tenantId: beta.id, invitedBy: adminId, email: "admin@example.com", username: "admin", name: "Dup", propertyRoles: [] }),
    ).rejects.toThrow(/cannot be invited/i);
    expect(await pendingUserByEmail(pool, beta.id, "admin@example.com")).toBe("taken");
    expect(await pendingUserByEmail(pool, alpha.id, "admin@example.com")).toBe("taken");
    expect(await pendingUserByEmail(pool, alpha.id, "nobody@example.com")).toBeNull();
  });

  it("re-inviting a pending user replaces the token and leaves their roles untouched", async () => {
    const first = await inviteUser(pool, {
      tenantId: alpha.id,
      invitedBy: adminId,
      email: "hal@example.com",
      username: "hal",
      name: "Hal",
      tenantRole: "tenant_admin",
      propertyRoles: [{ propertyId: PROPERTY_A, role: "revenue" }],
    });
    const pending = await pendingUserByEmail(pool, alpha.id, "hal@example.com");
    expect(pending).toMatchObject({ userId: first.userId, tenantRole: "tenant_admin", propertyRoles: [{ propertyId: PROPERTY_A, role: "revenue" }] });

    const second = await inviteUser(pool, { tenantId: alpha.id, invitedBy: adminId, email: "hal@example.com", username: "hal", name: "Hal", propertyRoles: [] });
    expect(second.userId).toBe(first.userId);
    expect(await invitationByToken(pool, first.token)).toBeNull();
    expect(await invitationByToken(pool, second.token)).not.toBeNull();
    expect(await loadActor(pool, alpha.id, first.userId)).toEqual({
      tenantRole: "tenant_admin",
      propertyRoles: [{ propertyId: PROPERTY_A, role: "revenue" }],
    });
  });
});
