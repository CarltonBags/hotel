import { describe, expect, it } from "vitest";
import { cashBookBalance, closeCount, countTotal, denominationsFor, movementSign, paidOutNeedsApproval } from "../src/cash";

describe("cash desk rules", () => {
  it("counts by denomination", () => {
    expect(denominationsFor("EUR")[0]).toBe(500);
    expect(denominationsFor("CHF")).toContain(1000);
    expect(countTotal("EUR", { "50": 2, "20": 1, "0.5": 3, "0.01": 7 })).toBe(121.57);
    expect(() => countTotal("EUR", { "3": 1 })).toThrow(/denomination/);
    expect(() => countTotal("EUR", { "10": -1 })).toThrow();
    expect(() => countTotal("EUR", { "10": 1.5 })).toThrow();
  });

  it("the difference of a close count needs a reason above the tolerance", () => {
    expect(closeCount({ expected: 250, counted: 247.5, tolerance: 5 })).toEqual({ difference: -2.5, needsReason: false });
    expect(closeCount({ expected: 250, counted: 244.99, tolerance: 5 })).toEqual({ difference: -5.01, needsReason: true });
    expect(closeCount({ expected: 250, counted: 256, tolerance: 5 })).toEqual({ difference: 6, needsReason: true });
    expect(closeCount({ expected: 250, counted: 255, tolerance: 5 }).needsReason).toBe(false);
  });

  it("each movement kind moves money in or out", () => {
    expect(movementSign("payment")).toBe(1);
    expect(movementSign("refund")).toBe(-1);
    expect(movementSign("paid_out")).toBe(-1);
    expect(movementSign("deposit")).toBe(-1);
    expect(movementSign("change_in")).toBe(1);
    expect(movementSign("transfer_out")).toBe(-1);
    expect(movementSign("transfer_in")).toBe(1);
    expect(movementSign("tip_out")).toBe(-1);
  });

  it("the Cash Book balance is the float plus the movements", () => {
    const book = cashBookBalance([
      { kind: "float", amount: 200 },
      { kind: "payment", amount: 80.5 },
      { kind: "paid_out", amount: -12.3 },
      { kind: "refund", amount: -20 },
    ]);
    expect(book.balances).toEqual([200, 280.5, 268.2, 248.2]);
    expect(book.balance).toBe(248.2);
  });

  it("a Paid-out above the property limit needs an Approval unless the user may exceed it", () => {
    expect(paidOutNeedsApproval(80, 100, false)).toBe(false);
    expect(paidOutNeedsApproval(100.01, 100, false)).toBe(true);
    expect(paidOutNeedsApproval(500, 100, true)).toBe(false);
  });
});
