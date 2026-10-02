/**
 * Front-office rules (ticket 96): who works one property at a time, which
 * guest details a property's registration needs, the nights a Fixed Charge
 * covers, and the Today workspace list.
 */
import type { GuestData } from "./guests";
import type { Actor, PropertyRole } from "./permissions";
import { nightsOf } from "./stay-quote";

/** Floor and desk roles: a user holding only these works in one property at a time. */
const FRONT_OFFICE_ROLES = new Set<PropertyRole>(["front_desk", "housekeeper", "housekeeping_supervisor", "maintenance"]);

export function isFrontOfficeOnly(actor: Actor): boolean {
  if (actor.tenantRole !== undefined || actor.propertyRoles.length === 0) return false;
  return actor.propertyRoles.every((r) => FRONT_OFFICE_ROLES.has(r.role));
}

export type RegistrationField = keyof Pick<
  GuestData,
  "firstName" | "lastName" | "dateOfBirth" | "placeOfBirth" | "nationality" | "addressLine1" | "postalCode" | "city" | "countryOfResidence" | "documentType" | "documentNumber"
>;

const ORDER: RegistrationField[] = ["firstName", "lastName", "dateOfBirth", "placeOfBirth", "nationality", "addressLine1", "postalCode", "city", "countryOfResidence", "documentType", "documentNumber"];
const PERSON: RegistrationField[] = ["firstName", "lastName", "dateOfBirth", "nationality"];
const ADDRESS: RegistrationField[] = ["addressLine1", "postalCode", "city", "countryOfResidence"];
const DOCUMENT: RegistrationField[] = ["documentType", "documentNumber"];

/**
 * Registration fields per country of the property: the statutory minimum as
 * researched (Meldeschein DE and AT, Swiss federal minimum, decision 49).
 * Labelled "verify" in the UI; the registration tickets replace this with the
 * property's own rules (Canton Profile). `foreigners` fields apply when the
 * nationality is not the property's country.
 */
const RULES: Record<string, { all: RegistrationField[]; foreigners: RegistrationField[] }> = {
  DE: { all: [...PERSON, ...ADDRESS], foreigners: DOCUMENT },
  AT: { all: [...PERSON, ...ADDRESS], foreigners: DOCUMENT },
  CH: { all: [...PERSON, "placeOfBirth", ...DOCUMENT], foreigners: [] },
};

/** Fields the guest still lacks for registration at a property in the country, in form order. */
export function registrationGaps(guest: GuestData, propertyCountry: string): RegistrationField[] {
  const rule = RULES[propertyCountry];
  if (!rule) return [];
  const needed = new Set(rule.all);
  if (guest.nationality !== propertyCountry) for (const f of rule.foreigners) needed.add(f);
  return ORDER.filter((f) => needed.has(f) && isEmpty(guest[f]));
}

/** Registration fields of the country, to mark them on the form. */
export function registrationFields(propertyCountry: string, nationality: string | null): RegistrationField[] {
  return registrationGaps({ nationality } as GuestData, propertyCountry);
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** The nights of the stay a Fixed Charge covers: its range [from, to) inside [arrival, departure). */
export function fixedChargeNights(range: { from: string; to: string }, arrival: string, departure: string): string[] {
  return nightsOf(arrival, departure).filter((d) => d >= range.from && d < range.to);
}

export interface WorkspaceRow {
  reservationId: string;
  confirmationNumber: string;
  room: string | null;
  guestFirstName: string;
  guestLastName: string;
  roomTypeCode: string;
  ratePlanName: string;
  bookerName: string;
  arrival: string;
  departure: string;
  vip: boolean;
  /** Open amount on the guest's own folios. */
  balance: number;
  /** Card Hold amount, null without one (payments, ticket 27). */
  cardHold: number | null;
}

export interface WorkspaceFilters {
  roomTypeCode?: string | undefined;
  ratePlanName?: string | undefined;
  bookerName?: string | undefined;
  vip?: boolean | undefined;
  unassigned?: boolean | undefined;
  openBalance?: boolean | undefined;
  noCardHold?: boolean | undefined;
}

export const WORKSPACE_SORT_KEYS = ["room", "name", "arrival", "departure", "balance"] as const;
export type WorkspaceSortKey = (typeof WORKSPACE_SORT_KEYS)[number];

export interface WorkspaceView {
  query?: string | undefined;
  filters?: WorkspaceFilters | undefined;
  sort?: { key: WorkspaceSortKey; dir: "asc" | "desc" } | undefined;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Search, filter and sort a workspace list. Search matches a room number from
 * its start or a guest name anywhere; every chosen filter must match; rows
 * without a room sort last whatever the direction.
 */
export function workspaceRows(rows: WorkspaceRow[], view: WorkspaceView): WorkspaceRow[] {
  const q = (view.query ?? "").trim().toLowerCase();
  const f = view.filters ?? {};
  const kept = rows.filter((r) => {
    if (q && !(r.room ?? "").toLowerCase().startsWith(q) && !`${r.guestFirstName} ${r.guestLastName}`.toLowerCase().includes(q)) return false;
    if (f.roomTypeCode && r.roomTypeCode !== f.roomTypeCode) return false;
    if (f.ratePlanName && r.ratePlanName !== f.ratePlanName) return false;
    if (f.bookerName && r.bookerName !== f.bookerName) return false;
    if (f.vip && !r.vip) return false;
    if (f.unassigned && r.room !== null) return false;
    if (f.openBalance && !(r.balance > 0)) return false;
    if (f.noCardHold && r.cardHold !== null) return false;
    return true;
  });
  const { key, dir } = view.sort ?? { key: "room", dir: "asc" };
  const sign = dir === "asc" ? 1 : -1;
  const value = (r: WorkspaceRow): string | number | null =>
    key === "room" ? r.room : key === "name" ? `${r.guestLastName} ${r.guestFirstName}` : key === "balance" ? r.balance : key === "arrival" ? r.arrival : r.departure;
  return [...kept].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    if (typeof x === "number" && typeof y === "number") return sign * (x - y);
    return sign * collator.compare(String(x), String(y));
  });
}
