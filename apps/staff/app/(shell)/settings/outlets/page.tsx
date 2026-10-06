import Link from "next/link";
import { redirect } from "next/navigation";
import { listCashRegisters, listOutlets, listTenantUsers, spendingLimitOf } from "@hoteloftware/db";
import { OUTLET_KINDS, rolesAt } from "@hoteloftware/domain";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { outletsModuleOn } from "@/lib/outlets";
import { loadShell } from "@/lib/shell";
import { createOutletAction, spendingLimitAction, updateOutletAction } from "./actions";

/** The property's outlets (ticket 60): name, kind, Cash Register, in use, Outlet Managers (Property Manager). */
export default async function OutletSettingsPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_outlets"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_outlets", property.id);
  if (!(await outletsModuleOn(tenant.schemaName, property.id))) redirect("/not-allowed");
  const [outlets, registers, users, limit] = await Promise.all([listOutlets(pool(), tenant.schemaName, property.id), listCashRegisters(pool(), tenant.schemaName, property.id), listTenantUsers(pool(), tenant.id), spendingLimitOf(pool(), tenant.schemaName, property.id)]);
  const managers = users.filter((u) => rolesAt({ propertyRoles: u.propertyRoles }, property.id).includes("outlet_manager"));
  const kinds = OUTLET_KINDS.map((k) => ({ value: k, label: m[`outlet.kind.${k}`] }));
  const regs = [{ value: "", label: m["outlet.none"] }, ...registers.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))];
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <h1 className="text-xl font-medium">
        {m["module.settings_outlets"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      <section className={section} data-spending-limit>
        <ActionForm action={spendingLimitAction} submitLabel={m["action.save"]} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="propertyId" value={property.id} />
          <Field label={m["outlet.spendingLimit"]} name="limit" defaultValue={String(limit)} />
        </ActionForm>
      </section>
      {outlets.map((o) => (
        <section key={o.id} className={section} data-outlet={o.name}>
          <ActionForm action={updateOutletAction} submitLabel={m["action.save"]} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="outletId" value={o.id} />
            <Field label={m["outlet.name"]} name="name" defaultValue={o.name} />
            <Select label={m["outlet.kind"]} name="kind" options={kinds} defaultValue={o.kind} />
            <Select label={m["outlet.register"]} name="cashRegisterId" options={regs} defaultValue={o.cashRegisterId ?? ""} />
            <Field label={m["outlet.discountMax"]} name="discountPercent" defaultValue={String(o.discountPercent)} />
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" value="on" defaultChecked={o.active} />
              {m["outlet.active"]}
            </label>
            <fieldset className="grid gap-1 sm:col-span-2">
              <legend className="text-ink-80">{m["outlet.managers"]}</legend>
              {managers.length ? (
                managers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2">
                    <input type="checkbox" name="managerId" value={u.id} defaultChecked={o.managers.includes(u.id)} />
                    {u.name}
                  </label>
                ))
              ) : (
                <span className="text-ink-60">–</span>
              )}
            </fieldset>
          </ActionForm>
          <Link href={`/outlets/${o.id}`} className="font-medium text-accent underline">
            {m["outlet.setup"]}
          </Link>
        </section>
      ))}
      <section className={section} data-new-outlet>
        <h2 className="font-medium">{m["outlet.new"]}</h2>
        <ActionForm action={createOutletAction} submitLabel={m["outlet.add"]} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="propertyId" value={property.id} />
          <input type="hidden" name="active" value="on" />
          <Field label={m["outlet.name"]} name="name" required />
          <Select label={m["outlet.kind"]} name="kind" options={kinds} />
          <Select label={m["outlet.register"]} name="cashRegisterId" options={regs} />
        </ActionForm>
      </section>
    </div>
  );
}
