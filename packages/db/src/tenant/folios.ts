import type { Pool, PoolClient } from "pg";
import {
  ROUTING_CATEGORIES,
  earlyDepartureFee,
  folioTotals,
  isOneOf,
  roundMoney,
  routeCharge,
  staySync,
  type FeeKind,
  type RoutingCategory,
  type TaxCodeTotal,
  type WantedStayCharge,
} from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { lockProperty } from "./property-lock";
import { withTenant } from "./with-tenant";

/**
 * Check-in, Folios and Charges ("Folio, billing and invoicing domain model",
 * ADR 0009, ADR 0010). A Charge is one Service for one Service Date, stored
 * gross with its Tax Code and the rate in force that day; net and VAT are
 * derived per Tax Code on the folio. Check-in posts every night per
 * component; afterwards stay Charges follow the stay (staySync). Charges are
 * never deleted: a wrong one is voided with a reason and stays visible.
 * Folios are created on first need: folio 1 bills the Primary Guest, folio 2
 * the booking's Company with its default Routing Rules.
 */

export type ChargeOrigin = "stay" | "catalogue" | "free_text" | "fee";

export interface Charge {
  id: string;
  folioId: string;
  serviceId: string | null;
  description: string;
  serviceDate: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxCodeId: string;
  taxCode: string;
  taxRate: number;
  revenueAccount: string;
  category: RoutingCategory;
  origin: ChargeOrigin;
  postedAt: string;
  postedBy: string;
  voided: boolean;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  /** Set when the stay sync voided it (shortening or a changed night), null for a void by hand. */
  autoVoid: AutoVoid | null;
}

export interface Folio {
  id: string;
  number: number;
  billTo: "guest" | "company";
  billToId: string;
  billToName: string;
  charges: Charge[];
  totals: { byTaxCode: TaxCodeTotal[]; gross: number };
}

export interface FolioView {
  folios: Folio[];
  routing: { category: RoutingCategory; folioId: string }[];
}

/** Thrown when a change gives up nights already charged: the caller shows the voids and the fee, and repeats with confirmation. */
export class ShorteningNeedsConfirmation extends Error {
  constructor(
    readonly voids: { id: string; serviceDate: string; description: string; amount: number }[],
    readonly fee: number,
  ) {
    super("Shortening the stay voids posted Charges; confirm to apply");
    this.name = "ShorteningNeedsConfirmation";
  }
}

interface ResRow {
  id: string;
  property_id: string;
  rate_plan_id: string;
  status: string;
  arrival: string;
  departure: string;
  primary_guest_id: string;
  company_id: string | null;
  legal_entity_id: string;
  today: string;
}

// TODO(Night Audit ticket): the property's Business Date instead of its wall-clock date
const RES_SELECT = `select r.id, r.property_id, r.rate_plan_id, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
    r.primary_guest_id, coalesce(b.booker_company_id, b.rate_code_company_id) as company_id, p.legal_entity_id,
    to_char((now() at time zone p.time_zone)::date, 'YYYY-MM-DD') as today
  from reservations r join bookings b on b.id = r.booking_id join properties p on p.id = r.property_id where r.id = $1`;

/** The reservation row locked for a Charge write (posting, voiding, moving: no effect on Availability or prices). */
async function loadReservation(tx: PoolClient, id: string): Promise<ResRow> {
  if (!isUuid(id)) throw new Error("Reservation not found");
  const { rows } = await tx.query<ResRow>(`${RES_SELECT} for update of r`, [id]);
  if (!rows[0]) throw new Error("Reservation not found");
  return rows[0];
}

/** For check-in: the property lock first, as every reservation writer takes it, then the row. */
async function loadReservationForStayChange(tx: PoolClient, id: string): Promise<ResRow> {
  if (!isUuid(id)) throw new Error("Reservation not found");
  const pre = await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [id]);
  if (!pre.rows[0]) throw new Error("Reservation not found");
  await lockProperty(tx, pre.rows[0].property_id);
  return loadReservation(tx, id);
}

function requireChargeable(r: ResRow): void {
  if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error(`The reservation is ${r.status.replace("_", " ")}; Charges cannot be posted`);
}

/**
 * A new reservation's folios: folio 1 for the Primary Guest; with a Company
 * on the booking (Booker or the Company of its Rate Code) also folio 2 for
 * it, carrying the Company's default Routing Rules. Called when a booking is
 * made; reservations from before folios get them on first need.
 */
export async function openFolios(tx: PoolClient, reservationId: string, userId: string): Promise<void> {
  const { rows } = await tx.query<ResRow>(RES_SELECT, [reservationId]);
  if (rows[0]) await ensureFolios(tx, rows[0], userId);
}

async function ensureFolios(tx: PoolClient, res: ResRow, userId: string): Promise<void> {
  const { rows } = await tx.query("select 1 from folios where reservation_id = $1 limit 1", [res.id]);
  if (rows.length) return;
  await tx.query("insert into folios (reservation_id, number, bill_to_guest_id, created_by) values ($1, 1, $2, $3)", [res.id, res.primary_guest_id, userId]);
  if (!res.company_id) return;
  const folio = await tx.query<{ id: string }>("insert into folios (reservation_id, number, bill_to_company_id, created_by) values ($1, 2, $2, $3) returning id", [res.id, res.company_id, userId]);
  await tx.query(
    `insert into reservation_routing (reservation_id, category, folio_id)
     select $1, unnest(routing), $2 from companies where id = $3`,
    [res.id, folio.rows[0]!.id, res.company_id],
  );
}

async function rateOn(tx: PoolClient, taxCodeId: string, date: string): Promise<number> {
  const { rows } = await tx.query<{ rate: string }>("select rate from tax_code_rates where tax_code_id = $1 and valid_from <= $2 order by valid_from desc limit 1", [taxCodeId, date]);
  if (!rows[0]) throw new Error(`The Tax Code has no rate in force on ${date}`);
  return Number(rows[0].rate);
}

interface NewCharge {
  serviceId: string | null;
  description: string;
  serviceDate: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxCodeId: string;
  revenueAccount: string;
  category: RoutingCategory;
  origin: ChargeOrigin;
  component?: string | null;
}

/** Posts onto the folio the Routing Rules pick for the category. */
async function insertCharge(tx: PoolClient, res: ResRow, userId: string, c: NewCharge): Promise<string> {
  const folios = await tx.query<{ id: string }>("select id from folios where reservation_id = $1 and number = 1", [res.id]);
  const rules = await tx.query<{ category: RoutingCategory; folio_id: string }>("select category, folio_id from reservation_routing where reservation_id = $1", [res.id]);
  const folioId = routeCharge(c.category, rules.rows.map((r) => ({ category: r.category, folioId: r.folio_id })), folios.rows[0]!.id);
  const taxRate = await rateOn(tx, c.taxCodeId, c.serviceDate);
  const { rows } = await tx.query<{ id: string }>(
    `insert into charges (folio_id, reservation_id, property_id, service_id, description, service_date, quantity, unit_price, amount, tax_code_id, tax_rate, revenue_account, category, origin, component, posted_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
    [folioId, res.id, res.property_id, c.serviceId, c.description, c.serviceDate, c.quantity, c.unitPrice, c.amount, c.taxCodeId, taxRate, c.revenueAccount, c.category, c.origin, c.component ?? null, userId],
  );
  const id = rows[0]!.id;
  await tx.query("insert into charge_events (charge_id, user_id, action, detail) values ($1, $2, 'post', $3)", [id, userId, JSON.stringify({ folioId })]);
  return id;
}

/** Voids the stay sync makes itself; their reason is stored for the log, the kind tells them from a void by hand. */
export type AutoVoid = "early_departure" | "stay_changed";
const AUTO_VOID_REASON: Record<AutoVoid, string> = { early_departure: "Early departure", stay_changed: "Stay changed" };

async function voidIn(tx: PoolClient, chargeId: string, reason: string, userId: string, auto: AutoVoid | null = null): Promise<void> {
  const { rowCount } = await tx.query("update charges set voided_at = clock_timestamp(), voided_by = $2, void_reason = $3, auto_void = $4 where id = $1 and voided_at is null", [
    chargeId,
    userId,
    reason,
    auto,
  ]);
  if (!rowCount) throw new Error("The Charge is already voided");
  await tx.query("insert into charge_events (charge_id, user_id, action, detail) values ($1, $2, 'void', $3)", [chargeId, userId, JSON.stringify(auto ? { reason, auto } : { reason })]);
}

interface WantedLine extends WantedStayCharge {
  serviceId: string;
  quantity: number;
  unitPrice: number;
}

/** The stay Charges the stored nights call for: the room part as the Rate Plan's accommodation Service, included Services per person. */
async function accommodationServiceOf(tx: PoolClient, res: ResRow): Promise<string> {
  // a derived plan without its own follows its base plan
  const plan = await tx.query<{ accommodation_service_id: string | null }>(
    "select coalesce(p.accommodation_service_id, b.accommodation_service_id) as accommodation_service_id from rate_plans p left join rate_plans b on b.id = p.base_plan_id where p.id = $1",
    [res.rate_plan_id],
  );
  const id = plan.rows[0]?.accommodation_service_id;
  if (!id) throw new Error("The Rate Plan has no accommodation Service; set one in the Rate Plan settings");
  return id;
}

async function wantedStay(tx: PoolClient, res: ResRow): Promise<WantedLine[]> {
  const roomService = await accommodationServiceOf(tx, res);
  const { rows } = await tx.query<{ date: string; kind: "room" | "service"; service_id: string | null; persons: number | null; unit_price: string; amount: string }>(
    "select to_char(date, 'YYYY-MM-DD') as date, kind, service_id, persons, unit_price, amount from reservation_night_components where reservation_id = $1 order by date, kind, service_id",
    [res.id],
  );
  return rows.map((r) =>
    r.kind === "room"
      ? { serviceDate: r.date, component: "room", amount: Number(r.amount), serviceId: roomService, quantity: 1, unitPrice: Number(r.amount) }
      : { serviceDate: r.date, component: `svc:${r.service_id}`, amount: Number(r.amount), serviceId: r.service_id!, quantity: r.persons ?? 1, unitPrice: Number(r.unit_price) },
  );
}

interface ServiceRow {
  id: string;
  name: string;
  tax_code_id: string;
  revenue_account: string;
}

async function serviceRows(tx: PoolClient, propertyId: string, ids: string[]): Promise<Map<string, ServiceRow>> {
  const { rows } = await tx.query<ServiceRow>("select id, name, tax_code_id, revenue_account from services where property_id = $1 and id = any($2::uuid[])", [propertyId, [...new Set(ids)]]);
  return new Map(rows.map((r) => [r.id, r]));
}

async function postStay(tx: PoolClient, res: ResRow, userId: string, lines: WantedLine[]): Promise<void> {
  const services = await serviceRows(tx, res.property_id, lines.map((l) => l.serviceId));
  for (const l of lines) {
    const s = services.get(l.serviceId);
    if (!s) throw new Error("A Service of the stay is not found at this property");
    await insertCharge(tx, res, userId, {
      serviceId: s.id,
      description: s.name,
      serviceDate: l.serviceDate,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
      taxCodeId: s.tax_code_id,
      revenueAccount: s.revenue_account,
      category: l.component === "room" ? "accommodation" : "package",
      origin: "stay",
      component: l.component,
    });
  }
}

/**
 * Check-in: the guest arrives on a night of the stay, a room is assigned for
 * tonight, and every night is posted per component onto the routed folios.
 */
export async function checkIn(pool: Pool, schema: string, id: string, userId: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const res = await loadReservationForStayChange(tx, id);
    if (res.status !== "confirmed") throw new Error(`The reservation is ${res.status.replace("_", " ")} and cannot be checked in`);
    if (res.arrival > res.today) throw new Error(`Check-in opens on the arrival date, ${res.arrival}`);
    if (res.departure <= res.today) throw new Error("The stay has ended; it cannot be checked in");
    const room = await tx.query("select 1 from room_assignments where reservation_id = $1 and from_date <= $2 and to_date > $2", [res.id, res.today]);
    if (!room.rows.length) throw new Error("Assign a room for tonight before check-in");
    const lines = await wantedStay(tx, res);
    await ensureFolios(tx, res, userId);
    await postStay(tx, res, userId, lines);
    await tx.query("update reservations set status = 'checked_in', checked_in_at = now(), checked_in_by = $2 where id = $1", [res.id, userId]);
    await tx.query("insert into reservation_changes (reservation_id, user_id, action, before, after) values ($1, $2, 'check_in', $3, $4)", [
      res.id,
      userId,
      JSON.stringify({ status: "confirmed" }),
      JSON.stringify({ status: "checked_in" }),
    ]);
  });
}

/**
 * After a change to a checked-in stay (inside the change's transaction, the
 * nights already rewritten): added or repriced nights are posted at once,
 * Charges of changed nights voided. Nights given up need confirmation first,
 * since they void posted Charges and cost the Rate Plan's early-departure fee.
 */
export async function syncStayCharges(tx: PoolClient, reservationId: string, userId: string, confirmShortening: boolean): Promise<void> {
  const res = await loadReservation(tx, reservationId);
  if (res.status !== "checked_in") return;
  const posted = await tx.query<{ id: string; service_date: string; component: string; amount: string; description: string; live: boolean }>(
    `select id, to_char(service_date, 'YYYY-MM-DD') as service_date, component, amount, description, voided_at is null as live from charges
     where reservation_id = $1 and origin = 'stay' and auto_void is null order by service_date, posted_at`,
    [res.id],
  );
  const rows = posted.rows.map((p) => ({ id: p.id, serviceDate: p.service_date, component: p.component, amount: Number(p.amount), description: p.description, live: p.live }));
  const have = rows.filter((h) => h.live);
  const nightKey = (c: { serviceDate: string; component: string }) => `${c.serviceDate}|${c.component}`;
  // a night's component voided by hand (say, a night given for free) is settled: not posted again, whatever its price now
  const settled = new Set(rows.filter((h) => !h.live && !have.some((x) => nightKey(x) === nightKey(h))).map(nightKey));
  const wanted = (await wantedStay(tx, res)).filter((w) => !settled.has(nightKey(w)));
  const plan = staySync(have, wanted);
  if (plan.voids.length === 0 && plan.posts.length === 0) return;
  const removed = new Set(plan.removedDates);
  let fee = 0;
  if (removed.size) {
    const policy = await tx.query<{ early_departure_fee_kind: FeeKind; early_departure_fee_percent: string | null }>(
      "select early_departure_fee_kind, early_departure_fee_percent from rate_plans where id = $1",
      [res.rate_plan_id],
    );
    const p = policy.rows[0]!;
    const perNight = plan.removedDates.map((d) => roundMoney(have.filter((h) => h.serviceDate === d).reduce((s, h) => s + h.amount, 0)));
    fee = earlyDepartureFee(p.early_departure_fee_kind, p.early_departure_fee_percent === null ? null : Number(p.early_departure_fee_percent), perNight);
    if (!confirmShortening) {
      const voids = have.filter((h) => plan.voids.includes(h.id)).map((h) => ({ id: h.id, serviceDate: h.serviceDate, description: h.description, amount: h.amount }));
      throw new ShorteningNeedsConfirmation(voids, fee);
    }
  }
  for (const v of plan.voids) {
    const date = have.find((h) => h.id === v)!.serviceDate;
    const kind: AutoVoid = removed.has(date) ? "early_departure" : "stay_changed";
    await voidIn(tx, v, AUTO_VOID_REASON[kind], userId, kind);
  }
  await postStay(tx, res, userId, wanted.filter((w) => plan.posts.includes(w)));
  if (fee > 0) {
    const accommodationServiceId = await accommodationServiceOf(tx, res);
    const s = (await serviceRows(tx, res.property_id, [accommodationServiceId])).get(accommodationServiceId)!;
    // TODO(gate 03): the tax advisor confirms the Tax Code of the early-departure fee; the accommodation one for now
    await insertCharge(tx, res, userId, {
      serviceId: s.id,
      description: "Early departure fee",
      serviceDate: res.today,
      quantity: 1,
      unitPrice: fee,
      amount: fee,
      taxCodeId: s.tax_code_id,
      revenueAccount: s.revenue_account,
      category: "accommodation",
      origin: "fee",
    });
  }
}

function checkAmount(n: number, label: string): number {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be more than zero`);
  return roundMoney(n);
}

/** A Service from the property's catalogue onto the folio its Routing Rule picks (category extras). */
export async function postServiceCharge(
  pool: Pool,
  schema: string,
  reservationId: string,
  input: { serviceId: string; quantity: number; serviceDate?: string | undefined; unitPrice?: number | undefined },
  userId: string,
): Promise<{ id: string; amount: number }> {
  if (!isUuid(input.serviceId)) throw new Error("Service not found");
  return withTenant(pool, schema, async (tx) => {
    const res = await loadReservation(tx, reservationId);
    requireChargeable(res);
    const s = await tx.query<ServiceRow & { default_price: string; active: boolean }>(
      "select id, name, tax_code_id, revenue_account, default_price, active from services where id = $1 and property_id = $2",
      [input.serviceId, res.property_id],
    );
    const service = s.rows[0];
    if (!service || !service.active) throw new Error("Service not found");
    const quantity = checkAmount(input.quantity, "Quantity");
    const unitPrice = input.unitPrice === undefined ? Number(service.default_price) : checkAmount(input.unitPrice, "Price");
    const amount = roundMoney(quantity * unitPrice);
    if (amount <= 0) throw new Error("The Service has no price; enter one");
    await ensureFolios(tx, res, userId);
    const id = await insertCharge(tx, res, userId, {
      serviceId: service.id,
      description: service.name,
      serviceDate: input.serviceDate ? checkDate(input.serviceDate) : res.today,
      quantity,
      unitPrice,
      amount,
      taxCodeId: service.tax_code_id,
      revenueAccount: service.revenue_account,
      category: "extras",
      origin: "catalogue",
    });
    return { id, amount };
  });
}

/** A Charge outside the catalogue (Property Manager): a description, a gross amount and a Tax Code of the property's Legal Entity. */
export async function postFreeTextCharge(
  pool: Pool,
  schema: string,
  reservationId: string,
  input: { description: string; amount: number; taxCodeId: string; serviceDate?: string | undefined },
  userId: string,
): Promise<{ id: string; description: string; amount: number; origin: ChargeOrigin }> {
  const description = input.description.trim();
  if (!description) throw new Error("A description is required");
  if (description.length > 200) throw new Error("The description is too long");
  const amount = checkAmount(input.amount, "Amount");
  if (!isUuid(input.taxCodeId)) throw new Error("Tax Code not found");
  return withTenant(pool, schema, async (tx) => {
    const res = await loadReservation(tx, reservationId);
    requireChargeable(res);
    const code = await tx.query("select 1 from tax_codes where id = $1 and legal_entity_id = $2", [input.taxCodeId, res.legal_entity_id]);
    if (!code.rows.length) throw new Error("Tax Code not found for this property's Legal Entity");
    await ensureFolios(tx, res, userId);
    const id = await insertCharge(tx, res, userId, {
      serviceId: null,
      description,
      serviceDate: input.serviceDate ? checkDate(input.serviceDate) : res.today,
      quantity: 1,
      unitPrice: amount,
      amount,
      taxCodeId: input.taxCodeId,
      revenueAccount: "",
      category: "extras",
      origin: "free_text",
    });
    return { id, description, amount, origin: "free_text" };
  });
}

/** The reservation locked, with the Charge checked to be on it. */
async function chargeReservation(tx: PoolClient, reservationId: string, chargeId: string): Promise<ResRow> {
  if (!isUuid(chargeId)) throw new Error("Charge not found");
  const res = await loadReservation(tx, reservationId);
  const { rows } = await tx.query("select 1 from charges where id = $1 and reservation_id = $2", [chargeId, res.id]);
  if (!rows[0]) throw new Error("Charge not found");
  return res;
}

/** Void with a mandatory reason; the Charge stays on the folio, struck out, and in its log. */
export async function voidCharge(pool: Pool, schema: string, reservationId: string, chargeId: string, reason: string, userId: string): Promise<void> {
  const why = reason.trim();
  if (!why) throw new Error("A reason is required to void a Charge");
  if (why.length > 200) throw new Error("The reason is too long");
  await withTenant(pool, schema, async (tx) => {
    await chargeReservation(tx, reservationId, chargeId);
    await voidIn(tx, chargeId, why, userId);
  });
}

/** Move a Charge to another folio of the same reservation. */
export async function moveCharge(pool: Pool, schema: string, reservationId: string, chargeId: string, folioId: string, userId: string): Promise<void> {
  if (!isUuid(folioId)) throw new Error("Folio not found");
  await withTenant(pool, schema, async (tx) => {
    const res = await chargeReservation(tx, reservationId, chargeId);
    const folio = await tx.query("select 1 from folios where id = $1 and reservation_id = $2", [folioId, res.id]);
    if (!folio.rows.length) throw new Error("Folio not found on this reservation");
    const { rows } = await tx.query<{ folio_id: string }>("select folio_id from charges where id = $1 and voided_at is null", [chargeId]);
    if (!rows[0]) throw new Error("A voided Charge cannot be moved");
    if (rows[0].folio_id === folioId) return;
    await tx.query("update charges set folio_id = $2 where id = $1", [chargeId, folioId]);
    await tx.query("insert into charge_events (charge_id, user_id, action, detail) values ($1, $2, 'move', $3)", [chargeId, userId, JSON.stringify({ from: rows[0].folio_id, to: folioId })]);
  });
}

/** Another folio with its own Bill-to (a Guest or a Company). */
export async function addFolio(pool: Pool, schema: string, reservationId: string, billTo: { guestId: string } | { companyId: string }, userId: string): Promise<{ id: string; number: number }> {
  const guestId = "guestId" in billTo ? billTo.guestId : null;
  const companyId = "companyId" in billTo ? billTo.companyId : null;
  if (!isUuid(guestId ?? companyId ?? "")) throw new Error("Bill-to not found");
  return withTenant(pool, schema, async (tx) => {
    const res = await loadReservation(tx, reservationId);
    requireChargeable(res);
    const exists = guestId
      ? await tx.query("select 1 from guests where id = $1", [guestId])
      : await tx.query("select 1 from companies where id = $1 and active", [companyId]);
    if (!exists.rows.length) throw new Error("Bill-to not found");
    await ensureFolios(tx, res, userId);
    const { rows } = await tx.query<{ id: string; number: number }>(
      `insert into folios (reservation_id, number, bill_to_guest_id, bill_to_company_id, created_by)
       select $1, coalesce(max(number), 0) + 1, $2, $3, $4 from folios where reservation_id = $1 returning id, number`,
      [res.id, guestId, companyId, userId],
    );
    return rows[0]!;
  });
}

/** Routing Rule of the reservation: Charges of the category go to the folio (null: back to folio 1). Charges already posted stay where they are. */
export async function setRouting(pool: Pool, schema: string, reservationId: string, category: string, folioId: string | null): Promise<void> {
  if (!isOneOf(ROUTING_CATEGORIES, category)) throw new Error("Unknown routing category");
  await withTenant(pool, schema, async (tx) => {
    const res = await loadReservation(tx, reservationId);
    if (folioId === null) {
      await tx.query("delete from reservation_routing where reservation_id = $1 and category = $2", [res.id, category]);
      return;
    }
    if (!isUuid(folioId)) throw new Error("Folio not found");
    const folio = await tx.query("select 1 from folios where id = $1 and reservation_id = $2", [folioId, res.id]);
    if (!folio.rows.length) throw new Error("Folio not found on this reservation");
    await tx.query(
      "insert into reservation_routing (reservation_id, category, folio_id) values ($1, $2, $3) on conflict (reservation_id, category) do update set folio_id = excluded.folio_id",
      [res.id, category, folioId],
    );
  });
}

interface ChargeRow {
  id: string;
  folio_id: string;
  service_id: string | null;
  description: string;
  service_date: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_code_id: string;
  tax_code: string;
  tax_rate: string;
  revenue_account: string;
  category: RoutingCategory;
  origin: ChargeOrigin;
  posted_at: Date;
  posted_by: string;
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
  auto_void: AutoVoid | null;
}

/** The reservation's folios with every Charge (voided ones too), totals per Tax Code, and its Routing Rules. */
export async function loadFolios(pool: Pool, schema: string, reservationId: string): Promise<FolioView> {
  if (!isUuid(reservationId)) return { folios: [], routing: [] };
  return withTenant(pool, schema, async (tx) => {
    const folios = await tx.query<{ id: string; number: number; guest_id: string | null; company_id: string | null; name: string }>(
      `select f.id, f.number, f.bill_to_guest_id as guest_id, f.bill_to_company_id as company_id,
         coalesce(c.name, trim(g.first_name || ' ' || g.last_name)) as name
       from folios f left join guests g on g.id = f.bill_to_guest_id left join companies c on c.id = f.bill_to_company_id
       where f.reservation_id = $1 order by f.number`,
      [reservationId],
    );
    const charges = await tx.query<ChargeRow>(
      `select ch.id, ch.folio_id, ch.service_id, ch.description, to_char(ch.service_date, 'YYYY-MM-DD') as service_date, ch.quantity, ch.unit_price, ch.amount,
         ch.tax_code_id, t.code as tax_code, ch.tax_rate, ch.revenue_account, ch.category, ch.origin, ch.posted_at, ch.posted_by, ch.voided_at, ch.voided_by, ch.void_reason, ch.auto_void
       from charges ch join tax_codes t on t.id = ch.tax_code_id
       where ch.reservation_id = $1 order by ch.service_date, ch.posted_at`,
      [reservationId],
    );
    const routing = await tx.query<{ category: RoutingCategory; folio_id: string }>("select category, folio_id from reservation_routing where reservation_id = $1 order by category", [reservationId]);
    const all: Charge[] = charges.rows.map((c) => ({
      id: c.id,
      folioId: c.folio_id,
      serviceId: c.service_id,
      description: c.description,
      serviceDate: c.service_date,
      quantity: Number(c.quantity),
      unitPrice: Number(c.unit_price),
      amount: Number(c.amount),
      taxCodeId: c.tax_code_id,
      taxCode: c.tax_code,
      taxRate: Number(c.tax_rate),
      revenueAccount: c.revenue_account,
      category: c.category,
      origin: c.origin,
      postedAt: c.posted_at.toISOString(),
      postedBy: c.posted_by,
      voided: c.voided_at !== null,
      voidedAt: c.voided_at?.toISOString() ?? null,
      voidedBy: c.voided_by,
      voidReason: c.void_reason,
      autoVoid: c.auto_void,
    }));
    return {
      folios: folios.rows.map((f) => {
        const own = all.filter((c) => c.folioId === f.id);
        return {
          id: f.id,
          number: f.number,
          billTo: f.company_id ? "company" : "guest",
          billToId: (f.company_id ?? f.guest_id)!,
          billToName: f.name,
          charges: own,
          totals: folioTotals(own),
        };
      }),
      routing: routing.rows.map((r) => ({ category: r.category, folioId: r.folio_id })),
    };
  });
}

export interface ChargeEvent {
  chargeId: string;
  description: string;
  origin: ChargeOrigin;
  action: "post" | "void" | "move";
  userId: string;
  at: string;
  detail: Record<string, unknown>;
}

/** What happened to the reservation's Charges, oldest first. */
export async function chargeHistory(pool: Pool, schema: string, reservationId: string): Promise<ChargeEvent[]> {
  if (!isUuid(reservationId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ charge_id: string; description: string; origin: ChargeOrigin; action: ChargeEvent["action"]; user_id: string; at: Date; detail: Record<string, unknown> }>(
      `select e.charge_id, ch.description, ch.origin, e.action, e.user_id, e.at, e.detail
       from charge_events e join charges ch on ch.id = e.charge_id where ch.reservation_id = $1 order by e.at, e.id`,
      [reservationId],
    );
    return rows.map((r) => ({ chargeId: r.charge_id, description: r.description, origin: r.origin, action: r.action, userId: r.user_id, at: r.at.toISOString(), detail: r.detail }));
  });
}
