/**
 * Guest profiles (ADR 0004, "Reservation and inventory domain model",
 * "Tourism statistics reporting duties"): tenant-wide, duplicate detection
 * on email, phone and name plus date of birth, manual merge.
 */

export const DOCUMENT_TYPES = ["passport", "id_card", "driving_licence", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface GuestData {
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD */
  dateOfBirth: string | null;
  /** ISO 3166 alpha-2 */
  nationality: string | null;
  countryOfResidence: string | null;
  postalCode: string | null;
  addressLine1: string;
  city: string;
  email: string | null;
  phone: string | null;
  /** Language for guest communication */
  language: string | null;
  preferences: string;
  vip: boolean;
  marketingConsent: boolean;
  /** ISO timestamp the consent was given */
  marketingConsentAt: string | null;
  /** Proof: how it was given, for example "Registration form, signed" */
  marketingConsentSource: string | null;
  documentType: DocumentType | null;
  documentNumber: string | null;
  documentCountry: string | null;
  /** YYYY-MM-DD */
  documentExpiry: string | null;
}

export function normaliseEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e === "" ? null : e;
}

/** Digits only, with an international "00" prefix dropped ("+49" and "0049" match); too short to identify anyone gives null. */
export function normalisePhone(phone: string | null | undefined): string | null {
  let digits = (phone ?? "").replace(/\D+/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits.length >= 6 ? digits : null;
}

/** Tourism statistics need the postal code of residents of Austria and Germany. */
export function needsPostalCode(countryOfResidence: string | null): boolean {
  return countryOfResidence === "AT" || countryOfResidence === "DE";
}

const empty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * The data of a merge: the kept profile's values win, gaps are filled from
 * the other. Preferences are joined. Marketing consent moves only together
 * with its proof, and the identity document only as a whole.
 */
export function mergeGuestData(keep: GuestData, other: GuestData): GuestData {
  const out: GuestData = { ...keep };
  const simple: (keyof GuestData)[] = ["firstName", "lastName", "dateOfBirth", "nationality", "countryOfResidence", "postalCode", "addressLine1", "city", "email", "phone", "language"];
  for (const k of simple) if (empty(out[k]) && !empty(other[k])) (out as unknown as Record<string, unknown>)[k] = other[k];
  const prefs = [keep.preferences.trim(), other.preferences.trim()].filter((p, i, all) => p !== "" && all.indexOf(p) === i);
  out.preferences = prefs.join("\n");
  out.vip = keep.vip || other.vip;
  if (!keep.marketingConsent && other.marketingConsent && other.marketingConsentAt && other.marketingConsentSource) {
    out.marketingConsent = true;
    out.marketingConsentAt = other.marketingConsentAt;
    out.marketingConsentSource = other.marketingConsentSource;
  }
  if (empty(keep.documentNumber) && !empty(other.documentNumber)) {
    out.documentType = other.documentType;
    out.documentNumber = other.documentNumber;
    out.documentCountry = other.documentCountry;
    out.documentExpiry = other.documentExpiry;
  }
  return out;
}

/** A profile with nothing filled in; the starting point for new profiles and forms. */
export const EMPTY_GUEST: GuestData = {
  firstName: "",
  lastName: "",
  dateOfBirth: null,
  nationality: null,
  countryOfResidence: null,
  postalCode: null,
  addressLine1: "",
  city: "",
  email: null,
  phone: null,
  language: null,
  preferences: "",
  vip: false,
  marketingConsent: false,
  marketingConsentAt: null,
  marketingConsentSource: null,
  documentType: null,
  documentNumber: null,
  documentCountry: null,
  documentExpiry: null,
};

/** Digits of a phone search term, normalised like stored numbers (no "00" prefix). */
export function phoneSearchDigits(term: string): string {
  const digits = term.replace(/\D+/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
}
