import type { Pool } from "pg";
import { zipSync } from "fflate";
import { invoicePdf, invoiceXml, renderReceiptPdf, type InvoiceDocument } from "@hoteloftware/invoices";
import { allReceiptsIn } from "./cash";
import { withTenant } from "./with-tenant";

/**
 * The exit export (ticket 89): everything the hotel must keep or may take to
 * another system, in open formats, standing alone. Spreadsheet files with
 * their columns documented in README.md; every invoice as issued (PDF with
 * its e-invoice, and XRechnung); registration records still within their
 * retention. One zip file.
 */
const TABLES: { file: string; about: string; sql: string }[] = [
  {
    file: "reservations.csv",
    about: "One line per reservation: confirmation number, status, stay, room type, Rate Plan, primary guest id, persons, Source and channel, made and cancelled.",
    sql: `select b.confirmation_number, r.id as reservation_id, p.name as property, r.status, r.arrival, r.departure, t.code as room_type, rp.code as rate_plan, r.primary_guest_id as guest_id,
            r.adults, coalesce(array_length(r.child_ages, 1), 0) as children, b.source, coalesce(b.channel_name, '') as channel, r.created_at, r.cancelled_at
          from reservations r join bookings b on b.id = r.booking_id join properties p on p.id = r.property_id join room_types t on t.id = r.room_type_id join rate_plans rp on rp.id = r.rate_plan_id
          order by r.arrival, b.confirmation_number`,
  },
  {
    file: "guests.csv",
    about: "One line per guest profile: names, date and place of birth, nationality, country of residence, address, contacts, language, travel document, marketing consent.",
    sql: `select id as guest_id, salutation, first_name, last_name, date_of_birth, place_of_birth, nationality, country_of_residence, address_line1, address_line2, postal_code, city, region,
            email, phone, language, document_type, document_number, document_country, document_expiry, marketing_consent, created_at from guests order by last_name, first_name`,
  },
  {
    file: "companies.csv",
    about: "One line per Company: name, VAT id, address, billing contact, payment terms, on account.",
    sql: `select id as company_id, name, vat_id, address_line1, address_line2, postal_code, city, country, billing_email, phone, contact_person, payment_terms_days, on_account, buyer_reference from companies order by name`,
  },
  {
    file: "folios.csv",
    about: "One line per folio: number, reservation, who it is billed to (guest or Company), charges and payments so far, opened.",
    sql: `select f.number as folio, f.reservation_id, f.bill_to_guest_id, f.bill_to_company_id, co.name as company,
            (select coalesce(sum(c.amount), 0) from charges c where c.folio_id = f.id and c.voided_at is null) as charges,
            (select coalesce(sum(p.amount), 0) from payments p where p.folio_id = f.id and p.status = 'succeeded') as payments, f.created_at
          from folios f left join companies co on co.id = f.bill_to_company_id order by f.created_at`,
  },
  {
    file: "folio_charges.csv",
    about: "One line per Charge on a folio: folio number, reservation, Service Date, Business Date, description, quantity, amount (gross), Tax Code and rate, voided, invoice.",
    sql: `select f.number as folio, c.reservation_id, c.service_date, c.business_date, c.description, c.quantity, c.unit_price, c.amount, tc.code as tax_code, c.tax_rate, c.category,
            c.voided_at, c.void_reason, i.number as invoice
          from charges c join folios f on f.id = c.folio_id join tax_codes tc on tc.id = c.tax_code_id left join invoices i on i.id = c.invoice_id order by c.service_date, f.number`,
  },
  {
    file: "payments.csv",
    about: "One line per payment or refund: Business Date, reservation, folio, Tender, amount, currency, status, reference, card brand and last digits (no card numbers exist), invoice.",
    sql: `select p.business_date, p.reservation_id, f.number as folio, p.tender, p.amount, p.currency, p.status, p.reference, p.card_brand, p.card_last4, i.number as invoice, p.posted_at
          from payments p left join folios f on f.id = p.folio_id left join invoices i on i.id = p.invoice_id order by p.posted_at`,
  },
  {
    file: "receipts.csv",
    about: "One line per Receipt as issued at the desk: property, number, payment, issued at.",
    sql: `select p.name as property, r.number, r.payment_id, r.issued_at from receipts r join properties p on p.id = r.property_id order by p.name, r.number`,
  },
  {
    file: "invoices.csv",
    about: "One line per invoice as issued: number, kind, issue date, gross, open amount, the file names in invoices/.",
    sql: `select number, kind, issue_date, gross, due, currency, cancels, issued_at from invoices where not test order by issue_date, number`,
  },
];

function csvValue(v: unknown): string {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(",") : String(v);
  // a formula is neutralised; numbers and phone numbers ("+49 30 …") stay as they are
  const safe = /^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s()./-]+$/.test(s) ? `'${s}` : s;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export async function exitExport(pool: Pool, schema: string, tenantName: string): Promise<{ zip: Uint8Array; counts: Record<string, number> }> {
  const files: Record<string, Uint8Array> = {};
  const counts: Record<string, number> = {};
  const enc = new TextEncoder();
  const data = await withTenant(pool, schema, async (tx) => {
    const tables = [] as { file: string; about: string; fields: string[]; rows: Record<string, unknown>[] }[];
    for (const t of TABLES) {
      const r = await tx.query(t.sql);
      tables.push({ file: t.file, about: t.about, fields: r.fields.map((f) => f.name), rows: r.rows });
    }
    const invoices = (await tx.query<{ number: string; document: InvoiceDocument; pdf: Buffer | null; xml: string | null }>("select number, document, pdf, xml from invoices where not test order by issue_date, number")).rows;
    const registrations = (await tx.query<{ id: string; pdf: Buffer }>("select id, pdf from registration_persons where pdf is not null")).rows;
    return { tables, invoices, registrations, receipts: await allReceiptsIn(tx) };
  });
  const readme: string[] = [`# Data export · ${tenantName}`, "", `Made ${new Date().toISOString()}. Spreadsheet files are UTF-8 with a BOM, semicolon separated, one header line.`, ""];
  for (const t of data.tables) {
    files[t.file] = enc.encode(`﻿${[t.fields.join(";"), ...t.rows.map((r) => t.fields.map((f) => csvValue(r[f])).join(";"))].join("\r\n")}\r\n`);
    counts[t.file] = t.rows.length;
    readme.push(`## ${t.file}`, "", t.about, "", `Columns: ${t.fields.join(", ")}`, "");
  }
  // every invoice as issued: the kept files, else rendered from the frozen document (the same document, the same file)
  for (const i of data.invoices) {
    const safe = i.number.replace(/[^\w.-]/g, "_");
    files[`invoices/${safe}.pdf`] = i.pdf ? new Uint8Array(i.pdf) : await invoicePdf(i.document);
    files[`invoices/${safe}.xml`] = enc.encode(i.xml ?? (await invoiceXml(i.document)));
  }
  counts.invoices = data.invoices.length;
  for (const r of data.receipts) files[`receipts/${r.propertyName.replace(/[^\w.-]/g, "_")}-${r.number}.pdf`] = await renderReceiptPdf(r);
  counts.receipts = data.receipts.length;
  for (const r of data.registrations) files[`registrations/${r.id}.pdf`] = new Uint8Array(r.pdf);
  counts.registrations = data.registrations.length;
  readme.push(
    "## invoices/",
    "",
    "Every invoice as issued: <number>.pdf (ZUGFeRD / Factur-X, the e-invoice embedded) and <number>.xml (XRechnung). Keep them for the statutory period.",
    "",
    "## receipts/",
    "",
    "Every Receipt as issued at the desk: <property>-<number>.pdf.",
    "",
    "## registrations/",
    "",
    "Registration records (Meldescheine) still within their retention, as signed.",
    "",
    "## Not in this export",
    "",
    "Fiscal exports (TSE, RKSV) come with the fiscal module. Card numbers are never stored; payments carry the card brand and last digits only.",
    "",
  );
  files["README.md"] = enc.encode(readme.join("\n"));
  return { zip: zipSync(files, { level: 6 }), counts };
}
