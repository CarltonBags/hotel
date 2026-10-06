import { cashSettings, fiscalRegistration, fiscalStatus, listCashRegisters, listTenantUsers } from "@hoteloftware/db";
import { FISCAL_SCOPES, formatDateTime } from "@hoteloftware/domain";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { ActionForm, Field } from "@/components/form-fields";
import { addRegisterAction, dsfinvkExportAction, fiscalScopeAction, registerActiveAction, saveCashDeskAction, setUpFiscalAction } from "./actions";

/** The property's cash desk: on or off, tolerance, Paid-out limit, cash-difference account, Cash Registers (ticket 50). */
export default async function CashDeskSettingsPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
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
  const [fiscal, registration] = await Promise.all([fiscalStatus(pool(), tenant.schemaName, property.id), fiscalRegistration(pool(), tenant.schemaName, property.id)]);
  const when = (d: Date | null) => (d ? formatDateTime(d, language, property.country, property.timeZone) : "–");
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
      <section aria-label={m["fiscal.title"]} className={section} data-fiscal>
        <h2 className="font-medium">{m["fiscal.title"]}</h2>
        <p className="text-ink-60">{m["fiscal.help"]}</p>
        {!fiscal.applies ? (
          <p className="text-ink-60">{m["fiscal.notGermany"]}</p>
        ) : !fiscal.unit ? (
          <ActionForm action={setUpFiscalAction} submitLabel={m["fiscal.setUp"]} pendingLabel={m["action.saving"]} className="grid gap-2">
            {hidden}
            <p className="text-ink-60">{m["fiscal.setUpHelp"]}</p>
          </ActionForm>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-ink-60">{m["fiscal.serial"]}</dt>
              <dd className="break-all font-mono text-xs" data-tss-serial>
                {fiscal.unit.tssSerial}
              </dd>
              <dt className="text-ink-60">{m["fiscal.since"]}</dt>
              <dd>{when(fiscal.unit.inUseSince)}</dd>
            </dl>
            <ActionForm action={fiscalScopeAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
              {hidden}
              <label className="grid gap-1">
                <span className="text-ink-80">{m["fiscal.scope"]}</span>
                <select name="scope" defaultValue={fiscal.unit.scope} className="h-10 rounded-xl border border-ink-10 bg-surface px-3">
                  {FISCAL_SCOPES.map((x) => (
                    <option key={x} value={x}>
                      {m[`fiscal.scope.${x}`]}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
            <h3 className="font-medium">{m["fiscal.clients"]}</h3>
            <ul className="grid gap-1" data-fiscal-clients>
              {fiscal.clients.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-2">
                  <span className="font-medium">{c.registerName ?? m["fiscal.desk"]}</span>
                  <span className="font-mono text-xs text-ink-60">{c.serial}</span>
                  <span className="text-xs text-ink-60">{when(c.registeredAt)}</span>
                </li>
              ))}
            </ul>
            <h3 className="font-medium">{m["fiscal.outages"]}</h3>
            {fiscal.outages.length ? (
              <ul className="grid gap-1" data-fiscal-outages>
                {fiscal.outages.map((o) => (
                  <li key={o.id} className={o.endedAt ? "" : "font-medium text-danger"}>
                    {o.registerName ?? m["fiscal.desk"]}: {when(o.startedAt)} – {o.endedAt ? when(o.endedAt) : m["fiscal.ongoing"]} · {o.error}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-60">{m["fiscal.noOutages"]}</p>
            )}
            <h3 className="font-medium">{m["fiscal.closings"]}</h3>
            <ul className="grid gap-1" data-fiscal-closings>
              {fiscal.closings.map((z) => (
                <li key={`${z.clientSerial}-${z.businessDate}`}>
                  {z.businessDate} · Z {z.exportNumber} · {z.state}
                  {z.error ? ` · ${z.error}` : ""}
                </li>
              ))}
            </ul>
            <h3 className="font-medium">{m["fiscal.exports"]}</h3>
            <p className="text-ink-60">{m["fiscal.exportHelp"]}</p>
            <ActionForm action={dsfinvkExportAction} submitLabel={m["fiscal.exportDsfinvk"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
              {hidden}
              <Field label={m["fiscal.from"]} name="from" type="date" required />
              <Field label={m["fiscal.to"]} name="to" type="date" required />
            </ActionForm>
            <ul className="grid gap-1" data-fiscal-archives>
              {fiscal.archives.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-2">
                  <span>
                    {m[`fiscal.kind.${a.kind}`]} {a.periodFrom} – {a.periodTo} · {a.state}
                    {a.error ? ` · ${a.error}` : ""}
                  </span>
                  {a.state === "completed" ? (
                    <a href={`/api/fiscal/archive/${a.id}`} className="text-accent underline">
                      {m["fiscal.download"]}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            <h3 className="font-medium">{m["fiscal.registration"]}</h3>
            <p className="text-ink-60">{m["fiscal.registrationHelp"]}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1" data-fiscal-registration>
              <dt className="text-ink-60">{m["fiscal.taxpayer"]}</dt>
              <dd>
                {registration.taxpayer.name} · {registration.taxpayer.address} · St.-Nr. {registration.taxpayer.taxNumber}
                {registration.taxpayer.vatId ? ` · ${registration.taxpayer.vatId}` : ""}
              </dd>
              <dt className="text-ink-60">{m["fiscal.establishment"]}</dt>
              <dd>
                {registration.establishment.name} · {registration.establishment.address}
              </dd>
              <dt className="text-ink-60">TSE</dt>
              <dd className="break-all">{registration.tse ? `${registration.tse.provider} · ${registration.tse.serial} · ${when(registration.tse.inUseSince)}` : "–"}</dd>
              {registration.systems.map((x) => (
                <div key={x.serial} className="contents">
                  <dt className="text-ink-60">{m["fiscal.system"]}</dt>
                  <dd>
                    {x.name} · {x.software} · <span className="font-mono text-xs">{x.serial}</span> · {when(x.inUseSince)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
