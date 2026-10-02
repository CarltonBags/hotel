import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakePaymentProvider } from "@hoteloftware/payments";
import { addDays, todayIn } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { loadFolios, postServiceCharge } from "../src/tenant/folios";
import {
  ApprovalRequired,
  captureCardHold,
  incrementCardHold,
  listCardHolds,
  listPaymentAccounts,
  listTerminalReaders,
  onboardPaymentAccount,
  placeCardHold,
  refreshPaymentAccount,
  refundPayment,
  registerTerminalReader,
  releaseCardHold,
  renewExpiringHolds,
  simulateCard,
  syncPayment,
  takePayment,
} from "../src/tenant/payments";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: onboarding a Legal Entity, Terminal readers, payments by Tender with
 * the balance after them, refunds with the Front Desk limit, Card Holds from
 * authorisation to capture, release and renewal. Against the fake provider.
 */
describe("payments", () => {
  let pool: Pool;
  let tenant: Tenant;
  let le: string;
  let berlin: string;
  let res: string;
  let reader: string;
  const provider = new FakePaymentProvider();
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const asFrontDesk = { userId: fd, unlimited: false };
  const asManager = { userId: "user_pm", unlimited: true };

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const s = tenant.schemaName;
    le = (await createLegalEntity(pool, s, { name: "Alpha GmbH", country: "DE" })).id;
    berlin = (await createProperty(pool, s, { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s, { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s, { propertyId: berlin, roomTypeId: dbl, numbers: ["101"] });
    await applyTaxPreset(pool, s, le, "DE");
    const std = (await listTaxCodes(pool, s, le)).find((c) => c.code === "STD")!.id;
    const minibar = await createService(pool, s, { propertyId: berlin, code: "MINI", name: "Minibar", defaultPrice: 100, taxCodeId: std, revenueAccount: "8410", postingRhythm: "once", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s, { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s, { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s, { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s, berlin, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: today, price: 100 }]);
    const guest = (await createGuest(pool, s, { firstName: "Aiko", lastName: "Tanaka" }, { userId: fd, propertyId: berlin })).id;
    const b = await createBooking(pool, s, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 1), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: guest }] });
    res = b.reservations[0]!.id;
    // a balance of 400 on the guest's folio
    await postServiceCharge(pool, s, res, { serviceId: minibar.id, quantity: 4 }, fd);
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  const balance = async () => (await loadFolios(pool, tenant.schemaName, res)).folios[0]!.balance;

  it("onboards the Legal Entity to a connected account mapped to the tenant", async () => {
    const s = tenant.schemaName;
    await expect(takePayment(pool, s, provider, { reservationId: res, tender: "card_terminal", amount: 10, readerId: "x" }, fd)).rejects.toThrow(/not set up for card payments/);
    const link = await onboardPaymentAccount(pool, s, provider, { tenantId: tenant.id, legalEntityId: le, email: null, returnUrl: "https://x/back", refreshUrl: "https://x/again" }, "user_owner");
    expect(link).toBe("https://x/back");
    await refreshPaymentAccount(pool, s, provider, le);
    const [account] = await listPaymentAccounts(pool, s);
    expect(account).toMatchObject({ legalEntityId: le, provider: "fake", chargesEnabled: true });
    const mapped = await pool.query("select tenant_id from control.external_ids where provider = 'fake' and external_id = $1", [account!.accountId]);
    expect(mapped.rows[0].tenant_id).toBe(tenant.id);
  });

  it("registers a Terminal reader at the property", async () => {
    const r = await registerTerminalReader(pool, tenant.schemaName, provider, berlin, { registrationCode: "desk-1", label: "Reception left" }, "user_pm");
    reader = r.readerId;
    expect((await listTerminalReaders(pool, tenant.schemaName, berlin)).map((x) => x.label)).toEqual(["Reception left"]);
  });

  it("a terminal payment waits for the card, then lowers the balance; only brand and last four are kept", async () => {
    const s = tenant.schemaName;
    expect(await balance()).toBe(400);
    const p = await takePayment(pool, s, provider, { reservationId: res, tender: "card_terminal", amount: 150, readerId: reader }, fd);
    expect(p.status).toBe("pending");
    expect(await balance()).toBe(400);
    await simulateCard(pool, s, provider, { paymentId: p.id });
    expect(await syncPayment(pool, s, provider, p.id)).toMatchObject({ status: "succeeded", cardBrand: "visa", cardLast4: "4242" });
    expect(await balance()).toBe(250);
    const cols = await pool.query("select column_name from information_schema.columns where table_schema = $1 and table_name in ('payments', 'card_holds')", [s]);
    expect(cols.rows.map((r) => r.column_name).filter((c: string) => /pan|card_number|cvc|expiry_month/.test(c))).toEqual([]);
  });

  it("a declined card leaves the payment failed and the balance as it was", async () => {
    const s = tenant.schemaName;
    const p = await takePayment(pool, s, provider, { reservationId: res, tender: "card_terminal", amount: 0.13, readerId: reader }, fd);
    await simulateCard(pool, s, provider, { paymentId: p.id });
    expect(await syncPayment(pool, s, provider, p.id)).toMatchObject({ status: "failed", error: "Card declined" });
    expect(await balance()).toBe(250);
  });

  it("a bank transfer is recorded with its reference and counts at once", async () => {
    const s = tenant.schemaName;
    await expect(takePayment(pool, s, provider, { reservationId: res, tender: "bank_transfer", amount: 50 }, fd)).rejects.toThrow(/reference/);
    const p = await takePayment(pool, s, provider, { reservationId: res, tender: "bank_transfer", amount: 50, reference: "SEPA 2026-10-02 Tanaka" }, fd);
    expect(p.status).toBe("succeeded");
    expect(await balance()).toBe(200);
  });

  it("refunds: a negative payment linked to the original; Front Desk above the limit needs Approval", async () => {
    const s = tenant.schemaName;
    const card = (await loadFolios(pool, s, res)).folios[0]!.payments.find((p) => p.tender === "card_terminal" && p.status === "succeeded")!;
    const r = await refundPayment(pool, s, provider, { paymentId: card.id, amount: 30, reason: "Minibar mistake" }, asFrontDesk);
    expect(r).toMatchObject({ amount: -30, status: "succeeded", refundOf: card.id });
    expect(await balance()).toBe(230);
    await expect(refundPayment(pool, s, provider, { paymentId: card.id, amount: 120.01, reason: "x" }, asFrontDesk)).rejects.toThrow(/more than/);
    // limit 200 by default: 100 is fine for Front Desk; lowering the limit below asks for Approval
    await pool.query(`update ${s}.properties set refund_limit = 50 where id = $1`, [berlin]);
    await expect(refundPayment(pool, s, provider, { paymentId: card.id, amount: 100, reason: "x" }, asFrontDesk)).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(refundPayment(pool, s, provider, { paymentId: card.id, amount: 100, reason: "x" }, asManager)).resolves.toMatchObject({ status: "succeeded" });
    await expect(refundPayment(pool, s, provider, { paymentId: card.id, amount: 10, reason: "" }, asManager)).rejects.toThrow(/reason/);
  });

  it("a refund the hotel's balance cannot cover waits as pending", async () => {
    const s = tenant.schemaName;
    const p = await takePayment(pool, s, provider, { reservationId: res, tender: "card_terminal", amount: 20, readerId: reader }, fd);
    await simulateCard(pool, s, provider, { paymentId: p.id });
    await syncPayment(pool, s, provider, p.id);
    provider.insufficientBalance = true;
    expect(await refundPayment(pool, s, provider, { paymentId: p.id, amount: 20, reason: "Guest left early" }, asManager)).toMatchObject({ status: "refund_pending_balance" });
    provider.insufficientBalance = false;
  });

  it("a Card Hold authorises with its expiry, increments, and is captured at checkout with the rest released", async () => {
    const s = tenant.schemaName;
    const h = await placeCardHold(pool, s, provider, { reservationId: res, amount: 300, readerId: reader }, fd);
    expect(h.status).toBe("pending");
    await simulateCard(pool, s, provider, { holdId: h.id });
    let [hold] = await listCardHolds(pool, s, res);
    expect(hold).toMatchObject({ status: "active", amount: 300, cardLast4: "4242" });
    expect(hold!.expiresAt).not.toBeNull();
    await incrementCardHold(pool, s, provider, { holdId: h.id, increment: 100 }, fd);
    await expect(incrementCardHold(pool, s, provider, { holdId: h.id, increment: 2001 }, fd)).rejects.toThrow(/increment/i);
    [hold] = await listCardHolds(pool, s, res);
    expect(hold).toMatchObject({ amount: 400, increments: 1 });
    // a hold is not a payment: the balance is unchanged until capture
    const before = await balance();
    const captured = await captureCardHold(pool, s, provider, { holdId: h.id, amount: 140 }, fd);
    expect(captured).toMatchObject({ amount: 140, tender: "card_terminal", status: "succeeded" });
    expect(await balance()).toBe(before - 140);
    [hold] = await listCardHolds(pool, s, res);
    expect(hold).toMatchObject({ status: "captured", capturedAmount: 140 });
    const other = await placeCardHold(pool, s, provider, { reservationId: res, amount: 50, readerId: reader }, fd);
    await simulateCard(pool, s, provider, { holdId: other.id });
    await releaseCardHold(pool, s, provider, other.id, fd);
    expect((await listCardHolds(pool, s, res)).find((x) => x.id === other.id)!.status).toBe("released");
  });

  it("a hold close to expiry is renewed on the same card and the desk is warned", async () => {
    const s = tenant.schemaName;
    const h = await placeCardHold(pool, s, provider, { reservationId: res, amount: 80, readerId: reader }, fd);
    await simulateCard(pool, s, provider, { holdId: h.id });
    // pretend it was made long ago and expires within the warning window
    await pool.query(`update ${s}.card_holds set authorised_at = now() - interval '4 days', expires_at = now() + interval '20 hours' where id = $1`, [h.id]);
    const warnings: string[] = [];
    const done = await renewExpiringHolds(pool, s, provider, new Date(), (w) => warnings.push(w.reservationId));
    expect(done).toEqual({ renewed: 1, failed: 0 });
    expect(warnings).toEqual([res]);
    const holds = await listCardHolds(pool, s, res);
    expect(holds.find((x) => x.id === h.id)!.status).toBe("released");
    expect(holds.find((x) => x.renewedFrom === h.id)).toMatchObject({ status: "active", amount: 80 });
    expect(await renewExpiringHolds(pool, s, provider, new Date(), () => undefined)).toEqual({ renewed: 0, failed: 0 });
  });
});
