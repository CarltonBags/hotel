import { addDays } from "./rates-grid";

/**
 * Meldeschein (ticket 45, "Meldeschein signing flow"): who registers how, by
 * the property's country, and how long a record is kept. Switzerland comes
 * with its Canton Profiles (ticket 47).
 */
export const REGISTRATION_COUNTRIES = ["DE", "AT"] as const;
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

/** The form a counted person is listed on: the family's head (see registrationNeeds). */
export function familyHead(country: RegistrationCountry, persons: RegistrationPerson[]): RegistrationPerson | null {
  const parents = persons.filter((p) => p.role === "primary" || p.role === "spouse" || p.role === "partner");
  if (country === "AT") return parents.find((p) => p.role === "primary") ?? parents[0] ?? null;
  const foreign = (p: RegistrationPerson) => p.nationality.toUpperCase() !== "DE";
  // the primary guest if foreign, else a foreign spouse or partner
  return parents.find((p) => p.role === "primary" && foreign(p)) ?? parents.find((p) => p.role !== "primary" && foreign(p)) ?? null;
}

/**
 * Who needs what. Germany: foreign nationals only; the spouse, partner and
 * minor children of the family's head are counted on the head's form, by
 * number and nationality, whatever their own nationality. Austria: every
 * guest; minors are listed on a parent's form.
 */
export function registrationNeeds(country: RegistrationCountry, persons: RegistrationPerson[], arrival: string): Record<string, RegistrationNeed> {
  const out: Record<string, RegistrationNeed> = {};
  const head = familyHead(country, persons);
  const minor = (p: RegistrationPerson) => p.role === "child" && minorAt(p.dateOfBirth, arrival);
  if (country === "AT") {
    for (const p of persons) out[p.id] = minor(p) && head ? "counted" : "own_form";
    return out;
  }
  const family = (p: RegistrationPerson) => p.role === "spouse" || p.role === "partner" || minor(p);
  for (const p of persons) {
    if (p === head) out[p.id] = "own_form";
    else if (head && family(p)) out[p.id] = "counted";
    else out[p.id] = p.nationality.toUpperCase() === "DE" ? "none" : "own_form";
  }
  return out;
}

/** The steps a guest goes through on the tablet. */
export const TABLET_STEPS = ["welcome", "details", "companions", "review", "done"] as const;
export type TabletStep = (typeof TABLET_STEPS)[number];

/** A record is deleted: Germany from day 365 after departure (at the latest by day 455), Austria after 7 years. */
export function registrationDeletionDue(country: RegistrationCountry, departure: string, today: string): boolean {
  if (country === "DE") return today >= addDays(departure, 365);
  const [y, m, d] = departure.split("-");
  return today >= `${Number(y) + 7}-${m}-${d}`;
}

/** Complete when the guest's part is done, it is confirmed (signature, or signed on paper in Germany) and the ID Check is recorded. */
export function registrationComplete(p: { guestDone: boolean; confirmation: "tablet_signature" | "paper" | null; idChecked: boolean }): boolean {
  return p.guestDone && p.confirmation !== null && p.idChecked;
}
