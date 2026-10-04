import { cashSettings, listCashRegisters, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { ActionForm, Field } from "@/components/form-fields";
import { addRegisterAction, registerActiveAction, saveCashDeskAction } from "./actions";

/** The property's cash desk: on or off, tolerance, Paid-out limit, cash-difference account, Cash Registers (ticket 50). */
export default async function CashDeskSettingsPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_cash_desk"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_cash_desk", property.id);
  const [settings, registers, users] = await Promise.all([cashSettings(pool(), tenant.schemaName, property.id), listCashRegisters(pool(), tenant.schemaName, property.id), listTenantUsers(pool(), tenant.id)]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.settings_cash_desk"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["cashset.help"]}</p>
      </div>
      <section aria-label={m["cashset.desk"]} className={section}>
        <ActionForm action={saveCashDeskAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3 sm:grid-cols-2">
          {hidden}
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="hidden" name="enabled" value="off" />
            <input type="checkbox" name="enabled" value="on" defaultChecked={settings.enabled} />
            {m["cashset.enabled"]}
          </label>
          <Field label={`${m["cashset.tolerance"]} (${settings.currency})`} name="tolerance" type="number" step="0.01" defaultValue={settings.tolerance.toFixed(2)} />
          <Field label={`${m["cashset.paidOutLimit"]} (${settings.currency})`} name="paidOutLimit" type="number" step="0.01" defaultValue={settings.paidOutLimit.toFixed(2)} />
          <Field label={m["cashset.differenceAccount"]} name="differenceAccount" defaultValue={settings.differenceAccount} />
          <p className="text-xs text-ink-60 sm:col-span-2">{m["cashset.fiscalNote"]}</p>
        </ActionForm>
      </section>
      <section aria-label={m["cashset.registers"]} className={section}>
        <h2 className="font-medium">{m["cashset.registers"]}</h2>
        {registers.length === 0 ? <p className="text-ink-60">{m["cashset.noRegisters"]}</p> : null}
        <ul className="grid gap-2">
          {registers.map((r) => (
            <li key={r.id} data-register={r.name} className={`flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3 ${r.active ? "" : "opacity-60"}`}>
              <span className="flex-1 font-medium">{r.name}</span>
              {r.openShift ? <span className="text-xs text-ink-60">{`${m["cash.openBy"]} ${name.get(r.openShift.userId) ?? "?"}`}</span> : null}
              <ActionForm action={registerActiveAction} submitLabel={r.active ? m["cashset.retire"] : m["cashset.reuse"]} className="flex">
                {hidden}
                <input type="hidden" name="registerId" value={r.id} />
                <input type="hidden" name="active" value={r.active ? "off" : "on"} />
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={addRegisterAction} submitLabel={m["cashset.add"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
          {hidden}
          <Field label={m["cashset.registerName"]} name="name" required />
        </ActionForm>
      </section>
    </div>
  );
}
