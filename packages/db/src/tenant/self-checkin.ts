import type { Pool, PoolClient } from "pg";
import { checkInConditions, isRegistrationCountry, isReady, needsReception, sameLastName, selfRegistrationPath, type CheckInCondition, type Cleanliness } from "@hoteloftware/domain";
import { checkInIn } from "./folios";
import { syncHousekeepingTasks } from "./housekeeping";
import { amountDueIn, cardGuaranteeIn } from "./payments";
import { reservationByKey } from "./portal";
import { lockProperty } from "./property-lock";
import { guestFormIn, guestStepIn, lockedRegistrationIn, openRegistrationIn, TabletProblem, type RegistrationView, type TabletInput, type TabletState } from "./registration";
import { assignRoomIn, freeRoomsIn } from "./reservation-changes";
import { withTenant } from "./with-tenant";

/**
 * Self Check-in (ticket 49), on a lobby kiosk or the guest's phone. The
 * Portal Link's key is the guest's authority, as in the Guest Portal; a kiosk
 * finds it by confirmation number and last name (or the confirmation's QR)
 * for today's arrivals only. The Check-in Conditions are tested at once: all
 * met, the guest is checked in without staff; the room not ready, the guest
 * becomes Arrived, Waiting for Room; anything else, reception helps. Each run
 * is kept for the desk's live line; nothing the guest typed is kept in it.
 */

/** Who checks a guest in by Self Check-in, as the change history shows it. */
export const SELF_CHECKIN_USER = "self-checkin";

/** A kiosk serves its own property only. */
export type SelfCheckinChannel = { kind: "kiosk"; deviceId: string; propertyId: string } | { kind: "phone" };
export type SelfCheckinStep = "stay" | "register" | "pay" | "result";
export type SelfCheckinOutcome = "checked_in" | "waiting" | "help";

export interface SelfCheckinView {
  runId: string;
  reservationId: string;
  status: string;
  step: SelfCheckinStep;
  outcome: SelfCheckinOutcome | null;
  property: { name: string; currency: string; checkinFrom: string; keyHandover: "reception" };
  stay: { firstName: string; lastName: string; confirmationNumber: string; arrival: string; departure: string; roomType: string; ratePlan: string; adults: number; children: number };
  /** The Check-in Conditions not met now. */
  failed: CheckInCondition[];
  /** The registration: done (or none needed), still on screen (with the guest's form), or only at reception. */
  registration: { status: "done" | "pending" | "reception"; form: TabletState | null };
  amountDue: number;
  cardGuarantee: boolean;
  roomNumber: string | null;
}

type Stay = {
  id: string;
  property_id: string;
  status: string;
  arrival: string;
  departure: string;
  adults: number;
  child_ages: number[];
  room_type: string;
  rate_plan: string;
  first_name: string;
  last_name: string;
  confirmation_number: string;
  name: string;
  currency: string;
  country: string;
  key_handover: "reception";
  business_date: string;
  local_time: string;
  checkin_from: string;
};

async function stayIn(tx: PoolClient, reservationId: string): Promise<Stay> {
  return (await tx.query<Stay>(
    `select r.id, r.property_id, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, r.adults, r.child_ages,
            t.name as room_type, pl.name as rate_plan, g.first_name, g.last_name, b.confirmation_number, p.name, trim(p.currency) as currency, p.country, p.key_handover,
            to_char(coalesce(p.business_date, (now() at time zone p.time_zone)::date), 'YYYY-MM-DD') as business_date,
            to_char(now() at time zone p.time_zone, 'HH24:MI') as local_time,
            to_char(coalesce(pm.checkin_time, '15:00'), 'HH24:MI') as checkin_from
     from reservations r join properties p on p.id = r.property_id join room_types t on t.id = r.room_type_id join rate_plans pl on pl.id = r.rate_plan_id
       join guests g on g.id = r.primary_guest_id join bookings b on b.id = r.booking_id left join property_messaging pm on pm.property_id = p.id
     where r.id = $1`,
    [reservationId],
  )).rows[0]!;
}

/** Cleanliness, nearest to ready first: the room a waiting guest gets is the one prepared soonest. */
const READY_RANK: Record<Cleanliness, number> = { inspected: 0, clean: 1, dirty: 2 };

/** The room for tonight: the one assigned (ready or not), else a free room of the type, a ready one first (none free: null). */
async function roomFor(tx: PoolClient, s: Stay): Promise<{ id: string; number: string; ready: boolean; assigned: boolean } | null> {
  const assigned = (await tx.query<{ id: string; number: string; cleanliness: Cleanliness; inspection_required: boolean }>(
    `select m.id, m.number, m.cleanliness, p.inspection_required from room_assignments a join rooms m on m.id = a.room_id join properties p on p.id = m.property_id
     where a.reservation_id = $1 and a.from_date <= $2 and a.to_date > $2`,
    [s.id, s.business_date],
  )).rows[0];
  if (assigned) return { id: assigned.id, number: assigned.number, ready: isReady(assigned.cleanliness, assigned.inspection_required), assigned: true };
  const free = await freeRoomsIn(tx, s.id, s.business_date);
  if (!free.length) return null;
  const { rows } = await tx.query<{ id: string; number: string; cleanliness: Cleanliness; inspection_required: boolean }>(
    "select m.id, m.number, m.cleanliness, p.inspection_required from rooms m join properties p on p.id = m.property_id where m.id = any($1::uuid[]) order by m.number",
    [free.map((f) => f.id)],
  );
  const best = rows.sort((a, b) => READY_RANK[a.cleanliness] - READY_RANK[b.cleanliness])[0];
  return best ? { id: best.id, number: best.number, ready: isReady(best.cleanliness, best.inspection_required), assigned: false } : null;
}

/** How far the registration is: none needed or done, still on screen, or only at reception. */
function registrationStatus(s: Stay, reg: RegistrationView | null): "done" | "pending" | "reception" {
  if (!isRegistrationCountry(s.country)) return "done";
  // not opened (a Swiss property without its Canton Profile), or on the desk's tablet right now
  if (!reg || reg.deviceId) return "reception";
  const primary = reg.persons.find((p) => p.role === "primary");
  if (!primary) return "reception";
  if (primary.completed) return "done";
  const path = selfRegistrationPath(reg.country, reg.persons, reg.arrival, reg.profile);
  if (path === "reception") return "reception";
  // companions are declared before the path is known: until then the guest's part is open
  if (primary.step !== "review" && primary.step !== "done") return "pending";
  if (path === "none") return primary.step === "done" ? "done" : "pending";
  return primary.guestDone && primary.confirmation ? "done" : "pending";
}

async function viewIn(tx: PoolClient, runId: string): Promise<SelfCheckinView> {
  const run = (await tx.query<{ id: string; reservation_id: string; step: SelfCheckinStep; outcome: SelfCheckinOutcome | null }>("select id, reservation_id, step, outcome from self_checkins where id = $1", [runId])).rows[0]!;
  const s = await stayIn(tx, run.reservation_id);
  const reg = isRegistrationCountry(s.country) ? await lockedRegistrationIn(tx, s.id) : null;
  const registration = registrationStatus(s, reg);
  const primary = reg?.persons.find((p) => p.role === "primary");
  const amountDue = await amountDueIn(tx, s.id);
  const cardGuarantee = !!(await cardGuaranteeIn(tx, s.id));
  const room = s.status === "confirmed" ? await roomFor(tx, s) : null;
  const tonight = (await tx.query<{ number: string }>("select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = $1 and a.from_date <= $2 and a.to_date > $2", [s.id, s.business_date])).rows[0];
  const failed = checkInConditions({ arrival: s.arrival, businessDate: s.business_date, localTime: s.local_time, checkinFrom: s.checkin_from, readyRoom: !!room?.ready, registration, amountDue, cardGuarantee });
  return {
    runId: run.id,
    reservationId: s.id,
    status: s.status,
    step: run.step,
    outcome: run.outcome,
    property: { name: s.name, currency: s.currency, checkinFrom: s.checkin_from, keyHandover: s.key_handover },
    stay: { firstName: s.first_name, lastName: s.last_name, confirmationNumber: s.confirmation_number, arrival: s.arrival, departure: s.departure, roomType: s.room_type, ratePlan: s.rate_plan, adults: s.adults, children: s.child_ages.length },
    failed: s.status === "checked_in" ? [] : failed,
    registration: { status: registration, form: registration === "pending" && reg && primary ? await guestFormIn(tx, reg, primary.id) : null },
    amountDue,
    cardGuarantee,
    roomNumber: tonight?.number ?? null,
  };
}

/** The open run of a stay (the Portal Link's key), locked; none: refused. */
async function runOf(tx: PoolClient, key: string): Promise<{ runId: string; reservationId: string; propertyId: string; status: string }> {
  const r = await reservationByKey(tx, key, { lock: true });
  const run = (await tx.query<{ id: string }>("select id from self_checkins where reservation_id = $1 and finished_at is null order by started_at desc limit 1 for update", [r.id])).rows[0];
  if (!run) throw new Error("Start Self Check-in again");
  return { runId: run.id, reservationId: r.id, propertyId: r.property_id, status: r.status };
}

/**
 * A kiosk finds today's arrival at its property: by confirmation number and
 * the primary guest's last name, or by the Portal Link in the confirmation's
 * QR code. The stay's key, or null (the same answer for anything else).
 */
export async function findForKiosk(pool: Pool, schema: string, propertyId: string, q: { confirmationNumber: string; lastName: string } | { key: string }): Promise<string | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ portal_key: string; last_name: string }>(
      `select r.portal_key, g.last_name from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id
       where r.property_id = $1 and r.status = 'confirmed' and r.arrival = coalesce(p.business_date, (now() at time zone p.time_zone)::date)
         and ${"key" in q ? "r.portal_key = $2" : "upper(b.confirmation_number) = upper($2)"}
       order by r.created_at`,
      [propertyId, "key" in q ? q.key : q.confirmationNumber.trim()],
    );
    const hit = "key" in q ? rows[0] : rows.find((r) => sameLastName(r.last_name, q.lastName));
    return hit?.portal_key ?? null;
  });
}

/**
 * Start (or take up again) Self Check-in for a stay: a run for the desk's
 * live line, and the registration opened for the guest's part on screen.
 */
export async function startSelfCheckin(pool: Pool, schema: string, key: string, channel: SelfCheckinChannel): Promise<SelfCheckinView> {
  return withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key, { lock: true });
    if (channel.kind === "kiosk" && channel.propertyId !== r.property_id) throw new Error("This link does not open anything");
    if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error("This stay cannot be checked in");
    const deviceId = channel.kind === "kiosk" ? channel.deviceId : null;
    let run = (await tx.query<{ id: string }>("select id from self_checkins where reservation_id = $1 and finished_at is null for update", [r.id])).rows[0];
    if (run) await tx.query("update self_checkins set channel = $2, device_id = $3, step = 'stay', updated_at = now() where id = $1", [run.id, channel.kind, deviceId]);
    else run = (await tx.query<{ id: string }>("insert into self_checkins (property_id, reservation_id, channel, device_id) values ($1, $2, $3, $4) returning id", [r.property_id, r.id, channel.kind, deviceId])).rows[0]!;
    if (r.status === "confirmed" && isRegistrationCountry(r.country)) {
      const reg = await openRegistrationIn(tx, r.id, SELF_CHECKIN_USER).catch(() => null);
      const primary = reg?.persons.find((p) => p.role === "primary");
      // the guest's part starts at the details (the language was chosen on the screen)
      if (reg && !reg.deviceId && primary && (primary.step === "waiting" || primary.step === "welcome")) await tx.query("update registration_persons set step = 'details' where id = $1", [primary.id]);
    }
    return viewIn(tx, run.id);
  });
}

export async function selfCheckinView(pool: Pool, schema: string, key: string): Promise<SelfCheckinView> {
  return withTenant(pool, schema, async (tx) => viewIn(tx, (await runOf(tx, key)).runId));
}

/** Where the guest is now, for the desk's live line. */
export async function selfCheckinStep(pool: Pool, schema: string, key: string, step: SelfCheckinStep): Promise<void> {
  if (!["stay", "register", "pay", "result"].includes(step)) throw new Error("Unknown step");
  await withTenant(pool, schema, async (tx) => {
    const { runId } = await runOf(tx, key);
    await tx.query("update self_checkins set step = $2, updated_at = now() where id = $1", [runId, step]);
  });
}

/**
 * The guest's part of the registration on screen: details, the persons
 * travelling along (every guest of the stay), then, where the guest signs on
 * screen, the review with the signature. Once the persons are known and no
 * form is needed, the guest's part is done.
 */
export async function selfCheckinRegister(pool: Pool, schema: string, key: string, input: TabletInput): Promise<SelfCheckinView> {
  if (input.step === "welcome") throw new Error("Unknown step");
  return withTenant(pool, schema, async (tx) => {
    const { runId, reservationId, status } = await runOf(tx, key);
    if (status !== "confirmed") throw new Error("This stay cannot be checked in");
    const reg = await lockedRegistrationIn(tx, reservationId);
    const primary = reg?.persons.find((p) => p.role === "primary");
    if (!reg || !primary || reg.deviceId) throw new Error("Reception will help you with the registration");
    if (input.step === "companions") {
      const s = await stayIn(tx, reservationId);
      const added = Array.isArray(input.add) ? input.add.length : 0;
      // everyone staying is declared: the forms depend on who they are
      if (reg.persons.length + added !== s.adults + s.child_ages.length) throw new TabletProblem("companions");
    }
    await guestStepIn(tx, reg, primary.id, input, SELF_CHECKIN_USER);
    if (input.step === "companions") {
      const after = (await lockedRegistrationIn(tx, reservationId))!;
      if (selfRegistrationPath(after.country, after.persons, after.arrival, after.profile) === "none") {
        await tx.query("update registration_persons set step = 'done', guest_done_at = now() where id = $1", [primary.id]);
      }
    }
    await tx.query("update self_checkins set step = 'register', updated_at = now() where id = $1", [runId]);
    return viewIn(tx, runId);
  });
}

export interface SelfCheckinResult {
  outcome: SelfCheckinOutcome;
  roomNumber: string | null;
  /** What reception will help with (outcome help). */
  failed: CheckInCondition[];
  reservationId: string;
  propertyId: string;
  guestName: string;
}

/**
 * Finish: all Check-in Conditions met, a ready room is assigned (the one
 * assigned already, else a free one of the type) and the stay is Checked-in,
 * its Charges posted. Only the room not ready: Arrived, Waiting for Room (its
 * preparation becomes urgent). Anything else: reception helps; what the guest
 * entered is kept. On the phone only once the guest said they are here.
 */
export async function finishSelfCheckin(pool: Pool, schema: string, key: string, channel: SelfCheckinChannel & { here?: boolean }): Promise<SelfCheckinResult> {
  return withTenant(pool, schema, async (tx) => {
    const { runId, reservationId, propertyId } = await runOf(tx, key);
    if (channel.kind === "kiosk" && channel.propertyId !== propertyId) throw new Error("This link does not open anything");
    if (channel.kind === "phone" && channel.here !== true) throw new Error("Tell us you are at the hotel first");
    await lockProperty(tx, propertyId);
    const v = await viewIn(tx, runId);
    const s = await stayIn(tx, reservationId);
    const done = async (outcome: SelfCheckinOutcome, failed: CheckInCondition[], roomNumber: string | null): Promise<SelfCheckinResult> => {
      await tx.query("update self_checkins set step = 'result', outcome = $2, reason = $3, finished_at = now(), updated_at = now() where id = $1", [runId, outcome, failed.join(",") || null]);
      return { outcome, roomNumber, failed, reservationId, propertyId, guestName: `${s.first_name} ${s.last_name}`.trim() };
    };
    if (s.status !== "confirmed") return done("help", [], null);
    if (needsReception(v.failed)) return done("help", v.failed.filter((c) => c !== "room_not_ready"), null);
    const room = await roomFor(tx, s);
    if (!room?.ready) {
      // the room nearest to ready is planned for the guest, so its preparation is the priority on the board; the guest hears the number once it is ready
      if (room && !room.assigned) await assignRoomIn(tx, reservationId, SELF_CHECKIN_USER, room.id);
      await tx.query("update reservations set waiting_for_room_since = coalesce(waiting_for_room_since, clock_timestamp()) where id = $1", [reservationId]);
      await syncHousekeepingTasks(tx, propertyId, SELF_CHECKIN_USER);
      return done("waiting", [], null);
    }
    if (!room.assigned) await assignRoomIn(tx, reservationId, SELF_CHECKIN_USER, room.id);
    await checkInIn(tx, reservationId, SELF_CHECKIN_USER);
    return done("checked_in", [], room.number);
  });
}

export interface SelfCheckinLine {
  id: string;
  reservationId: string;
  propertyId: string;
  guestName: string;
  channel: "kiosk" | "phone";
  deviceId: string | null;
  step: SelfCheckinStep;
  outcome: SelfCheckinOutcome | null;
  reason: CheckInCondition[];
  roomNumber: string | null;
  at: Date;
}

/** The desk's live line: guests in Self Check-in now, and how it ended in the last two hours. */
export async function selfCheckinLine(pool: Pool, schema: string, propertyIds: string[]): Promise<SelfCheckinLine[]> {
  if (!propertyIds.length) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; reservation_id: string; property_id: string; guest: string; channel: "kiosk" | "phone"; device_id: string | null; step: SelfCheckinStep; outcome: SelfCheckinOutcome | null; reason: string | null; room: string | null; at: Date }>(
      `select c.id, c.reservation_id, c.property_id, trim(g.first_name || ' ' || g.last_name) as guest, c.channel, c.device_id, c.step, c.outcome, c.reason, c.updated_at as at,
              (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id order by a.from_date limit 1) as room
       from self_checkins c join reservations r on r.id = c.reservation_id join guests g on g.id = r.primary_guest_id
       where c.property_id = any($1::uuid[]) and ((c.finished_at is null and c.updated_at > now() - interval '30 minutes') or c.finished_at > now() - interval '2 hours')
       order by c.updated_at desc limit 50`,
      [propertyIds],
    );
    return rows.map((r) => ({ id: r.id, reservationId: r.reservation_id, propertyId: r.property_id, guestName: r.guest, channel: r.channel, deviceId: r.device_id, step: r.step, outcome: r.outcome, reason: (r.reason?.split(",") ?? []) as CheckInCondition[], roomNumber: r.room, at: r.at }));
  });
}

/** The property whose lobby QR code carries this token (a phone scanning it is at the hotel). */
export async function propertyOfLobbyToken(pool: Pool, schema: string, token: string): Promise<string | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  return withTenant(pool, schema, async (tx) => (await tx.query<{ id: string }>("select id from properties where self_checkin_token = $1", [token])).rows[0]?.id ?? null);
}

/** The token of the property's lobby QR code, for staff to print. */
export async function lobbyToken(pool: Pool, schema: string, propertyId: string): Promise<string | null> {
  return withTenant(pool, schema, async (tx) => (await tx.query<{ self_checkin_token: string }>("select self_checkin_token from properties where id = $1", [propertyId])).rows[0]?.self_checkin_token ?? null);
}
