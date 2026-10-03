import type { Pool, PoolClient } from "pg";
import {
  DESK_TENDERS,
  HOLD_WARNING_HOURS,
  PROVIDER_TENDERS,
  captureAmount,
  holdExpiry,
  holdIncrementAllowed,
  holdWarningAt,
  isOneOf,
  refundCheck,
  refundableAmount,
  roundMoney,
  type PaymentStatus,
  type Tender,
} from "@hoteloftware/domain";
import { ProviderError, type IntentState, type PaymentProvider } from "@hoteloftware/payments";
import { isUuid } from "./catalogue-common";
import { approvalFor } from "./approvals";
import { assertDepositInvoiceable, depositIn } from "./invoices";
import { openFolios } from "./folios";
import { mapProviderAccount } from "../control/external-ids";
import { withTenant } from "./with-tenant";

/**
 * Payments and Card Holds (ticket 27). The provider is called outside any
 * database transaction: a payment is stored pending first, handed to the
 * provider, and settled from the provider's answer (polling or webhook), so
 * a slow reader never holds a lock. Only provider ids, card brand and the
 * last four digits are stored; no card number ever reaches the PMS.
 */

/** A refund above the Front Desk limit needs a Property Manager's Approval (ticket 31); refused while none is granted. */
export class ApprovalRequired extends Error {
  constructor(limit: number) {
    super(`Refunds above ${limit.toFixed(2)} need a Property Manager's Approval (Approvals come with ticket 31)`);
    this.name = "ApprovalRequired";
  }
}

export interface Payment {
  id: string;
  folioId: string;
  reservationId: string;
  tender: Tender;
  amount: number;
  currency: string;
  status: PaymentStatus;
  refundOf: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  readerId: string | null;
  reference: string;
  error: string | null;
  postedAt: string;
  postedBy: string;
}

interface PaymentRow {
  id: string;
  folio_id: string;
  reservation_id: string;
  tender: Tender;
  amount: string;
  currency: string;
  status: PaymentStatus;
  refund_of: string | null;
  card_brand: string | null;
  card_last4: string | null;
  reader_id: string | null;
  reference: string;
  error: string | null;
  posted_at: Date;
  posted_by: string;
  provider: string | null;
  provider_intent_id: string | null;
  provider_refund_id: string | null;
  property_id: string;
}

const PAYMENT_COLUMNS = "id, folio_id, reservation_id, tender, amount, currency, status, refund_of, card_brand, card_last4, reader_id, reference, error, posted_at, posted_by, provider, provider_intent_id, provider_refund_id, property_id";

export function toPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    folioId: r.folio_id,
    reservationId: r.reservation_id,
    tender: r.tender,
    amount: Number(r.amount),
    currency: r.currency.trim(),
    status: r.status,
    refundOf: r.refund_of,
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    readerId: r.reader_id,
    reference: r.reference,
    error: r.error,
    postedAt: r.posted_at.toISOString(),
    postedBy: r.posted_by,
  };
}

/** The payments of a reservation, oldest first. */
export async function paymentsOf(tx: PoolClient, reservationId: string): Promise<Payment[]> {
  const { rows } = await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where reservation_id = $1 order by posted_at`, [reservationId]);
  return rows.map(toPayment);
}

// ── provider accounts ──

export interface PaymentAccount {
  legalEntityId: string;
  legalEntityName: string;
  provider: string;
  accountId: string;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
}

export async function listPaymentAccounts(pool: Pool, schema: string): Promise<PaymentAccount[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ legal_entity_id: string; name: string; provider: string; account_id: string; charges_enabled: boolean; details_submitted: boolean; payouts_enabled: boolean }>(
      `select a.legal_entity_id, l.name, a.provider, a.account_id, a.charges_enabled, a.details_submitted, a.payouts_enabled
       from payment_accounts a join legal_entities l on l.id = a.legal_entity_id order by l.name`,
    );
    return rows.map((r) => ({
      legalEntityId: r.legal_entity_id,
      legalEntityName: r.name,
      provider: r.provider,
      accountId: r.account_id,
      chargesEnabled: r.charges_enabled,
      detailsSubmitted: r.details_submitted,
      payoutsEnabled: r.payouts_enabled,
    }));
  });
}

/**
 * Start (or continue) onboarding a Legal Entity at the provider: the
 * connected account is created once and mapped to the tenant, so the
 * provider's webhooks find their tenant; returns the provider's onboarding
 * link for the person to complete there.
 */
export async function onboardPaymentAccount(
  pool: Pool,
  schema: string,
  provider: PaymentProvider,
  input: { tenantId: string; legalEntityId: string; email: string | null; returnUrl: string; refreshUrl: string },
  userId: string,
): Promise<string> {
  if (!isUuid(input.legalEntityId)) throw new Error("Legal Entity not found");
  // the Legal Entity's row is held while its account is created, so a second click waits and finds the account
  const { accountId, created } = await withTenant(pool, schema, async (tx) => {
    const le = (await tx.query<{ name: string; country: string }>("select name, country from legal_entities where id = $1 for update", [input.legalEntityId])).rows[0];
    if (!le) throw new Error("Legal Entity not found");
    const existing = (await tx.query<{ account_id: string }>("select account_id from payment_accounts where legal_entity_id = $1", [input.legalEntityId])).rows[0];
    if (existing) return { accountId: existing.account_id, created: false };
    const { accountId: id } = await provider.createAccount({ businessName: le.name, country: le.country, email: input.email });
    await tx.query("insert into payment_accounts (legal_entity_id, provider, account_id, created_by) values ($1, $2, $3, $4)", [input.legalEntityId, provider.name, id, userId]);
    return { accountId: id, created: true };
  });
  // the webhook intake finds the tenant of a provider event through this mapping
  if (created) await mapProviderAccount(pool, provider.name, accountId, input.tenantId);
  return provider.onboardingLink(accountId, { returnUrl: input.returnUrl, refreshUrl: input.refreshUrl });
}

/** Read the account's state from the provider (after onboarding, or on its webhook). */
export async function refreshPaymentAccount(pool: Pool, schema: string, provider: PaymentProvider, legalEntityId: string): Promise<void> {
  const accountId = await withTenant(pool, schema, async (tx) => (await tx.query<{ account_id: string }>("select account_id from payment_accounts where legal_entity_id = $1", [legalEntityId])).rows[0]?.account_id);
  if (!accountId) throw new Error("No payment account for this Legal Entity");
  const s = await provider.accountStatus(accountId);
  await withTenant(pool, schema, (tx) =>
    tx.query("update payment_accounts set charges_enabled = $2, details_submitted = $3, payouts_enabled = $4, updated_at = now() where legal_entity_id = $1", [
      legalEntityId,
      s.chargesEnabled,
      s.detailsSubmitted,
      s.payoutsEnabled,
    ]),
  );
}

/** By the provider's account id, from its webhook. */
export async function refreshPaymentAccountById(pool: Pool, schema: string, provider: PaymentProvider, accountId: string): Promise<void> {
  const le = await withTenant(pool, schema, async (tx) => (await tx.query<{ legal_entity_id: string }>("select legal_entity_id from payment_accounts where account_id = $1", [accountId])).rows[0]?.legal_entity_id);
  if (le) await refreshPaymentAccount(pool, schema, provider, le);
}

interface Context {
  accountId: string;
  currency: string;
  propertyId: string;
}

/** The property's provider account (its Legal Entity's), ready for card payments. */
async function accountFor(tx: PoolClient, propertyId: string): Promise<Context> {
  const { rows } = await tx.query<{ account_id: string | null; charges_enabled: boolean | null; currency: string }>(
    "select a.account_id, a.charges_enabled, p.currency from properties p left join payment_accounts a on a.legal_entity_id = p.legal_entity_id where p.id = $1",
    [propertyId],
  );
  const r = rows[0];
  if (!r?.account_id || !r.charges_enabled) throw new Error("This property is not set up for card payments yet (Settings → Payments)");
  return { accountId: r.account_id, currency: r.currency.trim(), propertyId };
}

// ── Terminal readers ──

export interface TerminalReader {
  id: string;
  readerId: string;
  label: string;
  deviceType: string;
}

export async function listTerminalReaders(pool: Pool, schema: string, propertyId: string): Promise<TerminalReader[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; reader_id: string; label: string; device_type: string }>("select id, reader_id, label, device_type from terminal_readers where property_id = $1 order by label", [propertyId]);
    return rows.map((r) => ({ id: r.id, readerId: r.reader_id, label: r.label, deviceType: r.device_type }));
  });
}

/** Pair a reader by the registration code it shows; the property's Terminal location is created on first need. */
export async function registerTerminalReader(pool: Pool, schema: string, provider: PaymentProvider, propertyId: string, input: { registrationCode: string; label: string }, userId: string): Promise<TerminalReader> {
  const code = input.registrationCode.trim();
  const label = input.label.trim();
  if (!code) throw new Error("Enter the code the reader shows");
  if (!label) throw new Error("Name the reader (say, the desk it sits at)");
  if (!isUuid(propertyId)) throw new Error("Property not found");
  const prop = await withTenant(pool, schema, async (tx) => {
    const ctx = await accountFor(tx, propertyId);
    // TODO(property address): properties carry no address yet; the Legal Entity's stands in for the Terminal location
    const p = (await tx.query<{ name: string; address_line1: string; city: string; postal_code: string; country: string; terminal_location_id: string | null }>(
      `select p.name, l.address_line1, l.city, l.postal_code, p.country, p.terminal_location_id
       from properties p join legal_entities l on l.id = p.legal_entity_id where p.id = $1`,
      [propertyId],
    )).rows[0]!;
    return { ...ctx, ...p };
  });
  let location = prop.terminal_location_id;
  if (!location) {
    location = (await provider.createLocation(prop.accountId, { displayName: prop.name, line1: prop.address_line1 || prop.name, city: prop.city || "-", postalCode: prop.postal_code || "-", country: prop.country })).locationId;
    await withTenant(pool, schema, (tx) => tx.query("update properties set terminal_location_id = $2 where id = $1", [propertyId, location]));
  }
  const r = await provider.registerReader(prop.accountId, { registrationCode: code, label, locationId: location });
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      "insert into terminal_readers (property_id, provider, reader_id, label, device_type, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
      [propertyId, provider.name, r.readerId, r.label, r.deviceType, userId],
    );
    return { id: rows[0]!.id, readerId: r.readerId, label: r.label, deviceType: r.deviceType };
  });
}

export async function removeTerminalReader(pool: Pool, schema: string, propertyId: string, id: string): Promise<void> {
  if (!isUuid(id)) throw new Error("Reader not found");
  await withTenant(pool, schema, async (tx) => {
    const { rowCount } = await tx.query("delete from terminal_readers where id = $1 and property_id = $2", [id, propertyId]);
    if (!rowCount) throw new Error("Reader not found");
  });
}

export async function setRefundLimit(pool: Pool, schema: string, propertyId: string, limit: number): Promise<void> {
  if (!Number.isFinite(limit) || limit < 0) throw new Error("The limit must be zero or more");
  await withTenant(pool, schema, (tx) => tx.query("update properties set refund_limit = $2 where id = $1", [propertyId, roundMoney(limit)]));
}

async function readerOf(tx: PoolClient, propertyId: string, readerId: string): Promise<string> {
  const { rows } = await tx.query<{ reader_id: string }>("select reader_id from terminal_readers where property_id = $1 and reader_id = $2", [propertyId, readerId]);
  if (!rows[0]) throw new Error("Choose a card reader of this property");
  return rows[0].reader_id;
}

// ── payments ──

interface ResRow {
  id: string;
  property_id: string;
  status: string;
}

async function lockReservation(tx: PoolClient, id: string): Promise<ResRow> {
  if (!isUuid(id)) throw new Error("Reservation not found");
  const { rows } = await tx.query<ResRow>("select id, property_id, status from reservations where id = $1 for update", [id]);
  if (!rows[0]) throw new Error("Reservation not found");
  return rows[0];
}

const amountOf = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) throw new Error("The amount must be more than zero");
  return roundMoney(n);
};

/** A provider's definite "no" (shown as is), or no answer at all (worded for the desk). */
function failureOf(err: unknown): { definite: boolean; message: string } {
  return err instanceof ProviderError ? { definite: true, message: err.message } : { definite: false, message: "The payment provider did not answer; the payment is checked again shortly" };
}

/** Open amount on the guest's own folios: Charges less payments received. */
async function guestBalance(tx: PoolClient, reservationId: string): Promise<number> {
  const { rows } = await tx.query<{ b: string }>(
    `select (select coalesce(sum(ch.amount), 0) from charges ch join folios f on f.id = ch.folio_id where ch.reservation_id = $1 and ch.voided_at is null and f.bill_to_guest_id is not null)
          - (select coalesce(sum(pa.amount), 0) from payments pa join folios f on f.id = pa.folio_id where pa.reservation_id = $1 and pa.status = 'succeeded' and f.bill_to_guest_id is not null) as b`,
    [reservationId],
  );
  return roundMoney(Number(rows[0]!.b));
}

/**
 * Take a Payment on a folio (the guest's main folio unless named). Tenders
 * through the provider (card terminal, OTA virtual card keyed on the reader)
 * start pending on the reader and settle from the provider's answer; the
 * others are recorded by staff and count at once (a bank transfer with its
 * reference; on account becomes a Receivable with the invoice, ticket 29).
 */
export async function takePayment(
  pool: Pool,
  schema: string,
  provider: PaymentProvider,
  input: { reservationId: string; folioId?: string | undefined; tender: string; amount: number; readerId?: string | undefined; reference?: string | undefined },
  userId: string,
): Promise<Payment> {
  if (!isOneOf(DESK_TENDERS, input.tender)) throw new Error("Unknown Tender");
  const tender = input.tender as Tender;
  const amount = amountOf(input.amount);
  const reference = (input.reference ?? "").trim().slice(0, 200);
  if (tender === "bank_transfer" && !reference) throw new Error("A bank transfer needs its reference");
  const viaProvider = PROVIDER_TENDERS.includes(tender);
  const prepared = await withTenant(pool, schema, async (tx) => {
    const res = await lockReservation(tx, input.reservationId);
    if (res.status === "cancelled" || res.status === "no_show") throw new Error("The reservation is closed");
    await openFolios(tx, res.id, userId);
    const folio = input.folioId
      ? (await tx.query<{ id: string }>("select id from folios where id = $1 and reservation_id = $2", [input.folioId, res.id])).rows[0]
      : (await tx.query<{ id: string }>("select id from folios where reservation_id = $1 and number = 1", [res.id])).rows[0];
    if (!folio) throw new Error("Folio not found on this reservation");
    const ctx = viaProvider ? await accountFor(tx, res.property_id) : { accountId: "", currency: (await tx.query<{ currency: string }>("select currency from properties where id = $1", [res.property_id])).rows[0]!.currency.trim(), propertyId: res.property_id };
    const reader = viaProvider ? await readerOf(tx, res.property_id, String(input.readerId ?? "")) : null;
    // money before check-in must be taxable as a deposit before it is taken
    await assertDepositInvoiceable(tx, res.id, tender);
    const { rows } = await tx.query<PaymentRow>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, reader_id, reference, posted_by, settled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning ${PAYMENT_COLUMNS}`,
      [folio.id, res.id, res.property_id, tender, amount, ctx.currency, viaProvider ? "pending" : "succeeded", viaProvider ? provider.name : null, reader, reference, userId, viaProvider ? null : new Date()],
    );
    // money received now, before check-in: its Deposit Invoice in the same transaction
    if (!viaProvider) await depositIn(tx, rows[0]!.id, userId);
    return { row: rows[0]!, ctx, reader };
  });
  if (!viaProvider) return toPayment(prepared.row);
  try {
    const { intentId } = await provider.startTerminalPayment(prepared.ctx.accountId, {
      readerId: prepared.reader!,
      amount,
      currency: prepared.ctx.currency,
      hold: false,
      moto: tender === "ota_virtual_card",
      description: "Folio payment",
      metadata: { payment_id: prepared.row.id },
      idempotencyKey: `payment:${prepared.row.id}`,
    });
    return withTenant(pool, schema, async (tx) => toPayment((await tx.query<PaymentRow>(`update payments set provider_intent_id = $2 where id = $1 returning ${PAYMENT_COLUMNS}`, [prepared.row.id, intentId])).rows[0]!));
  } catch (err) {
    // nothing reached the reader: the payment is dropped (a retry starts a new one)
    const f = failureOf(err);
    await withTenant(pool, schema, (tx) => tx.query("update payments set status = 'failed', error = $2 where id = $1 and status = 'pending'", [prepared.row.id, f.message]));
    throw new Error(f.message);
  }
}

/** Settle a pending payment from the provider's state (polling from the desk, or its webhook). */
export async function syncPayment(pool: Pool, schema: string, provider: PaymentProvider, paymentId: string): Promise<Payment> {
  if (!isUuid(paymentId)) throw new Error("Payment not found");
  const p = await withTenant(pool, schema, async (tx) => (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where id = $1`, [paymentId])).rows[0]);
  if (!p) throw new Error("Payment not found");
  if (p.status !== "pending" || !p.provider_intent_id || p.refund_of) return toPayment(p);
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, p.property_id));
  const state = await provider.getIntent(ctx.accountId, p.provider_intent_id);
  return applyIntentToPayment(pool, schema, p.id, state);
}

/** Only a pending payment changes: webhook and desk polling cannot settle it twice. */
async function applyIntentToPayment(pool: Pool, schema: string, paymentId: string, state: IntentState): Promise<Payment> {
  const status: PaymentStatus | null = state.status === "succeeded" ? "succeeded" : state.status === "failed" || state.status === "cancelled" ? "failed" : null;
  return settleIntent(pool, schema, paymentId, state, status);
}

/** Settle a pending payment; one received before check-in gets its Deposit Invoice in the same transaction. */
async function settleIntent(pool: Pool, schema: string, paymentId: string, state: IntentState, status: PaymentStatus | null): Promise<Payment> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<PaymentRow>(
      `update payments set status = coalesce($2, status), card_brand = coalesce($3, card_brand), card_last4 = coalesce($4, card_last4), error = $5,
         settled_at = case when $2::text is not null then clock_timestamp() else settled_at end
       where id = $1 and status = 'pending' returning ${PAYMENT_COLUMNS}`,
      [paymentId, status, state.brand, state.last4, state.status === "cancelled" ? "Cancelled at the reader" : state.error],
    );
    if (rows[0]?.status === "succeeded") await depositIn(tx, rows[0].id, rows[0].posted_by);
    return toPayment(rows[0] ?? (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where id = $1`, [paymentId])).rows[0]!);
  });
}

/**
 * Stop waiting for the card. The provider's real state decides: a card
 * presented just before is a payment received, not a cancelled one.
 */
export async function cancelPendingPayment(pool: Pool, schema: string, provider: PaymentProvider, paymentId: string): Promise<Payment> {
  if (!isUuid(paymentId)) throw new Error("Payment not found");
  const p = await withTenant(pool, schema, async (tx) => (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where id = $1`, [paymentId])).rows[0]);
  if (!p || p.status !== "pending" || p.refund_of) throw new Error("Only a payment waiting at the reader can be cancelled");
  if (p.provider_intent_id && p.reader_id) {
    const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, p.property_id));
    await provider.cancelTerminalPayment(ctx.accountId, p.reader_id, p.provider_intent_id);
    const state = await provider.getIntent(ctx.accountId, p.provider_intent_id);
    if (state.status !== "waiting") return applyIntentToPayment(pool, schema, p.id, state);
  }
  return withTenant(pool, schema, async (tx) =>
    toPayment(
      (await tx.query<PaymentRow>(`update payments set status = 'failed', error = 'Cancelled at the desk' where id = $1 and status = 'pending' returning ${PAYMENT_COLUMNS}`, [paymentId])).rows[0] ??
        (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where id = $1`, [paymentId])).rows[0]!,
    ),
  );
}

/** Test mode only: present the simulated card on the reader of a waiting payment or hold, and settle it as the webhook would. */
export async function simulateCard(pool: Pool, schema: string, provider: PaymentProvider, target: { paymentId?: string; holdId?: string }): Promise<void> {
  if (!provider.testMode) throw new Error("Simulated cards exist in test mode only");
  const row = await withTenant(pool, schema, async (tx) =>
    target.paymentId
      ? (await tx.query<{ property_id: string; reader_id: string | null }>("select property_id, reader_id from payments where id = $1", [target.paymentId])).rows[0]
      : (await tx.query<{ property_id: string; reader_id: string | null }>("select property_id, reader_id from card_holds where id = $1", [target.holdId])).rows[0],
  );
  if (!row?.reader_id) throw new Error("Nothing is waiting on a reader");
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, row.property_id));
  await provider.simulateCard(ctx.accountId, row.reader_id);
  if (target.paymentId) await syncPayment(pool, schema, provider, target.paymentId);
  if (target.holdId) await syncCardHold(pool, schema, provider, target.holdId);
}

/**
 * Refund part or all of a payment: a negative payment linked to the
 * original, through the provider for card tenders (back to the same card),
 * under an idempotency key so a retried request never refunds twice. Front
 * Desk may refund up to the property's limit per payment (earlier refunds
 * count); above it a Property Manager's Approval is needed (ticket 31). A
 * refund the provider did not answer stays pending and is retried; one the
 * hotel's balance cannot cover waits as "refund pending balance".
 */
export async function refundPayment(
  pool: Pool,
  schema: string,
  provider: PaymentProvider,
  input: { paymentId: string; amount: number; reason: string },
  actor: { userId: string; unlimited: boolean },
): Promise<Payment> {
  const reason = input.reason.trim().slice(0, 200);
  if (!reason) throw new Error("A refund needs a reason");
  if (!isUuid(input.paymentId)) throw new Error("Payment not found");
  const amount = amountOf(input.amount);
  const refund = await withTenant(pool, schema, async (tx) => {
    const orig = (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where id = $1`, [input.paymentId])).rows[0];
    if (!orig) throw new Error("Payment not found");
    await lockReservation(tx, orig.reservation_id);
    if (orig.refund_of || orig.status !== "succeeded") throw new Error("Only a received payment can be refunded");
    const refunds = (await tx.query<{ amount: string; status: PaymentStatus }>("select amount, status from payments where refund_of = $1", [orig.id])).rows.map((r) => ({ amount: Number(r.amount), status: r.status }));
    const limit = Number((await tx.query<{ refund_limit: string }>("select refund_limit from properties where id = $1", [orig.property_id])).rows[0]!.refund_limit);
    const refundable = refundableAmount(Number(orig.amount), refunds);
    const refundedSoFar = roundMoney(Number(orig.amount) - refundable);
    const verdict = refundCheck({ amount, refundable, refundedSoFar, limit, unlimited: actor.unlimited });
    if (verdict === "exceeds_refundable") throw new Error(`Cannot refund more than ${refundable.toFixed(2)} of this payment`);
    let approvedBy: string | null = null;
    if (verdict === "needs_approval") {
      const decision = await approvalFor({ kind: "refund_over_limit", propertyId: orig.property_id, requestedBy: actor.userId, amount, subjectId: orig.id });
      if (!decision.granted) throw new ApprovalRequired(limit);
      approvedBy = decision.approvedBy;
    }
    const viaProvider = Boolean(orig.provider_intent_id);
    const { rows } = await tx.query<PaymentRow>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, refund_of, provider, provider_intent_id, card_brand, card_last4, reference, approved_by, posted_by, settled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning ${PAYMENT_COLUMNS}`,
      [orig.folio_id, orig.reservation_id, orig.property_id, orig.tender, -amount, orig.currency.trim(), viaProvider ? "pending" : "succeeded", orig.id, orig.provider, orig.provider_intent_id, orig.card_brand, orig.card_last4, reason, approvedBy, actor.userId, viaProvider ? null : new Date()],
    );
    return rows[0]!;
  });
  if (!refund.provider_intent_id) return toPayment(refund);
  return sendRefund(pool, schema, provider, refund.id);
}

/** Ask the provider for a pending refund (first time or again); the key changes only after a definite "not now". */
async function sendRefund(pool: Pool, schema: string, provider: PaymentProvider, refundPaymentId: string): Promise<Payment> {
  const r = await withTenant(pool, schema, async (tx) => (await tx.query<PaymentRow & { provider_attempts: number }>(`select ${PAYMENT_COLUMNS}, provider_attempts from payments where id = $1`, [refundPaymentId])).rows[0]!);
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, r.property_id));
  try {
    const result = await provider.refund(ctx.accountId, {
      intentId: r.provider_intent_id!,
      amount: -Number(r.amount),
      metadata: { payment_id: r.id },
      idempotencyKey: `refund:${r.id}:${r.provider_attempts}`,
    });
    const status: PaymentStatus = result.status === "succeeded" ? "succeeded" : result.status === "failed" ? "failed" : result.status === "insufficient_balance" ? "refund_pending_balance" : "pending";
    return withTenant(pool, schema, async (tx) =>
      toPayment(
        (await tx.query<PaymentRow>(
          `update payments set status = $2, provider_refund_id = coalesce(nullif($3, ''), provider_refund_id), error = $4,
             provider_attempts = provider_attempts + case when $2 = 'refund_pending_balance' then 1 else 0 end,
             settled_at = case when $2 = 'succeeded' then clock_timestamp() else null end
           where id = $1 returning ${PAYMENT_COLUMNS}`,
          [r.id, status, result.refundId, result.error],
        )).rows[0]!,
      ),
    );
  } catch (err) {
    const f = failureOf(err);
    // a definite "no" fails the refund; no answer leaves it pending (and counted), to be sent again under the same key
    return withTenant(pool, schema, async (tx) =>
      toPayment((await tx.query<PaymentRow>(`update payments set status = $2, error = $3 where id = $1 returning ${PAYMENT_COLUMNS}`, [r.id, f.definite ? "failed" : "pending", f.message])).rows[0]!),
    );
  }
}

/** A refund event from the provider: settle the refund it is about. */
export async function syncRefund(pool: Pool, schema: string, provider: PaymentProvider, refundId: string): Promise<{ propertyId: string } | null> {
  const p = await withTenant(pool, schema, async (tx) => (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where provider_refund_id = $1`, [refundId])).rows[0]);
  if (!p) return null;
  if (p.status === "succeeded" || p.status === "failed") return { propertyId: p.property_id };
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, p.property_id));
  const r = await provider.getRefund(ctx.accountId, refundId);
  if (r.status === "succeeded" || r.status === "failed") {
    await withTenant(pool, schema, (tx) =>
      tx.query("update payments set status = $2, error = $3, settled_at = case when $2 = 'succeeded' then clock_timestamp() else null end where id = $1 and status in ('pending', 'refund_pending_balance')", [p.id, r.status, r.error]),
    );
  }
  return { propertyId: p.property_id };
}

/** The scheduled retry of refunds still open: unanswered ones under the same key, those waiting for balance under a new one. */
export async function retryOpenRefunds(pool: Pool, schema: string, provider: PaymentProvider): Promise<{ propertyIds: string[] }> {
  const open = await withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; property_id: string }>(
      "select id, property_id from payments where refund_of is not null and provider_intent_id is not null and (status = 'refund_pending_balance' or (status = 'pending' and provider_refund_id is null))",
    )).rows,
  );
  const touched = new Set<string>();
  for (const r of open) {
    const after = await sendRefund(pool, schema, provider, r.id);
    if (after.status === "succeeded") touched.add(r.property_id);
  }
  return { propertyIds: [...touched] };
}

// ── Card Holds ──

export interface CardHold {
  id: string;
  reservationId: string;
  status: "pending" | "active" | "captured" | "released" | "expired" | "failed";
  channel: "terminal" | "online" | "moto";
  amount: number;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
  increments: number;
  extended: boolean;
  authorisedAt: string | null;
  expiresAt: string | null;
  warnedAt: string | null;
  renewedFrom: string | null;
  capturedAmount: number | null;
  /** The card is saved for holds without the guest (renewal, incidentals beyond the limits). */
  cardSaved: boolean;
  error: string | null;
}

interface HoldRow {
  id: string;
  reservation_id: string;
  property_id: string;
  provider_intent_id: string;
  reader_id: string | null;
  channel: "terminal" | "online" | "moto";
  provider_customer_id: string | null;
  payment_method_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  amount: string;
  currency: string;
  increments: number;
  extended: boolean;
  status: CardHold["status"];
  authorised_at: Date | null;
  expires_at: Date | null;
  warned_at: Date | null;
  renewed_from: string | null;
  captured_amount: string | null;
  error: string | null;
}

const HOLD_COLUMNS =
  "id, reservation_id, property_id, provider_intent_id, reader_id, channel, provider_customer_id, payment_method_id, card_brand, card_last4, amount, currency, increments, extended, status, authorised_at, expires_at, warned_at, renewed_from, captured_amount, error";

function toHold(r: HoldRow): CardHold {
  return {
    id: r.id,
    reservationId: r.reservation_id,
    status: r.status,
    channel: r.channel,
    amount: Number(r.amount),
    currency: r.currency.trim(),
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    increments: r.increments,
    extended: r.extended,
    authorisedAt: r.authorised_at?.toISOString() ?? null,
    expiresAt: r.expires_at?.toISOString() ?? null,
    warnedAt: r.warned_at?.toISOString() ?? null,
    renewedFrom: r.renewed_from,
    capturedAmount: r.captured_amount === null ? null : Number(r.captured_amount),
    cardSaved: Boolean(r.provider_customer_id && r.payment_method_id),
    error: r.error,
  };
}

export async function listCardHolds(pool: Pool, schema: string, reservationId: string): Promise<CardHold[]> {
  if (!isUuid(reservationId)) return [];
  return withTenant(pool, schema, async (tx) => (await tx.query<HoldRow>(`select ${HOLD_COLUMNS} from card_holds where reservation_id = $1 order by created_at`, [reservationId])).rows.map(toHold));
}

async function holdRow(pool: Pool, schema: string, holdId: string): Promise<HoldRow> {
  if (!isUuid(holdId)) throw new Error("Card Hold not found");
  const r = await withTenant(pool, schema, async (tx) => (await tx.query<HoldRow>(`select ${HOLD_COLUMNS} from card_holds where id = $1`, [holdId])).rows[0]);
  if (!r) throw new Error("Card Hold not found");
  return r;
}

/**
 * Work on one hold under its row lock. The provider is called while the lock
 * is held (short calls, one row): two desks cannot raise, capture or release
 * the same hold at once. Waiting at a reader never happens under a lock.
 */
async function withHold<T>(pool: Pool, schema: string, holdId: string, fn: (tx: PoolClient, h: HoldRow, ctx: Context) => Promise<T>): Promise<T> {
  if (!isUuid(holdId)) throw new Error("Card Hold not found");
  return withTenant(pool, schema, async (tx) => {
    const h = (await tx.query<HoldRow>(`select ${HOLD_COLUMNS} from card_holds where id = $1 for update`, [holdId])).rows[0];
    if (!h) throw new Error("Card Hold not found");
    return fn(tx, h, await accountFor(tx, h.property_id));
  });
}

/** Ask the guest's card on the reader for a pre-authorisation of the amount (the highest expected: in the EEA no capture above it). */
export async function placeCardHold(pool: Pool, schema: string, provider: PaymentProvider, input: { reservationId: string; amount: number; readerId: string }, userId: string): Promise<CardHold> {
  const amount = amountOf(input.amount);
  const prepared = await withTenant(pool, schema, async (tx) => {
    const res = await lockReservation(tx, input.reservationId);
    if (res.status !== "confirmed" && res.status !== "checked_in") throw new Error("Card Holds are for open stays only");
    const ctx = await accountFor(tx, res.property_id);
    const reader = await readerOf(tx, res.property_id, input.readerId);
    // the hold's row exists before the reader is asked, so its id keys the request
    const { rows } = await tx.query<{ id: string }>(
      `insert into card_holds (reservation_id, property_id, provider, provider_intent_id, reader_id, channel, amount, currency, status, created_by)
       values ($1, $2, $3, 'pending:' || gen_random_uuid(), $4, 'terminal', $5, $6, 'pending', $7) returning id`,
      [res.id, res.property_id, provider.name, reader, amount, ctx.currency, userId],
    );
    return { res, ctx, reader, holdId: rows[0]!.id };
  });
  try {
    const { intentId } = await provider.startTerminalPayment(prepared.ctx.accountId, {
      readerId: prepared.reader,
      amount,
      currency: prepared.ctx.currency,
      hold: true,
      moto: false,
      description: "Card Hold",
      metadata: { hold_id: prepared.holdId },
      idempotencyKey: `hold:${prepared.holdId}`,
    });
    return withTenant(pool, schema, async (tx) => toHold((await tx.query<HoldRow>(`update card_holds set provider_intent_id = $2 where id = $1 returning ${HOLD_COLUMNS}`, [prepared.holdId, intentId])).rows[0]!));
  } catch (err) {
    const f = failureOf(err);
    await withTenant(pool, schema, (tx) => tx.query("update card_holds set status = 'failed', error = $2 where id = $1 and status = 'pending'", [prepared.holdId, f.message]));
    throw new Error(f.message);
  }
}

/** Bring a hold up to date from the provider: authorised (with its expiry and saved card), declined, cancelled, or captured elsewhere. */
export async function syncCardHold(pool: Pool, schema: string, provider: PaymentProvider, holdId: string): Promise<CardHold> {
  const h = await holdRow(pool, schema, holdId);
  if ((h.status !== "pending" && h.status !== "active") || h.provider_intent_id.startsWith("pending:")) return toHold(h);
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, h.property_id));
  const state = await provider.getIntent(ctx.accountId, h.provider_intent_id);
  return withTenant(pool, schema, async (tx) => {
    // only an open hold changes: a capture or release that committed meanwhile is never undone
    const cur = (await tx.query<HoldRow>(`select ${HOLD_COLUMNS} from card_holds where id = $1 and status in ('pending', 'active') for update`, [h.id])).rows[0];
    if (!cur) return toHold((await tx.query<HoldRow>(`select ${HOLD_COLUMNS} from card_holds where id = $1`, [h.id])).rows[0]!);
    if (state.status === "authorised") {
      const authorisedAt = cur.authorised_at ?? new Date();
      // the provider's own deadline when it gives one, else the card rules (research)
      const expires = state.captureBefore ?? holdExpiry({ channel: cur.channel, brand: state.brand, extended: state.extended, authorisedAt });
      const { rows } = await tx.query<HoldRow>(
        `update card_holds set status = 'active', amount = $2, card_brand = coalesce($3, card_brand), card_last4 = coalesce($4, card_last4),
           payment_method_id = coalesce($5, payment_method_id), provider_customer_id = coalesce($6, provider_customer_id),
           extended = $7, authorised_at = $8, expires_at = $9, error = null where id = $1 returning ${HOLD_COLUMNS}`,
        [cur.id, state.capturable || Number(cur.amount), state.brand, state.last4, state.paymentMethodId, state.customerId, state.extended, authorisedAt, expires],
      );
      return toHold(rows[0]!);
    }
    if (state.status === "succeeded" && cur.status === "active") {
      // captured at the provider but not recorded here (a crash after the capture): record it now
      await recordCapture(tx, cur, provider.name, state.received, "system");
      return toHold((await tx.query<HoldRow>(`select ${HOLD_COLUMNS} from card_holds where id = $1`, [cur.id])).rows[0]!);
    }
    if (state.status === "failed" || state.status === "cancelled") {
      const { rows } = await tx.query<HoldRow>(`update card_holds set status = $2, error = $3 where id = $1 returning ${HOLD_COLUMNS}`, [cur.id, cur.status === "pending" ? "failed" : "released", state.error]);
      return toHold(rows[0]!);
    }
    // a declined tap leaves the hold waiting on the reader, with the reason shown
    const { rows } = await tx.query<HoldRow>(`update card_holds set error = $2 where id = $1 returning ${HOLD_COLUMNS}`, [cur.id, state.error]);
    return toHold(rows[0]!);
  });
}

/** The captured money as a card payment on the guest's main folio; the hold closes. */
async function recordCapture(tx: PoolClient, h: HoldRow, providerName: string, amount: number, userId: string): Promise<Payment> {
  await openFolios(tx, h.reservation_id, userId);
  const folio = (await tx.query<{ id: string }>("select id from folios where reservation_id = $1 and number = 1", [h.reservation_id])).rows[0]!;
  // a hold renewed on the saved card was taken without the card present
  const tender: Tender = h.channel === "online" ? "card_online" : "card_terminal";
  const { rows } = await tx.query<PaymentRow>(
    `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, provider_intent_id, reader_id, card_brand, card_last4, reference, posted_by, settled_at)
     values ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8, $9, $10, $11, 'Card Hold captured', $12, clock_timestamp()) returning ${PAYMENT_COLUMNS}`,
    [folio.id, h.reservation_id, h.property_id, tender, amount, h.currency.trim(), providerName, h.provider_intent_id, h.reader_id, h.card_brand, h.card_last4, userId],
  );
  await tx.query("update card_holds set status = 'captured', captured_amount = $2, capture_payment_id = $3 where id = $1", [h.id, amount, rows[0]!.id]);
  return toPayment(rows[0]!);
}

/** Raise an active hold, within the provider's limits (10 increments; each up to the greater of 500 or 5× held). */
export async function incrementCardHold(pool: Pool, schema: string, provider: PaymentProvider, input: { holdId: string; increment: number }): Promise<CardHold> {
  const increment = amountOf(input.increment);
  return withHold(pool, schema, input.holdId, async (tx, h, ctx) => {
    if (h.status !== "active") throw new Error("Only an active hold can be raised");
    if (!holdIncrementAllowed({ held: Number(h.amount), increment, increments: h.increments })) {
      throw new Error("This increment is beyond the card's limits; cover the balance instead, or place a new hold");
    }
    const state = await provider.incrementHold(ctx.accountId, h.provider_intent_id, roundMoney(Number(h.amount) + increment), `increment:${h.id}:${h.increments + 1}`);
    return toHold((await tx.query<HoldRow>(`update card_holds set amount = $2, increments = increments + 1 where id = $1 returning ${HOLD_COLUMNS}`, [h.id, state.capturable])).rows[0]!);
  });
}

/**
 * Incidentals in one batch: raise the hold so it covers what the guest owes
 * now. Beyond the card's increment limits, a fresh authorisation for the rest
 * goes on the saved card (merchant-initiated); without a saved card the desk
 * places a new hold on the reader.
 */
export async function coverBalanceWithHold(pool: Pool, schema: string, provider: PaymentProvider, holdId: string, userId: string): Promise<{ raisedBy: number; newHoldId: string | null }> {
  const plan = await withHold(pool, schema, holdId, async (tx, h, ctx) => {
    if (h.status !== "active") throw new Error("Only an active hold can be raised");
    const held = (await tx.query<{ s: string }>("select coalesce(sum(amount), 0) as s from card_holds where reservation_id = $1 and status = 'active'", [h.reservation_id])).rows[0]!.s;
    const shortfall = roundMoney((await guestBalance(tx, h.reservation_id)) - Number(held));
    if (shortfall <= 0) return { raisedBy: 0, fresh: null as null | { h: HoldRow; ctx: Context; amount: number } };
    if (holdIncrementAllowed({ held: Number(h.amount), increment: shortfall, increments: h.increments })) {
      const state = await provider.incrementHold(ctx.accountId, h.provider_intent_id, roundMoney(Number(h.amount) + shortfall), `increment:${h.id}:${h.increments + 1}`);
      await tx.query("update card_holds set amount = $2, increments = increments + 1 where id = $1", [h.id, state.capturable]);
      return { raisedBy: shortfall, fresh: null };
    }
    if (!h.provider_customer_id || !h.payment_method_id) throw new Error("Beyond this hold's limits and the card is not saved: place a new hold on the reader");
    return { raisedBy: 0, fresh: { h, ctx, amount: shortfall } };
  });
  if (!plan.fresh) return { raisedBy: plan.raisedBy, newHoldId: null };
  const { h, ctx, amount } = plan.fresh;
  const id = await savedCardHold(pool, schema, provider, h, ctx, amount, { renewedFrom: null, key: `cover:${h.id}:${h.increments}`, userId });
  return { raisedBy: amount, newHoldId: id };
}

/** A hold on the saved card without the guest, recorded as an online hold. */
async function savedCardHold(pool: Pool, schema: string, provider: PaymentProvider, h: HoldRow, ctx: Context, amount: number, opts: { renewedFrom: string | null; key: string; userId: string }): Promise<string> {
  const state = await provider.holdSavedCard(ctx.accountId, {
    customerId: h.provider_customer_id!,
    paymentMethodId: h.payment_method_id!,
    amount,
    currency: h.currency.trim(),
    metadata: { reservation_id: h.reservation_id },
    idempotencyKey: opts.key,
  });
  if (state.status !== "authorised") throw new ProviderError(state.error ?? "The card did not authorise");
  const authorisedAt = new Date();
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into card_holds (reservation_id, property_id, provider, provider_intent_id, reader_id, channel, provider_customer_id, payment_method_id, card_brand, card_last4, amount, currency, extended, status, authorised_at, expires_at, renewed_from, created_by)
       values ($1, $2, $3, $4, null, 'online', $5, $6, $7, $8, $9, $10, $11, 'active', $12, $13, $14, $15)
       on conflict (provider_intent_id) do update set status = card_holds.status returning id`,
      [h.reservation_id, h.property_id, provider.name, state.intentId, h.provider_customer_id, state.paymentMethodId ?? h.payment_method_id, state.brand ?? h.card_brand, state.last4 ?? h.card_last4, state.capturable, h.currency.trim(), state.extended, authorisedAt, state.captureBefore ?? holdExpiry({ channel: "online", brand: state.brand, extended: state.extended, authorisedAt }), opts.renewedFrom, opts.userId],
    );
    return rows[0]!.id;
  });
}

/** At checkout: capture what is due on the guest's folios (or the amount named), never more than held; the rest is released. */
export async function captureCardHold(pool: Pool, schema: string, provider: PaymentProvider, input: { holdId: string; amount?: number | undefined }, userId: string): Promise<Payment> {
  return withHold(pool, schema, input.holdId, async (tx, h, ctx) => {
    if (h.status !== "active") throw new Error("Only an active hold can be captured");
    const due = input.amount === undefined ? await guestBalance(tx, h.reservation_id) : amountOf(input.amount);
    if (input.amount !== undefined && roundMoney(due - Number(h.amount)) > 0) throw new Error(`Cannot capture more than the ${Number(h.amount).toFixed(2)} held`);
    const { capture } = captureAmount(Number(h.amount), due);
    if (capture <= 0) throw new Error("Nothing is due: release the hold instead");
    // the same key on a retry returns the same capture: a crash before commit never captures twice
    const state = await provider.captureHold(ctx.accountId, h.provider_intent_id, capture, `capture:${h.id}`);
    return recordCapture(tx, h, provider.name, state.received || capture, userId);
  });
}

/** Release a hold the guest no longer needs, or one still waiting on the reader. */
export async function releaseCardHold(pool: Pool, schema: string, provider: PaymentProvider, holdId: string): Promise<void> {
  await withHold(pool, schema, holdId, async (tx, h, ctx) => {
    if (h.status !== "active" && h.status !== "pending") throw new Error("The hold is no longer open");
    if (!h.provider_intent_id.startsWith("pending:")) {
      if (h.status === "pending" && h.reader_id) await provider.cancelTerminalPayment(ctx.accountId, h.reader_id, h.provider_intent_id);
      else await provider.releaseHold(ctx.accountId, h.provider_intent_id);
    }
    await tx.query("update card_holds set status = 'released' where id = $1 and status in ('active', 'pending')", [h.id]);
  });
}

export interface HoldWarning {
  holdId: string;
  reservationId: string;
  propertyId: string;
  renewed: boolean;
  error: string | null;
}

/**
 * The scheduled hold check. Holds past their expiry are marked expired. A
 * hold inside its renewal window (48 hours before expiry, or the last half of
 * a shorter hold) of a stay that lasts beyond it is renewed on the saved card
 * and the old one released; the desk is told either way. A stay that ends
 * before its hold runs out needs nothing. Each hold is claimed before the
 * provider is asked, so overlapping runs never renew twice.
 */
export async function renewExpiringHolds(pool: Pool, schema: string, provider: PaymentProvider, now: Date, warn: (w: HoldWarning) => void): Promise<{ renewed: number; failed: number }> {
  const candidates = await withTenant(pool, schema, async (tx) => {
    await tx.query("update card_holds set status = 'expired' where status = 'active' and expires_at < $1", [now]);
    return (await tx.query<HoldRow & { res_status: string; outlasts: boolean }>(
      `select ${HOLD_COLUMNS.split(", ").map((c) => `h.${c}`).join(", ")}, r.status as res_status,
         r.departure > (h.expires_at at time zone p.time_zone)::date as outlasts
       from card_holds h join reservations r on r.id = h.reservation_id join properties p on p.id = h.property_id
       where h.status = 'active' and h.warned_at is null and h.expires_at <= $1::timestamptz + make_interval(hours => $2)`,
      [now, HOLD_WARNING_HOURS],
    )).rows;
  });
  let renewed = 0;
  let failed = 0;
  for (const h of candidates) {
    if (holdWarningAt(h.expires_at!, h.authorised_at ?? now) > now) continue;
    const open = (h.res_status === "confirmed" || h.res_status === "checked_in") && h.outlasts;
    // claim: whoever sets warned_at first handles the hold
    const claimed = await withTenant(pool, schema, async (tx) => (await tx.query("update card_holds set warned_at = $2 where id = $1 and warned_at is null and status = 'active'", [h.id, now])).rowCount === 1);
    if (!claimed || !open) continue;
    let error: string | null = null;
    let ok = false;
    if (h.provider_customer_id && h.payment_method_id) {
      try {
        const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, h.property_id));
        await savedCardHold(pool, schema, provider, h, ctx, Number(h.amount), { renewedFrom: h.id, key: `renew:${h.id}`, userId: "system" });
        await provider.releaseHold(ctx.accountId, h.provider_intent_id).catch(() => undefined);
        await withTenant(pool, schema, (tx) => tx.query("update card_holds set status = 'released' where id = $1 and status = 'active'", [h.id]));
        ok = true;
        renewed++;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    } else {
      error = "The card is not saved for renewal";
    }
    if (!ok) {
      failed++;
      await withTenant(pool, schema, (tx) => tx.query("update card_holds set error = $2 where id = $1", [h.id, error]));
    }
    warn({ holdId: h.id, reservationId: h.reservation_id, propertyId: h.property_id, renewed: ok, error });
  }
  return { renewed, failed };
}

/** A provider event about an intent: settle the payment or hold it belongs to. */
export async function syncByIntent(pool: Pool, schema: string, provider: PaymentProvider, intentId: string): Promise<{ propertyId: string } | null> {
  const found = await withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ id: string; property_id: string }>("select id, property_id from payments where provider_intent_id = $1 and refund_of is null and status = 'pending'", [intentId])).rows[0];
    const h = (await tx.query<{ id: string; property_id: string }>("select id, property_id from card_holds where provider_intent_id = $1", [intentId])).rows[0];
    return { p, h };
  });
  if (found.p) {
    await syncPayment(pool, schema, provider, found.p.id);
    return { propertyId: found.p.property_id };
  }
  if (found.h) {
    await syncCardHold(pool, schema, provider, found.h.id);
    return { propertyId: found.h.property_id };
  }
  return null;
}

export interface PaymentListRow extends Payment {
  confirmationNumber: string;
  guestName: string;
}

/** Payments and refunds of a property over the last days, newest first (the Payments list). */
export async function listRecentPayments(pool: Pool, schema: string, propertyId: string, days = 7): Promise<PaymentListRow[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<PaymentRow & { confirmation_number: string; guest_name: string }>(
      `select ${PAYMENT_COLUMNS.split(", ").map((c) => `pa.${c}`).join(", ")}, b.confirmation_number, trim(g.first_name || ' ' || g.last_name) as guest_name
       from payments pa join reservations r on r.id = pa.reservation_id join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id
       where pa.property_id = $1 and pa.posted_at >= now() - make_interval(days => $2) order by pa.posted_at desc limit 500`,
      [propertyId, days],
    );
    return rows.map((r) => ({ ...toPayment(r), confirmationNumber: r.confirmation_number, guestName: r.guest_name }));
  });
}
