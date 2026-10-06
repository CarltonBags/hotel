import { describe, expect, it } from "vitest";
import { atOutageReport, atVatKey, yearlyReceiptCheckBy, refundVatAmounts, dsfinvkClosing, fiscalScopeCovers, fiscalSerial, fiscalVat, receiptVatAmounts } from "../src";

describe("fiscal module Germany", () => {
  it("a payment is shared over the VAT rates of what it pays for, to the cent", () => {
    // a stay of 300 at 7 % with breakfast of 50 at 19 %, paid 100
    expect(receiptVatAmounts(100, [{ rate: 7, gross: 300 }, { rate: 19, gross: 50 }, { rate: 7, gross: 0 }])).toEqual([
      { rate: 19, amount: 14.29 },
      { rate: 7, amount: 85.71 },
    ]);
    // a refund keeps the signs
    expect(receiptVatAmounts(-100, [{ rate: 7, gross: 300 }, { rate: 19, gross: 50 }]).reduce((s, a) => s + a.amount, 0)).toBeCloseTo(-100, 5);
    // a refund follows the payment it gives back
    expect(refundVatAmounts(-50, [{ rate: 19, amount: 14.29 }, { rate: 7, amount: 85.71 }])).toEqual([{ rate: 19, amount: -7.15 }, { rate: 7, amount: -42.85 }]);
    // nothing to share by: VAT not determinable
    expect(receiptVatAmounts(40, [])).toEqual([{ rate: null, amount: 40 }]);
  });

  it("rates as the TSE and DSFinV-K name them; a register's serial", () => {
    expect([19, 7, 0, null].map((r) => fiscalVat(r))).toEqual([
      { tse: "NORMAL", dsfinvk: 1 },
      { tse: "REDUCED_1", dsfinvk: 2 },
      { tse: "NULL", dsfinvk: 5 },
      { tse: "NULL", dsfinvk: 7 },
    ]);
    expect(() => fiscalVat(16)).toThrow(/16/);
    expect(fiscalSerial("0f5a3bab-cb99-4511-bb96-82d9c1199369")).toBe("HS-0F5A3BABCB994511BB9682D9C1199369");
    expect(fiscalScopeCovers("all", "card_terminal")).toBe(true);
    expect(fiscalScopeCovers("cash_and_vouchers", "card_terminal")).toBe(false);
  });

  it("the daily closing lists every Receipt with its TSE transaction or the outage, and sums cases and payments", () => {
    const at = new Date("2026-10-04T10:00:00Z");
    const c = dsfinvkClosing({
      clientId: "c1",
      exportNumber: 3,
      businessDate: "2026-10-04",
      createdAt: at,
      currency: "EUR",
      transactions: [
        { exportId: 11, number: 5, tssTxId: "tx-a", error: null, timeStart: at, timeEnd: at, businessCase: "Umsatz", paymentType: "Bar", currency: "EUR", amounts: [{ rate: 7, amount: 107 }] },
        { exportId: 12, number: null, tssTxId: "tx-b", error: "TSS not available", timeStart: at, timeEnd: at, businessCase: "Umsatz", paymentType: "Unbar", currency: "EUR", amounts: [{ rate: 19, amount: 119 }] },
      ],
    }) as any;
    expect(c.head).toMatchObject({ business_date: "2026-10-04", first_transaction_export_id: "11", last_transaction_export_id: "12" });
    expect(c.cash_statement.business_cases).toEqual([
      { type: "Umsatz", amounts_per_vat_id: [{ vat_definition_export_id: 1, incl_vat: 119, excl_vat: 100, vat: 19 }, { vat_definition_export_id: 2, incl_vat: 107, excl_vat: 100, vat: 7 }] },
    ]);
    expect(c.cash_statement.payment).toEqual({ full_amount: 226, cash_amount: 107, cash_amounts_by_currency: [{ currency_code: "EUR", amount: 107 }], payment_types: [{ type: "Bar", currency_code: "EUR", amount: 107 }, { type: "Unbar", currency_code: "EUR", amount: 119 }] });
    expect(c.transactions.map((t: any) => t.security)).toEqual([{ tss_tx_id: "tx-a" }, { error_message: "TSS not available" }]);
  });

  it("Austria: rate keys, the 48-hour outage report due within a week, the yearly receipt checked by 15 February", () => {
    expect([20, 10, 13, 19, 0].map(atVatKey)).toEqual(["STANDARD", "REDUCED_1", "REDUCED_2", "SPECIAL", "ZERO"]);
    expect(() => atVatKey(null)).toThrow();
    const start = new Date("2026-10-01T08:00:00Z");
    expect(atOutageReport({ startedAt: start, endedAt: new Date("2026-10-03T07:00:00Z") }, new Date("2026-10-05T00:00:00Z"))).toEqual({ due: false, reportBy: null });
    expect(atOutageReport({ startedAt: start, endedAt: null }, new Date("2026-10-03T09:00:00Z"))).toEqual({ due: true, reportBy: new Date("2026-10-10T08:00:00Z") });
    expect(yearlyReceiptCheckBy(new Date("2026-12-31T23:59:00Z"))).toBe("2027-02-15");
  });
});
