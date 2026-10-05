import type { Pool, PoolClient } from "pg";
import { todayIn, addDays } from "@hoteloftware/domain";
import type { PaymentProvider } from "@hoteloftware/payments";
import { openFolios } from "./folios";
import { assertDepositInvoiceable, checkOut, type IssuedInvoice } from "./invoices";
import { accountFor, applyIntentToPayment, guestBalance, type Payment } from "./payments";
import { PORTAL_USER } from "./portal";
import { withTenant } from "./with-tenant";

/**
 * Paying in the Guest Portal (ticket 41): the deposit or balance by card with
 * strong customer authentication in the guest's browser, or a card stored for
 * incidentals, which secures a Card Guarantee and is charged later by staff
 * without the guest (merchant-initiated). On the departure eve the guest
 * reviews the folio, pays and checks out alone where the property allows it.
 * No card number passes through us: the provider's form in the browser
 * returns tokens only.
 */

interface StayRow {
  id: string;
  property_id: string;
  status: string;
  arrival: string;
  departure: string;
  time_zone: string;
  express_auto: boolean;
}

async function stayByKey(tx: PoolClient, key: string): Promise<StayRow> {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("This link does not open anything");
  const { rows } = await tx.query<StayRow>(
    `select r.id, r.property_id, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, p.time_zone, p.express_checkout_auto as express_auto
     from reservations r join properties p on p.id = r.property_id where r.portal_key = $1 for update of r`,
    [key],
  );
  if (!rows[0]) throw new Error("This link does not open anything");
  return rows[0];
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
  const open = await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; property_id: string; provider_intent_id: string | null }>(
      `select id, property_id, provider_intent_id from payments
       where status = 'pending' and tender = 'card_online' and posted_by = $1 and ($2::uuid is null or reservation_id = $2) and posted_at < now() - make_interval(mins => $3)`,
      [PORTAL_USER, filter.reservationId ?? null, filter.olderThanMinutes ?? 0],
    );
    return Promise.all(rows.map(async (r) => ({ ...r, ctx: await accountFor(tx, r.property_id, provider) })));
  });
  for (const p of open) {
    if (!p.provider_intent_id) {
      await withTenant(pool, schema, (tx) => tx.query("update payments set status = 'failed', error = 'Not finished by the guest', settled_at = clock_timestamp() where id = $1 and status = 'pending'", [p.id]));
      continue;
    }
    const state = await provider.cancelOnlinePayment(p.ctx.accountId, p.provider_intent_id);
    await applyIntentToPayment(pool, schema, p.id, state);
  }
  return open.length;
}

/** The balance due on the guest's own folios, paid online; with `saveCard` the card is kept for incidentals too. */
export async function startPortalPayment(pool: Pool, schema: string, provider: PaymentProvider, key: string, options: { saveCard: boolean }): Promise<PortalPaymentStart> {
  const reservationId = await withTenant(pool, schema, async (tx) => (await stayByKey(tx, key)).id);
  // one payment at a time: an earlier one left open is closed first (or counted, if it went through)
  await closeUnfinishedPortalPayments(pool, schema, provider, { reservationId });
  const prepared = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error("Nothing can be paid on this stay any more");
    const amount = await guestBalance(tx, r.id);
    if (amount <= 0) throw new Error("Nothing is due");
    const ctx = await accountFor(tx, r.property_id, provider);
    await openFolios(tx, r.id, PORTAL_USER);
    await assertDepositInvoiceable(tx, r.id, "card_online");
    const folio = (await tx.query<{ id: string }>("select id from folios where reservation_id = $1 and number = 1", [r.id])).rows[0]!;
    const { rows } = await tx.query<{ id: string }>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, reference, posted_by, save_card)
       values ($1, $2, $3, 'card_online', $4, $5, 'pending', $6, 'guest portal', $7, $8) returning id`,
      [folio.id, r.id, r.property_id, amount, ctx.currency, provider.name, PORTAL_USER, options.saveCard],
    );
    return { paymentId: rows[0]!.id, amount, ctx, reservationId: r.id };
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
  /** It failed just now (not before): the desk is told once. */
  declinedNow: boolean;
  reservationId: string;
  propertyId: string;
}

/** After the guest's browser finished: the provider's answer settles the payment; a kept card becomes the Card Guarantee. */
export async function finishPortalPayment(pool: Pool, schema: string, provider: PaymentProvider, key: string, paymentId: string): Promise<PortalPaymentResult> {
  const p = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    const { rows } = await tx.query<{ id: string; status: Payment["status"]; provider_intent_id: string | null; property_id: string; save_card: boolean }>(
      "select id, status, provider_intent_id, property_id, save_card from payments where id = $1 and reservation_id = $2 and posted_by = $3",
      [paymentId, r.id, PORTAL_USER],
    );
    if (!rows[0]?.provider_intent_id) throw new Error("Payment not found");
    return { ...rows[0], reservationId: r.id, ctx: await accountFor(tx, rows[0].property_id, provider) };
  });
  const state = await provider.getIntent(p.ctx.accountId, p.provider_intent_id!);
  const settled = p.status === "pending" ? await applyIntentToPayment(pool, schema, p.id, state) : null;
  const status = settled?.status ?? p.status;
  if (status === "succeeded" && p.save_card && state.customerId && state.paymentMethodId) {
    await keepGuarantee(pool, schema, provider, p.reservationId, { customerId: state.customerId, paymentMethodId: state.paymentMethodId, brand: state.brand, last4: state.last4 });
  }
  return { status, error: status === "failed" ? (state.error ?? "The payment did not go through") : null, declinedNow: p.status === "pending" && status === "failed", reservationId: p.reservationId, propertyId: p.property_id };
}

async function keepGuarantee(pool: Pool, schema: string, provider: PaymentProvider, reservationId: string, card: { customerId: string; paymentMethodId: string; brand: string | null; last4: string | null }): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    // one card at a time: the newest secures the stay
    await tx.query("update card_guarantees set status = 'removed' where reservation_id = $1 and status = 'secured' and payment_method_id <> $2", [reservationId, card.paymentMethodId]);
    const exists = (await tx.query("select 1 from card_guarantees where reservation_id = $1 and payment_method_id = $2 and status = 'secured'", [reservationId, card.paymentMethodId])).rows.length;
    if (!exists) {
      await tx.query("insert into card_guarantees (reservation_id, provider, customer_id, payment_method_id, brand, last4, source, created_by) values ($1, $2, $3, $4, $5, $6, 'portal', $7)", [
        reservationId,
        provider.name,
        card.customerId,
        card.paymentMethodId,
        card.brand,
        card.last4,
        PORTAL_USER,
      ]);
    }
  });
}

/** A card stored for incidentals, without paying now: authenticated in the guest's browser. */
export async function startCardSetup(pool: Pool, schema: string, provider: PaymentProvider, key: string): Promise<{ setupId: string; clientSecret: string; publishableKey: string | null; accountId: string }> {
  const prepared = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error("A card cannot be stored on this stay any more");
    return { r, ctx: await accountFor(tx, r.property_id, provider) };
  });
  const setup = await provider.createCardSetup(prepared.ctx.accountId, { customerId: null, metadata: { reservation_id: prepared.r.id }, idempotencyKey: `setup:${prepared.r.id}:${Date.now()}` });
  await withTenant(pool, schema, (tx) =>
    tx.query("insert into card_setups (reservation_id, provider, provider_setup_id, customer_id) values ($1, $2, $3, $4)", [prepared.r.id, provider.name, setup.setupId, setup.customerId]),
  );
  return { setupId: setup.setupId, clientSecret: setup.clientSecret, publishableKey: provider.publishableKey, accountId: prepared.ctx.accountId };
}

export async function finishCardSetup(pool: Pool, schema: string, provider: PaymentProvider, key: string, setupId: string): Promise<{ status: "waiting" | "succeeded" | "failed"; error: string | null }> {
  const s = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    const { rows } = await tx.query<{ id: string; status: string }>("select id, status from card_setups where provider_setup_id = $1 and reservation_id = $2", [setupId, r.id]);
    if (!rows[0]) throw new Error("Card not found");
    return { row: rows[0], reservationId: r.id, ctx: await accountFor(tx, r.property_id, provider) };
  });
  const state = await provider.getSetup(s.ctx.accountId, setupId);
  await withTenant(pool, schema, (tx) => tx.query("update card_setups set status = $2, error = $3 where id = $1", [s.row.id, state.status, state.error]));
  if (state.status === "succeeded" && state.customerId && state.paymentMethodId) {
    await keepGuarantee(pool, schema, provider, s.reservationId, { customerId: state.customerId, paymentMethodId: state.paymentMethodId, brand: state.brand, last4: state.last4 });
  }
  return { status: state.status, error: state.error };
}

export interface CardGuarantee {
  id: string;
  brand: string | null;
  last4: string | null;
  source: string;
  securedAt: Date;
}

/** The stored card securing a stay, if any. */
export async function cardGuaranteeOf(pool: Pool, schema: string, reservationId: string): Promise<CardGuarantee | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query("select id, brand, last4, source, secured_at from card_guarantees where reservation_id = $1 and status = 'secured' order by secured_at desc limit 1", [reservationId]);
    return rows[0] ? { id: rows[0].id, brand: rows[0].brand, last4: rows[0].last4, source: rows[0].source, securedAt: rows[0].secured_at } : null;
  });
}

/**
 * Staff charge the stored card without the guest (merchant-initiated): a
 * Payment by card online, settled from the provider's answer; a decline is
 * told back as it is.
 */
export async function chargeStoredCard(pool: Pool, schema: string, provider: PaymentProvider, input: { reservationId: string; amount: number }, userId: string): Promise<Payment> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("The amount must be more than zero");
  const amount = Math.round(input.amount * 100) / 100;
  const prepared = await withTenant(pool, schema, async (tx) => {
    const { rows: g } = await tx.query<{ customer_id: string; payment_method_id: string; property_id: string; status: string }>(
      `select c.customer_id, c.payment_method_id, r.property_id, r.status from card_guarantees c join reservations r on r.id = c.reservation_id
       where c.reservation_id = $1 and c.status = 'secured' order by c.secured_at desc limit 1`,
      [input.reservationId],
    );
    const card = g[0];
    if (!card) throw new Error("No card is stored for this stay");
    if (card.status === "cancelled" || card.status === "no_show") throw new Error("The reservation is closed");
    const ctx = await accountFor(tx, card.property_id, provider);
    await openFolios(tx, input.reservationId, userId);
    await assertDepositInvoiceable(tx, input.reservationId, "card_online");
    const folio = (await tx.query<{ id: string }>("select id from folios where reservation_id = $1 and number = 1", [input.reservationId])).rows[0]!;
    const { rows } = await tx.query<{ id: string }>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, reference, posted_by)
       values ($1, $2, $3, 'card_online', $4, $5, 'pending', $6, 'stored card', $7) returning id`,
      [folio.id, input.reservationId, card.property_id, amount, ctx.currency, provider.name, userId],
    );
    return { paymentId: rows[0]!.id, card, ctx };
  });
  const state = await provider.chargeSavedCard(prepared.ctx.accountId, {
    customerId: prepared.card.customer_id,
    paymentMethodId: prepared.card.payment_method_id,
    amount,
    currency: prepared.ctx.currency,
    metadata: { payment_id: prepared.paymentId },
    idempotencyKey: `stored:${prepared.paymentId}`,
  });
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
    const r = await stayByKey(tx, key);
    const today = todayIn(r.time_zone);
    const { rows: lines } = await tx.query<{ description: string; amount: string }>(
      `select ch.description, ch.amount from charges ch join folios f on f.id = ch.folio_id where ch.reservation_id = $1 and ch.voided_at is null and f.bill_to_guest_id is not null
       union all
       select 'Payment', -pa.amount from payments pa join folios f on f.id = pa.folio_id where pa.reservation_id = $1 and pa.status = 'succeeded' and f.bill_to_guest_id is not null`,
      [r.id],
    );
    const { rows: x } = await tx.query<{ express_checkout_at: Date | null }>("select express_checkout_at from reservations where id = $1", [r.id]);
    const { rows: invoices } = r.status === "checked_out"
      ? await tx.query<{ id: string; number: string }>(
          "select i.id, i.number from invoices i join folios f on f.id = i.folio_id where i.reservation_id = $1 and not i.test and f.bill_to_guest_id is not null order by i.number",
          [r.id],
        )
      : { rows: [] };
    return {
      open: r.status === "checked_in" && today >= addDays(r.departure, -1) && today <= r.departure,
      balance: await guestBalance(tx, r.id),
      lines: lines.map((l) => ({ description: l.description, amount: Number(l.amount) })),
      checkedOut: r.status === "checked_out",
      requestedAt: x[0]!.express_checkout_at,
      invoices,
    };
  });
}

/**
 * Express checkout: with nothing left to pay, the guest checks out alone where
 * the property allows it (the final invoice is issued and can be downloaded);
 * elsewhere the desk sees the request and checks the guest out.
 */
export async function expressCheckout(pool: Pool, schema: string, provider: PaymentProvider, key: string): Promise<{ checkedOut: boolean; invoices: IssuedInvoice[] }> {
  const reservationId = await withTenant(pool, schema, async (tx) => (await stayByKey(tx, key)).id);
  await closeUnfinishedPortalPayments(pool, schema, provider, { reservationId });
  const r = await withTenant(pool, schema, async (tx) => {
    const r = await stayByKey(tx, key);
    if (r.status !== "checked_in") throw new Error("Express checkout opens while you stay");
    const today = todayIn(r.time_zone);
    if (today < addDays(r.departure, -1) || today > r.departure) throw new Error("Express checkout opens the evening before departure");
    if ((await guestBalance(tx, r.id)) > 0) throw new Error("Please pay the open amount first");
    await tx.query("update reservations set express_checkout_at = coalesce(express_checkout_at, now()) where id = $1", [r.id]);
    return r;
  });
  if (!r.express_auto) return { checkedOut: false, invoices: [] };
  try {
    return { checkedOut: true, invoices: await checkOut(pool, schema, r.id, PORTAL_USER, { override: false }) };
  } catch (err) {
    // folios the guest cannot settle here (a company's, say): the desk checks out, as asked
    if (err instanceof Error && !("code" in err)) return { checkedOut: false, invoices: [] };
    throw err;
  }
}
