import type { Pool, PoolClient } from "pg";
import {
  CITY_TAX_PRESETS,
  MANUAL_EXEMPTION_REASONS,
  cityTax,
  roundMoney,
  splitGross,
  type CityTaxExemptKey,
  type CityTaxExemptionReason,
  type CityTaxNight,
  type CityTaxPassOn,
  type CityTaxPreset,
  type CityTaxReasonSetting,
  type CityTaxVersion,
} from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { syncStayCharges } from "./folios";
import { lockProperty } from "./property-lock";
import { rateOn } from "./tax-rate";
import { withTenant } from "./with-tenant";

/**
 * City Tax (ticket 30): the property's rule with its versions, the Services
 * counted into the base and the exemption reasons it enables; exemptions per
 * person on a reservation with their evidence; the tax of each night of a
 * checked-in stay, kept for the filing report whether it is charged on top
 * (a City Tax Charge per night, posted with the stay) or absorbed.
 */

export interface CityTaxRuleView {
  id: string;
  propertyId: string;
  name: string;
  preset: CityTaxPreset | null;
  taxCodeId: string;
  revenueAccount: string;
  versions: (CityTaxVersion & { id: string })[];
  baseServiceIds: string[];
  reasons: CityTaxReasonSetting[];
}

/** Reservations whose City Tax changed after a change to the rule: the total of their recalculated nights before and after. */
export interface CityTaxChange {
  changed: { reservationId: string; confirmationNumber: string; guestName: string; before: number; after: number }[];
  /** Stays that could not be recalculated (they keep their City Tax as it was), with the reason. */
  skipped: { reservationId: string; confirmationNumber: string; guestName: string; reason: string }[];
}

interface VersionRow {
  id: string;
  valid_from: string;
  booked_from: string | null;
  kind: CityTaxVersion["kind"];
  percent: string | null;
  night_cap: number | null;
  step_basis: CityTaxVersion["stepBasis"];
  steps: CityTaxVersion["steps"];
  beyond_every: string | null;
  beyond_amount: string | null;
  flat: CityTaxVersion["flat"];
}

const num = (v: string | null) => (v === null ? null : Number(v));
const toVersion = (r: VersionRow): CityTaxVersion & { id: string } => ({
  id: r.id,
  validFrom: r.valid_from,
  bookedFrom: r.booked_from,
  kind: r.kind,
  percent: num(r.percent),
  nightCap: r.night_cap,
  stepBasis: r.step_basis,
  steps: r.steps,
  beyondEvery: num(r.beyond_every),
  beyondAmount: num(r.beyond_amount),
  flat: r.flat,
});

async function ruleIn(tx: PoolClient, propertyId: string): Promise<CityTaxRuleView | null> {
  const r = (await tx.query<{ id: string; name: string; preset: CityTaxPreset | null; tax_code_id: string; revenue_account: string }>(
    "select id, name, preset, tax_code_id, revenue_account from city_tax_rules where property_id = $1",
    [propertyId],
  )).rows[0];
  if (!r) return null;
  const versions = (await tx.query<VersionRow>(
    `select id, to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(booked_from, 'YYYY-MM-DD') as booked_from, kind, percent, night_cap, step_basis, steps, beyond_every, beyond_amount, flat
     from city_tax_rule_versions where rule_id = $1 order by valid_from, booked_from nulls first`,
    [r.id],
  )).rows.map(toVersion);
  const base = (await tx.query<{ service_id: string }>("select service_id from city_tax_base_services where rule_id = $1", [r.id])).rows.map((x) => x.service_id);
  const reasons = (await tx.query<{ reason: CityTaxExemptionReason; evidence: CityTaxReasonSetting["evidence"]; param: number | null }>(
    "select reason, evidence, param from city_tax_exemption_reasons where rule_id = $1 order by reason",
    [r.id],
  )).rows;
  return { id: r.id, propertyId, name: r.name, preset: r.preset, taxCodeId: r.tax_code_id, revenueAccount: r.revenue_account, versions, baseServiceIds: base, reasons };
}

async function passOnOf(tx: PoolClient, propertyId: string): Promise<CityTaxPassOn> {
  return (await tx.query<{ city_tax_pass_on: CityTaxPassOn }>("select city_tax_pass_on from properties where id = $1", [propertyId])).rows[0]!.city_tax_pass_on;
}

export async function getCityTaxRule(pool: Pool, schema: string, propertyId: string): Promise<{ passOn: CityTaxPassOn; rule: CityTaxRuleView | null }> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => ({ passOn: await passOnOf(tx, propertyId), rule: await ruleIn(tx, propertyId) }));
}

// ── the tax of a stay ──

/** A stay line as the posting builds it: the night, its component ("room", "svc:", "fix:") and gross amount. */
export interface StayLine {
  serviceDate: string;
  component: string;
  serviceId: string | null;
  amount: number;
}

export interface StayCityTax {
  rule: Pick<CityTaxRuleView, "id" | "name" | "taxCodeId" | "revenueAccount">;
  passOn: CityTaxPassOn;
  nights: CityTaxNight[];
}

/**
 * The City Tax of each night of a reservation from its stay lines: the base
 * is the room part net of VAT, plus the Services the rule marks; persons are
 * the adults and children with the exemptions set on the reservation.
 */
export async function cityTaxOfStay(tx: PoolClient, reservationId: string, propertyId: string, lines: StayLine[]): Promise<StayCityTax | null> {
  const rule = await ruleIn(tx, propertyId);
  if (!rule) return null;
  const r = (await tx.query<{ adults: number; child_ages: number[]; booked_on: string; pass_on: CityTaxPassOn }>(
    `select r.adults, r.child_ages, to_char((b.created_at at time zone p.time_zone)::date, 'YYYY-MM-DD') as booked_on,
       coalesce(r.city_tax_pass_on, p.city_tax_pass_on) as pass_on
     from reservations r join bookings b on b.id = r.booking_id join properties p on p.id = r.property_id where r.id = $1`,
    [reservationId],
  )).rows[0]!;
  const exemptions = new Map(
    (await tx.query<{ person: number; reason: CityTaxExemptionReason }>("select person, reason from reservation_city_tax_exemptions where reservation_id = $1", [reservationId])).rows.map((e) => [e.person, e.reason]),
  );
  const persons = [...Array.from({ length: r.adults }, () => null), ...r.child_ages].map((age, i) => ({ age, exemption: exemptions.get(i) ?? null }));
  const inBase = (l: StayLine) => l.component === "room" || ((l.component.startsWith("svc:") || l.component.startsWith("fix:")) && l.serviceId !== null && rule.baseServiceIds.includes(l.serviceId));
  const counted = lines.filter(inBase);
  const taxCodes = new Map(
    (await tx.query<{ id: string; tax_code_id: string }>("select id, tax_code_id from services where id = any($1::uuid[])", [[...new Set(counted.map((l) => l.serviceId).filter((x): x is string => !!x))]])).rows.map((s) => [s.id, s.tax_code_id]),
  );
  const base = new Map<string, number>();
  for (const l of counted) {
    const rate = await rateOn(tx, taxCodes.get(l.serviceId!)!, l.serviceDate);
    base.set(l.serviceDate, roundMoney((base.get(l.serviceDate) ?? 0) + splitGross(l.amount, rate).net));
  }
  const dates = [...new Set(lines.filter((l) => l.component === "room").map((l) => l.serviceDate))].sort();
  const nights = cityTax(rule, { bookedOn: r.booked_on, nights: dates.map((date) => ({ date, base: base.get(date) ?? 0 })), persons });
  // the stay's own setting once checked in, else the property's
  return { rule, passOn: r.pass_on, nights };
}

/**
 * Keep the record of a checked-in stay's City Tax in step (inside the
 * posting's transaction): nights from `today` on whose City Tax Charge is not
 * invoiced are written anew, nights no longer in the stay removed. Nights
 * already slept or invoiced stay as they were.
 */
export async function recordCityTaxNights(tx: PoolClient, reservationId: string, propertyId: string, today: string, tax: StayCityTax | null): Promise<void> {
  const ctax = (await tx.query<{ date: string; invoiced: boolean; live: boolean; by_hand: boolean }>(
    `select to_char(service_date, 'YYYY-MM-DD') as date, invoice_id is not null as invoiced, voided_at is null as live, (voided_at is not null and auto_void is null) as by_hand
     from charges where reservation_id = $1 and component like 'ctax:%'`,
    [reservationId],
  )).rows;
  const invoiced = new Set(ctax.filter((c) => c.live && c.invoiced).map((c) => c.date));
  // a City Tax Charge voided by hand is waived: the hotel bears it, so the night is filed as absorbed
  const waived = new Set(ctax.filter((c) => c.by_hand && !ctax.some((x) => x.live && x.date === c.date)).map((c) => c.date));
  const keep = (tax?.nights ?? []).filter((n) => n.date >= today && !invoiced.has(n.date));
  await tx.query("delete from city_tax_nights where reservation_id = $1 and date >= $2 and not (date = any($3::date[]))", [reservationId, today, [...invoiced]]);
  for (const n of keep) {
    await tx.query(
      `insert into city_tax_nights (reservation_id, date, property_id, rule_id, version_id, persons, taxable, base, tax, exempt, absorbed)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [reservationId, n.date, propertyId, tax!.rule.id, n.versionId, n.persons, n.taxable, n.base, n.tax, JSON.stringify(n.exempt), tax!.passOn === "absorbed" || waived.has(n.date)],
    );
  }
}

/** A stay given up (check-in cancelled): its record goes with its Charges. */
export async function dropCityTaxNights(tx: PoolClient, reservationId: string): Promise<void> {
  await tx.query("delete from city_tax_nights where reservation_id = $1", [reservationId]);
}

// ── rule changes ──

/** Recalculate a checked-in stay: its City Tax Charges and record follow the rule. Never confirms giving up nights: that is not a City Tax change. */
const resyncStay = (tx: PoolClient, reservationId: string, userId: string) => syncStayCharges(tx, reservationId, userId, false);

/** After any change to the rule: every checked-in stay of the property is recalculated; those whose tax changed are listed. */
async function recalculate(tx: PoolClient, propertyId: string, userId: string): Promise<CityTaxChange> {
  const stays = (await tx.query<{ id: string; confirmation_number: string; guest: string; total: string }>(
    `select r.id, b.confirmation_number, trim(g.first_name || ' ' || g.last_name) as guest,
       (select coalesce(sum(n.tax), 0) from city_tax_nights n where n.reservation_id = r.id) as total
     from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id
     where r.property_id = $1 and r.status = 'checked_in' order by b.confirmation_number`,
    [propertyId],
  )).rows;
  const changed: CityTaxChange["changed"] = [];
  const skipped: CityTaxChange["skipped"] = [];
  for (const st of stays) {
    // each stay on its own: one that cannot be recalculated keeps its tax and does not block the rule
    await tx.query("savepoint city_tax_stay");
    try {
      await resyncStay(tx, st.id, userId);
      await tx.query("release savepoint city_tax_stay");
    } catch (err) {
      await tx.query("rollback to savepoint city_tax_stay");
      skipped.push({ reservationId: st.id, confirmationNumber: st.confirmation_number, guestName: st.guest, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const after = Number((await tx.query<{ total: string }>("select coalesce(sum(tax), 0) as total from city_tax_nights where reservation_id = $1", [st.id])).rows[0]!.total);
    if (after !== Number(st.total)) changed.push({ reservationId: st.id, confirmationNumber: st.confirmation_number, guestName: st.guest, before: Number(st.total), after });
  }
  return { changed, skipped };
}

async function changeRule(pool: Pool, schema: string, propertyId: string, userId: string, fn: (tx: PoolClient, rule: CityTaxRuleView | null) => Promise<void>): Promise<CityTaxChange> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    await fn(tx, await ruleIn(tx, propertyId));
    return recalculate(tx, propertyId, userId);
  });
}

async function checkTaxCode(tx: PoolClient, propertyId: string, taxCodeId: string): Promise<void> {
  if (!isUuid(taxCodeId)) throw new Error("Choose the Tax Code of the City Tax Charge");
  const ok = (await tx.query("select 1 from tax_codes t join properties p on p.legal_entity_id = t.legal_entity_id where t.id = $1 and p.id = $2", [taxCodeId, propertyId])).rows.length;
  if (!ok) throw new Error("The Tax Code is not one of this property's Legal Entity");
}

function checkVersion(v: Omit<CityTaxVersion, "id">): void {
  checkDate(v.validFrom);
  if (v.bookedFrom) checkDate(v.bookedFrom);
  const money = (n: number) => Number.isFinite(n) && n >= 0 && roundMoney(n) === n;
  if (v.kind === "percentage") {
    if (v.percent === null || !(v.percent >= 0 && v.percent <= 100)) throw new Error("The percentage must be between 0 and 100");
    if (v.nightCap !== null && !(Number.isInteger(v.nightCap) && v.nightCap > 0)) throw new Error("The night cap must be a whole number of nights");
  } else if (v.kind === "step_table") {
    if (v.steps.length === 0) throw new Error("A step table needs at least one band");
    if (v.steps.some((x) => !money(x.amount) || (x.upTo !== null && !money(x.upTo)))) throw new Error("Bands need amounts in cents");
    if ((v.beyondEvery === null) !== (v.beyondAmount === null)) throw new Error("Give both the step beyond the last band and its amount, or neither");
  } else if (v.kind === "flat") {
    if (v.flat.length === 0) throw new Error("A flat rule needs at least one amount");
    const md = /^\d{2}-\d{2}$/;
    if (v.flat.some((f) => !money(f.amount) || (f.from !== null && !md.test(f.from)) || (f.to !== null && !md.test(f.to)) || (f.from === null) !== (f.to === null))) {
      throw new Error("Flat amounts need cents and a season as MM-DD to MM-DD, or none");
    }
  } else throw new Error("Unknown kind of City Tax Rule");
}

async function insertVersion(tx: PoolClient, ruleId: string, v: Omit<CityTaxVersion, "id">, userId: string): Promise<void> {
  checkVersion(v);
  await tx.query(
    `insert into city_tax_rule_versions (rule_id, valid_from, booked_from, kind, percent, night_cap, step_basis, steps, beyond_every, beyond_amount, flat, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (rule_id, valid_from, booked_from) do update set kind = excluded.kind, percent = excluded.percent, night_cap = excluded.night_cap, step_basis = excluded.step_basis,
       steps = excluded.steps, beyond_every = excluded.beyond_every, beyond_amount = excluded.beyond_amount, flat = excluded.flat`,
    [ruleId, v.validFrom, v.bookedFrom, v.kind, v.kind === "percentage" ? v.percent : null, v.kind === "percentage" ? v.nightCap : null, v.stepBasis, JSON.stringify(v.kind === "step_table" ? v.steps : []),
      v.kind === "step_table" ? v.beyondEvery : null, v.kind === "step_table" ? v.beyondAmount : null, JSON.stringify(v.kind === "flat" ? v.flat : []), userId],
  );
}

async function setReasons(tx: PoolClient, ruleId: string, reasons: CityTaxReasonSetting[]): Promise<void> {
  if (new Set(reasons.map((r) => r.reason)).size !== reasons.length) throw new Error("Each exemption reason once");
  for (const r of reasons) {
    if ((r.reason === "age" || r.reason === "long_stay") && !(r.param && Number.isInteger(r.param) && r.param > 0)) {
      throw new Error(r.reason === "age" ? "Give the age under which guests are exempt" : "Give the number of nights after which a stay is exempt");
    }
  }
  await tx.query("delete from city_tax_exemption_reasons where rule_id = $1", [ruleId]);
  for (const r of reasons) {
    await tx.query("insert into city_tax_exemption_reasons (rule_id, reason, evidence, param) values ($1, $2, $3, $4)", [
      ruleId,
      r.reason,
      r.reason === "age" || r.reason === "long_stay" ? "none" : r.evidence,
      r.reason === "age" || r.reason === "long_stay" ? r.param : null,
    ]);
  }
}

/** Set up the property's rule, empty or copied from a preset (to be verified with the municipality). */
export async function createCityTaxRule(
  pool: Pool,
  schema: string,
  propertyId: string,
  input: { preset?: CityTaxPreset | null; name?: string; taxCodeId: string; revenueAccount?: string },
  userId: string,
): Promise<CityTaxChange> {
  return changeRule(pool, schema, propertyId, userId, async (tx, existing) => {
    if (existing) throw new Error("The property already has a City Tax Rule");
    await checkTaxCode(tx, propertyId, input.taxCodeId);
    const preset = input.preset ? CITY_TAX_PRESETS[input.preset] : null;
    if (input.preset && !preset) throw new Error("Unknown preset");
    const name = (input.name?.trim() || preset?.name || "").slice(0, 120);
    if (!name) throw new Error("Give the rule a name");
    const { rows } = await tx.query<{ id: string }>(
      "insert into city_tax_rules (property_id, name, preset, tax_code_id, revenue_account, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
      [propertyId, name, input.preset ?? null, input.taxCodeId, input.revenueAccount?.trim() ?? "", userId],
    );
    for (const v of preset?.versions ?? []) await insertVersion(tx, rows[0]!.id, v, userId);
    await setReasons(tx, rows[0]!.id, preset?.reasons ?? []);
  });
}

/** Change the rule's name, Tax Code, revenue account, the Services counted into the base and the exemption reasons. */
export async function updateCityTaxRule(
  pool: Pool,
  schema: string,
  propertyId: string,
  input: { name?: string; taxCodeId?: string; revenueAccount?: string; baseServiceIds?: string[]; reasons?: CityTaxReasonSetting[] },
  userId: string,
): Promise<CityTaxChange> {
  return changeRule(pool, schema, propertyId, userId, async (tx, rule) => {
    if (!rule) throw new Error("The property has no City Tax Rule");
    if (input.taxCodeId !== undefined) await checkTaxCode(tx, propertyId, input.taxCodeId);
    const name = input.name === undefined ? rule.name : input.name.trim().slice(0, 120);
    if (!name) throw new Error("Give the rule a name");
    await tx.query("update city_tax_rules set name = $2, tax_code_id = $3, revenue_account = $4 where id = $1", [rule.id, name, input.taxCodeId ?? rule.taxCodeId, input.revenueAccount?.trim() ?? rule.revenueAccount]);
    if (input.baseServiceIds) {
      const ids = [...new Set(input.baseServiceIds)];
      const found = (await tx.query("select 1 from services where property_id = $1 and id = any($2::uuid[])", [propertyId, ids.filter(isUuid)])).rows.length;
      if (found !== ids.length) throw new Error("A Service is not found at this property");
      await tx.query("delete from city_tax_base_services where rule_id = $1", [rule.id]);
      for (const id of ids) await tx.query("insert into city_tax_base_services (rule_id, service_id) values ($1, $2)", [rule.id, id]);
    }
    if (input.reasons) await setReasons(tx, rule.id, input.reasons);
  });
}

/** Add a version (or replace the one with the same dates); uninvoiced nights of stays in house are recalculated. */
export async function addCityTaxVersion(pool: Pool, schema: string, propertyId: string, version: Omit<CityTaxVersion, "id"> & { id?: string }, userId: string): Promise<CityTaxChange> {
  return changeRule(pool, schema, propertyId, userId, async (tx, rule) => {
    if (!rule) throw new Error("The property has no City Tax Rule");
    const { id: _id, ...v } = version;
    await insertVersion(tx, rule.id, v, userId);
  });
}

/** Remove a version no night has been taxed by yet. */
export async function removeCityTaxVersion(pool: Pool, schema: string, propertyId: string, versionId: string, userId: string): Promise<CityTaxChange> {
  return changeRule(pool, schema, propertyId, userId, async (tx, rule) => {
    if (!rule || !isUuid(versionId) || !rule.versions.some((v) => v.id === versionId)) throw new Error("Version not found");
    // nights in house are recalculated afterwards; nights already slept or invoiced keep the version they were taxed by
    const used = (await tx.query("select 1 from city_tax_nights n where n.version_id = $1 and (n.date < (select business_date from properties where id = $2) or exists (select 1 from charges c where c.reservation_id = n.reservation_id and c.service_date = n.date and c.component like 'ctax:%' and c.invoice_id is not null)) limit 1", [versionId, propertyId])).rows.length;
    if (used) throw new Error("Nights have been taxed by this version; add a new version instead");
    await tx.query("update city_tax_nights set version_id = null where version_id = $1", [versionId]);
    await tx.query("delete from city_tax_rule_versions where id = $1", [versionId]);
  });
}

/** Charged on top as a City Tax Charge, or absorbed by the hotel: for guests checked in from now on (a stay in house keeps what it had). */
export async function setCityTaxPassOn(pool: Pool, schema: string, propertyId: string, passOn: CityTaxPassOn): Promise<void> {
  if (passOn !== "on_top" && passOn !== "absorbed") throw new Error("Charged on top or absorbed");
  if (!isUuid(propertyId)) throw new Error("Property not found");
  await withTenant(pool, schema, (tx) => tx.query("update properties set city_tax_pass_on = $2 where id = $1", [propertyId, passOn]));
}

/** At check-in, before the stay is posted: the stay keeps the property's pass-on from now on. */
export async function fixCityTaxPassOn(tx: PoolClient, reservationId: string, checkedIn: boolean): Promise<void> {
  await tx.query(
    checkedIn
      ? "update reservations r set city_tax_pass_on = p.city_tax_pass_on from properties p where p.id = r.property_id and r.id = $1"
      : "update reservations set city_tax_pass_on = null where id = $1",
    [reservationId],
  );
}

// ── exemptions ──

export interface CityTaxExemption {
  id: string;
  person: number;
  reason: CityTaxExemptionReason;
  note: string;
  documentName: string | null;
}

export async function listCityTaxExemptions(pool: Pool, schema: string, reservationId: string): Promise<CityTaxExemption[]> {
  if (!isUuid(reservationId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; person: number; reason: CityTaxExemptionReason; note: string; document_name: string | null }>(
      "select id, person, reason, note, document_name from reservation_city_tax_exemptions where reservation_id = $1 order by person",
      [reservationId],
    )).rows.map((r) => ({ id: r.id, person: r.person, reason: r.reason, note: r.note, documentName: r.document_name })),
  );
}

/** Evidence documents: PDF or image, up to 5 MB. */
export const EVIDENCE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Exempt one person of the reservation (adults first, then children) for a
 * reason the rule enables, with the evidence it asks for. A stay in house is
 * recalculated at once.
 */
export async function setCityTaxExemption(
  pool: Pool,
  schema: string,
  reservationId: string,
  input: { person: number; reason: CityTaxExemptionReason; note: string; document?: { name: string; type: string; bytes: Uint8Array } | null },
  userId: string,
): Promise<{ id: string }> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  return withTenant(pool, schema, async (tx) => {
    const pre = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0];
    if (!pre) throw new Error("Reservation not found");
    await lockProperty(tx, pre.property_id);
    const r = (await tx.query<{ status: string; adults: number; child_ages: number[] }>("select status, adults, child_ages from reservations where id = $1 for update", [reservationId])).rows[0]!;
    if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error(`The reservation is ${r.status.replace("_", " ")}`);
    if (!Number.isInteger(input.person) || input.person < 0 || input.person >= r.adults + r.child_ages.length) throw new Error("Choose a guest of the reservation");
    const rule = await ruleIn(tx, pre.property_id);
    const setting = rule?.reasons.find((x) => x.reason === input.reason);
    if (!MANUAL_EXEMPTION_REASONS.includes(input.reason) || !setting) throw new Error("This exemption reason is not enabled for the property");
    const note = input.note.trim().slice(0, 500);
    const doc = input.document && input.document.bytes.length ? input.document : null;
    if (setting.evidence === "note" && !note) throw new Error("This exemption needs a note as evidence");
    if (setting.evidence === "document" && !doc) throw new Error("This exemption needs a document as evidence");
    if (doc && !(EVIDENCE_TYPES as readonly string[]).includes(doc.type)) throw new Error("Evidence must be a PDF, JPEG or PNG");
    if (doc && doc.bytes.length > EVIDENCE_MAX_BYTES) throw new Error("Evidence may be at most 5 MB");
    const { rows } = await tx.query<{ id: string }>(
      `insert into reservation_city_tax_exemptions (reservation_id, person, reason, note, document, document_name, document_type, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (reservation_id, person) do update set reason = excluded.reason, note = excluded.note, document = excluded.document,
         document_name = excluded.document_name, document_type = excluded.document_type, created_at = now(), created_by = excluded.created_by
       returning id`,
      [reservationId, input.person, input.reason, note, doc ? Buffer.from(doc.bytes) : null, doc ? doc.name.slice(0, 200) : null, doc?.type ?? null, userId],
    );
    if (r.status === "checked_in") await resyncStay(tx, reservationId, userId);
    return { id: rows[0]!.id };
  });
}

export async function removeCityTaxExemption(pool: Pool, schema: string, reservationId: string, exemptionId: string, userId: string): Promise<void> {
  if (!isUuid(reservationId) || !isUuid(exemptionId)) throw new Error("Exemption not found");
  await withTenant(pool, schema, async (tx) => {
    const pre = (await tx.query<{ property_id: string; status: string }>("select property_id, status from reservations where id = $1", [reservationId])).rows[0];
    if (!pre) throw new Error("Reservation not found");
    await lockProperty(tx, pre.property_id);
    const { rowCount } = await tx.query("delete from reservation_city_tax_exemptions where id = $1 and reservation_id = $2", [exemptionId, reservationId]);
    if (!rowCount) throw new Error("Exemption not found");
    if (pre.status === "checked_in") await resyncStay(tx, reservationId, userId);
  });
}

/** An exemption's evidence document. */
export async function cityTaxEvidence(pool: Pool, schema: string, exemptionId: string): Promise<{ propertyId: string; name: string; type: string; bytes: Buffer }> {
  if (!isUuid(exemptionId)) throw new Error("Evidence not found");
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string; document: Buffer | null; document_name: string | null; document_type: string | null }>(
      "select r.property_id, e.document, e.document_name, e.document_type from reservation_city_tax_exemptions e join reservations r on r.id = e.reservation_id where e.id = $1",
      [exemptionId],
    )).rows[0];
    if (!r?.document) throw new Error("Evidence not found");
    return { propertyId: r.property_id, name: r.document_name ?? "evidence", type: r.document_type ?? "application/octet-stream", bytes: r.document };
  });
}

// ── filing report ──

export interface CityTaxReport {
  property: { name: string; currency: string };
  rule: { name: string; preset: CityTaxPreset | null } | null;
  from: string;
  to: string;
  totals: { nights: number; personNights: number; taxedPersonNights: number; base: number; tax: number; charged: number; absorbed: number };
  /** Person-nights not taxed, by reason. */
  exempt: Partial<Record<CityTaxExemptKey, number>>;
  /** Exemptions set on reservations that exempted nights in the period, with the number of those nights. */
  exemptions: { reservationId: string; confirmationNumber: string; guestName: string; person: number; reason: CityTaxExemptionReason; note: string; documentName: string | null; exemptionId: string; nights: number }[];
  /** Every stay with nights in the period: the guest list with length of stay. */
  stays: { reservationId: string; confirmationNumber: string; guestName: string; arrival: string; departure: string; nights: number; persons: number; base: number; tax: number; absorbed: boolean }[];
}

/** The filing report of the property's City Tax for a period (nights by their date). */
export async function cityTaxReport(pool: Pool, schema: string, propertyId: string, period: { from: string; to: string }): Promise<CityTaxReport> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  checkDate(period.from);
  checkDate(period.to);
  if (period.to < period.from) throw new Error("The period ends before it starts");
  return withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ name: string; currency: string }>("select name, currency from properties where id = $1", [propertyId])).rows[0];
    if (!p) throw new Error("Property not found");
    const rule = await ruleIn(tx, propertyId);
    const nights = (await tx.query<{ reservation_id: string; date: string; persons: number; taxable: number; base: string; tax: string; exempt: Partial<Record<CityTaxExemptKey, number>>; absorbed: boolean }>(
      "select reservation_id, to_char(date, 'YYYY-MM-DD') as date, persons, taxable, base, tax, exempt, absorbed from city_tax_nights where property_id = $1 and date between $2 and $3",
      [propertyId, period.from, period.to],
    )).rows;
    const exempt: CityTaxReport["exempt"] = {};
    const totals = { nights: nights.length, personNights: 0, taxedPersonNights: 0, base: 0, tax: 0, charged: 0, absorbed: 0 };
    const perStay = new Map<string, { nights: number; persons: number; base: number; tax: number; absorbed: boolean }>();
    for (const n of nights) {
      totals.personNights += n.persons;
      totals.taxedPersonNights += n.taxable;
      totals.base = roundMoney(totals.base + Number(n.base));
      totals.tax = roundMoney(totals.tax + Number(n.tax));
      if (n.absorbed) totals.absorbed = roundMoney(totals.absorbed + Number(n.tax));
      else totals.charged = roundMoney(totals.charged + Number(n.tax));
      for (const [k, v] of Object.entries(n.exempt) as [CityTaxExemptKey, number][]) exempt[k] = (exempt[k] ?? 0) + v;
      const st = perStay.get(n.reservation_id) ?? { nights: 0, persons: n.persons, base: 0, tax: 0, absorbed: n.absorbed };
      perStay.set(n.reservation_id, { nights: st.nights + 1, persons: Math.max(st.persons, n.persons), base: roundMoney(st.base + Number(n.base)), tax: roundMoney(st.tax + Number(n.tax)), absorbed: st.absorbed && n.absorbed });
    }
    const ids = [...perStay.keys()];
    const info = new Map(
      (await tx.query<{ id: string; confirmation_number: string; guest: string; arrival: string; departure: string }>(
        `select r.id, b.confirmation_number, trim(g.first_name || ' ' || g.last_name) as guest, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure
         from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id where r.id = any($1::uuid[])`,
        [ids],
      )).rows.map((r) => [r.id, r]),
    );
    const stays = ids
      .map((id) => ({ reservationId: id, confirmationNumber: info.get(id)!.confirmation_number, guestName: info.get(id)!.guest, arrival: info.get(id)!.arrival, departure: info.get(id)!.departure, ...perStay.get(id)! }))
      .sort((a, b) => (a.arrival < b.arrival ? -1 : a.arrival > b.arrival ? 1 : a.confirmationNumber.localeCompare(b.confirmationNumber)));
    const exemptions = (await tx.query<{ id: string; reservation_id: string; person: number; reason: CityTaxExemptionReason; note: string; document_name: string | null }>(
      "select id, reservation_id, person, reason, note, document_name from reservation_city_tax_exemptions where reservation_id = any($1::uuid[]) order by reservation_id, person",
      [ids],
    ))
      .rows.map((e) => ({
        reservationId: e.reservation_id,
        confirmationNumber: info.get(e.reservation_id)!.confirmation_number,
        guestName: info.get(e.reservation_id)!.guest,
        person: e.person,
        reason: e.reason,
        note: e.note,
        documentName: e.document_name,
        exemptionId: e.id,
        // the nights its reason actually exempted someone (a reason disabled since, or a night under the cap, does not count)
        nights: nights.filter((n) => n.reservation_id === e.reservation_id && (n.exempt[e.reason] ?? 0) > 0).length,
      }))
      .filter((e) => e.nights > 0);
    return { property: { name: p.name, currency: p.currency.trim() }, rule: rule ? { name: rule.name, preset: rule.preset } : null, from: period.from, to: period.to, totals, exempt, exemptions, stays };
  });
}
