/**
 * The cash desk (ticket 50, decided in "Cash handling and fiscal
 * cash-register obligations"): Cash Registers with Shifts opened with a
 * counted float and closed with a blind count, a Cash Book of every
 * movement, Paid-outs within a property limit.
 */
import { roundMoney } from "./money";

/** Notes and coins by currency, largest first. */
const DENOMINATIONS: Record<string, number[]> = {
  EUR: [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01],
  CHF: [1000, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05],
};

export function denominationsFor(currency: string): number[] {
  return DENOMINATIONS[currency] ?? DENOMINATIONS.EUR!;
}

/** A count by denomination: how many of each note and coin. */
export type CashCount = Record<string, number>;

/** The amount of a count; unknown denominations and anything but whole, non-negative pieces are refused. */
export function countTotal(currency: string, count: CashCount): number {
  const known = new Set(denominationsFor(currency).map(String));
  let cents = 0;
  for (const [denomination, pieces] of Object.entries(count)) {
    if (!known.has(denomination)) throw new Error(`Unknown denomination ${denomination}`);
    if (!Number.isInteger(pieces) || pieces < 0 || pieces > 100_000) throw new Error(`Count whole pieces of ${denomination}`);
    cents += Math.round(Number(denomination) * 100) * pieces;
  }
  return cents / 100;
}

/** The result of a close count against the Cash Book: above the tolerance (either way) a reason is required. */
export function closeCount(input: { expected: number; counted: number; tolerance: number }): { difference: number; needsReason: boolean } {
  const difference = roundMoney(input.counted - input.expected);
  return { difference, needsReason: Math.abs(difference) > input.tolerance };
}

export const CASH_MOVEMENT_KINDS = ["float", "payment", "refund", "paid_out", "deposit", "change_in", "transfer_out", "transfer_in", "tip_out", "difference"] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

/** Whether a kind brings cash into the register (+1) or takes it out (−1); float and difference carry their own sign. */
export function movementSign(kind: Exclude<CashMovementKind, "float" | "difference">): 1 | -1 {
  return kind === "payment" || kind === "change_in" || kind === "transfer_in" ? 1 : -1;
}

/** Running balance after each movement, and the balance now: the float plus every movement. */
export function cashBookBalance(movements: { kind: CashMovementKind; amount: number }[]): { balances: number[]; balance: number } {
  let cents = 0;
  const balances = movements.map((m) => {
    cents += Math.round(m.amount * 100);
    return cents / 100;
  });
  return { balances, balance: cents / 100 };
}

/** A Paid-out above the property limit needs a Property Manager's Approval, unless the user may exceed it. */
export function paidOutNeedsApproval(amount: number, limit: number, mayExceed: boolean): boolean {
  return !mayExceed && amount > limit;
}
