import { COUNTRIES } from "@hoteloftware/domain";
import { DEFAULT_FORMATS, listInvoiceNumberRanges, listLegalEntities, type LegalEntity, type NumberRange } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { loadShell } from "@/lib/shell";
import { fill, type Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { saveLegalEntity, saveNumberRange } from "./actions";

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
      <Field label={m["field.taxNumber"]} name="taxNumber" defaultValue={entity?.taxNumber} />
      <Field label={m["field.invoiceEmail"]} name="invoiceEmail" type="email" defaultValue={entity?.invoiceEmail} />
      <Field label={m["field.invoicePhone"]} name="invoicePhone" defaultValue={entity?.invoicePhone} />
      <Field label={m["field.iban"]} name="iban" defaultValue={entity?.iban} />
      <Field label={m["field.bic"]} name="bic" defaultValue={entity?.bic} />
    </ActionForm>
  );
}

export default async function LegalEntitiesPage() {
  const { tenant } = await requireAllowed("manage_legal_entities");
  const { messages: m, language } = await loadShell();
  const entities = await listLegalEntities(pool(), tenant.schemaName);
  const ranges = new Map(await Promise.all(entities.map(async (e) => [e.id, await listInvoiceNumberRanges(pool(), tenant.schemaName, e.id)] as const)));
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
          <NumberRanges legalEntityId={e.id} ranges={ranges.get(e.id) ?? []} m={m} />
        </details>
      ))}
      <section className="rounded-2xl bg-surface-2 p-5">
        <h2 className="mb-3 font-medium">{m["settings.legalEntities.new"]}</h2>
        <LegalEntityForm m={m} language={language} />
      </section>
    </div>
  );
}

/** Invoice number ranges of a Legal Entity: final invoices always; deposit and cancellation invoices use their own only when set. */
function NumberRanges({ legalEntityId, ranges, m }: { legalEntityId: string; ranges: NumberRange[]; m: Messages }) {
  return (
    <section aria-label={m["inv.ranges"]} className="mt-6 grid gap-3">
      <h3 className="text-sm font-medium">{m["inv.ranges"]}</h3>
      <p className="text-xs text-ink-60">{m["inv.rangesHelp"]}</p>
      {(["final", "deposit", "cancellation"] as const).map((kind) => {
        const r = ranges.find((x) => x.kind === kind);
        return (
          <ActionForm key={kind} action={saveNumberRange} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid items-end gap-3 md:grid-cols-[1fr_2fr_1fr_auto]">
            <input type="hidden" name="legalEntityId" value={legalEntityId} />
            <input type="hidden" name="kind" value={kind} />
            <p className="self-center text-sm">{m[`inv.kind.${kind}`]}</p>
            <Field label={m["inv.format"]} name="format" defaultValue={r?.format ?? (kind === "final" ? DEFAULT_FORMATS.final : "")} />
            <Field label={r ? fill(m["inv.nextIs"], { n: String(r.nextValue) }) : m["inv.startAt"]} name="startAt" type="number" />
          </ActionForm>
        );
      })}
    </section>
  );
}
