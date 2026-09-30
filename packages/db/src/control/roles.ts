import type { Pool, PoolClient } from "pg";
import { PROPERTY_ROLES, TENANT_ROLES, type Actor, type PropertyRole, type PropertyRoleAssignment, type TenantRole } from "@hoteloftware/domain";

type Queryable = Pool | PoolClient;

/** Run several control-schema writes as one transaction. */
export async function inControlTransaction<T>(pool: Pool, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** How many users hold the Owner role in this tenant. */
export async function countOwners(db: Queryable, tenantId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from control.tenant_roles where tenant_id = $1 and role = 'owner'", [tenantId]);
  return rows[0]?.n ?? 0;
}

/** The Actor for the permission check: the user's tenant role and property roles within this tenant. */
export async function loadActor(db: Queryable, tenantId: string, userId: string): Promise<Actor> {
  const tenantRole = await db.query<{ role: TenantRole }>(
    "select role from control.tenant_roles where tenant_id = $1 and user_id = $2",
    [tenantId, userId],
  );
  const propertyRoles = await db.query<{ property_id: string; role: PropertyRole }>(
    "select property_id, role from control.property_roles where tenant_id = $1 and user_id = $2 order by property_id, role",
    [tenantId, userId],
  );
  return {
    tenantRole: tenantRole.rows[0]?.role,
    propertyRoles: propertyRoles.rows.map((r) => ({ propertyId: r.property_id, role: r.role })),
  };
}

export async function setTenantRole(
  db: Queryable,
  input: { tenantId: string; userId: string; role: TenantRole | null; grantedBy?: string },
): Promise<void> {
  if (input.role === null) {
    await db.query("delete from control.tenant_roles where tenant_id = $1 and user_id = $2", [input.tenantId, input.userId]);
    return;
  }
  if (!TENANT_ROLES.includes(input.role)) throw new Error(`Unknown tenant role: ${input.role}`);
  await db.query(
    `insert into control.tenant_roles (tenant_id, user_id, role, granted_by) values ($1, $2, $3, $4)
     on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by, granted_at = now()
     where control.tenant_roles.tenant_id = excluded.tenant_id`,
    [input.tenantId, input.userId, input.role, input.grantedBy ?? null],
  );
}

/** Replace the user's role set at one property. An empty list removes every role there. */
export async function setPropertyRoles(
  db: Queryable,
  input: { tenantId: string; userId: string; propertyId: string; roles: PropertyRole[]; grantedBy?: string },
): Promise<void> {
  for (const role of input.roles) {
    if (!PROPERTY_ROLES.includes(role)) throw new Error(`Unknown property role: ${role}`);
  }
  await db.query(
    "delete from control.property_roles where tenant_id = $1 and user_id = $2 and property_id = $3 and not (role = any($4::control.property_role[]))",
    [input.tenantId, input.userId, input.propertyId, input.roles],
  );
  for (const role of input.roles) {
    await db.query(
      `insert into control.property_roles (tenant_id, user_id, property_id, role, granted_by) values ($1, $2, $3, $4, $5)
       on conflict (user_id, property_id, role) do nothing`,
      [input.tenantId, input.userId, input.propertyId, role, input.grantedBy ?? null],
    );
  }
}

export interface TenantUser {
  id: string;
  email: string;
  name: string;
  tenantRole: TenantRole | undefined;
  propertyRoles: PropertyRoleAssignment[];
  pendingInvitation: boolean;
  createdAt: Date;
}

export async function listTenantUsers(db: Queryable, tenantId: string): Promise<TenantUser[]> {
  const users = await db.query<{ id: string; email: string; name: string; created_at: Date; tenant_role: TenantRole | null; pending: boolean }>(
    `select u.id, u.email, u.name, u.created_at, tr.role as tenant_role, (i.user_id is not null) as pending
       from control."user" u
       left join control.tenant_roles tr on tr.user_id = u.id and tr.tenant_id = u.tenant_id
       left join control.invitations i on i.user_id = u.id and i.expires_at > now()
      where u.tenant_id = $1
      order by u.name, u.email`,
    [tenantId],
  );
  const roles = await db.query<{ user_id: string; property_id: string; role: PropertyRole }>(
    "select user_id, property_id, role from control.property_roles where tenant_id = $1 order by property_id, role",
    [tenantId],
  );
  const byUser = new Map<string, PropertyRoleAssignment[]>();
  for (const r of roles.rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push({ propertyId: r.property_id, role: r.role });
    byUser.set(r.user_id, list);
  }
  return users.rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    tenantRole: u.tenant_role ?? undefined,
    propertyRoles: byUser.get(u.id) ?? [],
    pendingInvitation: u.pending,
    createdAt: u.created_at,
  }));
}

export async function findTenantUser(db: Queryable, tenantId: string, userId: string): Promise<TenantUser | null> {
  const all = await listTenantUsers(db, tenantId);
  return all.find((u) => u.id === userId) ?? null;
}
