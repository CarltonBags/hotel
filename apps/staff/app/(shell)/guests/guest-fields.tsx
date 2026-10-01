"use client";

import { useState } from "react";
import { COUNTRIES, DOCUMENT_TYPES, needsPostalCode, type GuestData } from "@hoteloftware/domain";
import type { Messages } from "@/i18n/messages";
import { Field, Select } from "@/components/form-fields";

/** The fields of a Guest profile; contact, address and document sections only for users who may see them. */
export function GuestFields({ guest, contacts, readOnly, m }: { guest?: GuestData | undefined; contacts: boolean; readOnly: boolean; m: Messages }) {
  const [residence, setResidence] = useState(guest?.countryOfResidence ?? "");
  const [consent, setConsent] = useState(guest?.marketingConsent ?? false);
  const ro = readOnly ? { readOnly: true } : {};
  const countryList = (
    <datalist id="countries">
      {COUNTRIES.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
  );
  const missingPostal = needsPostalCode(residence.toUpperCase() || null) && !(guest?.postalCode ?? "");
  return (
    <div className="grid gap-4">
      {countryList}
      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">{m["guests.person"]}</legend>
        <Field label={m["guests.firstName"]} name="firstName" defaultValue={guest?.firstName} {...ro} />
        <Field label={m["guests.lastName"]} name="lastName" defaultValue={guest?.lastName} required {...ro} />
        {contacts ? <Field label={m["guests.dateOfBirth"]} name="dateOfBirth" type="date" defaultValue={guest?.dateOfBirth ?? undefined} {...ro} /> : <div className="hidden md:block" />}
        <CountryField label={m["guests.nationality"]} name="nationality" defaultValue={guest?.nationality ?? ""} readOnly={readOnly} />
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["guests.countryOfResidence"]}</span>
          <input
            name="countryOfResidence"
            list="countries"
            maxLength={2}
            value={residence}
            onChange={(e) => setResidence(e.target.value.toUpperCase())}
            readOnly={readOnly}
            className="h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm uppercase"
          />
        </label>
        {contacts ? (
          <Field label={`${m["guests.postalCode"]}${missingPostal ? ` (${m["guests.postalNeeded"]})` : ""}`} name="postalCode" defaultValue={guest?.postalCode ?? undefined} {...ro} />
        ) : (
          <div className="hidden md:block" />
        )}
      </fieldset>
      {contacts ? (
        <fieldset className="grid gap-3 md:grid-cols-3">
          <legend className="mb-1 text-sm font-medium">{m["guests.contact"]}</legend>
          <Field label={m["guests.email"]} name="email" type="email" defaultValue={guest?.email ?? undefined} {...ro} />
          <Field label={m["guests.phone"]} name="phone" type="tel" defaultValue={guest?.phone ?? undefined} {...ro} />
          <Select
            label={m["guests.language"]}
            name="language"
            options={[
              { value: "", label: "–" },
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
            defaultValue={guest?.language ?? ""}
            readOnly={readOnly}
          />
          <Field label={m["guests.address"]} name="addressLine1" defaultValue={guest?.addressLine1} {...ro} />
          <Field label={m["field.city"]} name="city" defaultValue={guest?.city} {...ro} />
        </fieldset>
      ) : null}
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">{m["guests.preferences"]}</legend>
        <textarea
          name="preferences"
          defaultValue={guest?.preferences}
          readOnly={readOnly}
          rows={2}
          aria-label={m["guests.preferences"]}
          className="w-full rounded-xl border border-ink-10 bg-surface-2 p-3 text-sm"
        />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input type="hidden" name="vip" value="off" />
            <input type="checkbox" name="vip" value="on" defaultChecked={guest?.vip ?? false} disabled={readOnly} />
            VIP
          </label>
          {contacts ? (
            <label className="flex items-center gap-1">
              <input type="hidden" name="marketingConsent" value="off" />
              <input type="checkbox" name="marketingConsent" value="on" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={readOnly} />
              {m["guests.marketingConsent"]}
            </label>
          ) : null}
        </div>
        {contacts && consent ? (
          <div className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="marketingConsentAt" value={guest?.marketingConsentAt ?? ""} />
            <Field label={m["guests.consentProof"]} name="marketingConsentSource" defaultValue={guest?.marketingConsentSource ?? undefined} required {...ro} />
            {guest?.marketingConsentAt ? <p className="self-end pb-2 text-xs text-ink-60">{new Date(guest.marketingConsentAt).toLocaleString()}</p> : null}
          </div>
        ) : null}
      </fieldset>
      {contacts ? (
        <fieldset className="grid gap-3 md:grid-cols-4">
          <legend className="mb-1 text-sm font-medium">{m["guests.document"]}</legend>
          <Select
            label={m["guests.documentType"]}
            name="documentType"
            options={[{ value: "", label: "–" }, ...DOCUMENT_TYPES.map((d) => ({ value: d, label: m[`guests.doc.${d}`] }))]}
            defaultValue={guest?.documentType ?? ""}
            readOnly={readOnly}
          />
          <Field label={m["guests.documentNumber"]} name="documentNumber" defaultValue={guest?.documentNumber ?? undefined} {...ro} />
          <CountryField label={m["guests.documentCountry"]} name="documentCountry" defaultValue={guest?.documentCountry ?? ""} readOnly={readOnly} />
          <Field label={m["guests.documentExpiry"]} name="documentExpiry" type="date" defaultValue={guest?.documentExpiry ?? undefined} {...ro} />
        </fieldset>
      ) : null}
    </div>
  );
}

function CountryField({ label, name, defaultValue, readOnly }: { label: string; name: string; defaultValue: string; readOnly: boolean }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-ink-80">{label}</span>
      <input name={name} list="countries" maxLength={2} defaultValue={defaultValue} readOnly={readOnly} className="h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm uppercase" />
    </label>
  );
}
