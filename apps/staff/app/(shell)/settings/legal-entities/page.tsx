import { COUNTRIES } from "@hoteloftware/domain";
import { listLegalEntities, type LegalEntity } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { loadShell } from "@/lib/shell";
import type { Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { saveLegalEntity } from "./actions";

function countryOptions(language: string) {
  const names = new Intl.DisplayNames([language], { type: "region" });
  return COUNTRIES.map((c) => ({ value: c, label: `${names.of(c)} (${c})` }));
}

function LegalEntityForm({ entity, m, language }: { entity?: LegalEntity; m: Messages; language: string }) {
  return (
    <ActionForm action={saveLegalEntity} submitLabel={entity ? m["action.save"] : m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-2">
      {entity ? <input type="hidden" name="id" value={entity.id} /> : null}
      <Field label={m["field.legalEntityName"]} name="name" defaultValue={entity?.name} required />
      <Field label={m["field.vatId"]} name="vatId" defaultValue={entity?.vatId} />
      <Field label={m["field.addressLine1"]} name="addressLine1" defaultValue={entity?.addressLine1} />
      <Field label={m["field.addressLine2"]} name="addressLine2" defaultValue={entity?.addressLine2} />
      <Field label={m["field.postalCode"]} name="postalCode" defaultValue={entity?.postalCode} />
      <Field label={m["field.city"]} name="city" defaultValue={entity?.city} />
      <Select label={m["field.country"]} name="country" options={countryOptions(language)} defaultValue={entity?.country ?? "DE"} />
      <Field label={m["field.accountHolder"]} name="accountHolder" defaultValue={entity?.accountHolder} />
      <Field label={m["field.iban"]} name="iban" defaultValue={entity?.iban} />
      <Field label={m["field.bic"]} name="bic" defaultValue={entity?.bic} />
    </ActionForm>
  );
}

export default async function LegalEntitiesPage() {
  const { tenant } = await requireAllowed("manage_legal_entities");
  const { messages: m, language } = await loadShell();
  const entities = await listLegalEntities(pool(), tenant.schemaName);
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <h1 className="text-xl font-medium">{m["settings.legalEntities.title"]}</h1>
      {entities.length === 0 ? <p className="text-ink-60">{m["settings.legalEntities.none"]}</p> : null}
      {entities.map((e) => (
        <details key={e.id} className="rounded-2xl bg-surface-2 p-5">
          <summary className="cursor-pointer font-medium">
            {e.name} <span className="text-ink-60">· {e.city || m["settings.legalEntities.noAddress"]} · {e.vatId || m["settings.legalEntities.noVatId"]}</span>
          </summary>
          <div className="mt-4">
            <LegalEntityForm entity={e} m={m} language={language} />
          </div>
        </details>
      ))}
      <section className="rounded-2xl bg-surface-2 p-5">
        <h2 className="mb-3 font-medium">{m["settings.legalEntities.new"]}</h2>
        <LegalEntityForm m={m} language={language} />
      </section>
    </div>
  );
}
