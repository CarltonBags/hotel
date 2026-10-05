import { describe, expect, it } from "vitest";
import { acceptsOnlineReservations, lockedByNonPayment, nonPaymentStage } from "../src/non-payment";

describe("the non-payment ladder on a simulated timeline", () => {
  it("each stage on its days", () => {
    const timeline = [null, 0, 1, 29, 30, 59, 60, 89, 90].map((d) => [d, nonPaymentStage(d)]);
    expect(timeline).toEqual([
      [null, "none"],
      [0, "none"],
      [1, "reminders"],
      [29, "reminders"],
      [30, "restricted"],
      [59, "restricted"],
      [60, "no_new_bookings"],
      [89, "no_new_bookings"],
      [90, "termination"],
    ]);
  });

  it("settings and reports lock from day 30; operations, subscription and export stay open", () => {
    expect(lockedByNonPayment("reminders", "manage_tenant_settings")).toBe(false);
    expect(lockedByNonPayment("restricted", "manage_tenant_settings")).toBe(true);
    expect(lockedByNonPayment("restricted", "view_revenue_reports")).toBe(true);
    expect(lockedByNonPayment("restricted", "check_in")).toBe(false);
    expect(lockedByNonPayment("termination", "manage_subscription")).toBe(false);
    expect(lockedByNonPayment("restricted", "take_payments")).toBe(false);
  });

  it("no new online reservations after day 60", () => {
    expect(acceptsOnlineReservations("restricted")).toBe(true);
    expect(acceptsOnlineReservations("no_new_bookings")).toBe(false);
  });
});
