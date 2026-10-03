import { describe, expect, it } from "vitest";
import { TENDERS, captureAmount, folioBalance, holdExpiry, holdIncrementAllowed, holdWarningAt, refundCheck, refundableAmount } from "../src/index";

/** Seams: balance after payments; what may still be refunded and who may; Card Hold validity and limits (payments research, ticket 27). */
describe("payments", () => {
  it("knows the v1 desk tenders", () => {
    expect(TENDERS).toEqual(["card_terminal", "card_online", "bank_transfer", "on_account", "ota_virtual_card", "ota_collect"]);
  });

  it("balance is gross Charges less succeeded payments; refunds count back", () => {
    expect(folioBalance(300, [{ amount: 100, status: "succeeded" }, { amount: 50, status: "pending" }])).toBe(200);
    expect(folioBalance(300, [{ amount: 300, status: "succeeded" }, { amount: -40, status: "succeeded" }])).toBe(40);
    expect(folioBalance(0.3, [{ amount: 0.1, status: "succeeded" }, { amount: 0.2, status: "succeeded" }])).toBe(0);
  });

  it("refundable is the original less refunds already made or pending", () => {
    expect(refundableAmount(120, [{ amount: -20, status: "succeeded" }, { amount: -30, status: "pending" }, { amount: -50, status: "failed" }])).toBe(70);
  });

  it("refunds over the refundable amount are refused; over the Front Desk limit they need Approval", () => {
    const fd = { refundedSoFar: 0, limit: 200, unlimited: false };
    expect(refundCheck({ ...fd, amount: 80, refundable: 70 })).toBe("exceeds_refundable");
    expect(refundCheck({ ...fd, amount: 0, refundable: 70 })).toBe("not_positive");
    expect(refundCheck({ ...fd, amount: 250, refundable: 300 })).toBe("needs_approval");
    expect(refundCheck({ ...fd, amount: 250, refundable: 300, unlimited: true })).toBe("ok");
    expect(refundCheck({ ...fd, amount: 200, refundable: 300 })).toBe("ok");
  });

  it("the Front Desk limit counts earlier refunds of the same payment, so it cannot be split", () => {
    expect(refundCheck({ amount: 100, refundable: 300, refundedSoFar: 150, limit: 200, unlimited: false })).toBe("needs_approval");
    expect(refundCheck({ amount: 50, refundable: 300, refundedSoFar: 150, limit: 200, unlimited: false })).toBe("ok");
  });

  it("a Card Hold lasts 2 days on a terminal (Visa 5), 7 online (Visa 5), 30 when extended", () => {
    const at = new Date("2026-10-02T10:00:00Z");
    expect(holdExpiry({ channel: "terminal", brand: "mastercard", extended: false, authorisedAt: at }).toISOString()).toBe("2026-10-04T10:00:00.000Z");
    expect(holdExpiry({ channel: "terminal", brand: "visa", extended: false, authorisedAt: at }).toISOString()).toBe("2026-10-07T10:00:00.000Z");
    expect(holdExpiry({ channel: "online", brand: "amex", extended: false, authorisedAt: at }).toISOString()).toBe("2026-10-09T10:00:00.000Z");
    expect(holdExpiry({ channel: "terminal", brand: "visa", extended: true, authorisedAt: at }).toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });

  it("renewal comes 48 hours before expiry, or halfway through a shorter hold", () => {
    expect(holdWarningAt(new Date("2026-10-09T10:00:00Z"), new Date("2026-10-02T10:00:00Z")).toISOString()).toBe("2026-10-07T10:00:00.000Z");
    // a 2-day terminal hold is renewed after one day, not at once
    expect(holdWarningAt(new Date("2026-10-04T10:00:00Z"), new Date("2026-10-02T10:00:00Z")).toISOString()).toBe("2026-10-03T10:00:00.000Z");
  });

  it("increments: at most 10, each up to the greater of 500 or five times the amount held before", () => {
    expect(holdIncrementAllowed({ held: 100, increment: 500, increments: 0 })).toBe(true);
    expect(holdIncrementAllowed({ held: 200, increment: 1000, increments: 9 })).toBe(true);
    expect(holdIncrementAllowed({ held: 200, increment: 1001, increments: 0 })).toBe(false);
    expect(holdIncrementAllowed({ held: 50, increment: 100, increments: 10 })).toBe(false);
  });

  it("capture takes what is due up to the held amount; the rest is released", () => {
    expect(captureAmount(300, 240)).toEqual({ capture: 240, release: 60 });
    expect(captureAmount(300, 420)).toEqual({ capture: 300, release: 0 });
    expect(captureAmount(300, 0)).toEqual({ capture: 0, release: 300 });
  });
});
