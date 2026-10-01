import { PROPERTY_ROLES, TENANT_ROLES, can, type PropertyRole, type TenantRole } from "@hoteloftware/domain";
import { listTenantUsers, type Property, type TenantUser } from "@hoteloftware/db";
import { accessibleProperties, requirePrincipal } from "@/lib/authorize";
import { messages } from "@/lib/shell";
import type { Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { ActionForm, Field, inputClass } from "@/components/form-fields";
import { invite, updateRoles } from "./actions";

function RolePicker({
  properties,
  user,
  canTenantRoles,
  m,
}: {
  properties: Property[];
  user?: TenantUser;
  canTenantRoles: boolean;
  m: Messages;
}) {
  return (
    <div className="grid gap-3">
      {canTenantRoles ? (
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["settings.users.tenantRole"]}</span>
          <select name="tenantRole" defaultValue={user?.tenantRole ?? ""} className={inputClass}>
            <option value="">{m["settings.users.none"]}</option>
            {TENANT_ROLES.map((r: TenantRole) => (
              <option key={r} value={r}>
                {m[`role.${r}`]}
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
                  {m[`role.${r}`]}
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
  const m = await messages();
  const canTenantRoles = can(actor, "manage_tenant_roles");
  const managed = (await accessibleProperties()).filter((p) => can(actor, "manage_property_users", p.id));
  const managedIds = new Set(managed.map((p) => p.id));
  const users = (await listTenantUsers(pool(), tenant.id)).filter(
    (u) => canTenantRoles || u.propertyRoles.some((r) => managedIds.has(r.propertyId)),
  );
  const propertyName = (id: string) => managed.find((p) => p.id === id)?.name ?? m["settings.users.otherProperty"];

  if (!canTenantRoles && managed.length === 0) {
    return <p className="p-6 text-ink-60">{m["settings.users.noneManaged"]}</p>;
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <h1 className="text-xl font-medium">{m["settings.users.title"]}</h1>
      {users.map((u) => (
        <details key={u.id} className="rounded-2xl bg-surface-2 p-5">
          <summary className="cursor-pointer">
            <span className="font-medium">{u.name}</span>{" "}
            <span className="font-mono text-ink-80">{u.username ?? m["settings.users.noUsername"]}</span> <span className="text-ink-60">{u.email}</span>{" "}
            {u.pendingInvitation ? <span className="rounded-full bg-warning/15 px-2 text-xs text-warning">{m["settings.users.invited"]}</span> : null}{" "}
            <span className="text-ink-60">
              {[
                u.tenantRole ? m[`role.${u.tenantRole}`] : null,
                ...[...u.propertyRoles]
                  .sort((a, b) => propertyName(a.propertyId).localeCompare(propertyName(b.propertyId)) || a.role.localeCompare(b.role))
                  .map((r) => `${m[`role.${r.role}`]} @ ${propertyName(r.propertyId)}`),
              ]
                .filter(Boolean)
                .join(", ") || m["settings.users.noRoles"]}
            </span>
          </summary>
          <div className="mt-4">
            <ActionForm action={updateRoles} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]}>
              <input type="hidden" name="userId" value={u.id} />
              <div className="max-w-xs">
                <Field label={m["field.username"]} name="username" defaultValue={u.username ?? ""} required />
              </div>
              <RolePicker properties={managed} user={u} canTenantRoles={canTenantRoles} m={m} />
            </ActionForm>
          </div>
        </details>
      ))}
      <section className="rounded-2xl bg-surface-2 p-5">
        <h2 className="mb-3 font-medium">{m["settings.users.invite"]}</h2>
        <ActionForm action={invite} submitLabel={m["action.createInvitation"]} pendingLabel={m["action.saving"]}>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={m["field.name"]} name="name" required />
            <Field label={m["field.emailForInvitation"]} name="email" type="email" required />
            <Field label={m["field.username"]} name="username" required />
          </div>
          <RolePicker properties={managed} canTenantRoles={canTenantRoles} m={m} />
        </ActionForm>
      </section>
    </div>
  );
}
