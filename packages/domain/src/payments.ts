/**
 * Payment rules (ticket 27; "Payments provider in the EU" research, folio
 * domain model). A Payment is money received against a folio by one Tender;
 * a refund is a negative Payment linked to the original. A Card Hold is a
 * pre-authorisation, not a Payment.
 */
import { roundMoney } from "./money";

/** Tenders of v1; cash and vouchers come with their tickets. */
export const TENDERS = ["card_terminal", "card_online", "bank_transfer", "on_account", "ota_virtual_card", "ota_collect"] as const;
export type Tender = (typeof TENDERS)[number];

/** Tenders staff pick at the desk; "card online" arises only from a hold renewed on the saved card. */
export const DESK_TENDERS: readonly Tender[] = ["card_terminal", "bank_transfer", "on_account", "ota_virtual_card", "ota_collect"];

/** Tenders taken through the payment provider (the rest are recorded by staff). */
export const PROVIDER_TENDERS: readonly Tender[] = ["card_terminal", "ota_virtual_card"];

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed", "refund_pending_balance"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Gross Charges less succeeded payments; refunds (negative) count back. */
export function folioBalance(gross: number, payments: { amount: number; status: PaymentStatus }[]): number {
  return roundMoney(gross - payments.filter((p) => p.status === "succeeded").reduce((s, p) => s + p.amount, 0));
}

/** What may still be refunded of a payment: refunds made or under way count, failed ones do not. */
export function refundableAmount(original: number, refunds: { amount: number; status: PaymentStatus }[]): number {
  return roundMoney(original + refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount, 0));
}

export type RefundVerdict = "ok" | "not_positive" | "exceeds_refundable" | "needs_approval";

/**
 * Property Manager and Accounting refund without limit; Front Desk up to the
 * property limit per payment, counting what was already refunded on it, so
 * a large refund cannot be split into small ones; above it with Approval.
 */
export function refundCheck(input: { amount: number; refundable: number; refundedSoFar: number; limit: number; unlimited: boolean }): RefundVerdict {
  if (!(input.amount > 0)) return "not_positive";
  if (roundMoney(input.amount - input.refundable) > 0) return "exceeds_refundable";
  if (!input.unlimited && roundMoney(input.amount + input.refundedSoFar - input.limit) > 0) return "needs_approval";
  return "ok";
}

export type HoldChannel = "terminal" | "online" | "moto";

/**
 * How long a Card Hold lasts: card-present 2 days (Visa 5), card-not-present
 * 7 days (Visa merchant-initiated 5); up to 30 days only when the provider
 * confirms the extended authorisation for this hold.
 */
export function holdExpiry(input: { channel: HoldChannel; brand: string | null; extended: boolean; authorisedAt: Date }): Date {
  const visa = (input.brand ?? "").toLowerCase() === "visa";
  const days = input.extended ? 30 : input.channel === "terminal" ? (visa ? 5 : 2) : visa ? 5 : 7;
  return new Date(input.authorisedAt.getTime() + days * 86_400_000);
}

/** Hours before expiry the desk is warned and the hold renewed (owner may tune; not decided in the research). */
export const HOLD_WARNING_HOURS = 48;

/** When a hold is renewed: 48 hours before expiry, or in the last half of a shorter hold's life, so a fresh hold is not replaced at once. */
export function holdWarningAt(expiresAt: Date, authorisedAt: Date): Date {
  const life = expiresAt.getTime() - authorisedAt.getTime();
  return new Date(expiresAt.getTime() - Math.min(HOLD_WARNING_HOURS * 3_600_000, Math.max(0, life / 2)));
}

/** Provider limits on incremental authorisation: 10 per hold, each up to the greater of 500 or 500 % of the amount held before. */
export function holdIncrementAllowed(input: { held: number; increment: number; increments: number }): boolean {
  return input.increments < 10 && input.increment > 0 && input.increment <= Math.max(500, input.held * 5) + 0.005;
}

/** At checkout: capture what is due, never more than held (EEA rule); the remainder is released. */
export function captureAmount(held: number, due: number): { capture: number; release: number } {
  const capture = roundMoney(Math.max(0, Math.min(held, due)));
  return { capture, release: roundMoney(held - capture) };
}
