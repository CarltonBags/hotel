import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { FiscalUnavailable } from "@hoteloftware/fiscal";
import { isUuid } from "./catalogue-common";
import { clientIn, unitIn, type FiscalDeps } from "./fiscal";
import { inTestMode } from "./go-live";
import { withTenant } from "./with-tenant";

/**
 * Orders at German outlets (ticket 62, research "Card acceptance on phones
 * and fiscal duties of an outlet point of sale"): each order round is signed
 * by the TSE as an order (Bestellung-V1) within 45 seconds of it; a voided
 * item becomes a new order with negative quantity. The bill's id is the table
 * key both its orders and its Receipt carry; the Receipt prints the time of
 * the first order. Austria signs only the payment (as before).
 */

/** Signed within this many seconds of the order (KassenSichV practice for orders at a table). */
export const ORDER_SIGN_SECONDS = 45;
const STALE_CLAIM_SECONDS = 90;

interface OrderLine {
  quantity: number;
  text: string;
  pricePerUnit: number;
}

/** The TSE client of a bill's outlet, when its property signs (Germany, a TSE in use, not in Test Mode). */
async function signingClientIn(tx: PoolClient, billId: string): Promise<{ propertyId: string; clientId: string } | null> {
  const b = (await tx.query<{ property_id: string; country: string; register: string | null }>(
    "select b.property_id, p.country, o.cash_register_id as register from outlet_bills b join outlets o on o.id = b.outlet_id join properties p on p.id = b.property_id where b.id = $1",
    [billId],
  )).rows[0];
  if (!b || b.country.trim() !== "DE" || (await inTestMode(tx)) || !(await unitIn(tx, b.property_id))) return null;
  return { propertyId: b.property_id, clientId: (await clientIn(tx, b.property_id, b.register)).id };
}

/** An order round to sign, recorded in the round's own transaction. */
export async function recordRoundOrderIn(tx: PoolClient, roundId: string): Promise<void> {
  const r = (await tx.query<{ bill_id: string; at: Date }>("select bill_id, coalesce(ordered_at, sent_at) as at from outlet_rounds where id = $1", [roundId])).rows[0];
  if (!r) return;
  const c = await signingClientIn(tx, r.bill_id);
  if (!c) return;
  const lines: OrderLine[] = (await tx.query<{ quantity: number; description: string; unit_price: string }>("select quantity, description, unit_price from outlet_bill_lines where round_id = $1 order by created_at, id", [roundId])).rows.map((l) => ({
    quantity: l.quantity,
    text: l.description,
    pricePerUnit: Number(l.unit_price),
  }));
  if (!lines.length) return;
  await tx.query("insert into fiscal_orders (property_id, client_id, bill_id, round_id, lines, ordered_at) values ($1, $2, $3, $4, $5, $6) on conflict do nothing", [c.propertyId, c.clientId, r.bill_id, roundId, JSON.stringify(lines), r.at]);
}

/** A voided item of a signed round: a new order with negative quantity. */
export async function recordVoidOrderIn(tx: PoolClient, lineId: string): Promise<void> {
  const l = (await tx.query<{ bill_id: string; quantity: number; description: string; unit_price: string; round_id: string | null }>("select bill_id, quantity, description, unit_price, round_id from outlet_bill_lines where id = $1", [lineId])).rows[0];
  if (!l?.round_id) return;
  // only an item whose order went to the TSE is cancelled there
  if (!(await tx.query("select 1 from fiscal_orders where round_id = $1", [l.round_id])).rows.length) return;
  const c = await signingClientIn(tx, l.bill_id);
  if (!c) return;
  await tx.query("insert into fiscal_orders (property_id, client_id, bill_id, voided_line_id, lines, ordered_at) values ($1, $2, $3, $4, $5, clock_timestamp()) on conflict do nothing", [
    c.propertyId,
    c.clientId,
    l.bill_id,
    lineId,
    JSON.stringify([{ quantity: -l.quantity, text: l.description, pricePerUnit: Number(l.unit_price) }]),
  ]);
}

const amount = (n: number) => n.toFixed(2);

/**
 * Sign the orders of a bill (right after its round, by the device's action)
 * or every open one (the worker, every minute). Each is claimed so two
 * signers never sign it twice; a TSE that does not answer leaves it failed,
 * tried again with back-off.
 */
export async function signOutletOrders(pool: Pool, schema: string, deps: FiscalDeps, filter: { billId?: string } = {}): Promise<{ signed: number; failed: number }> {
  if (filter.billId && !isUuid(filter.billId)) return { signed: 0, failed: 0 };
  const ids = await withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string }>(
      `select id from fiscal_orders
       where ($1::uuid is null or bill_id = $1)
         and (state = 'open' or (state = 'failed' and claimed_at < now() - least(attempts, 30) * interval '1 minute')
              or (state = 'signing' and claimed_at < now() - make_interval(secs => ${STALE_CLAIM_SECONDS})))
       order by ordered_at, created_at limit 100`,
      [filter.billId ?? null],
    )).rows.map((r) => r.id),
  );
  const out = { signed: 0, failed: 0 };
  for (const id of ids) (await signOrder(pool, schema, deps, id)) ? out.signed++ : out.failed++;
  return out;
}

async function signOrder(pool: Pool, schema: string, deps: FiscalDeps, orderId: string): Promise<boolean> {
  const claim = randomUUID();
  const held = await withTenant(pool, schema, async (tx) => {
    const o = (await tx.query<{ property_id: string; client_id: string; bill_id: string; lines: OrderLine[]; attempts: number; registered: boolean }>(
      `select o.property_id, o.client_id, o.bill_id, o.lines, o.attempts, c.registered_at is not null as registered
       from fiscal_orders o join fiscal_clients c on c.id = o.client_id where o.id = $1 and o.state <> 'signed' for update of o`,
      [orderId],
    )).rows[0];
    if (!o || !o.registered) return null;
    const unit = await unitIn(tx, o.property_id);
    if (!unit) return null;
    await tx.query("update fiscal_orders set state = 'signing', claim = $2, claimed_at = clock_timestamp(), attempts = attempts + 1 where id = $1", [orderId, claim]);
    return { o, unit };
  });
  if (!held) return false;
  try {
    const t = await deps.provider.sign({
      tssId: held.unit.tssId,
      clientId: held.o.client_id,
      txId: orderId,
      retry: held.o.attempts > 0,
      amountsPerVatRate: [],
      amountsPerPaymentType: [],
      order: { lineItems: held.o.lines.map((l) => ({ quantity: String(l.quantity), text: l.text.slice(0, 200), pricePerUnit: amount(l.pricePerUnit) })) },
      // the table key: order and bill belong together
      metadata: { table_key: held.o.bill_id },
    });
    await withTenant(pool, schema, (tx) =>
      tx.query(
        `update fiscal_orders set state = 'signed', claim = null, error = null, number = $2, time_start = $3, time_end = $4, signature = $5, signature_counter = $6, signed_at = clock_timestamp()
         where id = $1 and (claim = $7 or state = 'failed')`,
        [orderId, t.number, t.timeStart, t.timeEnd, t.signature, t.signatureCounter, claim],
      ),
    );
    return true;
  } catch (err) {
    const error = (err instanceof FiscalUnavailable || err instanceof Error ? err.message : "").slice(0, 200) || "TSE not available";
    await withTenant(pool, schema, (tx) => tx.query("update fiscal_orders set state = 'failed', claim = null, error = $2 where id = $1 and claim = $3", [orderId, error, claim]));
    return false;
  }
}

export interface BillOrders {
  /** When the bill's first order was taken: printed on the Receipt. */
  firstOrderAt: Date | null;
  orders: { number: number | null; orderedAt: Date; signedAt: Date | null; state: string }[];
}

/** The orders of a bill as signed (or waiting), oldest first. */
export async function billOrdersIn(tx: PoolClient, billId: string): Promise<BillOrders> {
  const rows = (await tx.query<{ number: string | null; ordered_at: Date; signed_at: Date | null; state: string }>("select number, ordered_at, signed_at, state from fiscal_orders where bill_id = $1 order by ordered_at, created_at", [billId])).rows;
  const first = (await tx.query<{ at: Date | null }>("select min(coalesce(ordered_at, sent_at)) as at from outlet_rounds where bill_id = $1", [billId])).rows[0]!.at;
  return { firstOrderAt: first, orders: rows.map((r) => ({ number: r.number === null ? null : Number(r.number), orderedAt: r.ordered_at, signedAt: r.signed_at, state: r.state })) };
}
