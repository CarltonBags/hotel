"use client";

import { useState } from "react";
import { DOCUMENT_TYPES, SALUTATIONS, needsPostalCode, type GuestData, type RegistrationField } from "@hoteloftware/domain";
import type { Messages } from "@/i18n/messages";
import { Field, Select } from "@/components/form-fields";
import { CountryPicker } from "@/components/country-picker";
import { useShell } from "@/shell/ShellProvider";

/**
 * The fields of a Guest profile; contact, address and document sections only
 * for users who may see them. `marked`: fields the property's registration
 * asks for, shown with a dot.
 */
export function GuestFields({
  guest,
  contacts,
  readOnly,
  marked = [],
  compact = false,
  m,
}: {
  guest?: GuestData | undefined;
  contacts: boolean;
  readOnly: boolean;
  marked?: RegistrationField[] | undefined;
  /** Narrow panels (drawer, Today workspace): two columns instead of three. */
  compact?: boolean | undefined;
  m: Messages;
}) {
  const { language } = useShell();
  const [residence, setResidence] = useState(guest?.countryOfResidence ?? "");
  const [consent, setConsent] = useState(guest?.marketingConsent ?? false);
  const ro = readOnly ? { readOnly: true } : {};
  const cols = compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 md:grid-cols-3";
  const mark = (f: RegistrationField, label: string) => (marked.includes(f) ? `${label} •` : label);
  const missingPostal = needsPostalCode(residence.toUpperCase() || null) && !(guest?.postalCode ?? "");
  return (
    <div className="grid gap-4">
      {marked.length ? <p className="text-xs text-ink-60">{m["guests.registrationMarked"]}</p> : null}
      <fieldset className={cols}>
        <legend className="mb-1 text-sm font-medium">{m["guests.person"]}</legend>
        <Select
          label={m["guests.salutation"]}
          name="salutation"
          options={[{ value: "", label: "–" }, ...SALUTATIONS.map((x) => ({ value: x, label: m[`guests.salutation.${x}`] }))]}
          defaultValue={guest?.salutation ?? ""}
          readOnly={readOnly}
        />
        <Field label={mark("firstName", m["guests.firstName"])} name="firstName" defaultValue={guest?.firstName} {...ro} />
        <Field label={mark("lastName", m["guests.lastName"])} name="lastName" defaultValue={guest?.lastName} required {...ro} />
        {contacts ? <Field label={mark("dateOfBirth", m["guests.dateOfBirth"])} name="dateOfBirth" type="date" defaultValue={guest?.dateOfBirth ?? undefined} {...ro} /> : null}
        {contacts ? <Field label={mark("placeOfBirth", m["guests.placeOfBirth"])} name="placeOfBirth" defaultValue={guest?.placeOfBirth ?? undefined} {...ro} /> : null}
        <CountryPicker label={m["guests.nationality"]} name="nationality" defaultValue={guest?.nationality ?? ""} readOnly={readOnly} language={language} marked={marked.includes("nationality")} />
      </fieldset>
      {contacts ? (
        <fieldset className={cols}>
          <legend className="mb-1 text-sm font-medium">{m["guests.addressSection"]}</legend>
          <Field label={mark("addressLine1", m["guests.address"])} name="addressLine1" defaultValue={guest?.addressLine1} {...ro} />
          <Field label={m["guests.address2"]} name="addressLine2" defaultValue={guest?.addressLine2} {...ro} />
          <Field
            label={mark("postalCode", `${m["guests.postalCode"]}${missingPostal ? ` (${m["guests.postalNeeded"]})` : ""}`)}
            name="postalCode"
            defaultValue={guest?.postalCode ?? undefined}
            {...ro}
          />
          <Field label={mark("city", m["field.city"])} name="city" defaultValue={guest?.city} {...ro} />
          <Field label={m["guests.region"]} name="region" defaultValue={guest?.region} {...ro} />
          <CountryPicker
            label={m["guests.countryOfResidence"]}
            name="countryOfResidence"
            defaultValue={guest?.countryOfResidence ?? ""}
            readOnly={readOnly}
            language={language}
            marked={marked.includes("countryOfResidence")}
            onChange={setResidence}
          />
        </fieldset>
      ) : (
        <fieldset className={cols}>
          <CountryPicker label={m["guests.countryOfResidence"]} name="countryOfResidence" defaultValue={guest?.countryOfResidence ?? ""} readOnly={readOnly} language={language} onChange={setResidence} />
        </fieldset>
      )}
      {contacts ? (
        <fieldset className={cols}>
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
        </fieldset>
      ) : null}
      {contacts ? (
        <fieldset className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 md:grid-cols-4"}>
          <legend className="mb-1 text-sm font-medium">{m["guests.document"]}</legend>
          <Select
            label={mark("documentType", m["guests.documentType"])}
            name="documentType"
            options={[{ value: "", label: "–" }, ...DOCUMENT_TYPES.map((d) => ({ value: d, label: m[`guests.doc.${d}`] }))]}
            defaultValue={guest?.documentType ?? ""}
            readOnly={readOnly}
          />
          <Field label={mark("documentNumber", m["guests.documentNumber"])} name="documentNumber" defaultValue={guest?.documentNumber ?? undefined} {...ro} />
          <CountryPicker label={m["guests.documentCountry"]} name="documentCountry" defaultValue={guest?.documentCountry ?? ""} readOnly={readOnly} language={language} />
          <Field label={m["guests.documentExpiry"]} name="documentExpiry" type="date" defaultValue={guest?.documentExpiry ?? undefined} {...ro} />
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
    </div>
  );
}
