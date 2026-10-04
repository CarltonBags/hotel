import type { Pool, PoolClient } from "pg";
import {
  PERSON_ROLES,
  familyHead,
  isRegistrationCountry,
  registrationComplete,
  registrationDeletionDue,
  registrationNeeds,
  type PersonRole,
  type RegistrationCountry,
  type RegistrationNeed,
  type TabletStep,
} from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { renderMeldescheinPdf } from "@hoteloftware/invoices";
import { updateGuestIn } from "./guests";
import { withTenant } from "./with-tenant";

/**
 * Meldeschein registration (ticket 45): the desk opens a reservation's
 * registration, sends it to a guest tablet, follows the guest's steps live,
 * records the ID Check and, in Germany, the signature on paper. A guest
 * tablet is an enrolled guest Device of the property and shows only what the
 * desk sent; one reservation at a time.
 */

export interface RegistrationPersonView {
  id: string;
  guestId: string | null;
  role: PersonRole;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
  documentNumber: string;
  gender: string;
  language: string;
  step: TabletStep | "waiting";
  need: RegistrationNeed;
  /** For a counted person: the person whose form lists them. */
  countedOn: string | null;
  guestDone: boolean;
  confirmation: "tablet_signature" | "paper" | null;
  idChecked: boolean;
  idCheckNote: string;
  completed: boolean;
}

export interface RegistrationView {
  id: string;
  reservationId: string;
  propertyId: string;
  country: RegistrationCountry;
  deviceId: string | null;
  queue: string[];
  arrival: string;
  departure: string;
  persons: RegistrationPersonView[];
}

type PersonRow = {
  id: string;
  guest_id: string | null;
  role: PersonRole;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  nationality: string;
  address_line1: string;
  postal_code: string;
  city: string;
  country: string;
  document_number: string;
  gender: string;
  language: string;
  step: TabletStep | "waiting";
  guest_done_at: Date | null;
  confirmation: "tablet_signature" | "paper" | null;
  id_checked_at: Date | null;
  id_check_note: string;
  completed_at: Date | null;
};
const PERSON_COLUMNS = `id, guest_id, role, first_name, last_name, to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth, nationality, address_line1, postal_code, city, country, document_number,
  gender, language, step, guest_done_at, confirmation, id_checked_at, id_check_note, completed_at`;

async function viewIn(tx: PoolClient, where: string, arg: string): Promise<RegistrationView | null> {
  const r = (await tx.query<{ id: string; reservation_id: string; property_id: string; country: RegistrationCountry; device_id: string | null; queue: string[]; arrival: string; departure: string }>(
    `select g.id, g.reservation_id, g.property_id, g.country, g.device_id, g.queue, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure
     from registrations g join reservations r on r.id = g.reservation_id where ${where}`,
    [arg],
  )).rows[0];
  if (!r) return null;
  const rows = (await tx.query<PersonRow>(`select ${PERSON_COLUMNS} from registration_persons where registration_id = $1 order by created_at, id`, [r.id])).rows;
  const people = rows.map((p) => ({ id: p.id, role: p.role, nationality: p.nationality, dateOfBirth: p.date_of_birth }));
  const needs = registrationNeeds(r.country, people, r.arrival);
  const head = familyHead(r.country, people);
  return {
    id: r.id,
    reservationId: r.reservation_id,
    propertyId: r.property_id,
    country: r.country,
    deviceId: r.device_id,
    queue: r.queue,
    arrival: r.arrival,
    departure: r.departure,
    persons: rows.map((p) => ({
      id: p.id,
      guestId: p.guest_id,
      role: p.role,
      firstName: p.first_name,
      lastName: p.last_name,
      dateOfBirth: p.date_of_birth,
      nationality: p.nationality,
      addressLine1: p.address_line1,
      postalCode: p.postal_code,
      city: p.city,
      country: p.country,
      documentNumber: p.document_number,
      gender: p.gender,
      language: p.language,
      step: p.step,
      need: needs[p.id]!,
      countedOn: needs[p.id] === "counted" ? (head?.id ?? null) : null,
      guestDone: p.guest_done_at !== null,
      confirmation: p.confirmation,
      idChecked: p.id_checked_at !== null,
      idCheckNote: p.id_check_note,
      completed: p.completed_at !== null,
    })),
  };
}

/** The reservation's registration, opened with the primary guest's profile on first use. */
export async function openRegistration(pool: Pool, schema: string, reservationId: string, userId: string): Promise<RegistrationView> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  return withTenant(pool, schema, async (tx) => {
    const found = await viewIn(tx, "g.reservation_id = $1", reservationId);
    if (found) return found;
    const r = (await tx.query<{ property_id: string; country: string; guest_id: string; status: string }>(
      "select r.property_id, p.country, r.primary_guest_id as guest_id, r.status from reservations r join properties p on p.id = r.property_id where r.id = $1",
      [reservationId],
    )).rows[0];
    if (!r) throw new Error("Reservation not found");
    if (!isRegistrationCountry(r.country)) throw new Error(`Registration for ${r.country} comes with its Canton Profile`);
    if (r.status === "cancelled" || r.status === "no_show") throw new Error("This stay is not arriving");
    const { rows } = await tx.query<{ id: string }>("insert into registrations (reservation_id, property_id, country, created_by) values ($1, $2, $3, $4) returning id", [reservationId, r.property_id, r.country, userId]);
    await tx.query(
      `insert into registration_persons (registration_id, guest_id, role, first_name, last_name, date_of_birth, nationality, address_line1, postal_code, city, country, document_number, language)
       select $1, g.id, 'primary', g.first_name, g.last_name, g.date_of_birth, coalesce(g.nationality, ''), coalesce(g.address_line1, ''), coalesce(g.postal_code, ''), coalesce(g.city, ''),
         coalesce(g.country_of_residence, ''), coalesce(g.document_number, ''), case when g.language in ('de', 'en') then g.language else 'de' end
       from guests g where g.id = $2`,
      [rows[0]!.id, r.guest_id],
    );
    return (await viewIn(tx, "g.id = $1", rows[0]!.id))!;
  });
}

export async function findRegistration(pool: Pool, schema: string, reservationId: string): Promise<RegistrationView | null> {
  if (!isUuid(reservationId)) return null;
  return withTenant(pool, schema, (tx) => viewIn(tx, "g.reservation_id = $1", reservationId));
}

export interface PersonInput {
  role: PersonRole;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string;
}

/** Germany counts spouse, partner and children by number and nationality: their names are not asked. */
function checkPerson(p: PersonInput, country: RegistrationCountry): void {
  if (!PERSON_ROLES.includes(p.role) || p.role === "primary") throw new Error("Spouse, partner, child or other guest");
  const countedOnly = country === "DE" && p.role !== "other";
  if (!countedOnly && (!p.firstName.trim() || !p.lastName.trim())) throw new Error("Give the person's name");
  if (!/^[A-Z]{2}$/.test(p.nationality.toUpperCase())) throw new Error("Give the nationality");
  if (p.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth)) throw new Error("Date of birth as a date");
}

async function insertPerson(tx: PoolClient, registrationId: string, p: PersonInput): Promise<void> {
  const country = (await tx.query<{ country: RegistrationCountry }>("select country from registrations where id = $1", [registrationId])).rows[0]?.country;
  if (!country) throw new Error("Registration not found");
  checkPerson(p, country);
  await tx.query(
    "insert into registration_persons (registration_id, role, first_name, last_name, date_of_birth, nationality) values ($1, $2, $3, $4, $5, $6)",
    [registrationId, p.role, p.firstName.trim().slice(0, 120), p.lastName.trim().slice(0, 120), p.dateOfBirth, p.nationality.toUpperCase()],
  );
}

/** The desk adds a fellow guest. */
export async function addRegistrationPerson(pool: Pool, schema: string, registrationId: string, p: PersonInput): Promise<void> {
  if (!isUuid(registrationId)) throw new Error("Registration not found");
  await withTenant(pool, schema, (tx) => insertPerson(tx, registrationId, p));
}

/** Send the registration to a guest tablet: the persons given, or every one needing their own form whose part is not done. */
export async function sendToTablet(pool: Pool, schema: string, input: { registrationId: string; deviceId: string; personIds?: string[] }): Promise<void> {
  if (!isUuid(input.registrationId) || !isUuid(input.deviceId)) throw new Error("Choose a tablet");
  await withTenant(pool, schema, async (tx) => {
    const reg = await viewIn(tx, "g.id = $1", input.registrationId);
    if (!reg) throw new Error("Registration not found");
    const device = (await tx.query<{ ok: boolean }>(
      "select (d.kind = 'guest' and d.revoked_at is null and d.property_id = $2) as ok from control.devices d where d.id = $1",
      [input.deviceId, reg.propertyId],
    )).rows[0];
    if (!device?.ok) throw new Error("Choose an enrolled guest tablet of this property");
    const busy = (await tx.query("select 1 from registrations where device_id = $1 and id <> $2", [input.deviceId, reg.id])).rowCount;
    if (busy) throw new Error("This tablet is busy with another reservation; take it back there first");
    const queue = (input.personIds?.length ? reg.persons.filter((p) => input.personIds!.includes(p.id)) : reg.persons.filter((p) => p.need === "own_form")).filter((p) => !p.guestDone).map((p) => p.id);
    if (!queue.length) throw new Error("Nobody left to register on the tablet");
    // a re-send starts over: whoever was waiting from an earlier send waits again
    await tx.query("update registration_persons set step = 'waiting' where registration_id = $1 and guest_done_at is null", [reg.id]);
    try {
      await tx.query("savepoint send");
      await tx.query("update registrations set device_id = $2, queue = $3 where id = $1", [reg.id, input.deviceId, queue]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new Error("This tablet is busy with another reservation; take it back there first");
      throw err;
    }
    await tx.query("update registration_persons set step = 'welcome' where id = $1", [queue[0]]);
  });
}

/** Take the registration back from the tablet: what the guest entered stays; their step starts again next time. */
export async function takeBackFromTablet(pool: Pool, schema: string, registrationId: string): Promise<void> {
  if (!isUuid(registrationId)) throw new Error("Registration not found");
  await withTenant(pool, schema, async (tx) => {
    await tx.query("update registration_persons set step = 'waiting' where registration_id = $1 and guest_done_at is null", [registrationId]);
    await tx.query("update registrations set device_id = null, queue = '{}' where id = $1", [registrationId]);
  });
}

/** What the tablet may show of a person: the statutory fields, nothing the desk recorded. */
export interface TabletPerson {
  id: string;
  role: PersonRole;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
  documentNumber: string;
  gender: string;
  language: string;
  step: TabletStep | "waiting";
}

export interface TabletState {
  registrationId: string;
  country: RegistrationCountry;
  propertyName: string;
  arrival: string;
  departure: string;
  person: TabletPerson;
  /** Those counted on this person's form: role, name and nationality only. */
  companions: { role: PersonRole; firstName: string; lastName: string; nationality: string }[];
  /** How many more persons come after this one on the tablet. */
  next: number;
}

const tabletPerson = (p: RegistrationPersonView): TabletPerson => ({
  id: p.id,
  role: p.role,
  firstName: p.firstName,
  lastName: p.lastName,
  dateOfBirth: p.dateOfBirth,
  nationality: p.nationality,
  addressLine1: p.addressLine1,
  postalCode: p.postalCode,
  city: p.city,
  country: p.country,
  documentNumber: p.documentNumber,
  gender: p.gender,
  language: p.language,
  step: p.step,
});

/** What a guest tablet shows: the person whose turn it is, or nothing (idle). */
export async function tabletState(pool: Pool, schema: string, deviceId: string): Promise<TabletState | null> {
  if (!isUuid(deviceId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const reg = await viewIn(tx, "g.device_id = $1", deviceId);
    if (!reg || !reg.queue.length) return null;
    const person = reg.persons.find((p) => p.id === reg.queue[0]);
    if (!person) return null;
    const name = (await tx.query<{ name: string }>("select name from properties where id = $1", [reg.propertyId])).rows[0]!.name;
    return {
      registrationId: reg.id,
      country: reg.country,
      propertyName: name,
      arrival: reg.arrival,
      departure: reg.departure,
      person: tabletPerson(person),
      companions: reg.persons.filter((p) => p.countedOn === person.id).map((p) => ({ role: p.role, firstName: p.firstName, lastName: p.lastName, nationality: p.nationality })),
      next: reg.queue.length - 1,
    };
  });
}

/** The statutory fields the guest may edit; arrival and departure never. */
export interface GuestDetails {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
  documentNumber: string;
  gender: string;
}

export type TabletInput =
  | { step: "welcome"; language: "de" | "en" }
  /** While the guest types: saved for the desk to see live, nothing advances, nothing goes to the profile yet. */
  | { step: "draft"; details: Partial<GuestDetails> }
  | { step: "details"; details: GuestDetails }
  | { step: "companions"; add: PersonInput[] }
  /** A Back from the review: the details once more. */
  | { step: "back" }
  | { step: "review"; signaturePng: Uint8Array | null };

/** A problem the guest can fix, named by field; the tablet says it in the guest's language. */
export class TabletProblem extends Error {}

const NEXT: Record<"welcome" | "details" | "companions" | "review", TabletStep> = { welcome: "details", details: "companions", companions: "review", review: "done" };
const DRAFT_COLUMNS: Record<keyof GuestDetails, string> = { firstName: "first_name", lastName: "last_name", dateOfBirth: "date_of_birth", nationality: "nationality", addressLine1: "address_line1", postalCode: "postal_code", city: "city", country: "country", documentNumber: "document_number", gender: "gender" };
const GENDERS = ["", "f", "m", "x"];
/** At most this many persons on one registration (a family, a small group). */
const MAX_PERSONS = 12;
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_SIGNATURE_BYTES = 300_000;

function realDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s > "1900-01-01";
}

function checkDetails(d: GuestDetails): void {
  for (const k of Object.keys(DRAFT_COLUMNS) as (keyof GuestDetails)[]) if (typeof d[k] !== "string" || d[k].length > 120) throw new TabletProblem(k);
  if (!d.firstName.trim()) throw new TabletProblem("firstName");
  if (!d.lastName.trim()) throw new TabletProblem("lastName");
  if (!realDate(d.dateOfBirth)) throw new TabletProblem("dateOfBirth");
  if (!/^[A-Z]{2}$/.test(d.nationality.toUpperCase())) throw new TabletProblem("nationality");
  if (!GENDERS.includes(d.gender)) throw new TabletProblem("gender");
}

/**
 * The guest moves one step on the tablet. The registration is locked, and only
 * the person whose turn it is on this tablet, at this step, can be changed:
 * two taps or a take-back racing a step leave nothing half done. Details go
 * back to the guest profile in the same transaction, logged as entered on the
 * tablet. In Austria the review ends with the signature.
 */
export async function tabletStep(pool: Pool, schema: string, device: { id: string; name: string }, personId: string, input: TabletInput): Promise<void> {
  if (!isUuid(personId) || !isUuid(device.id)) throw new Error("Not on this tablet");
  await withTenant(pool, schema, async (tx) => {
    const locked = (await tx.query<{ id: string }>("select id from registrations where device_id = $1 for update", [device.id])).rows[0];
    const reg = locked ? await viewIn(tx, "g.id = $1", locked.id) : null;
    if (!reg || reg.queue[0] !== personId) throw new Error("Not on this tablet");
    const person = reg.persons.find((p) => p.id === personId)!;
    if (input.step === "draft") {
      if (person.step !== "details") return;
      const entries = Object.entries(input.details ?? {}).filter(([k, v]) => k in DRAFT_COLUMNS && typeof v === "string" && v.length <= 120 && (k !== "dateOfBirth" || realDate(v)) && (k !== "gender" || GENDERS.includes(v)));
      if (!entries.length) return;
      await tx.query(`update registration_persons set ${entries.map(([k], i) => `${DRAFT_COLUMNS[k as keyof GuestDetails]} = $${i + 2}`).join(", ")} where id = $1`, [personId, ...entries.map(([, v]) => (v as string).trim())]);
      return;
    }
    if (input.step === "back") {
      if (person.step !== "review") throw new Error("This step is done already");
      await tx.query("update registration_persons set step = 'details' where id = $1", [personId]);
      return;
    }
    if (person.step !== input.step) throw new Error("This step is done already");
    if (input.step === "welcome") {
      await tx.query("update registration_persons set language = $2 where id = $1", [personId, input.language === "en" ? "en" : "de"]);
    } else if (input.step === "details") {
      const d = input.details;
      checkDetails(d);
      const v = { firstName: d.firstName.trim(), lastName: d.lastName.trim(), dateOfBirth: d.dateOfBirth, nationality: d.nationality.toUpperCase(), addressLine1: d.addressLine1.trim(), postalCode: d.postalCode.trim(), city: d.city.trim(), country: d.country.trim().toUpperCase().slice(0, 2), documentNumber: d.documentNumber.trim(), gender: d.gender };
      await tx.query(
        `update registration_persons set first_name = $2, last_name = $3, date_of_birth = $4, nationality = $5, address_line1 = $6, postal_code = $7, city = $8, country = $9, document_number = $10, gender = $11 where id = $1`,
        [personId, v.firstName, v.lastName, v.dateOfBirth, v.nationality, v.addressLine1, v.postalCode, v.city, v.country, v.documentNumber, v.gender],
      );
      // back to the guest profile, logged as changed on the tablet, with the step or not at all
      if (person.guestId) {
        await updateGuestIn(tx, person.guestId, { firstName: v.firstName, lastName: v.lastName, dateOfBirth: v.dateOfBirth, nationality: v.nationality, addressLine1: v.addressLine1, postalCode: v.postalCode, city: v.city, countryOfResidence: v.country, documentNumber: v.documentNumber }, { userId: `tablet:${device.name}` });
      }
    } else if (input.step === "companions") {
      const add = Array.isArray(input.add) ? input.add : [];
      if (reg.persons.length + add.length > MAX_PERSONS) throw new TabletProblem("companions");
      for (const p of add) {
        if (!p || typeof p !== "object" || typeof p.nationality !== "string") throw new TabletProblem("companions");
        await insertPerson(tx, reg.id, { role: p.role, firstName: String(p.firstName ?? ""), lastName: String(p.lastName ?? ""), dateOfBirth: p.dateOfBirth && realDate(String(p.dateOfBirth)) ? String(p.dateOfBirth) : null, nationality: p.nationality });
      }
    } else if (input.step === "review") {
      if (reg.country === "AT") {
        const png = input.signaturePng;
        if (!png?.length || png.length > MAX_SIGNATURE_BYTES || !PNG.every((b, i) => png[i] === b)) throw new TabletProblem("signature");
        await tx.query("update registration_persons set confirmation = 'tablet_signature', signature = $2 where id = $1", [personId, Buffer.from(png)]);
      }
      await tx.query("update registration_persons set guest_done_at = now() where id = $1", [personId]);
      // the next person's turn; the tablet is free after the last
      const rest = reg.queue.slice(1);
      await tx.query("update registrations set queue = $2, device_id = case when cardinality($2::uuid[]) = 0 then null else device_id end where id = $1", [reg.id, rest]);
      if (rest[0]) await tx.query("update registration_persons set step = 'welcome' where id = $1", [rest[0]]);
    }
    await tx.query("update registration_persons set step = $2 where id = $1", [personId, NEXT[input.step]]);
  });
}

/** The desk records the ID Check: details compared with the passport, or a note why not (a discrepancy, no valid ID shown). */
export async function recordIdCheck(pool: Pool, schema: string, personId: string, note: string, userId: string, compared = true): Promise<void> {
  if (!isUuid(personId)) throw new Error("Person not found");
  if (!compared && !note.trim()) throw new Error("Confirm you compared the details with the passport, or note why not");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("update registration_persons set id_checked_by = $2, id_checked_at = now(), id_check_note = $3 where id = $1 and completed_at is null", [personId, userId, note.trim().slice(0, 300)])).rowCount);
  if (!n) throw new Error("This registration is completed already");
}

/** Germany: the guest signed the printed form at the desk; the paper stays with the hotel. */
export async function confirmSignedOnPaper(pool: Pool, schema: string, personId: string, userId: string): Promise<void> {
  if (!isUuid(personId)) throw new Error("Person not found");
  await withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ country: string; done: boolean }>(
      "select g.country, p.guest_done_at is not null as done from registration_persons p join registrations g on g.id = p.registration_id where p.id = $1",
      [personId],
    )).rows[0];
    if (!p) throw new Error("Person not found");
    if (p.country !== "DE") throw new Error("In Austria the guest signs on the tablet");
    if ((await tx.query("select 1 from registration_persons where id = $1 and completed_at is not null", [personId])).rowCount) throw new Error("This registration is completed already");
    if (!p.done) throw new Error("The guest's part on the tablet comes first");
    await tx.query("update registration_persons set confirmation = 'paper', paper_signed_by = $2, paper_signed_at = now() where id = $1", [personId, userId]);
  });
}

/** What the rendered form shows of one person. */
export interface RegistrationDocument {
  country: RegistrationCountry;
  property: { name: string; address: string };
  arrival: string;
  departure: string;
  person: RegistrationPersonView;
  companions: { role: PersonRole; name: string; nationality: string; dateOfBirth: string | null }[];
  signature: Uint8Array | null;
  confirmedBy: string;
  idCheck: string;
}

export async function registrationDocument(pool: Pool, schema: string, personId: string): Promise<RegistrationDocument & { reservationId: string }> {
  if (!isUuid(personId)) throw new Error("Person not found");
  return withTenant(pool, schema, (tx) => documentIn(tx, personId));
}

async function documentIn(tx: PoolClient, personId: string): Promise<RegistrationDocument & { reservationId: string }> {
  const row = (await tx.query<{ registration_id: string; signature: Buffer | null; paper_signed_by: string | null; paper_signed_at: Date | null; id_checked_by: string | null }>(
    "select registration_id, signature, paper_signed_by, paper_signed_at, id_checked_by from registration_persons where id = $1",
    [personId],
  )).rows[0];
  if (!row) throw new Error("Person not found");
  const reg = (await viewIn(tx, "g.id = $1", row.registration_id))!;
  const prop = (await tx.query<{ name: string; address: string }>(
    "select p.name, concat_ws(', ', l.address_line1, l.postal_code || ' ' || l.city) as address from properties p join legal_entities l on l.id = p.legal_entity_id where p.id = $1",
    [reg.propertyId],
  )).rows[0]!;
  const person = reg.persons.find((p) => p.id === personId)!;
  return {
    reservationId: reg.reservationId,
    country: reg.country,
    property: prop,
    arrival: reg.arrival,
    departure: reg.departure,
    person,
    companions: reg.persons.filter((p) => p.countedOn === personId).map((p) => ({ role: p.role, name: `${p.firstName} ${p.lastName}`, nationality: p.nationality, dateOfBirth: p.dateOfBirth })),
    signature: row.signature,
    confirmedBy: person.confirmation === "tablet_signature" ? "tablet" : row.paper_signed_by ? `paper:${row.paper_signed_by}` : "",
    idCheck: row.id_checked_by ?? "",
  };
}

/** The form as it stands, rendered (for printing before signing on paper). */
export async function renderRegistration(doc: RegistrationDocument): Promise<Uint8Array> {
  return renderMeldescheinPdf({ ...doc, signature: doc.signature ? new Uint8Array(doc.signature) : null });
}

/** The property a registration person belongs to (to authorise before anything of theirs is read). */
export async function registrationPersonProperty(pool: Pool, schema: string, personId: string): Promise<string | null> {
  if (!isUuid(personId)) return null;
  return withTenant(pool, schema, async (tx) => (await tx.query<{ property_id: string }>("select g.property_id from registration_persons p join registrations g on g.id = p.registration_id where p.id = $1", [personId])).rows[0]?.property_id ?? null);
}

/** Complete a person's registration, rendering its form under the lock so the stored form is what was confirmed: only with the guest's part, a confirmation and the ID Check. */
export async function completeRegistrationPerson(pool: Pool, schema: string, personId: string): Promise<void> {
  if (!isUuid(personId)) throw new Error("Person not found");
  await withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ guest_done_at: Date | null; confirmation: "tablet_signature" | "paper" | null; id_checked_at: Date | null; completed_at: Date | null }>(
      "select guest_done_at, confirmation, id_checked_at, completed_at from registration_persons where id = $1 for update",
      [personId],
    )).rows[0];
    if (!p) throw new Error("Person not found");
    if (p.completed_at) return;
    if (!registrationComplete({ guestDone: p.guest_done_at !== null, confirmation: p.confirmation, idChecked: p.id_checked_at !== null })) throw new Error("Complete needs the guest's part, the signature and the ID Check");
    const pdf = await renderRegistration(await documentIn(tx, personId));
    await tx.query("update registration_persons set completed_at = now(), pdf = $2 where id = $1", [personId, Buffer.from(pdf)]);
  });
}

export async function registrationPdf(pool: Pool, schema: string, personId: string): Promise<{ pdf: Buffer; reservationId: string; propertyId: string } | null> {
  if (!isUuid(personId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ pdf: Buffer | null; reservation_id: string; property_id: string }>(
      "select p.pdf, g.reservation_id, g.property_id from registration_persons p join registrations g on g.id = p.registration_id where p.id = $1",
      [personId],
    )).rows[0];
    return r?.pdf ? { pdf: r.pdf, reservationId: r.reservation_id, propertyId: r.property_id } : null;
  });
}

/** The daily deletion: Germany from day 365 after departure, Austria after 7 years. Returns how many registrations went. */
export async function deleteExpiredRegistrations(pool: Pool, schema: string, today: string): Promise<number> {
  return withTenant(pool, schema, async (tx) => {
    const rows = (await tx.query<{ id: string; country: RegistrationCountry; departure: string }>(
      "select g.id, g.country, to_char(r.departure, 'YYYY-MM-DD') as departure from registrations g join reservations r on r.id = g.reservation_id",
    )).rows.filter((r) => registrationDeletionDue(r.country, r.departure, today));
    if (rows.length) await tx.query("delete from registrations where id = any($1::uuid[])", [rows.map((r) => r.id)]);
    return rows.length;
  });
}
