import { PROPERTY_ROLES, ROLE_LABELS, TENANT_ROLES, can, type PropertyRole, type TenantRole } from "@hoteloftware/domain";
import { listTenantUsers, type Property, type TenantUser } from "@hoteloftware/db";
import { accessibleProperties, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { ActionForm, Field, inputClass } from "@/components/form-fields";
import { invite, updateRoles } from "./actions";

function RolePicker({
  properties,
  user,
  canTenantRoles,
}: {
  properties: Property[];
  user?: TenantUser;
  canTenantRoles: boolean;
}) {
  return (
    <div className="grid gap-3">
      {canTenantRoles ? (
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">Tenant role</span>
          <select name="tenantRole" defaultValue={user?.tenantRole ?? ""} className={inputClass}>
            <option value="">none</option>
            {TENANT_ROLES.map((r: TenantRole) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r].en}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {properties.map((p) => {
        const current = new Set(user?.propertyRoles.filter((r) => r.propertyId === p.id).map((r) => r.role));
        return (
          <fieldset key={p.id} className="grid gap-1 text-sm">
            <legend className="text-ink-80">{p.name}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {PROPERTY_ROLES.map((r: PropertyRole) => (
                <label key={r} className="flex items-center gap-1">
                  <input type="checkbox" name={`role:${p.id}`} value={r} defaultChecked={current.has(r)} />
                  {ROLE_LABELS[r].en}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export default async function UsersPage() {
  const { tenant, actor } = await requirePrincipal();
  const canTenantRoles = can(actor, "manage_tenant_roles");
  const managed = (await accessibleProperties()).filter((p) => can(actor, "manage_property_users", p.id));
  const managedIds = new Set(managed.map((p) => p.id));
  const users = (await listTenantUsers(pool(), tenant.id)).filter(
    (u) => canTenantRoles || u.propertyRoles.some((r) => managedIds.has(r.propertyId)),
  );
  const propertyName = (id: string) => managed.find((p) => p.id === id)?.name ?? "other property";

  if (!canTenantRoles && managed.length === 0) {
    return <p className="text-ink-60">You do not manage users at any property.</p>;
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-medium">Users</h1>
      {users.map((u) => (
        <details key={u.id} className="rounded-2xl bg-surface p-5 shadow-card">
          <summary className="cursor-pointer">
            <span className="font-medium">{u.name}</span>{" "}
            <span className="font-mono text-ink-80">{u.username ?? "no Username yet"}</span> <span className="text-ink-60">{u.email}</span>{" "}
            {u.pendingInvitation ? <span className="rounded-full bg-warning/15 px-2 text-xs text-warning">invited</span> : null}{" "}
            <span className="text-ink-60">
              {[
                u.tenantRole ? ROLE_LABELS[u.tenantRole].en : null,
                ...[...u.propertyRoles]
                  .sort((a, b) => propertyName(a.propertyId).localeCompare(propertyName(b.propertyId)) || a.role.localeCompare(b.role))
                  .map((r) => `${ROLE_LABELS[r.role].en} @ ${propertyName(r.propertyId)}`),
              ]
                .filter(Boolean)
                .join(", ") || "no roles"}
            </span>
          </summary>
          <div className="mt-4">
            <ActionForm action={updateRoles} submitLabel="Save">
              <input type="hidden" name="userId" value={u.id} />
              <div className="max-w-xs">
                <Field label="Username (for signing in)" name="username" defaultValue={u.username ?? ""} required />
              </div>
              <RolePicker properties={managed} user={u} canTenantRoles={canTenantRoles} />
            </ActionForm>
          </div>
        </details>
      ))}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="mb-3 font-medium">Invite a user</h2>
        <ActionForm action={invite} submitLabel="Create invitation">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Name" name="name" required />
            <Field label="Email (for the invitation)" name="email" type="email" required />
            <Field label="Username (for signing in)" name="username" required />
          </div>
          <RolePicker properties={managed} canTenantRoles={canTenantRoles} />
        </ActionForm>
      </section>
    </div>
  );
}
