import { COUNTRIES } from "@hoteloftware/domain";
import { listLegalEntities, type LegalEntity } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { saveLegalEntity } from "./actions";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryOptions = COUNTRIES.map((c) => ({ value: c, label: `${countryNames.of(c)} (${c})` }));

function LegalEntityForm({ entity }: { entity?: LegalEntity }) {
  return (
    <ActionForm action={saveLegalEntity} submitLabel={entity ? "Save" : "Create Legal Entity"} className="grid gap-3 md:grid-cols-2">
      {entity ? <input type="hidden" name="id" value={entity.id} /> : null}
      <Field label="Name of the Legal Entity" name="name" defaultValue={entity?.name} required />
      <Field label="VAT ID" name="vatId" defaultValue={entity?.vatId} />
      <Field label="Address line 1" name="addressLine1" defaultValue={entity?.addressLine1} />
      <Field label="Address line 2" name="addressLine2" defaultValue={entity?.addressLine2} />
      <Field label="Postal code" name="postalCode" defaultValue={entity?.postalCode} />
      <Field label="City" name="city" defaultValue={entity?.city} />
      <Select label="Country" name="country" options={countryOptions} defaultValue={entity?.country ?? "DE"} />
      <Field label="Account holder" name="accountHolder" defaultValue={entity?.accountHolder} />
      <Field label="IBAN" name="iban" defaultValue={entity?.iban} />
      <Field label="BIC" name="bic" defaultValue={entity?.bic} />
    </ActionForm>
  );
}

export default async function LegalEntitiesPage() {
  const { tenant } = await requireAllowed("manage_legal_entities");
  const entities = await listLegalEntities(pool(), tenant.schemaName);
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-medium">Legal Entities</h1>
      {entities.length === 0 ? <p className="text-ink-60">No Legal Entity yet. Every Property belongs to exactly one.</p> : null}
      {entities.map((e) => (
        <details key={e.id} className="rounded-2xl bg-surface p-5 shadow-card">
          <summary className="cursor-pointer font-medium">
            {e.name} <span className="text-ink-60">· {e.city || "no address"} · {e.vatId || "no VAT ID"}</span>
          </summary>
          <div className="mt-4">
            <LegalEntityForm entity={e} />
          </div>
        </details>
      ))}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="mb-3 font-medium">New Legal Entity</h2>
        <LegalEntityForm />
      </section>
    </div>
  );
}
