import type { Pool, PoolClient } from "pg";
import { MODULES, invoiceTotals, roundMoney, subscriptionLines, type InvoiceLine, type ModulePeriod, type PriceList } from "@hoteloftware/domain";
import { invoicePdf, invoiceXml, type InvoiceDocument } from "@hoteloftware/invoices";
import type { Tenant } from "../tenant/provision";
import { modulePeriods } from "../tenant/modules";
import { withTenant } from "../tenant/with-tenant";

/**
 * Subscription billing (ticket 88): the price list, the customer's payment
 * terms, usage passed on, and the monthly e-invoice per Legal Entity of the
 * customer, issued by the platform's own company.
 */

/** The price list in force on a day; a price not configured is refused, never guessed. */
export async function pricesOn(pool: Pool, day: string): Promise<PriceList> {
  const { rows } = await pool.query<{ key: string; unit: string; amount: string }>(
    "select distinct on (key) key, unit, amount from control.price_list where valid_from <= $1 order by key, valid_from desc",
    [day],
  );
  const p = new Map(rows.map((r) => [r.key, r]));
  const need = (k: string) => {
    const r = p.get(k);
    if (!r) throw new Error(`The price list has no "${k}"`);
    return r;
  };
  return {
    base_room: Number(need("base_room").amount),
    modules: Object.fromEntries(MODULES.map((m) => {
      const r = need(`module:${m}`);
      if (r.unit !== "room" && r.unit !== "property") throw new Error(`The price of module:${m} is per room or per property`);
      return [m, { unit: r.unit, amount: Number(r.amount) }];
    })) as PriceList["modules"],
    handling: Number(need("usage_handling").amount),
    yearlyDiscount: Number(need("yearly_discount").amount),
    vatRate: Number(need("vat").amount),
  };
}

const PRICE_UNITS: Record<string, readonly string[]> = { base_room: ["room"], usage_handling: ["percent"], yearly_discount: ["percent"], vat: ["percent"], ...Object.fromEntries(MODULES.map((m) => [`module:${m}`, ["room", "property"]])) };

/** A price from a day on, set by our staff: from today on only, never for a month already invoiced. */
export async function setPrice(pool: Pool, input: { key: string; unit: "room" | "property" | "percent"; amount: number; validFrom: string }, userId: string, today: string): Promise<void> {
  const units = PRICE_UNITS[input.key];
  if (!units) throw new Error("Unknown price");
  if (!units.includes(input.unit)) throw new Error(`${input.key} is priced ${units.join(" or ")}`);
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error("Give the amount, not negative");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom) || input.validFrom < today) throw new Error("A price applies from today or later");
  await pool.query(
    "insert into control.price_list (key, valid_from, unit, amount, set_by) values ($1, $2, $3, $4, $5) on conflict (key, valid_from) do update set unit = excluded.unit, amount = excluded.amount, set_by = excluded.set_by",
    [input.key, input.validFrom, input.unit, input.amount, userId],
  );
}

export interface Subscription {
  /** Prepaid yearly from this month on, or monthly (null). */
  yearlyFrom: string | null;
  paymentMethod: "sepa" | "card" | "transfer";
  accountHolder: string | null;
  mandateReference: string | null;
  accountLast4: string | null;
}

export async function getSubscription(pool: Pool, tenantId: string): Promise<Subscription> {
  const r = (await pool.query<{ yearly_from: string | null; payment_method: Subscription["paymentMethod"]; account_holder: string | null; mandate_reference: string | null; account_last4: string | null }>(
    "select to_char(yearly_from, 'YYYY-MM-DD') as yearly_from, payment_method, account_holder, mandate_reference, account_last4 from control.subscriptions where tenant_id = $1",
    [tenantId],
  )).rows[0];
  return r ? { yearlyFrom: r.yearly_from, paymentMethod: r.payment_method, accountHolder: r.account_holder, mandateReference: r.mandate_reference, accountLast4: r.account_last4 } : { yearlyFrom: null, paymentMethod: "sepa", accountHolder: null, mandateReference: null, accountLast4: null };
}

/**
 * The Owner's SEPA direct debit details. The account itself stays with the
 * payment provider: only the mandate reference and last digits are kept
 * here. Card payment comes with the provider's billing; bank transfer is set
 * by our support on request (chains).
 */
export async function setDirectDebit(pool: Pool, tenantId: string, input: { accountHolder: string; mandateReference: string; last4?: string }, userId: string): Promise<void> {
  if (!input.accountHolder.trim() || !input.mandateReference.trim()) throw new Error("A SEPA direct debit needs the account holder and the signed mandate");
  if (input.last4 && !/^\d{4}$/.test(input.last4)) throw new Error("Last four digits only");
  await pool.query(
    `insert into control.subscriptions (tenant_id, payment_method, account_holder, mandate_reference, account_last4, updated_at, updated_by) values ($1, 'sepa', $2, $3, $4, now(), $5)
     on conflict (tenant_id) do update set payment_method = 'sepa', account_holder = excluded.account_holder, mandate_reference = excluded.mandate_reference, account_last4 = excluded.account_last4, updated_at = now(), updated_by = excluded.updated_by`,
    [tenantId, input.accountHolder.trim(), input.mandateReference.trim(), input.last4 ?? null, userId],
  );
}

/** Our support allows payment by bank transfer for a customer (chains, on request), or takes it back to direct debit. */
export async function setBankTransfer(pool: Pool, tenantId: string, on: boolean, userId: string): Promise<void> {
  await pool.query(
    `insert into control.subscriptions (tenant_id, payment_method, updated_at, updated_by) values ($1, $2, now(), $3)
     on conflict (tenant_id) do update set payment_method = excluded.payment_method, updated_at = now(), updated_by = excluded.updated_by`,
    [tenantId, on ? "transfer" : "sepa", userId],
  );
}

/**
 * The Owner chooses yearly prepayment, from next month: the year's rooms are
 * invoiced then with the discount. Back to monthly only after a prepaid year.
 */
export async function setYearly(pool: Pool, tenantId: string, yearly: boolean, today: string, userId: string): Promise<void> {
  const current = await getSubscription(pool, tenantId);
  const next = `${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10)}`;
  if (yearly) {
    if (current.yearlyFrom) return;
    await pool.query(
      `insert into control.subscriptions (tenant_id, yearly_from, updated_at, updated_by) values ($1, $2, now(), $3)
       on conflict (tenant_id) do update set yearly_from = excluded.yearly_from, updated_at = now(), updated_by = excluded.updated_by`,
      [tenantId, next, userId],
    );
    return;
  }
  if (!current.yearlyFrom) return;
  // a prepaid year runs to its end: monthly again from its anniversary
  const months = (Number(next.slice(0, 4)) - Number(current.yearlyFrom.slice(0, 4))) * 12 + Number(next.slice(5, 7)) - Number(current.yearlyFrom.slice(5, 7));
  if (months > 0 && months % 12 !== 0) throw new Error("The prepaid year runs to its end; switch back to monthly in its last month");
  await pool.query("update control.subscriptions set yearly_from = null, updated_at = now(), updated_by = $2 where tenant_id = $1", [tenantId, userId]);
}

/** Usage passed on (SMS, WhatsApp): recorded when the message is sent; billed the month after at cost plus handling. */
export async function recordUsage(pool: Pool, tenantId: string, kind: string, quantity: number, cost: number, at = new Date(), propertyId: string | null = null): Promise<void> {
  await pool.query("insert into control.usage_events (tenant_id, kind, quantity, cost, at, property_id) values ($1, $2, $3, $4, $5, $6)", [tenantId, kind, quantity, cost, at, propertyId]);
}

export interface SubscriptionInvoiceRow {
  id: string;
  legalEntityId: string;
  month: string;
  number: string;
  gross: number;
  issuedAt: Date;
}

export async function listSubscriptionInvoices(pool: Pool, tenantId: string): Promise<SubscriptionInvoiceRow[]> {
  const { rows } = await pool.query<{ id: string; legal_entity_id: string; month: string; number: string; gross: string; issued_at: Date }>(
    "select id, legal_entity_id, to_char(month, 'YYYY-MM') as month, number, document -> 'totals' ->> 'gross' as gross, issued_at from control.subscription_invoices where tenant_id = $1 order by month desc, number desc",
    [tenantId],
  );
  return rows.map((r) => ({ id: r.id, legalEntityId: r.legal_entity_id, month: r.month, number: r.number, gross: Number(r.gross), issuedAt: r.issued_at }));
}

export async function subscriptionInvoiceFile(pool: Pool, tenantId: string, id: string, kind: "pdf" | "xml"): Promise<Buffer | string | null> {
  const r = (await pool.query<{ pdf: Buffer | null; xml: string | null }>("select pdf, xml from control.subscription_invoices where id = $1 and tenant_id = $2", [id, tenantId])).rows[0];
  return r ? (kind === "pdf" ? r.pdf : r.xml) : null;
}

async function inTransaction<T>(pool: Pool, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The next number of the platform's invoice range, inside the issuing transaction (row locked): a failed issue leaves no gap. */
async function nextNumber(tx: PoolClient, year: number): Promise<string> {
  const { rows } = await tx.query<{ last: number }>(
    "insert into control.counters (key, last) values ($1, 1) on conflict (key) do update set last = control.counters.last + 1 returning last",
    [`subscription:${year}`],
  );
  return `HS-${year}-${String(rows[0]!.last).padStart(5, "0")}`;
}

const EU_COUNTRIES = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];

function paymentNote(sub: Subscription): string {
  if (sub.paymentMethod === "sepa") return `SEPA direct debit, mandate ${sub.mandateReference ?? ""}`;
  if (sub.paymentMethod === "card") return `Charged to the card ending ${sub.accountLast4 ?? ""}`;
  return "Payable by bank transfer within 14 days";
}

/**
 * Issue a tenant's subscription invoices for a month: one per Legal Entity,
 * rooms counted on the 1st (kept, Out of Order rooms included), Modules
 * billed for the month, last month's usage at cost plus handling, the yearly
 * discount. Once per Legal Entity and month; returns the numbers issued.
 */
export async function issueSubscriptionInvoices(pool: Pool, tenant: Tenant, monthStart: string): Promise<string[]> {
  if (!/^\d{4}-\d{2}-01$/.test(monthStart)) throw new Error("A month starts on the 1st");
  const seller = (await pool.query<{ name: string; address_line1: string; postal_code: string; city: string; country: string; vat_id: string | null; tax_number: string | null; iban: string | null; bic: string | null; email: string; phone: string }>("select * from control.platform_seller")).rows[0];
  if (!seller) throw new Error("The platform's company is not set up");
  const prices = await pricesOn(pool, monthStart);
  const sub = await getSubscription(pool, tenant.id);
  // rooms on the 1st: counted once, then kept
  const entities = await withTenant(pool, tenant.schemaName, async (tx) => {
    const les = (await tx.query<{ id: string; name: string; address_line1: string; address_line2: string | null; postal_code: string; city: string; country: string; vat_id: string | null; tax_number: string | null }>(
      "select id, name, address_line1, address_line2, postal_code, city, country, vat_id, tax_number from legal_entities order by name",
    )).rows;
    const props = (await tx.query<{ id: string; name: string; legal_entity_id: string; rooms: number }>(
      "select p.id, p.name, p.legal_entity_id, (select count(*)::int from rooms r where r.property_id = p.id) as rooms from properties p order by p.name",
    )).rows;
    return { les, props };
  });
  for (const p of entities.props) {
    await pool.query("insert into control.room_counts (tenant_id, property_id, month, rooms) values ($1, $2, $3, $4) on conflict do nothing", [tenant.id, p.id, monthStart, p.rooms]);
  }
  const counted = new Map((await pool.query<{ property_id: string; rooms: number }>("select property_id, rooms from control.room_counts where tenant_id = $1 and month = $2", [tenant.id, monthStart])).rows.map((r) => [r.property_id, r.rooms]));
  const periods = await modulePeriods(pool, tenant.schemaName, entities.props.map((p) => p.id));
  // last month, by the platform's (Berlin) calendar
  const usage = (await pool.query<{ kind: string; quantity: number; cost: string }>(
    `select kind, sum(quantity)::int as quantity, sum(cost) as cost from control.usage_events
     where tenant_id = $1 and at >= (($2::date - interval '1 month')::timestamp at time zone 'Europe/Berlin') and at < ($2::date::timestamp at time zone 'Europe/Berlin') group by kind`,
    [tenant.id, monthStart],
  )).rows.map((u) => ({ kind: u.kind, quantity: u.quantity, cost: Number(u.cost) }));
  const issued: string[] = [];
  // the tenant's usage goes on the first invoice actually issued this month (once)
  let usageBilled = ((await pool.query("select 1 from control.subscription_invoices where tenant_id = $1 and month = $2", [tenant.id, monthStart])).rowCount ?? 0) > 0;
  for (const le of entities.les) {
    const exists = (await pool.query("select 1 from control.subscription_invoices where tenant_id = $1 and legal_entity_id = $2 and month = $3", [tenant.id, le.id, monthStart])).rowCount;
    if (exists) continue;
    const props = entities.props.filter((p) => p.legal_entity_id === le.id);
    if (!props.length) continue;
    const lines = subscriptionLines({ monthStart, properties: props.map((p) => ({ name: p.name, rooms: counted.get(p.id) ?? p.rooms, modules: periods.get(p.id) ?? ([] as ModulePeriod[]) })), usage: usageBilled ? [] : usage, prices, yearlyFrom: sub.yearlyFrom });
    // VAT by the place of supply: German VAT at home; reverse charge for an EU business with a VAT id; outside scope beyond the EU
    const abroad = le.country !== seller.country;
    const eu = EU_COUNTRIES.includes(le.country);
    if (abroad && eu && !le.vat_id) throw new Error(`${le.name} is in another EU country without a VAT id: reverse charge needs it`);
    const vatRate = abroad ? 0 : prices.vatRate;
    const zeroCategory = abroad ? (eu ? { code: "AE" as const, reason: "Reverse charge" } : { code: "O" as const, reason: "Not subject to VAT" }) : undefined;
    const monthEnd = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const invoiceLines: InvoiceLine[] = lines.map((l) => ({ description: l.description, taxCode: vatRate ? "STD" : "ZERO", rate: vatRate, quantity: l.quantity, unitGross: roundMoney(l.unitNet * (1 + vatRate / 100)), gross: roundMoney(l.net * (1 + vatRate / 100)), periodStart: monthStart, periodEnd: monthEnd }));
    const number = await inTransaction(pool, async (tx) => {
      const assigned = await nextNumber(tx, Number(monthStart.slice(0, 4)));
      const doc: InvoiceDocument = {
        kind: "final",
        number: assigned,
        issueDate: monthStart,
        dueDate: new Date(Date.parse(`${monthStart}T12:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10),
        currency: "EUR",
        language: le.country === "DE" || le.country === "AT" || le.country === "CH" ? "de" : "en",
        seller: { name: seller.name, addressLine1: seller.address_line1, addressLine2: "", postalCode: seller.postal_code, city: seller.city, country: seller.country, vatId: seller.vat_id, taxNumber: seller.tax_number, email: seller.email, phone: seller.phone, iban: seller.iban, bic: seller.bic, accountHolder: seller.name },
        buyer: { name: le.name, addressLine1: le.address_line1, addressLine2: le.address_line2 ?? "", postalCode: le.postal_code, city: le.city, country: le.country, vatId: le.vat_id, taxNumber: le.tax_number },
        reference: `Hoteloftware ${monthStart.slice(0, 7)} · ${tenant.slug}`,
        periodStart: monthStart,
        periodEnd: monthEnd,
        totals: invoiceTotals(invoiceLines),
        deposits: [],
        notes: [paymentNote(sub), ...(zeroCategory ? [zeroCategory.code === "AE" ? "Reverse charge: VAT is owed by the recipient (Art. 196 VAT Directive)." : "Not subject to German VAT (place of supply outside the EU)."] : [])],
        ...(zeroCategory ? { zeroCategory } : {}),
      };
      await tx.query("insert into control.subscription_invoices (tenant_id, legal_entity_id, month, number, document) values ($1, $2, $3, $4, $5)", [tenant.id, le.id, monthStart, assigned, JSON.stringify(doc)]);
      return { assigned, doc };
    }).catch((err: { code?: string }) => {
      // another run issued it meanwhile: nothing to do, no number used
      if (err.code === "23505") return null;
      throw err;
    });
    if (!number) continue;
    usageBilled = true;
    // the files after the number is taken, outside the counter's lock
    const [pdf, xml] = await Promise.all([invoicePdf(number.doc), invoiceXml(number.doc)]);
    await pool.query("update control.subscription_invoices set pdf = $2, xml = $3 where number = $1", [number.assigned, Buffer.from(pdf), xml]);
    issued.push(number.assigned);
  }
  return issued;
}
