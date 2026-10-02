import type { Pool, PoolClient } from "pg";
import {
  HOLD_WARNING_HOURS,
  PROVIDER_TENDERS,
  TENDERS,
  holdExpiry,
  holdIncrementAllowed,
  isOneOf,
  refundCheck,
  refundableAmount,
  roundMoney,
  type PaymentStatus,
  type Tender,
} from "@hoteloftware/domain";
import { ProviderError, type IntentState, type PaymentProvider } from "@hoteloftware/payments";
import { isUuid } from "./catalogue-common";
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

/** A refund above the Front Desk limit needs a Property Manager's Approval (ticket 31); until then it is refused. */
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
  const existing = await withTenant(pool, schema, async (tx) => {
    const le = await tx.query<{ name: string; country: string }>("select name, country from legal_entities where id = $1", [input.legalEntityId]);
    if (!le.rows[0]) throw new Error("Legal Entity not found");
    const acc = await tx.query<{ account_id: string }>("select account_id from payment_accounts where legal_entity_id = $1", [input.legalEntityId]);
    return { le: le.rows[0], accountId: acc.rows[0]?.account_id ?? null };
  });
  let accountId = existing.accountId;
  if (!accountId) {
    accountId = (await provider.createAccount({ businessName: existing.le.name, country: existing.le.country, email: input.email })).accountId;
    await withTenant(pool, schema, (tx) =>
      tx.query("insert into payment_accounts (legal_entity_id, provider, account_id, created_by) values ($1, $2, $3, $4)", [input.legalEntityId, provider.name, accountId, userId]),
    );
    // the webhook intake finds the tenant of a provider event through this mapping
    await mapProviderAccount(pool, provider.name, accountId, input.tenantId);
  }
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
  if (!isOneOf(TENDERS, input.tender)) throw new Error("Unknown Tender");
  const tender = input.tender;
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
    const { rows } = await tx.query<PaymentRow>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, reader_id, reference, posted_by, settled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning ${PAYMENT_COLUMNS}`,
      [folio.id, res.id, res.property_id, tender, amount, ctx.currency, viaProvider ? "pending" : "succeeded", viaProvider ? provider.name : null, reader, reference, userId, viaProvider ? null : new Date()],
    );
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
      description: `Folio payment`,
      metadata: { payment_id: prepared.row.id },
    });
    return withTenant(pool, schema, async (tx) => toPayment((await tx.query<PaymentRow>(`update payments set provider_intent_id = $2 where id = $1 returning ${PAYMENT_COLUMNS}`, [prepared.row.id, intentId])).rows[0]!));
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : "The payment provider could not be reached";
    await withTenant(pool, schema, (tx) => tx.query("update payments set status = 'failed', error = $2 where id = $1", [prepared.row.id, message]));
    throw err instanceof ProviderError ? err : new Error(message);
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

async function applyIntentToPayment(pool: Pool, schema: string, paymentId: string, state: IntentState): Promise<Payment> {
  const status: PaymentStatus | null = state.status === "succeeded" ? "succeeded" : state.status === "failed" || state.status === "cancelled" ? "failed" : null;
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<PaymentRow>(
      `update payments set status = coalesce($2, status), card_brand = coalesce($3, card_brand), card_last4 = coalesce($4, card_last4), error = $5,
         settled_at = case when $2::text is not null then clock_timestamp() else settled_at end
       where id = $1 and status = 'pending' returning ${PAYMENT_COLUMNS}`,
      [paymentId, status, state.brand, state.last4, state.status === "cancelled" ? "Cancelled at the reader" : state.error],
    );
    return toPayment(rows[0] ?? (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where id = $1`, [paymentId])).rows[0]!);
  });
}

/** Stop waiting for the card: the reader is freed and the payment dropped. */
export async function cancelPendingPayment(pool: Pool, schema: string, provider: PaymentProvider, paymentId: string): Promise<void> {
  if (!isUuid(paymentId)) throw new Error("Payment not found");
  const p = await withTenant(pool, schema, async (tx) => (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where id = $1`, [paymentId])).rows[0]);
  if (!p || p.status !== "pending") throw new Error("Only a payment waiting at the reader can be cancelled");
  if (p.provider_intent_id && p.reader_id) {
    const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, p.property_id));
    await provider.cancelTerminalPayment(ctx.accountId, p.reader_id, p.provider_intent_id);
  }
  await withTenant(pool, schema, (tx) => tx.query("update payments set status = 'failed', error = 'Cancelled at the desk' where id = $1 and status = 'pending'", [paymentId]));
}

/** Test mode only: present the simulated card on the reader of a waiting payment or hold. */
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
  // settle at once, as the provider's webhook would
  if (target.paymentId) await syncPayment(pool, schema, provider, target.paymentId);
  if (target.holdId) await syncCardHold(pool, schema, provider, target.holdId);
}

/**
 * Refund part or all of a payment: a negative payment linked to the
 * original, through the provider for card tenders (back to the same card).
 * Front Desk may refund up to the property's limit; above it Approval is
 * needed (ticket 31; refused until then). A refund the hotel's provider
 * balance cannot cover waits as "refund pending balance".
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
  const prepared = await withTenant(pool, schema, async (tx) => {
    const orig = (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where id = $1`, [input.paymentId])).rows[0];
    if (!orig) throw new Error("Payment not found");
    await lockReservation(tx, orig.reservation_id);
    if (orig.refund_of || orig.status !== "succeeded") throw new Error("Only a received payment can be refunded");
    const refunds = (await tx.query<{ amount: string; status: PaymentStatus }>("select amount, status from payments where refund_of = $1", [orig.id])).rows.map((r) => ({ amount: Number(r.amount), status: r.status }));
    const limit = Number((await tx.query<{ refund_limit: string }>("select refund_limit from properties where id = $1", [orig.property_id])).rows[0]!.refund_limit);
    const refundable = refundableAmount(Number(orig.amount), refunds);
    const verdict = refundCheck({ amount, refundable, limit, unlimited: actor.unlimited });
    if (verdict === "exceeds_refundable") throw new Error(`Cannot refund more than ${refundable.toFixed(2)} of this payment`);
    // TODO(ticket 31): ask for a Property Manager's Approval instead of refusing
    if (verdict === "needs_approval") throw new ApprovalRequired(limit);
    const viaProvider = Boolean(orig.provider_intent_id);
    const { rows } = await tx.query<PaymentRow>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, refund_of, provider, card_brand, card_last4, reference, posted_by, settled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning ${PAYMENT_COLUMNS}`,
      [orig.folio_id, orig.reservation_id, orig.property_id, orig.tender, -amount, orig.currency.trim(), viaProvider ? "pending" : "succeeded", orig.id, orig.provider, orig.card_brand, orig.card_last4, reason, actor.userId, viaProvider ? null : new Date()],
    );
    return { orig, refund: rows[0]!, viaProvider, ctx: viaProvider ? await accountFor(tx, orig.property_id) : null };
  });
  if (!prepared.viaProvider) return toPayment(prepared.refund);
  try {
    const r = await provider.refund(prepared.ctx!.accountId, { intentId: prepared.orig.provider_intent_id!, amount, metadata: { payment_id: prepared.refund.id } });
    const status: PaymentStatus = r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : r.status === "insufficient_balance" ? "refund_pending_balance" : "pending";
    return withTenant(pool, schema, async (tx) =>
      toPayment(
        (await tx.query<PaymentRow>(
          `update payments set status = $2, provider_refund_id = nullif($3, ''), error = $4, settled_at = case when $2 = 'succeeded' then clock_timestamp() else null end where id = $1 returning ${PAYMENT_COLUMNS}`,
          [prepared.refund.id, status, r.refundId, r.error],
        )).rows[0]!,
      ),
    );
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : "The payment provider could not be reached";
    await withTenant(pool, schema, (tx) => tx.query("update payments set status = 'failed', error = $2 where id = $1", [prepared.refund.id, message]));
    throw err instanceof ProviderError ? err : new Error(message);
  }
}

/** A refund still pending at the provider, settled from its state (its webhook). */
export async function syncRefund(pool: Pool, schema: string, provider: PaymentProvider, refundId: string): Promise<void> {
  const p = await withTenant(pool, schema, async (tx) => (await tx.query<PaymentRow>(`select ${PAYMENT_COLUMNS} from payments where provider_refund_id = $1`, [refundId])).rows[0]);
  if (!p || p.status === "succeeded" || p.status === "failed") return;
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, p.property_id));
  const r = await provider.getRefund(ctx.accountId, refundId);
  if (r.status === "succeeded" || r.status === "failed") {
    await withTenant(pool, schema, (tx) =>
      tx.query("update payments set status = $2, error = $3, settled_at = case when $2 = 'succeeded' then clock_timestamp() else null end where id = $1", [p.id, r.status, r.error]),
    );
  }
}

// ── Card Holds ──

export interface CardHold {
  id: string;
  reservationId: string;
  status: "pending" | "active" | "captured" | "released" | "expired" | "failed";
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
  error: string | null;
}

interface HoldRow {
  id: string;
  reservation_id: string;
  property_id: string;
  provider_intent_id: string;
  reader_id: string | null;
  channel: "terminal" | "online" | "moto";
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
  "id, reservation_id, property_id, provider_intent_id, reader_id, channel, payment_method_id, card_brand, card_last4, amount, currency, increments, extended, status, authorised_at, expires_at, warned_at, renewed_from, captured_amount, error";

function toHold(r: HoldRow): CardHold {
  return {
    id: r.id,
    reservationId: r.reservation_id,
    status: r.status,
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

/** Ask the guest's card on the reader for a pre-authorisation of the amount (the highest expected: in the EEA no capture above it). */
export async function placeCardHold(pool: Pool, schema: string, provider: PaymentProvider, input: { reservationId: string; amount: number; readerId: string }, userId: string): Promise<CardHold> {
  const amount = amountOf(input.amount);
  const prepared = await withTenant(pool, schema, async (tx) => {
    const res = await lockReservation(tx, input.reservationId);
    if (res.status !== "confirmed" && res.status !== "checked_in") throw new Error("Card Holds are for open stays only");
    const ctx = await accountFor(tx, res.property_id);
    const reader = await readerOf(tx, res.property_id, input.readerId);
    return { res, ctx, reader };
  });
  const { intentId } = await provider.startTerminalPayment(prepared.ctx.accountId, {
    readerId: prepared.reader,
    amount,
    currency: prepared.ctx.currency,
    hold: true,
    moto: false,
    description: "Card Hold",
    metadata: { reservation_id: prepared.res.id },
  });
  return withTenant(pool, schema, async (tx) =>
    toHold(
      (await tx.query<HoldRow>(
        `insert into card_holds (reservation_id, property_id, provider, provider_intent_id, reader_id, channel, amount, currency, status, created_by)
         values ($1, $2, $3, $4, $5, 'terminal', $6, $7, 'pending', $8) returning ${HOLD_COLUMNS}`,
        [prepared.res.id, prepared.res.property_id, provider.name, intentId, prepared.reader, amount, prepared.ctx.currency, userId],
      )).rows[0]!,
    ),
  );
}

/** Bring a hold up to date from the provider: authorised (with its expiry), declined or cancelled. */
export async function syncCardHold(pool: Pool, schema: string, provider: PaymentProvider, holdId: string): Promise<CardHold> {
  const h = await holdRow(pool, schema, holdId);
  if (h.status !== "pending" && h.status !== "active") return toHold(h);
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, h.property_id));
  return applyIntentToHold(pool, schema, h, await provider.getIntent(ctx.accountId, h.provider_intent_id));
}

async function applyIntentToHold(pool: Pool, schema: string, h: HoldRow, state: IntentState): Promise<CardHold> {
  return withTenant(pool, schema, async (tx) => {
    if (state.status === "authorised") {
      const authorisedAt = h.authorised_at ?? new Date();
      // the provider's own deadline when it gives one, else the card rules (research)
      const expires = state.captureBefore ?? holdExpiry({ channel: h.channel, brand: state.brand, extended: state.extended, authorisedAt });
      const { rows } = await tx.query<HoldRow>(
        `update card_holds set status = 'active', amount = $2, card_brand = $3, card_last4 = $4, payment_method_id = coalesce($5, payment_method_id),
           extended = $6, authorised_at = $7, expires_at = $8, error = null where id = $1 returning ${HOLD_COLUMNS}`,
        [h.id, state.capturable || Number(h.amount), state.brand, state.last4, state.paymentMethodId, state.extended, authorisedAt, expires],
      );
      return toHold(rows[0]!);
    }
    if (state.status === "failed" || state.status === "cancelled") {
      const status = h.status === "pending" ? "failed" : "released";
      const { rows } = await tx.query<HoldRow>(`update card_holds set status = $2, error = $3 where id = $1 returning ${HOLD_COLUMNS}`, [h.id, status, state.error]);
      return toHold(rows[0]!);
    }
    return toHold(h);
  });
}

/** Raise an active hold for incidentals, within the provider's limits (10 increments; each up to the greater of 500 or 5× held). */
export async function incrementCardHold(pool: Pool, schema: string, provider: PaymentProvider, input: { holdId: string; increment: number }, userId: string): Promise<CardHold> {
  void userId;
  const h = await holdRow(pool, schema, input.holdId);
  if (h.status !== "active") throw new Error("Only an active hold can be raised");
  const increment = amountOf(input.increment);
  if (!holdIncrementAllowed({ held: Number(h.amount), increment, increments: h.increments })) {
    throw new Error("This increment is beyond the card's limits; place a new hold for the rest");
  }
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, h.property_id));
  const state = await provider.incrementHold(ctx.accountId, h.provider_intent_id, roundMoney(Number(h.amount) + increment));
  return withTenant(pool, schema, async (tx) =>
    toHold((await tx.query<HoldRow>(`update card_holds set amount = $2, increments = increments + 1 where id = $1 returning ${HOLD_COLUMNS}`, [h.id, state.capturable])).rows[0]!),
  );
}

/** At checkout: capture what is due (never more than held) as a card payment on the guest's folio; the rest is released. */
export async function captureCardHold(pool: Pool, schema: string, provider: PaymentProvider, input: { holdId: string; amount: number }, userId: string): Promise<Payment> {
  const h = await holdRow(pool, schema, input.holdId);
  if (h.status !== "active") throw new Error("Only an active hold can be captured");
  const amount = amountOf(input.amount);
  if (amount > Number(h.amount) + 0.005) throw new Error(`Cannot capture more than the ${Number(h.amount).toFixed(2)} held`);
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, h.property_id));
  const state = await provider.captureHold(ctx.accountId, h.provider_intent_id, amount);
  return withTenant(pool, schema, async (tx) => {
    await lockReservation(tx, h.reservation_id);
    await openFolios(tx, h.reservation_id, userId);
    const folio = (await tx.query<{ id: string }>("select id from folios where reservation_id = $1 and number = 1", [h.reservation_id])).rows[0]!;
    const { rows } = await tx.query<PaymentRow>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, provider_intent_id, reader_id, card_brand, card_last4, reference, posted_by, settled_at)
       values ($1, $2, $3, 'card_terminal', $4, $5, 'succeeded', $6, $7, $8, $9, $10, 'Card Hold captured', $11, clock_timestamp()) returning ${PAYMENT_COLUMNS}`,
      [folio.id, h.reservation_id, h.property_id, state.received || amount, h.currency.trim(), provider.name, h.provider_intent_id, h.reader_id, h.card_brand, h.card_last4, userId],
    );
    await tx.query("update card_holds set status = 'captured', captured_amount = $2, capture_payment_id = $3 where id = $1", [h.id, amount, rows[0]!.id]);
    return toPayment(rows[0]!);
  });
}

/** Release a hold the guest no longer needs (or one waiting on the reader). */
export async function releaseCardHold(pool: Pool, schema: string, provider: PaymentProvider, holdId: string, userId: string): Promise<void> {
  void userId;
  const h = await holdRow(pool, schema, holdId);
  if (h.status !== "active" && h.status !== "pending") throw new Error("The hold is no longer open");
  const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, h.property_id));
  if (h.status === "pending" && h.reader_id) await provider.cancelTerminalPayment(ctx.accountId, h.reader_id, h.provider_intent_id);
  else await provider.releaseHold(ctx.accountId, h.provider_intent_id);
  await withTenant(pool, schema, (tx) => tx.query("update card_holds set status = 'released' where id = $1", [h.id]));
}

export interface HoldWarning {
  holdId: string;
  reservationId: string;
  propertyId: string;
  renewed: boolean;
  error: string | null;
}

/**
 * The scheduled hold check: every active hold within the warning window
 * (HOLD_WARNING_HOURS before expiry) of a stay still open is renewed on the
 * same card without the guest, and the desk is told either way. A hold is
 * handled once: the old one is released and marked warned.
 */
export async function renewExpiringHolds(pool: Pool, schema: string, provider: PaymentProvider, now: Date, warn: (w: HoldWarning) => void): Promise<{ renewed: number; failed: number }> {
  const due = await withTenant(pool, schema, async (tx) =>
    (await tx.query<HoldRow & { res_status: string }>(
      `select ${HOLD_COLUMNS.split(", ").map((c) => `h.${c}`).join(", ")}, r.status as res_status from card_holds h join reservations r on r.id = h.reservation_id
       where h.status = 'active' and h.warned_at is null and h.expires_at <= $1::timestamptz + make_interval(hours => $2)`,
      [now, HOLD_WARNING_HOURS],
    )).rows,
  );
  let renewed = 0;
  let failed = 0;
  for (const h of due) {
    const open = h.res_status === "confirmed" || h.res_status === "checked_in";
    let error: string | null = null;
    let ok = false;
    if (open && h.payment_method_id) {
      try {
        const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, h.property_id));
        const state = await provider.renewHold(ctx.accountId, { paymentMethodId: h.payment_method_id, amount: Number(h.amount), currency: h.currency.trim(), metadata: { reservation_id: h.reservation_id } });
        if (state.status !== "authorised") throw new ProviderError(state.error ?? "The card did not authorise the renewal");
        await provider.releaseHold(ctx.accountId, h.provider_intent_id).catch(() => undefined);
        await withTenant(pool, schema, async (tx) => {
          const authorisedAt = new Date();
          await tx.query(
            `insert into card_holds (reservation_id, property_id, provider, provider_intent_id, reader_id, channel, payment_method_id, card_brand, card_last4, amount, currency, extended, status, authorised_at, expires_at, renewed_from, created_by)
             values ($1, $2, $3, $4, null, 'online', $5, $6, $7, $8, $9, $10, 'active', $11, $12, $13, 'system')`,
            [h.reservation_id, h.property_id, provider.name, state.intentId, state.paymentMethodId ?? h.payment_method_id, state.brand ?? h.card_brand, state.last4 ?? h.card_last4, state.capturable, h.currency.trim(), state.extended, authorisedAt, state.captureBefore ?? holdExpiry({ channel: "online", brand: state.brand, extended: state.extended, authorisedAt }), h.id],
          );
          await tx.query("update card_holds set status = 'released', warned_at = now() where id = $1", [h.id]);
        });
        ok = true;
        renewed++;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    if (!ok) {
      failed += open ? 1 : 0;
      await withTenant(pool, schema, (tx) => tx.query("update card_holds set warned_at = now(), error = coalesce($2, error) where id = $1", [h.id, error]));
    }
    // a closed stay's hold simply runs out; only open stays need the desk
    if (open) warn({ holdId: h.id, reservationId: h.reservation_id, propertyId: h.property_id, renewed: ok, error });
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
