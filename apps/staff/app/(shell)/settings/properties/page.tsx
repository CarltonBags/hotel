import { COUNTRIES, CURRENCIES, formatDateTime } from "@hoteloftware/domain";
import { listLegalEntities, listProperties, type LegalEntity, type Property } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { loadShell } from "@/lib/shell";
import type { Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { saveProperty } from "./actions";

function countryOptions(language: string) {
  const names = new Intl.DisplayNames([language], { type: "region" });
  return COUNTRIES.map((c) => ({ value: c, label: `${names.of(c)} (${c})` }));
}
const currencyOptions = CURRENCIES.map((c) => ({ value: c, label: c }));
const timeZoneOptions = Intl.supportedValuesOf("timeZone")
  .filter((z) => z.startsWith("Europe/") || z === "UTC")
  .map((z) => ({ value: z, label: z }));

function PropertyForm({ property, entities, m, language }: { property?: Property; entities: LegalEntity[]; m: Messages; language: string }) {
  return (
    <ActionForm action={saveProperty} submitLabel={property ? m["action.save"] : m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-2">
      {property ? <input type="hidden" name="id" value={property.id} /> : null}
      <Field label={m["field.propertyName"]} name="name" defaultValue={property?.name} required />
      <Select
        label={m["field.legalEntity"]}
        name="legalEntityId"
        options={entities.map((e) => ({ value: e.id, label: e.name }))}
        defaultValue={property?.legalEntityId}
      />
      <Select label={m["field.country"]} name="country" options={countryOptions(language)} defaultValue={property?.country ?? "DE"} />
      <Select label={m["field.timeZone"]} name="timeZone" options={timeZoneOptions} defaultValue={property?.timeZone ?? "Europe/Berlin"} />
      <Select label={m["field.currency"]} name="currency" options={currencyOptions} defaultValue={property?.currency ?? "EUR"} />
    </ActionForm>
  );
}

export default async function PropertiesPage() {
  const { tenant } = await requireAllowed("manage_properties");
  const { messages: m, language } = await loadShell();
  const [properties, entities] = await Promise.all([listProperties(pool(), tenant.schemaName), listLegalEntities(pool(), tenant.schemaName)]);
  const now = new Date();
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <h1 className="text-xl font-medium">{m["settings.properties.title"]}</h1>
      {entities.length === 0 ? <p className="text-danger">{m["settings.properties.needLegalEntity"]}</p> : null}
      {properties.map((p) => (
        <details key={p.id} className="rounded-2xl bg-surface-2 p-5">
          <summary className="cursor-pointer font-medium">
            {p.name}{" "}
            <span className="text-ink-60">
              · {p.legalEntityName} · {p.country} · {p.currency} · {formatDateTime(now, language, p.country, p.timeZone)} ({p.timeZone})
            </span>
          </summary>
          <div className="mt-4">
            <PropertyForm property={p} entities={entities} m={m} language={language} />
          </div>
        </details>
      ))}
      {entities.length > 0 ? (
        <section className="rounded-2xl bg-surface-2 p-5">
          <h2 className="mb-3 font-medium">{m["settings.properties.new"]}</h2>
          <PropertyForm entities={entities} m={m} language={language} />
        </section>
      ) : null}
    </div>
  );
}
