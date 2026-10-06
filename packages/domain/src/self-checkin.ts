import { isRegistrationCountry, registrationNeeds, registrationSignature, type CantonProfile, type RegistrationPerson } from "./registration";

/**
 * Self Check-in (ticket 49): the Check-in Conditions, tested at once. All
 * met: the guest is checked in without staff. A room not ready: the guest
 * waits for it (Arrived, Waiting for Room). Anything else: reception helps.
 */
export const CHECK_IN_CONDITIONS = ["arrival_day", "too_early", "registration", "payment", "room_not_ready"] as const;
export type CheckInCondition = (typeof CHECK_IN_CONDITIONS)[number];

export interface CheckInFacts {
  arrival: string;
  businessDate: string;
  /** The property's local time now, "HH:MM". */
  localTime: string;
  /** The earliest check-in, "HH:MM". */
  checkinFrom: string;
  /** An inspected room of the type is free tonight (or the assigned one is ready). */
  readyRoom: boolean;
  /** The registration: done (or none needed), or only at reception. */
  registration: "done" | "pending" | "reception";
  amountDue: number;
  cardGuarantee: boolean;
}

/** The conditions not met, in the order a guest meets them. */
export function checkInConditions(f: CheckInFacts): CheckInCondition[] {
  const out: CheckInCondition[] = [];
  if (f.arrival !== f.businessDate) out.push("arrival_day");
  else if (f.localTime < f.checkinFrom) out.push("too_early");
  if (f.registration !== "done") out.push("registration");
  if (f.amountDue > 0 && !f.cardGuarantee) out.push("payment");
  if (!f.readyRoom) out.push("room_not_ready");
  return out;
}

/** What only the desk can mend (a room not ready only means waiting for it). */
export function needsReception(failed: CheckInCondition[]): boolean {
  return failed.some((c) => c !== "room_not_ready");
}

/**
 * How the registration can be done in Self Check-in: none needed, on screen
 * (Austria's signature; a Swiss canton allowing the tablet signature), or
 * only at reception (Germany's foreign guests until the card path of ticket
 * 46; a handwritten signature; the ID Check; fellow guests with forms of
 * their own).
 */
export function selfRegistrationPath(country: string, persons: RegistrationPerson[], arrival: string, profile: CantonProfile | null): "none" | "on_screen" | "reception" {
  if (!isRegistrationCountry(country)) return "none";
  const needs = registrationNeeds(country, persons, arrival, profile);
  const forms = persons.filter((p) => needs[p.id] === "own_form");
  if (!forms.length) return "none";
  if (forms.length > 1 || forms[0]!.role !== "primary") return "reception";
  return registrationSignature(country, profile) === "tablet" ? "on_screen" : "reception";
}
