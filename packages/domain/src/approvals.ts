/**
 * Approvals (ticket 31, permission matrix "Approval"): an action beyond a
 * role's limit needs a Property Manager's recorded consent, given on the same
 * screen with their credentials or remotely on a request, which expires after
 * 24 hours and is used once.
 */
export const APPROVAL_KINDS = ["refund_over_limit", "price_below_floor", "complimentary"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_TTL_HOURS = 24;

export type ApprovalStatus = "pending" | "approved" | "rejected" | "used" | "expired";

/** A request's status as of now: a pending or approved one past its expiry counts as expired. */
export function approvalStatus(stored: Exclude<ApprovalStatus, "expired">, expiresAt: Date, now: Date): ApprovalStatus {
  return (stored === "pending" || stored === "approved") && expiresAt.getTime() <= now.getTime() ? "expired" : stored;
}

/**
 * Price Override of a reservation's nights: which nights become
 * complimentary (price 0) and which fall below the room type's Price Floor.
 * Either needs an Approval when the user may not approve themselves.
 */
export function priceOverrideCheck(nights: { date: string; price: number }[], floor: number | null): { complimentary: string[]; belowFloor: string[] } {
  return {
    complimentary: nights.filter((n) => n.price === 0).map((n) => n.date),
    belowFloor: nights.filter((n) => n.price > 0 && floor !== null && n.price < floor).map((n) => n.date),
  };
}
