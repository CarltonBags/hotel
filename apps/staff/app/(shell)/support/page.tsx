import { redirect } from "next/navigation";
import { INCIDENT_STATES } from "@hoteloftware/domain";
import { listTenantsForSupport, statusPage } from "@hoteloftware/db";
import { isSupportConsoleUser } from "@/lib/support";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { bankTransferAction, markPaidAction, reportIncidentAction, terminateAction, scheduleMaintenanceAction, setPriceAction, updateIncidentAction } from "./actions";
import { OpenTenant } from "./open-tenant";

/** The support console (ticket 93): open a customer's tenant with a reason; run the status page. */
export default async function SupportPage() {
  const { messages: m } = await loadShell();
  if (!(await isSupportConsoleUser())) redirect("/not-allowed");
  const [tenants, status] = await Promise.all([listTenantsForSupport(pool()), statusPage(pool())]);
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">{m["module.support_console"]}</h1>
        <p className="text-sm text-ink-60">{m["support.help"]}</p>
      </div>
      <section aria-label={m["support.openTitle"]} className={section}>
        <h2 className="font-medium">{m["support.openTitle"]}</h2>
        <OpenTenant tenants={tenants} m={m} />
      </section>
      <section aria-label={m["support.incidents"]} className={section}>
        <h2 className="font-medium">
          {m["support.incidents"]} · <a href="/status" target="_blank" rel="noreferrer" className="text-accent underline">{m["support.statusPage"]}</a>
        </h2>
        {status.open.map((i) => (
          <div key={i.id} data-incident={i.title} className="grid gap-2 rounded-xl bg-surface p-3">
            <p className="font-medium">
              {i.title} · {m[`support.impact.${i.impact}`]}
            </p>
            <ActionForm action={updateIncidentAction} submitLabel={m["support.publishUpdate"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="incidentId" value={i.id} />
              <Select label={m["support.state"]} name="state" options={INCIDENT_STATES.map((s) => ({ value: s, label: m[`support.state.${s}`] }))} />
              <Field label={m["support.message"]} name="message" required />
            </ActionForm>
          </div>
        ))}
        <ActionForm action={reportIncidentAction} submitLabel={m["support.report"]} pendingLabel={m["action.saving"]} className="grid gap-2 sm:grid-cols-3">
          <Field label={m["support.title"]} name="title" required />
          <Select label={m["support.impact"]} name="impact" options={[{ value: "minor", label: m["support.impact.minor"] }, { value: "major", label: m["support.impact.major"] }]} />
          <Field label={m["support.message"]} name="message" />
        </ActionForm>
      </section>
      <section aria-label={m["support.prices"]} className={section}>
        <h2 className="font-medium">{m["support.prices"]}</h2>
        <p className="text-xs text-ink-60">{m["support.pricesHelp"]}</p>
        <ActionForm action={setPriceAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-2 sm:grid-cols-4">
          <Field label={m["support.priceKey"]} name="key" />
          <Select label={m["support.priceUnit"]} name="unit" options={[{ value: "room", label: "room" }, { value: "property", label: "property" }, { value: "percent", label: "percent" }]} />
          <Field label={m["support.priceAmount"]} name="amount" />
          <Field label={m["support.priceFrom"]} name="validFrom" type="date" />
        </ActionForm>
      </section>
      <section aria-label={m["support.billing"]} className={section}>
        <h2 className="font-medium">{m["support.billing"]}</h2>
        <ActionForm action={markPaidAction} submitLabel={m["support.markPaid"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
          <Field label={m["support.invoiceNumber"]} name="number" />
        </ActionForm>
        <ActionForm action={terminateAction} submitLabel={m["support.terminate"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
          <Select label={m["support.tenant"]} name="tenantId" options={tenants.map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` }))} />
        </ActionForm>
      </section>
      <section aria-label={m["support.transfer"]} className={section}>
        <h2 className="font-medium">{m["support.transfer"]}</h2>
        <ActionForm action={bankTransferAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
          <Select label={m["support.tenant"]} name="tenantId" options={tenants.map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` }))} />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="on" /> {m["support.transferOn"]}
          </label>
        </ActionForm>
      </section>
      <section aria-label={m["support.maintenance"]} className={section}>
        <h2 className="font-medium">{m["support.maintenance"]}</h2>
        <p className="text-xs text-ink-60">{m["support.maintenanceHelp"]}</p>
        <ActionForm action={scheduleMaintenanceAction} submitLabel={m["support.announce"]} pendingLabel={m["action.saving"]} className="grid gap-2 sm:grid-cols-2">
          <Field label={m["support.title"]} name="title" required />
          <Field label={m["support.message"]} name="description" />
          <Field label={m["support.startsAt"]} name="startsAt" type="datetime-local" required />
          <Field label={m["support.endsAt"]} name="endsAt" type="datetime-local" required />
        </ActionForm>
      </section>
    </div>
  );
}
