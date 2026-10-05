import { roundMoney } from "./money";

/**
 * Value Vouchers (ticket 53): sold at the desk by any tender, the sale a
 * liability of the Legal Entity, not revenue; redeemed as a Tender on a folio
 * at any property of that Legal Entity, partly, the rest staying on it.
 */

/** Tenders a Voucher is sold for (a card on the terminal is recorded with its slip's reference). */
export const VOUCHER_SALE_TENDERS = ["cash", "card_terminal", "bank_transfer"] as const;
export type VoucherSaleTender = (typeof VOUCHER_SALE_TENDERS)[number];

/** Letters and digits nobody mistakes for one another (no 0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A Voucher code, XXXX-XXXX-XXXX, from random bytes (one per character). */
export function voucherCode(random: Uint8Array): string {
  if (random.length < 12) throw new Error("Twelve random bytes are needed");
  const chars = [...random.slice(0, 12)].map((b) => ALPHABET[b % ALPHABET.length]!);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

/** A code as typed: case, spaces and dashes do not matter. */
export function normalizeVoucherCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z2-9]{12}$/.test(c)) return null;
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

/** What is left on a Voucher: its value less what was redeemed (a refund of a redemption gives it back). */
export function voucherBalance(amount: number, redemptions: number[]): number {
  return roundMoney(amount - redemptions.reduce((s, r) => s + r, 0));
}

/** The code shown where others may see it (a Receipt, a list): its last group only. */
export function maskVoucherCode(code: string): string {
  return `••••-••••-${code.slice(-4)}`;
}
