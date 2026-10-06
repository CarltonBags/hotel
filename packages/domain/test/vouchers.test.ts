import { describe, expect, it } from "vitest";
import { maskVoucherCode, normalizeVoucherCode, voucherBalance, voucherCode } from "../src";

describe("vouchers", () => {
  it("a code is three groups of four unmistakable characters, read however it is typed", () => {
    const code = voucherCode(Uint8Array.from({ length: 12 }, (_, i) => i * 21));
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code).not.toMatch(/[01ILO]/);
    expect(normalizeVoucherCode(` ${code.toLowerCase().replace(/-/g, " ")} `)).toBe(code);
    expect(normalizeVoucherCode("ABCD-EFGH")).toBeNull();
    expect(maskVoucherCode("ABCD-EFGH-JKMN")).toBe("••••-••••-JKMN");
  });

  it("partial redemptions leave the balance; a refunded redemption gives it back", () => {
    expect(voucherBalance(100, [30])).toBe(70);
    expect(voucherBalance(100, [30, 70])).toBe(0);
    expect(voucherBalance(100, [30, 20, -20])).toBe(70);
  });
});
