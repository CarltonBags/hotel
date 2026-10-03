"use client";

import { ROUTING_CATEGORIES } from "@hoteloftware/domain";
import type { Company } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import { ActionForm, Field } from "@/components/form-fields";
import { createCompanyAction, saveCompanyAction } from "./actions";

/** Billing data, payment terms and default Routing Rules of a Company. */
export function CompanyForm({ company, readOnly, m }: { company?: Company; readOnly: boolean; m: Messages }) {
  const ro = readOnly ? { readOnly: true } : {};
  const fields = (
    <>
      {company ? <input type="hidden" name="id" value={company.id} /> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={m["companies.name"]} name="name" defaultValue={company?.name} required {...ro} />
        <Field label={m["field.vatId"]} name="vatId" defaultValue={company?.vatId ?? undefined} {...ro} />
        <Field label={m["companies.contactPerson"]} name="contactPerson" defaultValue={company?.contactPerson} {...ro} />
        <Field label={m["companies.buyerReference"]} name="buyerReference" defaultValue={company?.buyerReference} {...ro} />
        <Field label={m["field.addressLine1"]} name="addressLine1" defaultValue={company?.addressLine1} {...ro} />
        <Field label={m["field.addressLine2"]} name="addressLine2" defaultValue={company?.addressLine2} {...ro} />
        <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
          <Field label={m["field.postalCode"]} name="postalCode" defaultValue={company?.postalCode} {...ro} />
          <Field label={m["field.city"]} name="city" defaultValue={company?.city} {...ro} />
          <Field label={m["field.country"]} name="country" defaultValue={company?.country ?? undefined} {...ro} />
        </div>
        <Field label={m["companies.billingEmail"]} name="billingEmail" type="email" defaultValue={company?.billingEmail ?? undefined} {...ro} />
        <Field label={m["guests.phone"]} name="phone" type="tel" defaultValue={company?.phone ?? undefined} {...ro} />
        <Field label={m["companies.paymentTerms"]} name="paymentTermsDays" type="number" defaultValue={String(company?.paymentTermsDays ?? 14)} required {...ro} />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{m["companies.routing"]}</legend>
        <p className="text-xs text-ink-60">{m["companies.routingHelp"]}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {ROUTING_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-1">
              <input type="hidden" name={`routing_${c}`} value="off" />
              <input type="checkbox" name={`routing_${c}`} value="on" defaultChecked={company?.routing.includes(c) ?? false} disabled={readOnly} />
              {m[`companies.routing.${c}`]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="hidden" name="onAccount" value="off" />
          <input type="checkbox" name="onAccount" value="on" defaultChecked={company?.onAccount ?? false} disabled={readOnly} />
          {m["companies.onAccount"]}
        </label>
        {company ? (
          <label className="flex items-center gap-1">
            <input type="hidden" name="active" value="off" />
            <input type="checkbox" name="active" value="on" defaultChecked={company.active} disabled={readOnly} />
            {m["services.active"]}
          </label>
        ) : null}
      </div>
      <textarea name="notes" defaultValue={company?.notes} readOnly={readOnly} rows={2} aria-label={m["companies.notes"]} placeholder={m["companies.notes"]} className="w-full rounded-xl border border-ink-10 bg-surface-2 p-3 text-sm" />
    </>
  );
  if (readOnly) return <div className="grid gap-4">{fields}</div>;
  return (
    <ActionForm action={company ? saveCompanyAction : createCompanyAction} submitLabel={company ? m["action.save"] : m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-4">
      {fields}
    </ActionForm>
  );
}
