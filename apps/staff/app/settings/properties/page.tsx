import { COUNTRIES, CURRENCIES, formatInPropertyTime } from "@hoteloftware/domain";
import { listLegalEntities, listProperties, type LegalEntity, type Property } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { saveProperty } from "./actions";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryOptions = COUNTRIES.map((c) => ({ value: c, label: `${countryNames.of(c)} (${c})` }));
const currencyOptions = CURRENCIES.map((c) => ({ value: c, label: c }));
const timeZoneOptions = Intl.supportedValuesOf("timeZone")
  .filter((z) => z.startsWith("Europe/") || z === "UTC")
  .map((z) => ({ value: z, label: z }));

function PropertyForm({ property, entities }: { property?: Property; entities: LegalEntity[] }) {
  return (
    <ActionForm action={saveProperty} submitLabel={property ? "Save" : "Create Property"} className="grid gap-3 md:grid-cols-2">
      {property ? <input type="hidden" name="id" value={property.id} /> : null}
      <Field label="Property name" name="name" defaultValue={property?.name} required />
      <Select
        label="Legal Entity"
        name="legalEntityId"
        options={entities.map((e) => ({ value: e.id, label: e.name }))}
        defaultValue={property?.legalEntityId}
      />
      <Select label="Country" name="country" options={countryOptions} defaultValue={property?.country ?? "DE"} />
      <Select label="Time zone" name="timeZone" options={timeZoneOptions} defaultValue={property?.timeZone ?? "Europe/Berlin"} />
      <Select label="Currency" name="currency" options={currencyOptions} defaultValue={property?.currency ?? "EUR"} />
    </ActionForm>
  );
}

export default async function PropertiesPage() {
  const { tenant } = await requireAllowed("manage_properties");
  const [properties, entities] = await Promise.all([listProperties(pool(), tenant.schemaName), listLegalEntities(pool(), tenant.schemaName)]);
  const now = new Date();
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-medium">Properties</h1>
      {entities.length === 0 ? <p className="text-danger">Create a Legal Entity first; every Property belongs to one.</p> : null}
      {properties.map((p) => (
        <details key={p.id} className="rounded-2xl bg-surface p-5 shadow-card">
          <summary className="cursor-pointer font-medium">
            {p.name}{" "}
            <span className="text-ink-60">
              · {p.legalEntityName} · {p.country} · {p.currency} · now {formatInPropertyTime(now, p.timeZone)} ({p.timeZone})
            </span>
          </summary>
          <div className="mt-4">
            <PropertyForm property={p} entities={entities} />
          </div>
        </details>
      ))}
      {entities.length > 0 ? (
        <section className="rounded-2xl bg-surface p-5 shadow-card">
          <h2 className="mb-3 font-medium">New Property</h2>
          <PropertyForm entities={entities} />
        </section>
      ) : null}
    </div>
  );
}
