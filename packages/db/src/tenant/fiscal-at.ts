import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { FiscalUnavailable, seal, unseal, type AtAccount, type AtSignedReceipt } from "@hoteloftware/fiscal";
import { atOutageReport, atVatKey, fiscalAmount, fiscalPayment, yearlyReceiptCheckBy, type VatAmount } from "@hoteloftware/domain";
import { tenantKey, type FileStore } from "@hoteloftware/storage";
import { isUuid } from "./catalogue-common";
import { clientIn, type FiscalDeps, type FiscalSignResult } from "./fiscal";
import { inTestMode } from "./go-live";
import { withTenant } from "./with-tenant";

/**
 * The fiscal module for Austria through fiskaly (ticket 52, RKSV). Every
 * Austrian property runs it. A signature creation unit per Legal Entity
 * (its own organisation at the provider, with the taxpayer's FinanzOnline
 * credentials), registered with FinanzOnline; each Cash Register (and the
 * desk) a register there, whose start receipt the provider signs. Every
 * on-site payment is signed, cards included; a refund is a cancellation
 * receipt, the only correction. The provider makes the monthly and yearly
 * receipts and has FinanzOnline check them; we keep them and remind of the
 * yearly receipt's print and check by 15 February. A Receipt the provider
 * could not be reached for says "Sicherheitseinrichtung ausgefallen" and is
 * signed once it answers; an outage over 48 hours is to be reported to
 * FinanzOnline within a week, and the managers are reminded with the data.
 */

const STALE_CLAIM_SECONDS = 90;

interface AtUnit {
  legalEntityId: string;
  scuId: string;
  account: AtAccount;
  certificateSerial: string;
  initializedAt: Date | null;
}

/** The Austrian unit of the property's Legal Entity, if set up. */
export async function atUnitOfPropertyIn(tx: PoolClient, propertyId: string, secret?: string | null): Promise<AtUnit | null> {
  const u = (await tx.query<{ legal_entity_id: string; scu_id: string; api_key: string; api_secret_sealed: string; certificate_serial: string; initialized_at: Date | null }>(
    "select u.legal_entity_id, u.scu_id, u.api_key, u.api_secret_sealed, u.certificate_serial, u.initialized_at from fiscal_at_units u join properties p on p.legal_entity_id = u.legal_entity_id where p.id = $1",
    [propertyId],
  )).rows[0];
  if (!u) return null;
  return { legalEntityId: u.legal_entity_id, scuId: u.scu_id, account: { apiKey: u.api_key, apiSecret: secret ? unseal(secret, u.api_secret_sealed) : "" }, certificateSerial: u.certificate_serial, initializedAt: u.initialized_at };
}

function provider(deps: FiscalDeps) {
  if (!deps.at) throw new Error("The Austrian fiscal provider is not configured");
  return deps.at;
}

function needSecret(deps: FiscalDeps): string {
  if (!deps.secret) throw new Error("The fiscal module is not configured (FISCAL_SECRET)");
  return deps.secret;
}

export interface AtSetUpInput {
  /** The Legal Entity's own organisation at fiskaly (SIGN AT). */
  apiKey: string;
  apiSecret: string;
  fon: { participantId: string; userId: string; pin: string };
}

/**
 * Set up the Legal Entity's signature unit: the FinanzOnline credentials
 * handed to the provider, the SCU created and registered with FinanzOnline,
 * then every register of its Austrian properties. Not in Test Mode.
 */
export async function setUpFiscalAt(pool: Pool, schema: string, deps: FiscalDeps, legalEntityId: string, input: AtSetUpInput, userId: string): Promise<void> {
  if (!isUuid(legalEntityId)) throw new Error("Legal Entity not found");
  const secret = needSecret(deps);
  const at = provider(deps);
  const apiKey = input.apiKey.trim();
  const fon = { participantId: input.fon.participantId.trim(), userId: input.fon.userId.trim(), pin: input.fon.pin };
  if (!apiKey || !input.apiSecret) throw new Error("Give the fiskaly API key and secret of the Legal Entity's organisation");
  if (!/^[0-9A-Za-z]{8,12}$/.test(fon.participantId) || fon.userId.length < 5 || fon.userId.length > 12 || fon.pin.length < 5) throw new Error("Give the FinanzOnline participant id, web-service user and PIN");
  await withTenant(pool, schema, async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('fiscal-at-setup:' || $1))", [legalEntityId]);
    if ((await tx.query("select 1 from fiscal_at_units where legal_entity_id = $1", [legalEntityId])).rowCount) return;
    const le = (await tx.query<{ name: string; country: string; vat_id: string | null; tax_number: string | null }>("select name, country, vat_id, tax_number from legal_entities where id = $1", [legalEntityId])).rows[0];
    if (!le) throw new Error("Legal Entity not found");
    if (le.country !== "AT") throw new Error("The signature unit is for Legal Entities in Austria");
    if (await inTestMode(tx)) throw new Error("Set up the signature unit after go-live: in Test Mode nothing is signed");
    const taxId = le.vat_id && /^ATU\d{8}$/.test(le.vat_id.replace(/\s/g, "")) ? { vatId: le.vat_id.replace(/\s/g, "") } : le.tax_number ? { taxNumber: le.tax_number } : null;
    if (!taxId) throw new Error("The Legal Entity needs its UID (ATU…) or tax number");
    const account = { apiKey, apiSecret: input.apiSecret };
    await at.fonAuth(account, fon);
    const scuId = randomUUID();
    const scu = await at.createScu(account, scuId, taxId, le.name);
    await tx.query(
      `insert into fiscal_at_units (legal_entity_id, provider, scu_id, certificate_serial, api_key, api_secret_sealed, fon_participant_id, fon_user_id, fon_pin_sealed, initialized_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp(), $10)`,
      [legalEntityId, at.name, scuId, scu.certificateSerial, apiKey, seal(secret, input.apiSecret), fon.participantId, fon.userId, seal(secret, fon.pin), userId],
    );
  });
  const properties = await withTenant(pool, schema, async (tx) => (await tx.query<{ id: string }>("select id from properties where legal_entity_id = $1 and country = 'AT'", [legalEntityId])).rows);
  for (const p of properties) await registerAtClients(pool, schema, deps, p.id);
}

/** Every active Cash Register (and the desk) of an Austrian property as a register at the provider, registered and initialised. */
export async function registerAtClients(pool: Pool, schema: string, deps: FiscalDeps, propertyId: string): Promise<{ registered: number; failed: string[] }> {
  const out = { registered: 0, failed: [] as string[] };
  const todo = await withTenant(pool, schema, async (tx) => {
    const unit = await atUnitOfPropertyIn(tx, propertyId, deps.secret);
    if (!unit) return null;
    const registers = (await tx.query<{ id: string }>("select id from cash_registers where property_id = $1 and active", [propertyId])).rows;
    for (const r of [...registers.map((x) => x.id), null]) await clientIn(tx, propertyId, r);
    const open = (await tx.query<{ id: string; serial: string; name: string | null }>(
      "select c.id, c.serial, g.name from fiscal_clients c left join cash_registers g on g.id = c.register_id where c.property_id = $1 and c.registered_at is null",
      [propertyId],
    )).rows;
    return { unit, open };
  });
  if (!todo || !todo.open.length) return out;
  if (!deps.secret || !deps.at) return { registered: 0, failed: todo.open.map((c) => `${c.serial}: the fiscal module is not configured`) };
  for (const c of todo.open) {
    try {
      const r = await deps.at.createRegister(todo.unit.account, c.id, c.name ?? "Rezeption");
      await withTenant(pool, schema, (tx) =>
        tx.query("update fiscal_clients set registered_at = clock_timestamp(), provider_serial = $2, initialization_receipt_id = $3 where id = $1 and registered_at is null", [c.id, r.serial, r.initializationReceiptId]),
      );
      out.registered++;
    } catch (err) {
      out.failed.push(`${c.serial}: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return out;
}

/**
 * Sign an Austrian Receipt: the claim as in Germany; a provider out of
 * reach leaves it open (it is signed later) and opens an outage; a receipt
 * the SCU could not sign comes back marked so and is kept as it is.
 */
export async function signAtReceipt(pool: Pool, schema: string, deps: FiscalDeps, receiptId: string): Promise<FiscalSignResult> {
  const claim = randomUUID();
  const held = await withTenant(pool, schema, async (tx) => {
    const f = (await tx.query<{ state: string; stale: boolean; property_id: string; client_id: string; amounts: VatAmount[]; tender: string; currency: string; amount: string; receipt_type: string; refund_of: string | null }>(
      `select f.state, coalesce(f.claimed_at < now() - make_interval(secs => ${STALE_CLAIM_SECONDS}), true) as stale, f.property_id, f.client_id, f.amounts, f.tender, trim(f.currency) as currency, f.amount, f.receipt_type, p.refund_of
       from fiscal_transactions f join receipts rc on rc.id = f.receipt_id join payments p on p.id = rc.payment_id where f.receipt_id = $1 for update of f`,
      [receiptId],
    )).rows[0];
    if (!f) return { kind: "none" as const };
    if (f.state === "signed" || f.state === "failed") return { kind: "done" as const, propertyId: f.property_id };
    if (f.state === "signing" && !f.stale) return { kind: "busy" as const };
    const client = (await tx.query<{ registered: boolean }>("select registered_at is not null as registered from fiscal_clients where id = $1", [f.client_id])).rows[0]!;
    const unit = await atUnitOfPropertyIn(tx, f.property_id, deps.secret);
    if (!client.registered || !unit || !deps.secret) return { kind: "busy" as const };
    // a cancellation names the receipt it cancels
    const original = f.refund_of ? (await tx.query<{ receipt_number: string | null }>("select f.receipt_number from fiscal_transactions f join receipts rc on rc.id = f.receipt_id where rc.payment_id = $1", [f.refund_of])).rows[0]?.receipt_number : null;
    await tx.query("update fiscal_transactions set state = 'signing', claim = $2, claimed_at = clock_timestamp(), attempts = attempts + 1 where receipt_id = $1", [receiptId, claim]);
    return { kind: "claimed" as const, row: f, unit, original: original ?? null };
  });
  if (held.kind === "none") return { state: "none" };
  if (held.kind === "busy") return { state: "signing" };
  if (held.kind === "done") return { state: "signed", propertyId: held.propertyId };
  const { row, unit } = held;
  let signed: AtSignedReceipt | null = null;
  let error = "";
  try {
    const amount = Number(row.amount);
    signed = await provider(deps).sign(unit.account, {
      registerId: row.client_id,
      receiptId,
      type: row.receipt_type === "cancellation" ? "CANCELLATION" : "NORMAL",
      amountsPerVatRate: row.amounts.map((a) => ({ vatRate: atVatKey(a.rate), amount: fiscalAmount(a.amount) })),
      amountsPerPaymentType: [{ paymentType: fiscalPayment(row.tender).tse, amount: fiscalAmount(amount), currency: row.currency }],
      lineItems: [{ quantity: "1", text: amount < 0 ? "Rückzahlung Beherbergung" : "Zahlung Beherbergung", pricePerUnit: fiscalAmount(amount) }],
      ...(held.original ? { metadata: { cancels_receipt_number: held.original } } : {}),
    });
  } catch (err) {
    error = (err instanceof FiscalUnavailable || err instanceof Error ? err.message : "").slice(0, 200) || "Signature service not available";
  }
  return withTenant(pool, schema, async (tx) => {
    const propertyId = row.property_id;
    if (signed) {
      const n = (await tx.query(
        `update fiscal_transactions set state = 'signed', claim = null, receipt_number = $2, time_start = $3, time_end = $3, client_serial = $4, qr_code_data = $5,
           unit_failed = $6, hints = $7, error = null, finished_at = clock_timestamp() where receipt_id = $1 and claim = $8`,
        [receiptId, signed.receiptNumber, signed.timeSignature, signed.registerSerial, signed.qrCodeData, !signed.signed, JSON.stringify(signed.hints), claim],
      )).rowCount;
      if (!n) return { state: "signing" };
      await tx.query("update fiscal_outages set ended_at = clock_timestamp() where property_id = $1 and ended_at is null", [propertyId]);
      return { state: "signed", propertyId };
    }
    // Austria: not signed now, signed once the provider answers
    const n = (await tx.query("update fiscal_transactions set state = 'open', claim = null, claimed_at = null, error = $2 where receipt_id = $1 and claim = $3", [receiptId, error, claim])).rowCount;
    if (!n) return { state: "signing" };
    const started = (await tx.query("insert into fiscal_outages (property_id, client_id, error) values ($1, $2, $3) on conflict (client_id) where ended_at is null do nothing returning id", [propertyId, row.client_id, error])).rowCount;
    return { state: "failed", propertyId, error, outageStarted: !!started };
  });
}

export interface AtOutageToReport {
  id: string;
  propertyId: string;
  propertyName: string;
  registerSerial: string;
  startedAt: Date;
  endedAt: Date | null;
  reportBy: Date;
  error: string;
}

/**
 * Austrian outages over 48 hours not yet reported to FinanzOnline: the
 * reminder with what the report needs, at most once a day until marked
 * reported.
 */
export async function atOutagesToReport(pool: Pool, schema: string, now = new Date()): Promise<AtOutageToReport[]> {
  return withTenant(pool, schema, async (tx) => {
    const rows = (await tx.query<{ id: string; property_id: string; name: string; serial: string; started_at: Date; ended_at: Date | null; error: string }>(
      `select o.id, o.property_id, p.name, coalesce(c.provider_serial, c.serial) as serial, o.started_at, o.ended_at, o.error
       from fiscal_outages o join properties p on p.id = o.property_id join fiscal_clients c on c.id = o.client_id
       where p.country = 'AT' and o.reported_at is null and (o.reminded_at is null or o.reminded_at < $1::timestamptz - interval '1 day')
       order by o.started_at`,
      [now],
    )).rows;
    const due = rows.map((r) => ({ r, report: atOutageReport({ startedAt: r.started_at, endedAt: r.ended_at }, now) })).filter((x) => x.report.due);
    for (const x of due) await tx.query("update fiscal_outages set reminded_at = $2 where id = $1", [x.r.id, now]);
    return due.map(({ r, report }) => ({ id: r.id, propertyId: r.property_id, propertyName: r.name, registerSerial: r.serial, startedAt: r.started_at, endedAt: r.ended_at, reportBy: report.reportBy!, error: r.error }));
  });
}

/** The outage was reported to FinanzOnline (by the manager, through FinanzOnline). */
export async function markOutageReported(pool: Pool, schema: string, propertyId: string, outageId: string, userId: string): Promise<void> {
  if (!isUuid(outageId)) throw new Error("Outage not found");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("update fiscal_outages set reported_at = clock_timestamp(), reported_by = $3 where id = $1 and property_id = $2 and reported_at is null", [outageId, propertyId, userId])).rowCount);
  if (!n) throw new Error("Outage not found or reported already");
}

/** The provider's own receipts (start, monthly, yearly, fault clearance) of an Austrian property's registers, kept here. */
export async function syncAtSystemReceipts(pool: Pool, schema: string, deps: FiscalDeps, propertyId: string): Promise<number> {
  const work = await withTenant(pool, schema, async (tx) => {
    const unit = await atUnitOfPropertyIn(tx, propertyId, deps.secret);
    const clients = (await tx.query<{ id: string }>("select id from fiscal_clients where property_id = $1 and registered_at is not null", [propertyId])).rows;
    return unit && deps.secret ? { unit, clients } : null;
  });
  if (!work) return 0;
  let added = 0;
  for (const c of work.clients) {
    const list = await provider(deps).systemReceipts(work.unit.account, c.id);
    await withTenant(pool, schema, async (tx) => {
      for (const r of list) {
        const n = (await tx.query(
          `insert into fiscal_system_receipts (property_id, client_id, provider_receipt_id, receipt_type, receipt_number, time_signature, qr_code_data, validation)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (client_id, provider_receipt_id) do update set validation = coalesce(excluded.validation, fiscal_system_receipts.validation)`,
          [propertyId, c.id, r.id, r.type, r.receiptNumber, r.timeSignature, r.qrCodeData, r.validation],
        )).rowCount;
        added += n ?? 0;
      }
    });
  }
  return added;
}

export interface AtSystemReceiptView {
  id: string;
  registerSerial: string;
  registerName: string | null;
  type: string;
  receiptNumber: string;
  timeSignature: Date;
  qrCodeData: string;
  validation: "SUCCESS" | "ERROR" | null;
  printedAt: Date | null;
  /** The yearly receipt: printed and checked by this date. */
  checkBy: string | null;
}

export async function atSystemReceipts(pool: Pool, schema: string, propertyId: string): Promise<AtSystemReceiptView[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; serial: string; name: string | null; receipt_type: string; receipt_number: string; time_signature: Date; qr_code_data: string; validation: "SUCCESS" | "ERROR" | null; printed_at: Date | null }>(
      `select s.id, coalesce(c.provider_serial, c.serial) as serial, g.name, s.receipt_type, s.receipt_number, s.time_signature, s.qr_code_data, s.validation, s.printed_at
       from fiscal_system_receipts s join fiscal_clients c on c.id = s.client_id left join cash_registers g on g.id = c.register_id
       where s.property_id = $1 order by s.time_signature desc limit 60`,
      [propertyId],
    )).rows.map((r) => ({
      id: r.id,
      registerSerial: r.serial,
      registerName: r.name,
      type: r.receipt_type,
      receiptNumber: r.receipt_number,
      timeSignature: r.time_signature,
      qrCodeData: r.qr_code_data,
      validation: r.validation,
      printedAt: r.printed_at,
      checkBy: r.receipt_type === "YEARLY_CLOSE" ? yearlyReceiptCheckBy(r.time_signature) : null,
    })),
  );
}

/** One of the provider's receipts, for printing (the property's, for the caller's rights check). */
export async function atSystemReceipt(pool: Pool, schema: string, id: string): Promise<(AtSystemReceiptView & { propertyId: string }) | null> {
  if (!isUuid(id)) return null;
  const p = await withTenant(pool, schema, async (tx) => (await tx.query<{ property_id: string }>("select property_id from fiscal_system_receipts where id = $1", [id])).rows[0]?.property_id);
  if (!p) return null;
  const r = (await atSystemReceipts(pool, schema, p)).find((x) => x.id === id);
  return r ? { ...r, propertyId: p } : null;
}

/** The yearly receipt was printed and checked (with the BMF's Belegcheck app, or by the provider's FinanzOnline check). */
export async function markSystemReceiptPrinted(pool: Pool, schema: string, propertyId: string, id: string, userId: string): Promise<void> {
  if (!isUuid(id)) throw new Error("Receipt not found");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("update fiscal_system_receipts set printed_at = clock_timestamp(), printed_by = $3 where id = $1 and property_id = $2 and printed_at is null", [id, propertyId, userId])).rowCount);
  if (!n) throw new Error("Receipt not found or marked already");
}

/** Yearly receipts not yet printed and checked: the managers are reminded until 15 February. */
export async function yearlyReceiptsToCheck(pool: Pool, schema: string): Promise<{ id: string; propertyId: string; registerSerial: string; checkBy: string }[]> {
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; property_id: string; serial: string; time_signature: Date }>(
      `select s.id, s.property_id, coalesce(c.provider_serial, c.serial) as serial, s.time_signature from fiscal_system_receipts s join fiscal_clients c on c.id = s.client_id
       where s.receipt_type = 'YEARLY_CLOSE' and s.printed_at is null`,
    )).rows.map((r) => ({ id: r.id, propertyId: r.property_id, registerSerial: r.serial, checkBy: yearlyReceiptCheckBy(r.time_signature) })),
  );
}

/** The data collection log (DEP7) of an Austrian property's registers for a period, kept in the file store. */
export async function atDepArchive(pool: Pool, schema: string, deps: FiscalDeps & { store: FileStore; tenantId: string }, input: { propertyId: string; from: string; to: string }, userId: string): Promise<{ id: string; state: string; error: string | null }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to) throw new Error("Choose a period");
  const work = await withTenant(pool, schema, async (tx) => {
    const unit = await atUnitOfPropertyIn(tx, input.propertyId, deps.secret);
    if (!unit || !deps.secret) throw new Error("Set up the signature unit first");
    await tx.query("insert into fiscal_archives (property_id, kind, period_from, period_to, requested_by) values ($1, 'dep', $2, $3, $4) on conflict do nothing", [input.propertyId, input.from, input.to, userId]);
    const row = (await tx.query<{ id: string }>("update fiscal_archives set state = 'pending', error = null where property_id = $1 and kind = 'dep' and period_from = $2 and period_to = $3 and state <> 'completed' returning id", [input.propertyId, input.from, input.to])).rows[0];
    const span = (await tx.query<{ f: Date; t: Date }>("select ($1::date)::timestamp at time zone p.time_zone as f, ($2::date + 1)::timestamp at time zone p.time_zone as t from properties p where p.id = $3", [input.from, input.to, input.propertyId])).rows[0]!;
    const clients = (await tx.query<{ id: string; serial: string }>("select id, coalesce(provider_serial, serial) as serial from fiscal_clients where property_id = $1 and registered_at is not null order by serial", [input.propertyId])).rows;
    const done = (await tx.query<{ id: string }>("select id from fiscal_archives where property_id = $1 and kind = 'dep' and period_from = $2 and period_to = $3", [input.propertyId, input.from, input.to])).rows[0]!;
    return { unit, id: row?.id ?? done.id, pending: !!row, span, clients };
  });
  if (work.pending) {
    try {
      const parts: { kasse: string; dep: unknown }[] = [];
      for (const c of work.clients) parts.push({ kasse: c.serial, dep: JSON.parse(new TextDecoder().decode(await provider(deps).dep(work.unit.account, c.id, work.span.f, new Date(work.span.t.getTime() - 1000)))) });
      const bytes = new TextEncoder().encode(JSON.stringify({ zeitraum: { von: input.from, bis: input.to }, kassen: parts }, null, 1));
      const key = tenantKey(deps.tenantId, "fiscal_archive", work.id);
      await deps.store.put(key, bytes, "application/json");
      await withTenant(pool, schema, (tx) => tx.query("update fiscal_archives set state = 'completed', file_key = $2, bytes = $3, finished_at = clock_timestamp() where id = $1", [work.id, key, bytes.length]));
    } catch (err) {
      await withTenant(pool, schema, (tx) => tx.query("update fiscal_archives set state = 'failed', error = $2, finished_at = clock_timestamp() where id = $1", [work.id, err instanceof Error ? err.message.slice(0, 300) : "error"]));
    }
  }
  return withTenant(pool, schema, async (tx) => (await tx.query<{ id: string; state: string; error: string | null }>("select id, state, error from fiscal_archives where id = $1", [work.id])).rows[0]!);
}

/** Austrian properties whose Legal Entity's unit is set up (the worker's work). */
export async function atFiscalProperties(pool: Pool, schema: string): Promise<string[]> {
  return withTenant(pool, schema, async (tx) => (await tx.query<{ id: string }>("select p.id from properties p join fiscal_at_units u on u.legal_entity_id = p.legal_entity_id where p.country = 'AT'")).rows.map((r) => r.id));
}

export interface AtFiscalStatus {
  unit: { certificateSerial: string; initializedAt: Date | null; fonParticipantId: string; fonUserId: string } | null;
  legalEntity: { id: string; name: string; taxId: string };
  registers: { serial: string; providerSerial: string | null; name: string | null; registeredAt: Date | null; initializationReceiptId: string | null }[];
  outages: { id: string; registerSerial: string; startedAt: Date; endedAt: Date | null; error: string; reportBy: Date | null; reportedAt: Date | null }[];
}

/** The settings page of an Austrian property: the unit, its registers (the FinanzOnline registration data), outages to report. */
export async function atFiscalStatus(pool: Pool, schema: string, propertyId: string, now = new Date()): Promise<AtFiscalStatus | null> {
  if (!isUuid(propertyId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const le = (await tx.query<{ id: string; name: string; country: string; vat_id: string | null; tax_number: string | null; p_country: string }>(
      "select le.id, le.name, le.country, le.vat_id, le.tax_number, p.country as p_country from properties p join legal_entities le on le.id = p.legal_entity_id where p.id = $1",
      [propertyId],
    )).rows[0];
    if (!le || le.p_country !== "AT") return null;
    const u = (await tx.query<{ certificate_serial: string; initialized_at: Date | null; fon_participant_id: string; fon_user_id: string }>("select certificate_serial, initialized_at, fon_participant_id, fon_user_id from fiscal_at_units where legal_entity_id = $1", [le.id])).rows[0];
    const registers = (await tx.query<{ serial: string; provider_serial: string | null; name: string | null; registered_at: Date | null; initialization_receipt_id: string | null }>(
      "select c.serial, c.provider_serial, g.name, c.registered_at, c.initialization_receipt_id from fiscal_clients c left join cash_registers g on g.id = c.register_id where c.property_id = $1 order by g.name nulls first",
      [propertyId],
    )).rows;
    const outages = (await tx.query<{ id: string; serial: string; started_at: Date; ended_at: Date | null; error: string; reported_at: Date | null }>(
      "select o.id, coalesce(c.provider_serial, c.serial) as serial, o.started_at, o.ended_at, o.error, o.reported_at from fiscal_outages o join fiscal_clients c on c.id = o.client_id where o.property_id = $1 order by o.started_at desc limit 30",
      [propertyId],
    )).rows;
    return {
      unit: u ? { certificateSerial: u.certificate_serial, initializedAt: u.initialized_at, fonParticipantId: u.fon_participant_id, fonUserId: u.fon_user_id } : null,
      legalEntity: { id: le.id, name: le.name, taxId: le.vat_id || le.tax_number || "" },
      registers: registers.map((r) => ({ serial: r.serial, providerSerial: r.provider_serial, name: r.name, registeredAt: r.registered_at, initializationReceiptId: r.initialization_receipt_id })),
      outages: outages.map((o) => ({ id: o.id, registerSerial: o.serial, startedAt: o.started_at, endedAt: o.ended_at, error: o.error, reportBy: atOutageReport({ startedAt: o.started_at, endedAt: o.ended_at }, now).reportBy, reportedAt: o.reported_at })),
    };
  });
}

