"use client";

import { useActionState, useState } from "react";
import type { PortalLanguage } from "@hoteloftware/domain";
import type { FormState } from "@/lib/form";
import { portalText, type PortalKey } from "@/i18n/portal";
import { guestButton, guestInput } from "./glass";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function Note({ state, language }: { state: FormState; language: PortalLanguage }) {
  if (state.error) return <p className="text-sm text-red-300" role="alert">{portalTextOr(language, state.error)}</p>;
  if (state.ok && state.message) return <p className="text-sm text-emerald-300" role="status">{portalTextOr(language, state.message)}</p>;
  return null;
}

const portalTextOr = (language: PortalLanguage, key: string) => {
  try {
    return portalText(language, key as PortalKey);
  } catch {
    return key;
  }
};

function In({ label, name, defaultValue, type = "text", required, ...rest }: { label: string; name: string; defaultValue?: string | null | undefined; type?: string; required?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue">) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-white/70">{label}</span>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} className={guestInput} {...rest} />
    </label>
  );
}

export interface PrecheckinValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  countryOfResidence: string | null;
  addressLine1: string;
  postalCode: string;
  city: string;
  phone: string;
  documentType: string | null;
  documentNumber: string;
  documentCountry: string | null;
  documentExpiry: string | null;
  arrivalTime: string | null;
  companions: { firstName: string; lastName: string; dateOfBirth: string | null; nationality: string | null }[];
  consent: boolean;
}

/** Pre-check-in: one card, the guest's details, document, companions, arrival time, consent. */
export function PrecheckinForm({ action, language, values, persons, documentImages }: { action: Action; language: PortalLanguage; values: PrecheckinValues; persons: number; documentImages: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const t = (k: PortalKey, v?: Record<string, string | number>) => portalText(language, k, v);
  const [count, setCount] = useState(Math.max(values.companions.length, Math.max(0, persons - 1)));
  return (
    <form action={formAction} className="grid gap-4" data-precheckin>
      <h3 className="text-sm font-medium uppercase tracking-wide text-white/60">{t("you")}</h3>
      <div className="grid grid-cols-2 gap-3">
        <In label={t("firstName")} name="firstName" defaultValue={values.firstName} autoComplete="given-name" />
        <In label={t("lastName")} name="lastName" defaultValue={values.lastName} required autoComplete="family-name" />
        <In label={t("dateOfBirth")} name="dateOfBirth" type="date" defaultValue={values.dateOfBirth} />
        <In label={t("nationality")} name="nationality" defaultValue={values.nationality} maxLength={2} placeholder="DE" />
        <In label={t("address")} name="addressLine1" defaultValue={values.addressLine1} autoComplete="street-address" />
        <In label={t("postalCode")} name="postalCode" defaultValue={values.postalCode} autoComplete="postal-code" />
        <In label={t("city")} name="city" defaultValue={values.city} autoComplete="address-level2" />
        <In label={t("residence")} name="countryOfResidence" defaultValue={values.countryOfResidence} maxLength={2} placeholder="DE" />
        <In label={t("phone")} name="phone" type="tel" defaultValue={values.phone} autoComplete="tel" />
        <In label={t("arrivalTime")} name="arrivalTime" type="time" defaultValue={values.arrivalTime} />
      </div>
      <h3 className="text-sm font-medium uppercase tracking-wide text-white/60">{t("document")}</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-white/70">{t("documentType")}</span>
          <select name="documentType" defaultValue={values.documentType ?? ""} className={guestInput}>
            <option value="" />
            <option value="passport">{t("passport")}</option>
            <option value="id_card">{t("idCard")}</option>
            <option value="driving_licence">{t("drivingLicence")}</option>
          </select>
        </label>
        <In label={t("documentNumber")} name="documentNumber" defaultValue={values.documentNumber} />
        <In label={t("documentCountry")} name="documentCountry" defaultValue={values.documentCountry} maxLength={2} placeholder="DE" />
        <In label={t("documentExpiry")} name="documentExpiry" type="date" defaultValue={values.documentExpiry} />
      </div>
      {documentImages ? (
        <label className="grid gap-1 text-sm">
          <span className="text-white/70">{t("documentImage")}</span>
          <input type="file" name="documentImage" accept="image/jpeg,image/png,image/webp" className="text-sm text-white/80" />
        </label>
      ) : null}
      <h3 className="text-sm font-medium uppercase tracking-wide text-white/60">{t("companions")}</h3>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid grid-cols-2 gap-3" data-companion={i}>
          <In label={`${t("companion", { n: i + 1 })} · ${t("firstName")}`} name={`c${i}first`} defaultValue={values.companions[i]?.firstName} />
          <In label={t("lastName")} name={`c${i}last`} defaultValue={values.companions[i]?.lastName} />
          <In label={t("dateOfBirth")} name={`c${i}dob`} type="date" defaultValue={values.companions[i]?.dateOfBirth} />
          <In label={t("nationality")} name={`c${i}nat`} defaultValue={values.companions[i]?.nationality} maxLength={2} />
        </div>
      ))}
      {count < 6 ? (
        <button type="button" onClick={() => setCount(count + 1)} className="justify-self-start text-sm text-white/70 underline">
          + {t("companion", { n: count + 1 })}
        </button>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="hidden" name="consent" value="off" />
        <input type="checkbox" name="consent" defaultChecked={values.consent} /> {t("consent")}
      </label>
      <input type="hidden" name="consentWording" value={t("consent")} />
      <Note state={state} language={language} />
      <button type="submit" disabled={pending} className={guestButton}>
        {t("save")}
      </button>
    </form>
  );
}

/** One extra: quantity and add. */
export function ExtraForm({ action, language, serviceId, label }: { action: Action; language: PortalLanguage; serviceId: string; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2" data-extra={label}>
      <input type="hidden" name="serviceId" value={serviceId} />
      <span className="flex-1">{label}</span>
      <input name="quantity" type="number" min={1} max={10} defaultValue={1} className={guestInput.replace("w-full", "w-16")} />
      <button type="submit" disabled={pending} className={guestButton}>
        {portalText(language, "add")}
      </button>
      <Note state={state} language={language} />
    </form>
  );
}

/** The Booker invites a room's guest by email. */
export function InviteForm({ action, language, reservationId, defaultEmail }: { action: Action; language: PortalLanguage; reservationId: string; defaultEmail: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" data-invite={reservationId}>
      <input type="hidden" name="reservationId" value={reservationId} />
      <label className="grid flex-1 gap-1 text-sm">
        <span className="text-white/70">{portalText(language, "inviteEmail")}</span>
        <input name="email" type="email" required defaultValue={defaultEmail ?? ""} className={guestInput} />
      </label>
      <button type="submit" disabled={pending} className={guestButton}>
        {portalText(language, "invite")}
      </button>
      <Note state={state} language={language} />
    </form>
  );
}

/** Booking number and last name, then the code. */
export function FindForm({ request, verify, language }: { request: Action; verify: Action; language: PortalLanguage }) {
  const [sent, requestAction, requesting] = useActionState(request, {});
  const [checked, verifyAction, verifying] = useActionState(verify, {});
  const [who, setWho] = useState({ confirmation: "", lastName: "" });
  const t = (k: PortalKey) => portalText(language, k);
  return (
    <div className="grid gap-4" data-find>
      <form action={requestAction} className="grid gap-3" onSubmit={(e) => { const f = new FormData(e.currentTarget); setWho({ confirmation: String(f.get("confirmation")), lastName: String(f.get("lastName")) }); }}>
        <In label={t("confirmation")} name="confirmation" required inputMode="numeric" />
        <In label={t("lastName")} name="lastName" required autoComplete="family-name" />
        <Note state={sent} language={language} />
        <button type="submit" disabled={requesting} className={guestButton}>
          {t("sendCode")}
        </button>
      </form>
      {sent.ok ? (
        <form action={verifyAction} className="grid gap-3" data-code>
          <input type="hidden" name="confirmation" value={who.confirmation} />
          <input type="hidden" name="lastName" value={who.lastName} />
          <input type="hidden" name="lang" value={language} />
          <In label={t("code")} name="code" required inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
          <Note state={checked} language={language} />
          <button type="submit" disabled={verifying} className={guestButton}>
            {t("open")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
