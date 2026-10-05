import { roundMoney } from "./money";
import type { PaymentKind } from "./rates";
import { addDays } from "./rates-grid";

/**
 * The Guest Portal (ticket 40, "Guest portal identity model"): no accounts; a
 * Portal Link per reservation (and one per booking for the Booker), valid from
 * the confirmation until 30 days after departure, revocable by staff; else
 * confirmation number and last name with a one-time code by email.
 */
export const PORTAL_DAYS_AFTER_DEPARTURE = 30;
export const OTP_MINUTES = 10;
export const OTP_ATTEMPTS = 5;

/** Whether a link still opens: until 30 days after departure (the last one of a booking); a revoked link is a new key, so the old one is simply not found. */
export function portalLinkOpen(departure: string, today: string): boolean {
  return today <= addDays(departure, PORTAL_DAYS_AFTER_DEPARTURE);
}

/** Extras may be added until the arrival day (the guest's own reservation, not yet arrived). */
export function extrasOpen(status: string, arrival: string, today: string): boolean {
  return status === "confirmed" && today <= arrival;
}

/** A last name as the guest types it, compared without case, accents and spaces. */
export function sameLastName(a: string, b: string): boolean {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
  return n(a).length > 0 && n(a) === n(b);
}

/** Arrival time as the guest gives it: "HH:MM", within a day. */
export function isArrivalTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** The portal's languages: the guest's own where we have it. */
export const PORTAL_LANGUAGES = ["de", "en"] as const;
export type PortalLanguage = (typeof PORTAL_LANGUAGES)[number];
export function portalLanguage(asked: string | null | undefined, guest: string | null | undefined): PortalLanguage {
  for (const l of [asked, guest]) if (l && (PORTAL_LANGUAGES as readonly string[]).includes(l.slice(0, 2).toLowerCase())) return l.slice(0, 2).toLowerCase() as PortalLanguage;
  return "en";
}

/**
 * Paying in the portal before arrival (ticket 41): what the stay's Payment
 * Policy asks ahead (the whole stay, a share, or the first night), less what
 * was received; a Card Guarantee or no policy asks for nothing ahead.
 */
export function depositDue(policy: { kind: PaymentKind; depositPercent: number | null }, nightTotals: number[], received: number): number {
  const stay = nightTotals.reduce((s, n) => s + n, 0);
  const ahead =
    policy.kind === "full" ? stay : policy.kind === "deposit_percent" ? (stay * (policy.depositPercent ?? 0)) / 100 : policy.kind === "deposit_first_night" ? (nightTotals[0] ?? 0) : 0;
  return Math.max(0, roundMoney(ahead - received));
}

/** Express Checkout opens on the departure eve and stays open on the departure day (by the Business Date), while the guest is checked in. */
export function expressCheckoutOpen(status: string, departure: string, businessDate: string): boolean {
  return status === "checked_in" && businessDate >= addDays(departure, -1) && businessDate <= departure;
}

/** A stored card as guests and staff see it: brand and last four digits, never more. */
export function cardLabel(brand: string | null, last4: string | null): string {
  return [brand, last4 ? `•••• ${last4}` : ""].filter(Boolean).join(" ");
}
