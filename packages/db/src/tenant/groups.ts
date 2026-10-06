import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { OCCUPYING_STATUSES, RELEASE_WARNING_DAYS, addDays, can, groupStatusAllowed, releaseDateFor, releaseWarningDue, seriesArrivals, tentativeShortfall, unsoldHeld, type GroupStatus } from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { createGuest } from "./guests";
import { lockProperty } from "./property-lock";
import { createRatePlan } from "./rate-plans";
import { setRates } from "./rates";
import { createBooking, loadQuoteData } from "./reservations";
import type { Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * Groups (ticket 58, "Groups and allotments"): a contract with an organiser,
 * Held Rooms per room type and night in one dated holding (a Series has one
 * per departure, each with its own Release Date), contract prices per room
 * type and night with included Services (a hidden rate plan of the group's
 * own), terms and reduction rules as text. Tentative: the Held Rooms are
 * only wanted, and the Calendar warns when availability falls below them;
 * it lapses at its option date. Definite: they are out of sale everywhere,
 * channels included, until the Release Date, when the unsold ones return
 * (staff are warned 3 days ahead and may extend). Reservations booked for
 * the group pick its Held Rooms up.
 */

export interface GroupInput {
  propertyId: string;
  name: string;
  /** The organiser: a Company, or a person (a Guest profile), or none yet. */
  organiser: { companyId: string } | { guestId: string } | null;
  contact: string;
  optionDate: string | null;
  terms: string;
  reductionRules: string;
  /** Days before arrival a holding's Release Date falls on. */
  releaseDays: number;
  /** The plan whose policies, Accommodation Service and included Services the group's prices start from. */
  basePlanId: string;
}

function need(viewer: Viewer, action: "manage_groups" | "edit_group_contract" | "view_groups", propertyId: string): void {
  if (!can(viewer.actor, action, propertyId)) throw new Error("Not allowed to do this with groups");
}

async function groupIn(tx: PoolClient, groupId: string, lock = false): Promise<{ id: string; property_id: string; status: GroupStatus; rate_plan_id: string; release_days: number; name: string; organiser_company_id: string | null; organiser_guest_id: string | null }> {
  if (!isUuid(groupId)) throw new Error("Group not found");
  const g = (await tx.query("select id, property_id, status, rate_plan_id, release_days, name, organiser_company_id, organiser_guest_id from groups where id = $1" + (lock ? " for update" : ""), [groupId])).rows[0];
  if (!g) throw new Error("Group not found");
  return g;
}

/** The property's Business Date (the group's "today"). */
async function todayIn(tx: PoolClient, propertyId: string): Promise<string> {
  return (await tx.query<{ d: string }>("select to_char(coalesce(business_date, (now() at time zone time_zone)::date), 'YYYY-MM-DD') as d from properties where id = $1", [propertyId])).rows[0]!.d;
}

/** Availability changed for the group's held room types and nights: the channels are told (where connected). */
async function tellChannels(tx: PoolClient, groupId: string, holdingId: string | null = null): Promise<void> {
  await tx.query(
    `insert into ari_outbox (property_id, kind, room_type_id, date_from, date_to)
     select g.property_id, 'availability', h.room_type_id, min(h.date), max(h.date)
     from group_held_rooms h join group_holdings gh on gh.id = h.holding_id join groups g on g.id = gh.group_id join channel_connections k on k.property_id = g.property_id
     where g.id = $1 and ($2::uuid is null or gh.id = $2::uuid)
     group by g.property_id, h.room_type_id`,
    [groupId, holdingId],
  );
}

/** Create a Group (Front Desk, Property Manager), Tentative, with its own hidden rate plan for the contract prices. */
export async function createGroup(pool: Pool, schema: string, input: GroupInput, viewer: Viewer): Promise<{ id: string; ratePlanId: string }> {
  if (!isUuid(input.propertyId)) throw new Error("Property not found");
  need(viewer, "manage_groups", input.propertyId);
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Name the group");
  if (input.optionDate) checkDate(input.optionDate);
  if (!Number.isInteger(input.releaseDays) || input.releaseDays < 0 || input.releaseDays > 365) throw new Error("The release falls 0 to 365 days before arrival");
  const base = await withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ payment_policy_id: string; cancellation_policy_id: string; accommodation_service_id: string | null; meal_plan: string; base_occupancy: number; services: { serviceId: string; componentPrice: number }[] }>(
      `select p.payment_policy_id, p.cancellation_policy_id, p.accommodation_service_id, p.meal_plan, p.base_occupancy,
         coalesce((select json_agg(json_build_object('serviceId', s.service_id, 'componentPrice', s.component_price)) from rate_plan_services s where s.rate_plan_id = p.id), '[]'::json) as services
       from rate_plans p where p.id = $1 and p.property_id = $2 and p.group_id is null`,
      [isUuid(input.basePlanId) ? input.basePlanId : null, input.propertyId],
    )).rows[0];
    if (!p) throw new Error("Choose the Rate Plan the group's prices start from");
    const org = input.organiser;
    if (org && "companyId" in org && !(isUuid(org.companyId) && (await tx.query("select 1 from companies where id = $1", [org.companyId])).rowCount)) throw new Error("Company not found");
    if (org && "guestId" in org && !(isUuid(org.guestId) && (await tx.query("select 1 from guests where id = $1", [org.guestId])).rowCount)) throw new Error("Guest not found");
    const types = (await tx.query<{ id: string }>("select id from room_types where property_id = $1", [input.propertyId])).rows.map((t) => t.id);
    return { ...p, types };
  });
  const plan = await createRatePlan(
    pool,
    schema,
    {
      propertyId: input.propertyId,
      code: `G${randomBytes(3).toString("hex").toUpperCase()}`,
      name: `Gruppe ${name}`.slice(0, 80),
      kind: "base",
      roomTypeIds: base.types,
      mealPlan: base.meal_plan as never,
      baseOccupancy: base.base_occupancy,
      paymentPolicyId: base.payment_policy_id,
      cancellationPolicyId: base.cancellation_policy_id,
      accommodationServiceId: base.accommodation_service_id,
      includedServices: base.services.map((s) => ({ serviceId: s.serviceId, componentPrice: Number(s.componentPrice) })),
      public: false,
      // a hidden plan carries a Rate Code; the group's is never offered by its code (only from the group)
      rateCode: randomBytes(8).toString("hex").toUpperCase(),
      soldOnChannels: false,
    },
    { userId: viewer.userId },
  );
  // the plan is made in its own transaction: a group that cannot be stored takes its plan away again
  return withTenant(pool, schema, async (tx) => {
    const id = (await tx.query<{ id: string }>(
      `insert into groups (property_id, name, organiser_company_id, organiser_guest_id, contact, option_date, terms, reduction_rules, release_days, rate_plan_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        input.propertyId,
        name,
        input.organiser && "companyId" in input.organiser ? input.organiser.companyId : null,
        input.organiser && "guestId" in input.organiser ? input.organiser.guestId : null,
        input.contact.trim().slice(0, 300),
        input.optionDate,
        input.terms.trim().slice(0, 5000),
        input.reductionRules.trim().slice(0, 2000),
        input.releaseDays,
        plan.id,
        viewer.userId,
      ],
    )).rows[0]!.id;
    await tx.query("update rate_plans set group_id = $2 where id = $1", [plan.id, id]);
    return { id, ratePlanId: plan.id };
  }).catch(async (err: unknown) => {
    await withTenant(pool, schema, async (tx) => {
      await tx.query("delete from rate_plan_services where rate_plan_id = $1", [plan.id]);
      await tx.query("delete from rate_plan_room_types where rate_plan_id = $1", [plan.id]);
      await tx.query("delete from rate_plans where id = $1", [plan.id]);
    }).catch(() => undefined);
    throw err;
  });
}

/** The contract's data: name, organiser, contact, option date, terms, reduction rules, release days. */
/** `organiser` undefined keeps the organiser as it is. */
export async function updateGroup(pool: Pool, schema: string, groupId: string, input: Omit<GroupInput, "propertyId" | "basePlanId" | "organiser"> & { organiser?: GroupInput["organiser"] }, viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const g = await groupIn(tx, groupId, true);
    need(viewer, "manage_groups", g.property_id);
    if (input.optionDate) checkDate(input.optionDate);
    await tx.query(
      `update groups set name = $2, organiser_company_id = $3, organiser_guest_id = $4, contact = $5, option_date = $6, terms = $7, reduction_rules = $8, release_days = $9 where id = $1`,
      [
        g.id,
        input.name.trim().slice(0, 120) || g.name,
        input.organiser === undefined ? g.organiser_company_id : input.organiser && "companyId" in input.organiser ? input.organiser.companyId : null,
        input.organiser === undefined ? g.organiser_guest_id : input.organiser && "guestId" in input.organiser ? input.organiser.guestId : null,
        input.contact.trim().slice(0, 300),
        input.optionDate,
        input.terms.trim().slice(0, 5000),
        input.reductionRules.trim().slice(0, 2000),
        Math.max(0, Math.min(365, Math.trunc(input.releaseDays))),
      ],
    );
  });
}

export interface HoldingInput {
  arrival: string;
  departure: string;
  /** Defaults to the group's release days before arrival. */
  releaseDate?: string | null;
  /** The same rooms every night of the holding, per room type. */
  rooms: { roomTypeId: string; rooms: number }[];
}

async function addHoldingIn(tx: PoolClient, g: { id: string; property_id: string; release_days: number }, input: HoldingInput, today: string): Promise<string> {
  checkDate(input.arrival);
  checkDate(input.departure);
  if (input.departure <= input.arrival) throw new Error("The departure is after the arrival");
  if (input.arrival < today) throw new Error("The arrival is in the past");
  const release = input.releaseDate ? checkDate(input.releaseDate) : releaseDateFor(input.arrival, g.release_days, today);
  if (release > input.arrival) throw new Error("The Release Date is on or before arrival");
  const types = new Set((await tx.query<{ id: string }>("select id from room_types where property_id = $1", [g.property_id])).rows.map((t) => t.id));
  const id = (await tx.query<{ id: string }>("insert into group_holdings (group_id, arrival, departure, release_date) values ($1, $2, $3, $4) returning id", [g.id, input.arrival, input.departure, release])).rows[0]!.id;
  for (const r of input.rooms) {
    if (!types.has(r.roomTypeId)) throw new Error("Room type not found at this property");
    if (!Number.isInteger(r.rooms) || r.rooms < 0 || r.rooms > 999) throw new Error("Held Rooms are a whole number");
    if (!r.rooms) continue;
    await tx.query("insert into group_held_rooms (holding_id, room_type_id, date, rooms) select $1, $2, d::date, $3 from generate_series($4::date, $5::date - 1, interval '1 day') d", [id, r.roomTypeId, r.rooms, input.arrival, input.departure]);
  }
  return id;
}

/** One dated holding of Held Rooms. */
export async function addHolding(pool: Pool, schema: string, groupId: string, input: HoldingInput, viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const g = await groupIn(tx, groupId, true);
    need(viewer, "manage_groups", g.property_id);
    if (g.status === "lapsed" || g.status === "cancelled") throw new Error("The group is closed");
    await lockProperty(tx, g.property_id);
    const id = await addHoldingIn(tx, g, input, await todayIn(tx, g.property_id));
    if (g.status === "definite") await tellChannels(tx, g.id, id);
    return id;
  });
}

/** A Series: one holding per departure on a weekday between two dates, each with its own Release Date. */
export async function createSeries(pool: Pool, schema: string, groupId: string, input: { from: string; to: string; weekday: number; nights: number; rooms: HoldingInput["rooms"] }, viewer: Viewer): Promise<number> {
  if (!Number.isInteger(input.nights) || input.nights < 1 || input.nights > 30) throw new Error("A departure stays 1 to 30 nights");
  const arrivals = seriesArrivals(checkDate(input.from), checkDate(input.to), input.weekday);
  return withTenant(pool, schema, async (tx) => {
    const g = await groupIn(tx, groupId, true);
    need(viewer, "manage_groups", g.property_id);
    if (g.status === "lapsed" || g.status === "cancelled") throw new Error("The group is closed");
    await lockProperty(tx, g.property_id);
    const today = await todayIn(tx, g.property_id);
    for (const arrival of arrivals) await addHoldingIn(tx, g, { arrival, departure: addDays(arrival, input.nights), rooms: input.rooms }, today);
    await tx.query("update groups set series = true where id = $1", [g.id]);
    if (g.status === "definite") await tellChannels(tx, g.id);
    return arrivals.length;
  });
}

/** Held Rooms per room type and night of a holding, as the grid edits them. */
export async function setHeldRooms(pool: Pool, schema: string, holdingId: string, cells: { roomTypeId: string; date: string; rooms: number }[], viewer: Viewer): Promise<void> {
  if (!isUuid(holdingId)) throw new Error("Holding not found");
  await withTenant(pool, schema, async (tx) => {
    const h = (await tx.query<{ group_id: string; arrival: string; departure: string; released: boolean }>("select group_id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure, released_at is not null as released from group_holdings where id = $1", [holdingId])).rows[0];
    if (!h) throw new Error("Holding not found");
    const g = await groupIn(tx, h.group_id, true);
    need(viewer, "manage_groups", g.property_id);
    if (h.released) throw new Error("The holding is released");
    await lockProperty(tx, g.property_id);
    const types = new Set((await tx.query<{ id: string }>("select id from room_types where property_id = $1", [g.property_id])).rows.map((t) => t.id));
    for (const c of cells) {
      checkDate(c.date);
      if (!types.has(c.roomTypeId)) throw new Error("Room type not found at this property");
      if (c.date < h.arrival || c.date >= h.departure) throw new Error("A night outside the holding");
      if (!Number.isInteger(c.rooms) || c.rooms < 0 || c.rooms > 999) throw new Error("Held Rooms are a whole number");
      await tx.query("insert into group_held_rooms (holding_id, room_type_id, date, rooms) values ($1, $2, $3, $4) on conflict (holding_id, room_type_id, date) do update set rooms = excluded.rooms", [holdingId, c.roomTypeId, c.date, c.rooms]);
    }
    if (g.status === "definite") await tellChannels(tx, g.id, holdingId);
  });
}

/** Contract prices per room type and night (Revenue too). */
export async function setGroupPrices(pool: Pool, schema: string, groupId: string, cells: { roomTypeId: string; date: string; price: number }[], viewer: Viewer): Promise<void> {
  const g = await withTenant(pool, schema, (tx) => groupIn(tx, groupId));
  need(viewer, "edit_group_contract", g.property_id);
  await setRates(pool, schema, g.property_id, viewer.userId, cells.map((c) => ({ ratePlanId: g.rate_plan_id, roomTypeId: c.roomTypeId, date: c.date, price: c.price })));
}

/** Tentative ↔ Definite, or lapsed or cancelled; a Definite group's Held Rooms leave or return to sale at once, channels included. */
export async function setGroupStatus(pool: Pool, schema: string, groupId: string, status: GroupStatus, viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const g = await groupIn(tx, groupId, true);
    need(viewer, "manage_groups", g.property_id);
    if (!groupStatusAllowed(g.status, status)) throw new Error(`A ${g.status} group cannot become ${status}`);
    await lockProperty(tx, g.property_id);
    if (status === "definite") {
      const today = await todayIn(tx, g.property_id);
      // Held Rooms are taken out of sale only where they are free: nights short of rooms are named, staff reduce first
      const short: string[] = [];
      for (const h of (await tx.query<{ id: string; arrival: string; departure: string }>("select id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure from group_holdings where group_id = $1 and released_at is null and departure > $2", [g.id, today])).rows) {
        const data = await loadQuoteData(tx, g.property_id, h.arrival, h.departure, null, [h.id]);
        const cells = (await tx.query<{ room_type_id: string; code: string; date: string; unsold: number }>(
          `select x.room_type_id, t.code, to_char(x.date, 'YYYY-MM-DD') as date,
                  greatest(x.rooms - (select count(*) from reservations r where r.group_holding_id = x.holding_id and r.room_type_id = x.room_type_id and r.status = any($2::text[]) and r.arrival <= x.date and r.departure > x.date), 0)::int as unsold
           from group_held_rooms x join room_types t on t.id = x.room_type_id where x.holding_id = $1 and x.date >= $3`,
          [h.id, OCCUPYING_STATUSES, today],
        )).rows;
        for (const c of cells) {
          const type = data.types.find((t) => t.id === c.room_type_id);
          if (type && c.unsold > type.rooms - data.roomsTaken(c.room_type_id, c.date)) short.push(`${c.code} ${c.date}`);
        }
      }
      if (short.length) throw new Error(`Not enough rooms free to hold: ${short.slice(0, 6).join(", ")}${short.length > 6 ? " …" : ""}; reduce the Held Rooms first`);
      // a Release Date already passed would release at once: tomorrow at the earliest (never after arrival)
      await tx.query("update group_holdings set release_date = least(arrival, $2::date + 1), warned_at = null where group_id = $1 and released_at is null and release_date <= $2", [g.id, today]);
    }
    await tx.query("update groups set status = $2 where id = $1", [g.id, status]);
    if (g.status === "definite" || status === "definite") await tellChannels(tx, g.id);
  });
}

/** A holding's Release Date moved (extended before it passes, or brought forward); Revenue too. */
export async function setReleaseDate(pool: Pool, schema: string, holdingId: string, date: string, viewer: Viewer): Promise<void> {
  checkDate(date);
  if (!isUuid(holdingId)) throw new Error("Holding not found");
  await withTenant(pool, schema, async (tx) => {
    const h = (await tx.query<{ group_id: string; arrival: string; released: boolean }>("select group_id, to_char(arrival, 'YYYY-MM-DD') as arrival, released_at is not null as released from group_holdings where id = $1 for update", [holdingId])).rows[0];
    if (!h) throw new Error("Holding not found");
    const g = await groupIn(tx, h.group_id);
    need(viewer, "edit_group_contract", g.property_id);
    if (h.released) throw new Error("The Held Rooms are released already");
    if (date > h.arrival) throw new Error("The Release Date is on or before arrival");
    // tomorrow at the earliest: a release today would happen within the hour, without a warning
    if (date <= (await todayIn(tx, g.property_id)) && date < h.arrival) throw new Error("The Release Date is after today");
    await tx.query("update group_holdings set release_date = $2, warned_at = null where id = $1", [holdingId, date]);
  });
}

/** Book one room for the group: a normal reservation at the group's price, picking its Held Rooms up (the rooming list comes with ticket 59). */
export async function bookFromGroup(
  pool: Pool,
  schema: string,
  holdingId: string,
  input: { roomTypeId: string; firstName: string; lastName: string; adults: number },
  viewer: Viewer,
): Promise<{ reservationId: string }> {
  if (!isUuid(holdingId)) throw new Error("Holding not found");
  const h = await withTenant(pool, schema, async (tx) => {
    const row = (await tx.query<{ group_id: string; arrival: string; departure: string }>("select group_id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure from group_holdings where id = $1", [holdingId])).rows[0];
    if (!row) throw new Error("Holding not found");
    return { ...row, group: await groupIn(tx, row.group_id) };
  });
  need(viewer, "manage_groups", h.group.property_id);
  await withTenant(pool, schema, async (tx) => {
    const x = (await tx.query<{ released: boolean; unsold: number }>(
      `select gh.released_at is not null as released,
              coalesce((select greatest(hr.rooms - (select count(*) from reservations r where r.group_holding_id = gh.id and r.room_type_id = hr.room_type_id and r.status = any($3::text[]) and r.arrival <= hr.date and r.departure > hr.date), 0)
                        from group_held_rooms hr where hr.holding_id = gh.id and hr.room_type_id = $2 order by 1 limit 1), 0)::int as unsold
       from group_holdings gh where gh.id = $1`,
      [holdingId, input.roomTypeId, OCCUPYING_STATUSES],
    )).rows[0]!;
    if (x.released) throw new Error("The Held Rooms are released: book the room as a normal reservation");
    if (h.group.status === "definite" && x.unsold <= 0) throw new Error("No Held Room of this type is left: add Held Rooms or book outside the group");
  });
  const guest = await createGuest(pool, schema, { firstName: input.firstName.trim() || "Gast", lastName: input.lastName.trim() || h.group.name }, { userId: viewer.userId, propertyId: h.group.property_id });
  const booker = h.group.organiser_company_id ? { companyId: h.group.organiser_company_id } : { guestId: h.group.organiser_guest_id ?? guest.id };
  const b = await createBooking(pool, schema, h.group.property_id, viewer.userId, {
    booker,
    walkIn: false,
    notes: "",
    reservations: [{ arrival: h.arrival, departure: h.departure, roomTypeId: input.roomTypeId, ratePlanId: h.group.rate_plan_id, adults: input.adults, childAges: [], primaryGuestId: guest.id, groupHoldingId: holdingId }],
  }).catch(async (err: unknown) => {
    // the guest made for a booking that failed goes again
    await withTenant(pool, schema, (tx) => tx.query("delete from guests g where id = $1 and not exists (select 1 from reservations r where r.primary_guest_id = g.id)", [guest.id])).catch(() => undefined);
    throw err;
  });
  return { reservationId: b.reservations[0]!.id };
}

export interface GroupNight {
  date: string;
  held: number;
  pickedUp: number;
  unsold: number;
  /** Rooms of the type still free for sale that night (the group's own Held Rooms aside). */
  free: number;
  /** Tentative: wanted rooms above what is free (the warning). */
  shortfall: number;
  price: number | null;
}

export interface GroupView {
  id: string;
  propertyId: string;
  name: string;
  status: GroupStatus;
  organiser: { companyId: string; name: string } | { guestId: string; name: string } | null;
  contact: string;
  optionDate: string | null;
  terms: string;
  reductionRules: string;
  series: boolean;
  releaseDays: number;
  ratePlanId: string;
  /** The organiser's link to fill in names (ticket 59), once made. */
  roomingToken: string | null;
  holdings: {
    id: string;
    arrival: string;
    departure: string;
    releaseDate: string;
    released: boolean;
    /** Staff are warned 3 days before the Release Date. */
    releaseSoon: boolean;
    roomTypes: { id: string; code: string; nights: GroupNight[] }[];
    reservations: number;
  }[];
}

/** A group with its holdings, per room type and night: held, picked up, unsold, free, the tentative warning and the contract price. */
export async function groupView(pool: Pool, schema: string, groupId: string, viewer: Viewer): Promise<GroupView> {
  return withTenant(pool, schema, async (tx) => {
    const g = (await tx.query<{ id: string; property_id: string; name: string; status: GroupStatus; organiser_company_id: string | null; company: string | null; organiser_guest_id: string | null; guest: string | null; contact: string; option_date: string | null; terms: string; reduction_rules: string; series: boolean; release_days: number; rate_plan_id: string; rooming_token: string | null }>(
      `select g.id, g.property_id, g.name, g.status, g.organiser_company_id, c.name as company, g.organiser_guest_id, trim(gu.first_name || ' ' || gu.last_name) as guest, g.contact,
              to_char(g.option_date, 'YYYY-MM-DD') as option_date, g.terms, g.reduction_rules, g.series, g.release_days, g.rate_plan_id, g.rooming_token
       from groups g left join companies c on c.id = g.organiser_company_id left join guests gu on gu.id = g.organiser_guest_id where g.id = $1`,
      [isUuid(groupId) ? groupId : null],
    )).rows[0];
    if (!g) throw new Error("Group not found");
    need(viewer, "view_groups", g.property_id);
    const today = await todayIn(tx, g.property_id);
    const holdings = (await tx.query<{ id: string; arrival: string; departure: string; release_date: string; released: boolean; reservations: number }>(
      `select h.id, to_char(h.arrival, 'YYYY-MM-DD') as arrival, to_char(h.departure, 'YYYY-MM-DD') as departure, to_char(h.release_date, 'YYYY-MM-DD') as release_date, h.released_at is not null as released,
              (select count(*)::int from reservations r where r.group_holding_id = h.id and r.status = any($2::text[])) as reservations
       from group_holdings h where h.group_id = $1 order by h.arrival`,
      [g.id, OCCUPYING_STATUSES],
    )).rows;
    const out: GroupView["holdings"] = [];
    for (const h of holdings) {
      const cells = (await tx.query<{ room_type_id: string; code: string; date: string; rooms: number; picked: number }>(
        `select h.room_type_id, t.code, to_char(h.date, 'YYYY-MM-DD') as date, h.rooms,
                (select count(*)::int from reservations r where r.group_holding_id = h.holding_id and r.room_type_id = h.room_type_id and r.status = any($2::text[]) and r.arrival <= h.date and r.departure > h.date) as picked
         from group_held_rooms h join room_types t on t.id = h.room_type_id where h.holding_id = $1 order by t.sort_order, t.code, h.date`,
        [h.id, OCCUPYING_STATUSES],
      )).rows;
      // free for sale that night, this holding's own Held Rooms aside
      const data = await loadQuoteData(tx, g.property_id, h.arrival, h.departure, null, [h.id]);
      const types = new Map<string, { id: string; code: string; nights: GroupNight[] }>();
      for (const c of cells) {
        const type = data.types.find((t) => t.id === c.room_type_id);
        const free = type ? type.rooms - data.roomsTaken(c.room_type_id, c.date) : 0;
        const unsold = h.released ? 0 : unsoldHeld(c.rooms, c.picked);
        if (!types.has(c.room_type_id)) types.set(c.room_type_id, { id: c.room_type_id, code: c.code, nights: [] });
        types.get(c.room_type_id)!.nights.push({
          date: c.date,
          held: c.rooms,
          pickedUp: c.picked,
          unsold,
          free,
          shortfall: g.status === "tentative" ? tentativeShortfall(free, unsold) : 0,
          price: data.price(g.rate_plan_id, c.room_type_id, c.date),
        });
      }
      out.push({ id: h.id, arrival: h.arrival, departure: h.departure, releaseDate: h.release_date, released: h.released, releaseSoon: !h.released && g.status === "definite" && releaseWarningDue(h.release_date, today), roomTypes: [...types.values()], reservations: h.reservations });
    }
    return {
      id: g.id,
      propertyId: g.property_id,
      name: g.name,
      status: g.status,
      organiser: g.organiser_company_id ? { companyId: g.organiser_company_id, name: g.company ?? "" } : g.organiser_guest_id ? { guestId: g.organiser_guest_id, name: g.guest ?? "" } : null,
      contact: g.contact,
      optionDate: g.option_date,
      terms: g.terms,
      reductionRules: g.reduction_rules,
      series: g.series,
      releaseDays: g.release_days,
      ratePlanId: g.rate_plan_id,
      roomingToken: g.rooming_token,
      holdings: out,
    };
  });
}

export interface GroupRow {
  id: string;
  name: string;
  status: GroupStatus;
  organiser: string | null;
  firstArrival: string | null;
  lastDeparture: string | null;
  holdings: number;
  held: number;
  pickedUp: number;
}

export async function listGroups(pool: Pool, schema: string, propertyId: string, viewer: Viewer): Promise<GroupRow[]> {
  if (!isUuid(propertyId)) return [];
  need(viewer, "view_groups", propertyId);
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; name: string; status: GroupStatus; organiser: string | null; first: string | null; last: string | null; holdings: number; held: number; picked: number }>(
      `select g.id, g.name, g.status, coalesce(c.name, trim(gu.first_name || ' ' || gu.last_name)) as organiser,
              (select to_char(min(h.arrival), 'YYYY-MM-DD') from group_holdings h where h.group_id = g.id) as first,
              (select to_char(max(h.departure), 'YYYY-MM-DD') from group_holdings h where h.group_id = g.id) as last,
              (select count(*)::int from group_holdings h where h.group_id = g.id) as holdings,
              -- rooms held on each holding's arrival night, against reservations booked: the same unit
              (select coalesce(sum(x.rooms), 0)::int from group_held_rooms x join group_holdings h on h.id = x.holding_id where h.group_id = g.id and x.date = h.arrival) as held,
              (select count(*)::int from reservations r join group_holdings h on h.id = r.group_holding_id where h.group_id = g.id and r.status = any($2::text[])) as picked
       from groups g left join companies c on c.id = g.organiser_company_id left join guests gu on gu.id = g.organiser_guest_id
       where g.property_id = $1 order by g.status in ('lapsed', 'cancelled'), first nulls last, g.name`,
      [propertyId, OCCUPYING_STATUSES],
    )).rows.map((r) => ({ id: r.id, name: r.name, status: r.status, organiser: r.organiser, firstArrival: r.first, lastDeparture: r.last, holdings: r.holdings, held: r.held, pickedUp: r.picked })),
  );
}

export interface GroupDuties {
  /** Holdings released now, with the rooms that returned to sale. */
  released: { groupId: string; propertyId: string; groupName: string; arrival: string; rooms: number }[];
  /** Holdings whose Release Date is within 3 days: staff are told once. */
  releasingSoon: { groupId: string; propertyId: string; groupName: string; arrival: string; releaseDate: string; unsold: number }[];
  /** Tentative groups past their option date: lapsed. */
  lapsed: { groupId: string; propertyId: string; groupName: string }[];
}

/**
 * The worker's daily work: on the Release Date the unsold Held Rooms of a
 * Definite group return to sale (channels told); 3 days before, staff are
 * warned; a Tentative group past its option date lapses.
 */
export async function runGroupDuties(pool: Pool, schema: string): Promise<GroupDuties> {
  return withTenant(pool, schema, async (tx) => {
    const out: GroupDuties = { released: [], releasingSoon: [], lapsed: [] };
    const due = (await tx.query<{ id: string; group_id: string; property_id: string; name: string; arrival: string; release_date: string; today: string }>(
      `select h.id, g.id as group_id, g.property_id, g.name, to_char(h.arrival, 'YYYY-MM-DD') as arrival, to_char(h.release_date, 'YYYY-MM-DD') as release_date,
              to_char(coalesce(p.business_date, (now() at time zone p.time_zone)::date), 'YYYY-MM-DD') as today
       from group_holdings h join groups g on g.id = h.group_id join properties p on p.id = g.property_id
       where g.status = 'definite' and h.released_at is null
         and h.release_date <= coalesce(p.business_date, (now() at time zone p.time_zone)::date) + ${RELEASE_WARNING_DAYS}
       for update of h`,
    )).rows;
    for (const h of due) {
      // the most unsold Held Rooms on any night (what the release gives back to sale at its peak)
      const rooms = Number((await tx.query<{ n: number }>(
        `select coalesce(max(n), 0)::int as n from (select x.date, sum(greatest(x.rooms - (select count(*) from reservations r where r.group_holding_id = x.holding_id and r.room_type_id = x.room_type_id and r.status = any($2::text[]) and r.arrival <= x.date and r.departure > x.date), 0)) as n
         from group_held_rooms x where x.holding_id = $1 group by x.date) nights`,
        [h.id, OCCUPYING_STATUSES],
      )).rows[0]!.n);
      if (h.release_date <= h.today) {
        await tx.query("update group_holdings set released_at = clock_timestamp() where id = $1", [h.id]);
        await tellChannels(tx, h.group_id, h.id);
        out.released.push({ groupId: h.group_id, propertyId: h.property_id, groupName: h.name, arrival: h.arrival, rooms });
      } else if (releaseWarningDue(h.release_date, h.today)) {
        const n = (await tx.query("update group_holdings set warned_at = clock_timestamp() where id = $1 and warned_at is null", [h.id])).rowCount;
        if (n) out.releasingSoon.push({ groupId: h.group_id, propertyId: h.property_id, groupName: h.name, arrival: h.arrival, releaseDate: h.release_date, unsold: rooms });
      }
    }
    const lapsing = (await tx.query<{ id: string; property_id: string; name: string }>(
      `update groups g set status = 'lapsed' from properties p
       where p.id = g.property_id and g.status = 'tentative' and g.option_date is not null and g.option_date < coalesce(p.business_date, (now() at time zone p.time_zone)::date)
       returning g.id, g.property_id, g.name`,
    )).rows;
    out.lapsed = lapsing.map((g) => ({ groupId: g.id, propertyId: g.property_id, groupName: g.name }));
    return out;
  });
}

/** The property of a group or of a holding (for the caller's rights check). */
export async function groupProperty(pool: Pool, schema: string, ref: { groupId?: string; holdingId?: string }): Promise<string | null> {
  const id = ref.groupId ?? ref.holdingId;
  if (!id || !isUuid(id)) return null;
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ property_id: string }>(ref.groupId ? "select property_id from groups where id = $1" : "select g.property_id from group_holdings h join groups g on g.id = h.group_id where h.id = $1", [id])).rows[0]?.property_id ?? null,
  );
}
