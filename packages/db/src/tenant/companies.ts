import type { Pool } from "pg";
import { ROUTING_CATEGORIES, isOneOf, type RoutingCategory } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/** Companies: booker or bill-to with billing data, payment terms and default Routing Rules (folio domain model). */
export interface CompanyData {
  name: string;
  vatId: string | null;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string | null;
  billingEmail: string | null;
  phone: string | null;
  contactPerson: string;
  /** Days until an invoice is due. */
  paymentTermsDays: number;
  /** Invoices may be issued unpaid and become Receivables. */
  onAccount: boolean;
  /** Default Routing Rules: charge categories that go to the Company's folio. */
  routing: RoutingCategory[];
  notes: string;
  active: boolean;
}

export interface Company extends CompanyData {
  id: string;
}

const EMPTY: CompanyData = {
  name: "",
  vatId: null,
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  city: "",
  country: null,
  billingEmail: null,
  phone: null,
  contactPerson: "",
  paymentTermsDays: 14,
  onAccount: false,
  routing: [],
  notes: "",
  active: true,
};

const COLUMNS: Record<keyof CompanyData, string> = {
  name: "name",
  vatId: "vat_id",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  postalCode: "postal_code",
  city: "city",
  country: "country",
  billingEmail: "billing_email",
  phone: "phone",
  contactPerson: "contact_person",
  paymentTermsDays: "payment_terms_days",
  onAccount: "on_account",
  routing: "routing",
  notes: "notes",
  active: "active",
};
const FIELDS = Object.keys(COLUMNS) as (keyof CompanyData)[];
const SELECT = `select id, ${FIELDS.map((f) => COLUMNS[f]).join(", ")} from companies`;

function toCompany(r: Record<string, unknown>): Company {
  const c = { id: r.id } as Company;
  for (const f of FIELDS) {
    const v = r[COLUMNS[f]];
    (c as unknown as Record<string, unknown>)[f] = typeof v === "string" ? v.trimEnd() : v;
  }
  return c;
}

function clean(d: CompanyData): CompanyData {
  const opt = (v: string | null) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  const name = d.name.trim();
  if (!name) throw new Error("Company name is required");
  const country = opt(d.country)?.toUpperCase() ?? null;
  if (country !== null && !/^[A-Z]{2}$/.test(country)) throw new Error("Countries are two-letter codes");
  if (!Number.isInteger(d.paymentTermsDays) || d.paymentTermsDays < 0 || d.paymentTermsDays > 365) throw new Error("Payment terms are 0 to 365 days");
  if (!Array.isArray(d.routing) || d.routing.some((r) => !isOneOf(ROUTING_CATEGORIES, r))) throw new Error("Unknown routing category");
  const billingEmail = opt(d.billingEmail);
  if (billingEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) throw new Error("Billing email looks wrong");
  return {
    ...d,
    name,
    vatId: opt(d.vatId),
    addressLine1: d.addressLine1.trim(),
    addressLine2: d.addressLine2.trim(),
    postalCode: d.postalCode.trim(),
    city: d.city.trim(),
    country,
    billingEmail,
    phone: opt(d.phone),
    contactPerson: d.contactPerson.trim(),
    routing: [...new Set(d.routing)],
    notes: d.notes.trim(),
  };
}

export async function createCompany(pool: Pool, schema: string, input: Partial<CompanyData> & { name: string }, ctx: { userId: string }): Promise<Company> {
  const d = clean({ ...EMPTY, ...input });
  return withTenant(pool, schema, async (tx) => {
    const cols = [...FIELDS.map((f) => COLUMNS[f]), "created_by"];
    const { rows } = await tx.query(`insert into companies (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning ${FIELDS.map((f) => COLUMNS[f]).join(", ")}, id`, [
      ...FIELDS.map((f) => d[f]),
      ctx.userId,
    ]);
    return toCompany(rows[0]!);
  });
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? null : Array.isArray(v) ? v.join(",") || null : String(v));

export async function updateCompany(pool: Pool, schema: string, id: string, patch: Partial<CompanyData>, ctx: { userId: string }): Promise<Company> {
  if (!isUuid(id)) throw new Error("Company not found");
  return withTenant(pool, schema, async (tx) => {
    const cur = await tx.query(`${SELECT} where id = $1 for update`, [id]);
    if (!cur.rows[0]) throw new Error("Company not found");
    const before = toCompany(cur.rows[0]);
    const d = clean({ ...before, ...patch });
    for (const f of FIELDS.filter((f) => show(before[f]) !== show(d[f]))) {
      await tx.query("insert into company_changes (company_id, user_id, field, old_value, new_value) values ($1, $2, $3, $4, $5)", [id, ctx.userId, f, show(before[f]), show(d[f])]);
    }
    const { rows } = await tx.query(`update companies set ${FIELDS.map((f, i) => `${COLUMNS[f]} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1 returning id, ${FIELDS.map((f) => COLUMNS[f]).join(", ")}`, [
      id,
      ...FIELDS.map((f) => d[f]),
    ]);
    return toCompany(rows[0]!);
  });
}

export async function findCompany(pool: Pool, schema: string, id: string): Promise<Company | null> {
  if (!isUuid(id)) return null;
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(`${SELECT} where id = $1`, [id]);
    return rows[0] ? toCompany(rows[0]) : null;
  });
}

/** Tenant-wide search by name, VAT ID or city; empty query lists active Companies. */
export async function searchCompanies(pool: Pool, schema: string, query: string, limit = 50): Promise<Company[]> {
  const q = query.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `${SELECT} where ($1 = '' and active) or ($1 <> '' and (lower(name) like '%' || $1 || '%' or lower(coalesce(vat_id, '')) like '%' || $1 || '%' or lower(city) like '%' || $1 || '%'))
       order by lower(name) limit ${Math.min(limit, 200)}`,
      [q],
    );
    return rows.map(toCompany);
  });
}

/** Every Company, active or not, by name: for pickers that must show a Company already attached. */
export async function listCompanyNames(pool: Pool, schema: string): Promise<{ id: string; name: string; active: boolean }[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string; active: boolean }>("select id, name, active from companies order by lower(name)");
    return rows;
  });
}

export interface CompanyChange {
  userId: string;
  at: Date;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export async function companyHistory(pool: Pool, schema: string, companyId: string): Promise<CompanyChange[]> {
  if (!isUuid(companyId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ user_id: string; at: Date; field: string; old_value: string | null; new_value: string | null }>(
      "select user_id, at, field, old_value, new_value from company_changes where company_id = $1 order by at desc limit 200",
      [companyId],
    );
    return rows.map((r) => ({ userId: r.user_id, at: r.at, field: r.field, oldValue: r.old_value, newValue: r.new_value }));
  });
}
