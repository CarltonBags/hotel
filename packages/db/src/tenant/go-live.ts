import type { Pool, PoolClient } from "pg";
import { goLiveBlockers, goLiveChecklist, type ChecklistItem, type GoLiveFacts, type TrialKind } from "@hoteloftware/domain";
import { withTenant } from "./with-tenant";

/**
 * Test Mode and Go-live (ticket 87). A tenant before go-live is in Test Mode:
 * its setup is kept, the records made while testing are test records (no
 * real invoice number, no card charged) and go-live clears them in one
 * transaction, after a preview, once the checklist is complete and checked
 * by the platform's support staff.
 */

/** Whether the tenant of this transaction is in Test Mode. */
export async function inTestMode(tx: PoolClient): Promise<boolean> {
  return (await tx.query<{ on: boolean }>("select in_test_mode() as on")).rows[0]!.on;
}

export interface TenantLifecycle {
  trialKind: TrialKind | null;
  trialEndsAt: Date | null;
  /** Null while in Test Mode. */
  liveAt: Date | null;
  checkedBy: string | null;
  checkedAt: Date | null;
}

export async function tenantLifecycle(pool: Pool, tenantId: string): Promise<TenantLifecycle> {
  const { rows } = await pool.query<{ trial_kind: TrialKind | null; trial_ends_at: Date | null; live_at: Date | null; checked_by: string | null; go_live_checked_at: Date | null }>(
    `select t.trial_kind, t.trial_ends_at, t.live_at, u.name as checked_by, t.go_live_checked_at
     from control.tenants t left join control."user" u on u.id = t.go_live_checked_by where t.id = $1`,
    [tenantId],
  );
  const r = rows[0];
  if (!r) throw new Error("Tenant not found");
  return { trialKind: r.trial_kind, trialEndsAt: r.trial_ends_at, liveAt: r.live_at, checkedBy: r.checked_by, checkedAt: r.go_live_checked_at };
}

async function factsIn(tx: PoolClient, tenantId: string): Promise<GoLiveFacts> {
  const legalEntities = await tx.query<{ name: string; tax: boolean; codes: boolean; numbering: boolean; charges_enabled: boolean | null }>(
    `select l.name, (coalesce(l.vat_id, '') <> '' or coalesce(l.tax_number, '') <> '') as tax,
       exists (select 1 from tax_codes c where c.legal_entity_id = l.id) as codes,
       exists (select 1 from invoice_number_ranges r where r.legal_entity_id = l.id and r.kind = 'final') as numbering,
       a.charges_enabled
     from legal_entities l left join payment_accounts a on a.legal_entity_id = l.id order by l.name`,
  );
  const props = await tx.query<{ name: string; rooms: number; priced_through: string | null; city_tax: boolean; today: string; country: string; printer: boolean }>(
    `select p.name, p.country, p.receipt_printer <> '' as printer, (select count(*)::int from rooms r where r.property_id = p.id) as rooms,
       (select to_char(max(x.date), 'YYYY-MM-DD') from rates x join rate_plans rp on rp.id = x.rate_plan_id where rp.property_id = p.id) as priced_through,
       exists (select 1 from city_tax_rules c where c.property_id = p.id) as city_tax,
       to_char((now() at time zone p.time_zone)::date, 'YYYY-MM-DD') as today
     from properties p order by p.name`,
  );
  const users = await tx.query<{ n: number }>(
    `select count(*)::int as n from control."user" u where u.tenant_id = $1 and not exists (select 1 from control.invitations i where i.user_id = u.id)`,
    [tenantId],
  );
  const devices = await tx.query<{ n: number }>("select count(*)::int as n from control.devices where tenant_id = $1 and revoked_at is null", [tenantId]);
  return {
    legalEntities: legalEntities.rows.map((l) => ({ name: l.name, hasTaxData: l.tax, hasTaxCodes: l.codes, hasInvoiceNumbering: l.numbering, card: l.charges_enabled === null ? null : { chargesEnabled: l.charges_enabled } })),
    properties: props.rows.map((p) => ({ name: p.name, rooms: p.rooms, pricedThrough: p.priced_through, cityTaxRule: p.city_tax, country: p.country, receiptPrinter: p.printer, today: p.today })),
    staffUsers: users.rows[0]!.n,
    devices: devices.rows[0]!.n,
  };
}

/** The checklist as the setup stands now. */
export async function goLiveChecklistOf(pool: Pool, schema: string, tenantId: string): Promise<ChecklistItem[]> {
  return withTenant(pool, schema, async (tx) => goLiveChecklist(await factsIn(tx, tenantId)));
}

/** What go-live will clear: the test records, by kind. */
export interface TestRecordCounts {
  reservations: number;
  guests: number;
  companies: number;
  invoices: number;
  payments: number;
  receipts: number;
  cashMovements: number;
  nightAudits: number;
}

async function countsIn(tx: PoolClient): Promise<TestRecordCounts> {
  const { rows } = await tx.query<TestRecordCounts>(
    `select (select count(*)::int from reservations where test) as reservations,
       (select count(*)::int from guests g where test and not exists (select 1 from reservations r where r.primary_guest_id = g.id and not r.test)) as guests,
       (select count(*)::int from companies c where test and not exists (select 1 from rate_plans rp where rp.company_id = c.id)) as companies,
       (select count(*)::int from invoices) as invoices,
       (select count(*)::int from payments) as payments,
       (select count(*)::int from receipts) as receipts,
       (select count(*)::int from cash_movements) as "cashMovements",
       (select count(*)::int from night_audits) as "nightAudits"`,
  );
  return rows[0]!;
}

export async function testRecordCounts(pool: Pool, schema: string): Promise<TestRecordCounts> {
  return withTenant(pool, schema, countsIn);
}

/** What the staff check covers: the setup, without the date (which moves daily) and the optional Devices. */
function checkedSetup(f: GoLiveFacts): string {
  return JSON.stringify({ legalEntities: f.legalEntities, properties: f.properties.map(({ today: _today, ...p }) => p), staffUsers: f.staffUsers });
}

/** The platform's support staff confirm the checklist as the setup stands now (null takes the confirmation back). */
export async function markGoLiveChecked(pool: Pool, tenant: { id: string; schemaName: string }, staffUserId: string | null): Promise<void> {
  await withTenant(pool, tenant.schemaName, async (tx) => {
    const setup = staffUserId ? checkedSetup(await factsIn(tx, tenant.id)) : null;
    const { rowCount } = await tx.query(
      `update control.tenants set go_live_checked_by = $2, go_live_checked_at = case when $2::text is null then null else now() end, go_live_checked_setup = $3::jsonb
       where id = $1 and live_at is null`,
      [tenant.id, staffUserId, setup],
    );
    if (!rowCount) throw new Error("This tenant is already live");
  });
}

/** Whether the setup still is what our staff checked. */
export async function goLiveCheckCurrent(pool: Pool, tenant: { id: string; schemaName: string }): Promise<boolean> {
  return withTenant(pool, tenant.schemaName, async (tx) => {
    const setup = checkedSetup(await factsIn(tx, tenant.id));
    // compared as jsonb: key order does not matter
    const t = (await tx.query<{ same: boolean }>("select go_live_checked_setup = $2::jsonb as same from control.tenants where id = $1", [tenant.id, setup])).rows[0];
    return t?.same === true;
  });
}

export class GoLiveBlocked extends Error {
  constructor(readonly blockers: ChecklistItem[]) {
    super("Complete the required checklist items first");
  }
}

/**
 * Go live: clear every test record, keep setup and imported records, start
 * the Business Date of every property on its own calendar date, and leave
 * Test Mode. All or nothing; refused while a required item is missing or the
 * checklist is not checked.
 */
export async function goLive(pool: Pool, tenant: { id: string; schemaName: string }): Promise<TestRecordCounts> {
  return withTenant(pool, tenant.schemaName, async (tx) => {
    // every write in the tenant references a property (and takes a row share lock on the table): exclusive mode makes them wait,
    // so no record made while testing commits after the clearing has looked
    await tx.query("lock table properties in exclusive mode");
    const facts = await factsIn(tx, tenant.id);
    const t = (await tx.query<{ live_at: Date | null; checked: boolean; current: boolean; trial_kind: TrialKind | null }>(
      "select live_at, go_live_checked_setup is not null as checked, go_live_checked_setup = $2::jsonb as current, trial_kind from control.tenants where id = $1 for update",
      [tenant.id, checkedSetup(facts)],
    )).rows[0];
    if (!t) throw new Error("Tenant not found");
    if (t.live_at || !(await inTestMode(tx))) throw new Error("This tenant is already live");
    // nothing of the demo carries over but the user
    if (t.trial_kind === "demo") throw new Error("A demo tenant does not go live; a tenant with your own data does");
    const blockers = goLiveBlockers(goLiveChecklist(facts));
    if (blockers.length) throw new GoLiveBlocked(blockers);
    if (!t.checked) throw new Error("Our support staff check the checklist before go-live");
    if (!t.current) throw new Error("The setup changed after our support staff checked it; ask for a new check");
    const cleared = await countsIn(tx);
    await tx.query("select set_config('hoteloftware.clearing_test_records', 'on', true)");
    // In Test Mode no money moved and no document is real: every financial and operational record goes, also on an
    // imported reservation (an import brings guests, companies and reservations, which stay)
    // money, documents and the Cash Book reference each other: one statement, constraints checked at its end
    await tx.query(
      `with m as (delete from receivable_matches), rm as (delete from reminders), rc as (delete from receipts), cm as (delete from cash_movements),
         ch as (delete from card_holds), ce as (delete from charge_events), c as (delete from charges), i as (delete from invoices)
       delete from payments`,
    );
    for (const table of ["cash_shifts", "night_audits", "approvals", "housekeeping_tasks", "housekeeping_plans", "maintenance_issues", "lost_items", "phone_changes", "tourism_reports", "city_tax_nights", "room_cleanliness_changes", "receipt_numbers"]) {
      await tx.query(`delete from ${table}`);
    }
    await tx.query("delete from reservation_city_tax_exemptions x using reservations r where r.id = x.reservation_id and r.test");
    await tx.query("delete from reservation_routing x using folios f join reservations r on r.id = f.reservation_id where x.folio_id = f.id and r.test");
    await tx.query("delete from folios f using reservations r where r.id = f.reservation_id and r.test");
    await tx.query("delete from reservations where test");
    await tx.query("delete from bookings b where test and not exists (select 1 from reservations r where r.booking_id = b.id)");
    await tx.query(
      `delete from guests g where test
       and not exists (select 1 from reservations r where r.primary_guest_id = g.id)
       and not exists (select 1 from bookings b where b.booker_guest_id = g.id)
       and not exists (select 1 from folios f where f.bill_to_guest_id = g.id)`,
    );
    await tx.query(
      `delete from companies c where test
       and not exists (select 1 from rate_plans rp where rp.company_id = c.id)
       and not exists (select 1 from bookings b where c.id in (b.booker_company_id, b.rate_code_company_id))
       and not exists (select 1 from folios f where f.bill_to_company_id = c.id)`,
    );
    await tx.query("delete from guest_merges m where not exists (select 1 from guests g where g.id = m.kept_id)");
    // what stays is real from now on
    await tx.query("update guests set test = false where test");
    await tx.query("update companies set test = false where test");
    await tx.query("update bookings set test = false where test");
    await tx.query("update properties set business_date = (now() at time zone time_zone)::date, night_audit_alerted_for = null");
    await tx.query("delete from tenant_settings where key = 'test_mode'");
    await tx.query("update control.tenants set live_at = now(), trial_kind = null, trial_ends_at = null where id = $1", [tenant.id]);
    return cleared;
  });
}
