import { alpha3 } from "./iso-alpha3";
import { addDays } from "./rates-grid";

/**
 * Meldeschein (ticket 45, "Meldeschein signing flow"): who registers how, by
 * the property's country, and how long a record is kept. In Switzerland the
 * rules are the canton's: a Canton Profile per property (ticket 47).
 */
export const REGISTRATION_COUNTRIES = ["DE", "AT", "CH"] as const;
export type RegistrationCountry = (typeof REGISTRATION_COUNTRIES)[number];

export function isRegistrationCountry(c: string): c is RegistrationCountry {
  return (REGISTRATION_COUNTRIES as readonly string[]).includes(c);
}

export const PERSON_ROLES = ["primary", "spouse", "partner", "child", "other"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

/** Per person: their own form, counted on another's form (by number and nationality), or nothing. */
export type RegistrationNeed = "own_form" | "counted" | "none";

export interface RegistrationPerson {
  id: string;
  role: PersonRole;
  nationality: string;
  dateOfBirth: string | null;
}

function minorAt(dateOfBirth: string | null, on: string): boolean {
  if (!dateOfBirth) return false;
  const [y, m, d] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const adult = `${y + 18}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return on < adult;
}

/** The cantons with a preset; any other canton starts from the federal minimum. */
export const CANTONS = ["ZH", "BE", "GR", "VS", "LU", "GE", "TI", "BS", "other"] as const;
export type Canton = (typeof CANTONS)[number];
/** How a Swiss registration is confirmed: a printed form signed by hand (the only certainly compliant path today), a signature on the tablet, or no signature with the ID Check. */
export const CANTON_SIGNATURES = ["handwritten", "tablet", "id_check"] as const;
export type CantonSignature = (typeof CANTON_SIGNATURES)[number];
/** What happens with the records: Tessin's export file, entry by hand in the cantonal system (until its interface), or kept and printed on request. */
export const CANTON_TRANSMISSIONS = ["ti_export", "manual_entry", "keep"] as const;
export type CantonTransmission = (typeof CANTON_TRANSMISSIONS)[number];
/** Fields beyond the federal minimum (surname, first name, date of birth, place of birth, nationality, accompanying spouse and minor children, arrival and departure, document type and number). */
export const CANTON_FIELDS = ["address", "gender", "car_number"] as const;
export type CantonField = (typeof CANTON_FIELDS)[number];

export interface CantonProfile {
  canton: Canton;
  /** Foreign guests only, or every guest. */
  registers: "foreign" | "all";
  extraFields: CantonField[];
  /** One form per adult (minors on a parent's), per couple, or per family (all children on the head's). */
  grouping: "adult" | "couple" | "family";
  /** Years after departure, or Geneva's "current year until the end of the following January". */
  retention: { years: number } | { until: "end_of_next_january" };
  /** Whether a copy of the identity document may be kept (Tessin forbids it). */
  documentCopy: boolean;
  signature: CantonSignature;
  transmission: CantonTransmission;
  /** Tessin: the establishment's user id or LEAR / NO-LEAR number, first field of the export. */
  tiUserId?: string;
}

const preset = (canton: Canton, registers: CantonProfile["registers"], retention: CantonProfile["retention"], transmission: CantonTransmission, more: Partial<CantonProfile> = {}): CantonProfile => ({
  canton,
  registers,
  extraFields: ["address"],
  grouping: "family",
  retention,
  documentCopy: true,
  signature: "handwritten",
  transmission,
  ...more,
});

/**
 * The presets ("verify with your canton", ticket 47 and "Switzerland guest
 * registration rules"): the default confirmation everywhere is the printed
 * form signed by hand; where a retention period was not found, five years.
 */
export const CANTON_PRESETS: Record<Canton, CantonProfile> = {
  ZH: preset("ZH", "all", { years: 5 }, "manual_entry"),
  BE: preset("BE", "foreign", { years: 5 }, "keep"),
  GR: preset("GR", "foreign", { years: 1 }, "keep"),
  VS: preset("VS", "all", { years: 5 }, "keep"),
  LU: preset("LU", "all", { years: 5 }, "keep"),
  GE: preset("GE", "all", { until: "end_of_next_january" }, "manual_entry"),
  TI: preset("TI", "all", { years: 5 }, "ti_export", { documentCopy: false, extraFields: ["address", "car_number"], tiUserId: "" }),
  BS: preset("BS", "all", { years: 5 }, "manual_entry"),
  other: preset("other", "foreign", { years: 5 }, "keep", { extraFields: [] }),
};

export function isCantonProfile(v: unknown): v is CantonProfile {
  const p = v as CantonProfile | null;
  return (
    !!p &&
    (CANTONS as readonly string[]).includes(p.canton) &&
    (p.registers === "foreign" || p.registers === "all") &&
    Array.isArray(p.extraFields) &&
    p.extraFields.every((f) => (CANTON_FIELDS as readonly string[]).includes(f)) &&
    ["adult", "couple", "family"].includes(p.grouping) &&
    (("years" in (p.retention ?? {}) && Number.isInteger((p.retention as { years: number }).years) && (p.retention as { years: number }).years >= 1 && (p.retention as { years: number }).years <= 10) ||
      (p.retention as { until?: string })?.until === "end_of_next_january") &&
    typeof p.documentCopy === "boolean" &&
    (CANTON_SIGNATURES as readonly string[]).includes(p.signature) &&
    (CANTON_TRANSMISSIONS as readonly string[]).includes(p.transmission)
  );
}

/** Whether a picture of the identity document may be kept: Germany and Austria yes, Switzerland by the canton (Tessin no), elsewhere no registration. */
export function documentCopyAllowed(country: string, profile: CantonProfile | null): boolean {
  return country === "CH" ? !!profile?.documentCopy : country === "DE" || country === "AT";
}

/** How a registration is confirmed: Germany on paper, Austria on the tablet, Switzerland as its canton says. */
export function registrationSignature(country: RegistrationCountry, profile: CantonProfile | null): CantonSignature {
  return country === "DE" ? "handwritten" : country === "AT" ? "tablet" : (profile?.signature ?? "handwritten");
}

/** The registration ends at reception while a handwritten signature is needed: Self Check-in and the Guest Portal hand over to the desk. */
export function registrationAtReception(country: string, profile: CantonProfile | null): boolean {
  return isRegistrationCountry(country) && registrationSignature(country, profile) === "handwritten";
}

/** The form a counted person is listed on: the family's head (see registrationNeeds). */
export function familyHead(country: RegistrationCountry, persons: RegistrationPerson[], profile: CantonProfile | null = null): RegistrationPerson | null {
  const parents = persons.filter((p) => p.role === "primary" || p.role === "spouse" || p.role === "partner");
  if (country === "AT") return parents.find((p) => p.role === "primary") ?? parents[0] ?? null;
  const home = country === "CH" ? "CH" : "DE";
  const needs = (p: RegistrationPerson) => (country === "CH" && profile?.registers === "all") || p.nationality.toUpperCase() !== home;
  // the primary guest if registered, else a registered spouse or partner
  return parents.find((p) => p.role === "primary" && needs(p)) ?? parents.find((p) => p.role !== "primary" && needs(p)) ?? null;
}

/**
 * Who needs what. Germany: foreign nationals only; the spouse, partner and
 * minor children of the family's head are counted on the head's form, by
 * number and nationality, whatever their own nationality. Austria: every
 * guest; minors are listed on a parent's form. Switzerland: as the Canton
 * Profile says, foreign guests or all; one form per adult (minors on the
 * head's), per couple (spouse or partner too) or per family (all children).
 */
export function registrationNeeds(country: RegistrationCountry, persons: RegistrationPerson[], arrival: string, profile: CantonProfile | null = null): Record<string, RegistrationNeed> {
  const out: Record<string, RegistrationNeed> = {};
  const head = familyHead(country, persons, profile);
  const minor = (p: RegistrationPerson) => p.role === "child" && minorAt(p.dateOfBirth, arrival);
  if (country === "AT") {
    for (const p of persons) out[p.id] = minor(p) && head ? "counted" : "own_form";
    return out;
  }
  const grouping = country === "CH" ? (profile?.grouping ?? "family") : "couple";
  const family = (p: RegistrationPerson) => (grouping !== "adult" && (p.role === "spouse" || p.role === "partner")) || minor(p) || (grouping === "family" && p.role === "child");
  const home = country === "CH" ? "CH" : "DE";
  const registered = (p: RegistrationPerson) => (country === "CH" && profile?.registers === "all") || p.nationality.toUpperCase() !== home;
  for (const p of persons) {
    if (p === head) out[p.id] = "own_form";
    else if (head && family(p)) out[p.id] = "counted";
    else out[p.id] = registered(p) ? "own_form" : "none";
  }
  return out;
}

/** The steps a guest goes through on the tablet. */
export const TABLET_STEPS = ["welcome", "details", "companions", "review", "done"] as const;
export type TabletStep = (typeof TABLET_STEPS)[number];

/** The day a registration record (and a guest's document picture) is deleted: Germany day 365 after departure (at the latest by day 455), Austria after 7 years, Switzerland as its canton says. */
export function registrationRetentionUntil(country: RegistrationCountry, departure: string, profile: CantonProfile | null = null): string {
  if (country === "DE") return addDays(departure, 365);
  const [y, m, d] = departure.split("-");
  if (country === "CH") {
    const r = profile?.retention ?? { years: 5 };
    // kept through the end of the following January: gone on 1 February
    if ("until" in r) return `${Number(y) + 1}-02-01`;
    return `${Number(y) + r.years}-${m}-${d}`;
  }
  return `${Number(y) + 7}-${m}-${d}`;
}

export function registrationDeletionDue(country: RegistrationCountry, departure: string, today: string, profile: CantonProfile | null = null): boolean {
  return today >= registrationRetentionUntil(country, departure, profile);
}

/** Complete when the guest's part is done, it is confirmed (signature on the tablet or on paper; none where the canton takes the ID Check alone) and the ID Check is recorded. */
export function registrationComplete(p: { guestDone: boolean; confirmation: "tablet_signature" | "paper" | null; idChecked: boolean; signature?: CantonSignature }): boolean {
  return p.guestDone && (p.signature === "id_check" || p.confirmation !== null) && p.idChecked;
}

/** One Tessin registration as its import formats take it (ticket 47). */
export interface TessinRecord {
  userId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  /** ISO alpha-2; exported as alpha-3. */
  nationality: string;
  arrival: string;
  departure: string;
  placeOfBirth: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  over14: number;
  under14: number;
  documentType: "passport" | "id_card" | "other";
  documentNumber: string;
  carNumber: string;
  reference: string;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TI_DOCUMENT_XML = { passport: "Passport", id_card: "Identity card", other: "Other" } as const;
const TI_DOCUMENT_CSV = { passport: "Passaporto", id_card: "Carta identità", other: "Altro" } as const;

/** Tessin's XML (F-Modello_4.xsd): one registration per file, the elements in the schema's order. */
export function tessinXml(r: TessinRecord): string {
  const zip = /^\d+$/.test(r.postalCode) ? r.postalCode : "0";
  const el = (name: string, v: string | number) => `    <${name}>${xml(String(v))}</${name}>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<registrationForms>",
    "  <registration>",
    el("userId", r.userId),
    el("firstname", r.firstName),
    el("lastname", r.lastName),
    el("birthdate", r.dateOfBirth),
    el("nationality", alpha3(r.nationality) || "XXX"),
    el("arrivaldate", r.arrival),
    el("placeofbirth", r.placeOfBirth),
    el("street", r.street),
    el("zip", zip),
    el("city", r.city),
    el("nation", alpha3(r.country) || alpha3(r.nationality) || "XXX"),
    el("departuredate", r.departure),
    el("persover14", r.over14),
    el("persunder14", r.under14),
    el("documentType", TI_DOCUMENT_XML[r.documentType]),
    el("documentNumber", r.documentNumber),
    el("carid", r.carNumber),
    el("referenceNr", r.reference),
    "  </registration>",
    "</registrationForms>",
    "",
  ].join("\n");
}

const TI_CSV_HEADER = "Id Struttura;Cognome;Nome;Data di nascita;Nazionalità;Data di arrivo;Data di partenza;Luogo di nascita;Numero bollettino;Indirizzo;CAP;Domicilio;Nazione;Numero autovettura;Mag14;Min14;Tipo documento;Numero documento";
const swissDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const csvCell = (s: string) => s.replace(/[;\r\n]+/g, " ").trim();

/** Tessin's CSV (D-Modello_2): semicolon-separated, dates as DD.MM.YYYY, countries alpha-3, many registrations per file. */
export function tessinCsv(records: TessinRecord[]): string {
  const rows = records.map((r) =>
    [r.userId, r.lastName, r.firstName, swissDate(r.dateOfBirth), alpha3(r.nationality), swissDate(r.arrival), swissDate(r.departure), r.placeOfBirth, r.reference, r.street, r.postalCode, r.city, alpha3(r.country) || alpha3(r.nationality), r.carNumber, String(r.over14), String(r.under14), TI_DOCUMENT_CSV[r.documentType], r.documentNumber]
      .map(csvCell)
      .join(";"),
  );
  return [TI_CSV_HEADER, ...rows].map((l) => `${l}\r\n`).join("");
}
