import type { Pool, PoolClient } from "pg";
import { expressCheckoutOpen } from "@hoteloftware/domain";
import type { PaymentProvider } from "@hoteloftware/payments";
import { isUuid } from "./catalogue-common";
import { openFolios } from "./folios";
import { CheckOutBlocked, assertDepositInvoiceable, checkOut, type IssuedInvoice } from "./invoices";
import {
  accountFor,
  amountDueIn,
  amountOf,
  applyIntentToPayment,
  cardGuaranteeIn,
  failureOf,
  guestBalance,
  lockReservation,
  settleFromIntent,
  type CardGuarantee,
  type Payment,
} from "./payments";
import { PORTAL_USER, reservationByKey, type StayByKey } from "./portal";
import { withTenant } from "./with-tenant";

/**
 * Paying in the Guest Portal (ticket 41): before arrival what the Payment
 * Policy asks ahead, in house the balance, by card with strong customer
 * authentication in the guest's browser; or a Card Guarantee left for
 * incidentals, charged later by staff without the guest (merchant-initiated).
 * On the departure eve the guest reviews the folio, pays and uses Express
 * Checkout. No card number passes through us: the provider's form in the
 * browser returns tokens only.
 */

const stayByKey = (tx: PoolClient, key: string): Promise<StayByKey> => reservationByKey(tx, key, { lock: true });

async function mainFolioId(tx: PoolClient, reservationId: string, userId: string): Promise<string> {
  await openFolios(tx, reservationId, userId);
  return (await tx.query<{ id: string }>("select id from folios where reservation_id = $1 and number = 1", [reservationId])).rows[0]!.id;
}

export interface PortalPaymentStart {
  paymentId: string;
  amount: number;
  currency: string;
  clientSecret: string;
  /** For the provider's form in the browser (Stripe.js with the connected account). */
  publishableKey: string | null;
  accountId: string;
}

/**
 * Online payments the guest did not finish (another tab, a closed browser):
 * cancelled at the provider, so a late completion cannot take money we do not
 * record; one that went through after all is settled as received.
 */
export async function closeUnfinishedPortalPayments(pool: Pool, schema: string, provider: PaymentProvider, filter: { reservationId?: string; olderThanMinutes?: number }): Promise<number> {
  const open = await withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; property_id: string; provider_intent_id: string | null }>(
      `select id, property_id, provider_intent_id from payments
       where status = 'pending' and tender = 'card_online' and posted_by = $1 and ($2::uuid is null or reservation_id = $2) and posted_at < now() - make_interval(mins => $3)`,
      [PORTAL_USER, filter.reservationId ?? null, filter.olderThanMinutes ?? 0],
    )).rows,
  );
  let closed = 0;
  for (const p of open) {
    try {
      if (!p.provider_intent_id) {
        await withTenant(pool, schema, (tx) => tx.query("update payments set status = 'failed', error = 'Not finished by the guest', settled_at = clock_timestamp() where id = $1 and status = 'pending'", [p.id]));
      } else {
        const ctx = await withTenant(pool, schema, (tx) => accountFor(tx, p.property_id, provider));
        await applyIntentToPayment(pool, schema, p.id, await provider.cancelOnlinePayment(ctx.accountId, p.provider_intent_id));
      }
      closed++;
    } catch (err) {
      // one that cannot be closed now (provider away, no account) stays for the next run; the others go on
      console.error("unfinished portal payment not closed", p.id, err);
    }
  }
  return closed;
}

/** What is due now, paid online; with `saveCard` the card is kept as the stay's Card Guarantee too. */
export async function startPortalPayment(pool: Pool, schema: string, provider: PaymentProvider, key: string, options: { saveCard: boolean }): Promise<PortalPaymentStart> {
  const reservationId = await withTenant(pool, schema, async (tx) => (await stayByKey(tx, key)).id);
  // one payment at a time: an earlier one left open is closed first (or counted, if it went through)
  await closeUnfinishedPortalPayments(pool, schema, provider, { reservationId });
  const prepared = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error("Nothing can be paid on this stay any more");
    // still open (being confirmed at the bank, or another tab started it just now): never a second payment for the same amount
    const { rows: pending } = await tx.query("select 1 from payments where reservation_id = $1 and status = 'pending' and tender = 'card_online' and posted_by = $2", [r.id, PORTAL_USER]);
    if (pending.length) throw new Error("A payment is still being confirmed; please wait a moment and reload");
    const amount = await amountDueIn(tx, r.id);
    if (amount <= 0) throw new Error("Nothing is due");
    const ctx = await accountFor(tx, r.property_id, provider);
    const folioId = await mainFolioId(tx, r.id, PORTAL_USER);
    await assertDepositInvoiceable(tx, r.id, "card_online");
    const { rows } = await tx.query<{ id: string }>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, reference, posted_by, save_card)
       values ($1, $2, $3, 'card_online', $4, $5, 'pending', $6, 'guest portal', $7, $8) returning id`,
      [folioId, r.id, r.property_id, amount, ctx.currency, provider.name, PORTAL_USER, options.saveCard],
    );
    return { paymentId: rows[0]!.id, amount, ctx };
  });
  const intent = await provider.createOnlinePayment(prepared.ctx.accountId, {
    amount: prepared.amount,
    currency: prepared.ctx.currency,
    saveCard: options.saveCard,
    customerId: null,
    description: "Guest portal payment",
    metadata: { payment_id: prepared.paymentId },
    idempotencyKey: `portal:${prepared.paymentId}`,
  });
  await withTenant(pool, schema, (tx) => tx.query("update payments set provider_intent_id = $2 where id = $1", [prepared.paymentId, intent.intentId]));
  return { paymentId: prepared.paymentId, amount: prepared.amount, currency: prepared.ctx.currency, clientSecret: intent.clientSecret, publishableKey: provider.publishableKey, accountId: prepared.ctx.accountId };
}

export interface PortalPaymentResult {
  status: Payment["status"];
  error: string | null;
  reservationId: string;
  propertyId: string;
}

/**
 * After the guest's browser finished (or the form reported a decline): the
 * provider's answer settles the payment. A card refused in the form leaves the
 * provider's payment open for another card; it is cancelled here, so the
 * decline is final and the guest starts again. A card kept when the payment
 * settles now becomes the Card Guarantee.
 */
export async function finishPortalPayment(pool: Pool, schema: string, provider: PaymentProvider, key: string, paymentId: string): Promise<PortalPaymentResult> {
  if (!isUuid(paymentId)) throw new Error("Payment not found");
  const p = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    const { rows } = await tx.query<{ id: string; status: Payment["status"]; provider_intent_id: string | null; property_id: string; save_card: boolean; error: string | null }>(
      "select id, status, provider_intent_id, property_id, save_card, error from payments where id = $1 and reservation_id = $2 and posted_by = $3",
      [paymentId, r.id, PORTAL_USER],
    );
    if (!rows[0]?.provider_intent_id) throw new Error("Payment not found");
    return { ...rows[0], reservationId: r.id, ctx: await accountFor(tx, rows[0].property_id, provider) };
  });
  if (p.status !== "pending") return { status: p.status, error: p.status === "failed" ? (p.error ?? "The payment did not go through") : null, reservationId: p.reservationId, propertyId: p.property_id };
  let state = await provider.getIntent(p.ctx.accountId, p.provider_intent_id!);
  if (state.status === "waiting" && state.error) state = await provider.cancelOnlinePayment(p.ctx.accountId, p.provider_intent_id!);
  const { payment, settledNow } = await settleFromIntent(pool, schema, p.id, state);
  if (settledNow && payment.status === "succeeded" && p.save_card && state.customerId && state.paymentMethodId) {
    await keepGuarantee(pool, schema, provider, p.reservationId, { customerId: state.customerId, paymentMethodId: state.paymentMethodId, brand: state.brand, last4: state.last4 });
  }
  return { status: payment.status, error: payment.status === "failed" ? (payment.error ?? state.error ?? "The payment did not go through") : null, reservationId: p.reservationId, propertyId: p.property_id };
}

/**
 * A declined portal payment the desk has not been told of yet, claimed now:
 * whoever sees the decline first (the guest's page or the provider's webhook)
 * tells the desk, exactly once. A payment the guest simply left is no decline.
 */
export async function claimDeclineNotice(pool: Pool, schema: string, paymentId: string): Promise<{ reservationId: string; propertyId: string; error: string | null } | null> {
  if (!isUuid(paymentId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ reservation_id: string; property_id: string; error: string | null }>(
      `update payments set decline_noticed_at = now()
       where id = $1 and status = 'failed' and posted_by = $2 and decline_noticed_at is null and error is not null and error not in ('Cancelled at the reader', 'Not finished by the guest')
       returning reservation_id, property_id, error`,
      [paymentId, PORTAL_USER],
    );
    return rows[0] ? { reservationId: rows[0].reservation_id, propertyId: rows[0].property_id, error: rows[0].error } : null;
  });
}

async function keepGuarantee(pool: Pool, schema: string, provider: PaymentProvider, reservationId: string, card: { customerId: string; paymentMethodId: string; brand: string | null; last4: string | null }): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    await lockReservation(tx, reservationId);
    const current = (await tx.query<{ payment_method_id: string }>("select payment_method_id from card_guarantees where reservation_id = $1 and status = 'secured'", [reservationId])).rows[0];
    if (current?.payment_method_id === card.paymentMethodId) return;
    // one card at a time: the newest secures the stay
    await tx.query("update card_guarantees set status = 'removed' where reservation_id = $1 and status = 'secured'", [reservationId]);
    await tx.query("insert into card_guarantees (reservation_id, provider, customer_id, payment_method_id, brand, last4, created_by) values ($1, $2, $3, $4, $5, $6, $7)", [
      reservationId,
      provider.name,
      card.customerId,
      card.paymentMethodId,
      card.brand,
      card.last4,
      PORTAL_USER,
    ]);
  });
}

/** A Card Guarantee left without paying now: authenticated in the guest's browser. */
export async function startCardSetup(pool: Pool, schema: string, provider: PaymentProvider, key: string): Promise<{ setupId: string; clientSecret: string; publishableKey: string | null; accountId: string }> {
  const prepared = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error("A card cannot be left on this stay any more");
    // the stay's provider customer, once there is one: a new card goes on it, not on another customer
    const { rows: customer } = await tx.query<{ customer_id: string }>(
      "select customer_id from card_setups where reservation_id = $1 and customer_id is not null union all select customer_id from card_guarantees where reservation_id = $1 limit 1",
      [r.id],
    );
    const { rows } = await tx.query<{ id: string }>("insert into card_setups (reservation_id, provider) values ($1, $2) returning id", [r.id, provider.name]);
    return { r, rowId: rows[0]!.id, customerId: customer[0]?.customer_id ?? null, ctx: await accountFor(tx, r.property_id, provider) };
  });
  const setup = await provider.createCardSetup(prepared.ctx.accountId, { customerId: prepared.customerId, metadata: { reservation_id: prepared.r.id }, idempotencyKey: `setup:${prepared.rowId}` });
  await withTenant(pool, schema, (tx) => tx.query("update card_setups set provider_setup_id = $2, customer_id = $3 where id = $1", [prepared.rowId, setup.setupId, setup.customerId]));
  return { setupId: setup.setupId, clientSecret: setup.clientSecret, publishableKey: provider.publishableKey, accountId: prepared.ctx.accountId };
}

export async function finishCardSetup(pool: Pool, schema: string, provider: PaymentProvider, key: string, setupId: string): Promise<{ status: "waiting" | "succeeded" | "failed"; error: string | null }> {
  const s = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    const { rows } = await tx.query<{ id: string; status: "waiting" | "succeeded" | "failed"; error: string | null }>("select id, status, error from card_setups where provider_setup_id = $1 and reservation_id = $2", [setupId, r.id]);
    if (!rows[0]) throw new Error("Card not found");
    return { row: rows[0], reservationId: r.id, ctx: await accountFor(tx, r.property_id, provider) };
  });
  // settled before (a reload, the back button): told as it was, an older card never comes back
  if (s.row.status !== "waiting") return { status: s.row.status, error: s.row.error };
  const state = await provider.getSetup(s.ctx.accountId, setupId);
  const settledNow = await withTenant(pool, schema, async (tx) => (await tx.query("update card_setups set status = $2, error = $3 where id = $1 and status = 'waiting' returning id", [s.row.id, state.status, state.error])).rows.length > 0);
  if (settledNow && state.status === "succeeded" && state.customerId && state.paymentMethodId) {
    await keepGuarantee(pool, schema, provider, s.reservationId, { customerId: state.customerId, paymentMethodId: state.paymentMethodId, brand: state.brand, last4: state.last4 });
  }
  return { status: state.status, error: state.error };
}

export type { CardGuarantee };

/** The Card Guarantee securing a stay, if any. */
export async function cardGuaranteeOf(pool: Pool, schema: string, reservationId: string): Promise<CardGuarantee | null> {
  if (!isUuid(reservationId)) return null;
  return withTenant(pool, schema, (tx) => cardGuaranteeIn(tx, reservationId));
}

/**
 * Staff charge the Card Guarantee without the guest (merchant-initiated): a
 * Payment by card online, settled from the provider's answer; a decline is
 * told back as it is. A charge whose answer never came is sent again with the
 * same request key, so the card is never charged twice.
 */
export async function chargeStoredCard(pool: Pool, schema: string, provider: PaymentProvider, input: { reservationId: string; amount: number }, userId: string): Promise<Payment> {
  const amount = amountOf(input.amount);
  const prepared = await withTenant(pool, schema, async (tx) => {
    const res = await lockReservation(tx, input.reservationId);
    if (res.status === "cancelled" || res.status === "no_show") throw new Error("The reservation is closed");
    const { rows: g } = await tx.query<{ customer_id: string; payment_method_id: string }>("select customer_id, payment_method_id from card_guarantees where reservation_id = $1 and status = 'secured'", [res.id]);
    const card = g[0];
    if (!card) throw new Error("No card secures this stay");
    const ctx = await accountFor(tx, res.property_id, provider);
    const { rows: unanswered } = await tx.query<{ id: string; amount: string }>(
      "select id, amount from payments where reservation_id = $1 and status = 'pending' and reference = 'stored card' and provider_intent_id is null",
      [res.id],
    );
    if (unanswered[0]) {
      if (Number(unanswered[0].amount) !== amount) throw new Error(`A charge of ${Number(unanswered[0].amount).toFixed(2)} on the card is still unanswered: charge that amount to send it again`);
      return { paymentId: unanswered[0].id, card, ctx };
    }
    const folioId = await mainFolioId(tx, res.id, userId);
    await assertDepositInvoiceable(tx, res.id, "card_online");
    const { rows } = await tx.query<{ id: string }>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, reference, posted_by)
       values ($1, $2, $3, 'card_online', $4, $5, 'pending', $6, 'stored card', $7) returning id`,
      [folioId, res.id, res.property_id, amount, ctx.currency, provider.name, userId],
    );
    return { paymentId: rows[0]!.id, card, ctx };
  });
  let state;
  try {
    state = await provider.chargeSavedCard(prepared.ctx.accountId, {
      customerId: prepared.card.customer_id,
      paymentMethodId: prepared.card.payment_method_id,
      amount,
      currency: prepared.ctx.currency,
      metadata: { payment_id: prepared.paymentId },
      idempotencyKey: `stored:${prepared.paymentId}`,
    });
  } catch (err) {
    // a definite "no" closes the charge; no answer keeps it, to be sent again with the same key
    const f = failureOf(err);
    await withTenant(pool, schema, (tx) =>
      tx.query(f.definite ? "update payments set status = 'failed', error = $2, settled_at = clock_timestamp() where id = $1 and status = 'pending'" : "update payments set error = $2 where id = $1 and status = 'pending'", [prepared.paymentId, f.message]),
    );
    throw new Error(f.message);
  }
  await withTenant(pool, schema, (tx) => tx.query("update payments set provider_intent_id = $2 where id = $1", [prepared.paymentId, state.intentId]));
  return applyIntentToPayment(pool, schema, prepared.paymentId, state);
}

export interface ExpressCheckout {
  /** The departure eve or day, checked in: the guest may check out here. */
  open: boolean;
  balance: number;
  lines: { description: string; amount: number }[];
  /** Checked out (alone, or the desk has done it). */
  checkedOut: boolean;
  /** The guest asked; the desk checks out (where the property does not let guests do it alone). */
  requestedAt: Date | null;
  /** Checked out: the guest's own final invoices, to download. */
  invoices: { id: string; number: string }[];
}

/** The folio as the guest sees it on the departure eve: charges and payments of their own folios, the balance. */
export async function expressCheckoutView(pool: Pool, schema: string, key: string): Promise<ExpressCheckout> {
  return withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key);
    const { rows: lines } = await tx.query<{ description: string; amount: string }>(
      `select ch.description, ch.amount from charges ch join folios f on f.id = ch.folio_id where ch.reservation_id = $1 and ch.voided_at is null and f.bill_to_guest_id is not null and f.group_id is null
       union all
       select 'Payment', -pa.amount from payments pa join folios f on f.id = pa.folio_id where pa.reservation_id = $1 and pa.status = 'succeeded' and f.bill_to_guest_id is not null and f.group_id is null`,
      [r.id],
    );
    const { rows: x } = await tx.query<{ express_checkout_at: Date | null }>("select express_checkout_at from reservations where id = $1", [r.id]);
    const { rows: invoices } =
      r.status === "checked_out"
        ? await tx.query<{ id: string; number: string }>(
            "select i.id, i.number from invoices i join folios f on f.id = i.folio_id where i.reservation_id = $1 and not i.test and f.bill_to_guest_id is not null order by i.number",
            [r.id],
          )
        : { rows: [] };
    return {
      open: expressCheckoutOpen(r.status, r.departure, r.business_date),
      balance: await guestBalance(tx, r.id),
      lines: lines.map((l) => ({ description: l.description, amount: Number(l.amount) })),
      checkedOut: r.status === "checked_out",
      requestedAt: x[0]!.express_checkout_at,
      invoices,
    };
  });
}

/**
 * Express Checkout: with nothing left to pay, the guest checks out alone where
 * the property allows it (the final invoice is issued and can be downloaded);
 * elsewhere, or when a folio cannot be settled here, the desk sees the request
 * and checks the guest out.
 */
export async function expressCheckout(pool: Pool, schema: string, provider: PaymentProvider, key: string): Promise<{ checkedOut: boolean; invoices: IssuedInvoice[] }> {
  const reservationId = await withTenant(pool, schema, async (tx) => (await stayByKey(tx, key)).id);
  await closeUnfinishedPortalPayments(pool, schema, provider, { reservationId });
  const r = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    if (!expressCheckoutOpen(r.status, r.departure, r.business_date)) throw new Error("Express Checkout opens the evening before departure, while you stay");
    if ((await guestBalance(tx, r.id)) > 0) throw new Error("Please pay the open amount first");
    await tx.query("update reservations set express_checkout_at = coalesce(express_checkout_at, now()) where id = $1", [r.id]);
    return r;
  });
  if (!r.express_checkout_auto) return { checkedOut: false, invoices: [] };
  try {
    return { checkedOut: true, invoices: await checkOut(pool, schema, r.id, PORTAL_USER, { override: false }) };
  } catch (err) {
    // folios the guest cannot settle here (a company's, say): the desk checks out, as asked
    if (err instanceof CheckOutBlocked) return { checkedOut: false, invoices: [] };
    throw err;
  }
}

/** The provider's account and id of a payment or card setup of this stay (for the stand-in provider's test buttons); null when it is not the stay's. */
export async function portalProviderRef(pool: Pool, schema: string, provider: PaymentProvider, key: string, kind: "payment" | "setup", id: string): Promise<{ accountId: string; ref: string } | null> {
  return withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key);
    const { rows } =
      kind === "payment"
        ? isUuid(id)
          ? await tx.query<{ ref: string | null }>("select provider_intent_id as ref from payments where id = $1 and reservation_id = $2 and posted_by = $3", [id, r.id, PORTAL_USER])
          : { rows: [] }
        : await tx.query<{ ref: string | null }>("select provider_setup_id as ref from card_setups where provider_setup_id = $1 and reservation_id = $2", [id, r.id]);
    if (!rows[0]?.ref) return null;
    return { accountId: (await accountFor(tx, r.property_id, provider)).accountId, ref: rows[0].ref };
  });
}
