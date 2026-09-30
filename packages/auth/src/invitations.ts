import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { loadActor, setPropertyRoles, setTenantRole } from "@hoteloftware/db";
import type { PropertyRoleAssignment, TenantRole } from "@hoteloftware/domain";
import type { Auth } from "./index";

export const INVITATION_DAYS = 7;

export interface InviteInput {
  tenantId: string;
  invitedBy: string;
  email: string;
  name: string;
  tenantRole?: TenantRole | undefined;
  propertyRoles: PropertyRoleAssignment[];
}

export interface Invitation {
  userId: string;
  token: string;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newUserId(): string {
  return randomBytes(16).toString("base64url");
}

/** What a pending user already holds; the caller checks it may manage all of it before re-inviting. */
export interface PendingUser {
  userId: string;
  tenantId: string;
  name: string;
  tenantRole: TenantRole | undefined;
  propertyRoles: PropertyRoleAssignment[];
}

/**
 * The pending (invited, not yet accepted) user behind an email in this tenant,
 * or null. An email that belongs to a user of another tenant is reported as
 * "taken" without saying where.
 */
export async function pendingUserByEmail(pool: Pool, tenantId: string, email: string): Promise<PendingUser | null | "taken"> {
  const { rows } = await pool.query<{ id: string; tenant_id: string; name: string; pending: boolean }>(
    `select u.id, u.tenant_id, u.name, (i.user_id is not null) as pending
       from control."user" u left join control.invitations i on i.user_id = u.id
      where u.email = $1`,
    [email.trim().toLowerCase()],
  );
  const found = rows[0];
  if (!found) return null;
  if (found.tenant_id !== tenantId || !found.pending) return "taken";
  const actor = await loadActor(pool, tenantId, found.id);
  return { userId: found.id, tenantId, name: found.name, tenantRole: actor.tenantRole, propertyRoles: actor.propertyRoles };
}

/**
 * Create the user with their roles and a one-time invitation link. The user
 * has no password credential until they accept, so they cannot sign in yet.
 * Re-inviting a pending user only rotates the link and never changes roles;
 * the caller must first confirm it may manage every role that user holds
 * (see pendingUserByEmail). Sending the link by email is ticket 39; until
 * then the inviter copies the link.
 */
export async function inviteUser(pool: Pool, input: InviteInput): Promise<Invitation> {
  const email = input.email.trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ id: string; tenant_id: string; pending: boolean }>(
      `select u.id, u.tenant_id, (i.user_id is not null) as pending
         from control."user" u left join control.invitations i on i.user_id = u.id
        where u.email = $1`,
      [email],
    );
    let userId: string;
    const found = existing.rows[0];
    if (found) {
      if (found.tenant_id !== input.tenantId || !found.pending) {
        throw new Error("This email address cannot be invited");
      }
      userId = found.id;
      await client.query("delete from control.invitations where user_id = $1", [userId]);
    } else {
      userId = newUserId();
      await client.query('insert into control."user" (id, tenant_id, name, email, email_verified) values ($1, $2, $3, $4, false)', [
        userId,
        input.tenantId,
        input.name.trim(),
        email,
      ]);
      if (input.tenantRole) {
        await setTenantRole(client, { tenantId: input.tenantId, userId, role: input.tenantRole, grantedBy: input.invitedBy });
      }
      const byProperty = new Map<string, PropertyRoleAssignment["role"][]>();
      for (const r of input.propertyRoles) byProperty.set(r.propertyId, [...(byProperty.get(r.propertyId) ?? []), r.role]);
      for (const [propertyId, roles] of byProperty) {
        await setPropertyRoles(client, { tenantId: input.tenantId, userId, propertyId, roles, grantedBy: input.invitedBy });
      }
    }
    const token = randomBytes(32).toString("base64url");
    const { rows } = await client.query<{ expires_at: Date }>(
      `insert into control.invitations (user_id, tenant_id, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, now() + ($5 || ' days')::interval) returning expires_at`,
      [userId, input.tenantId, hashToken(token), input.invitedBy, String(INVITATION_DAYS)],
    );
    await client.query("commit");
    return { userId, token, expiresAt: rows[0]!.expires_at };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface PendingInvitation {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  expiresAt: Date;
}

/** The invitation behind a token, or null when unknown, used or expired. */
export async function invitationByToken(pool: Pool, token: string): Promise<PendingInvitation | null> {
  const { rows } = await pool.query<{ user_id: string; tenant_id: string; email: string; name: string; expires_at: Date }>(
    `select i.user_id, i.tenant_id, u.email, u.name, i.expires_at
       from control.invitations i join control."user" u on u.id = i.user_id
      where i.token_hash = $1 and i.expires_at > now()`,
    [hashToken(token)],
  );
  const r = rows[0];
  return r ? { userId: r.user_id, tenantId: r.tenant_id, email: r.email, name: r.name, expiresAt: r.expires_at } : null;
}

/** Accept: set the password (and optionally the name), mark the email verified, consume the token. */
export async function acceptInvitation(
  auth: Auth,
  pool: Pool,
  input: { token: string; password: string; name?: string; expectedTenantId?: string },
): Promise<{ userId: string; tenantId: string }> {
  const pending = await invitationByToken(pool, input.token);
  if (!pending) throw new Error("This invitation is invalid, already used or expired");
  // Checked before anything is consumed: a link opened at another tenant's address does nothing.
  if (input.expectedTenantId && pending.tenantId !== input.expectedTenantId) {
    throw new Error("This invitation belongs to another hotel company");
  }
  if (input.password.length < 10) throw new Error("The password needs at least 10 characters");
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const consumed = await client.query("delete from control.invitations where user_id = $1 and token_hash = $2", [
      pending.userId,
      hashToken(input.token),
    ]);
    if (!consumed.rowCount) throw new Error("This invitation is invalid, already used or expired");
    await client.query("delete from control.account where user_id = $1 and provider_id = 'credential'", [pending.userId]);
    await client.query(
      `insert into control.account (id, user_id, account_id, provider_id, password) values ($1, $2, $2, 'credential', $3)`,
      [newUserId(), pending.userId, hash],
    );
    await client.query('update control."user" set email_verified = true, name = coalesce($2, name), updated_at = now() where id = $1', [
      pending.userId,
      input.name?.trim() || null,
    ]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return { userId: pending.userId, tenantId: pending.tenantId };
}
