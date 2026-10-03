import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { InvoiceDocument } from "./document";
import { LABELS } from "./labels";

/** Inter (SIL Open Font License), embedded so the PDF meets PDF/A. */
const FONT = readFileSync(fileURLToPath(new URL("../fonts/Inter.ttf", import.meta.url)));
const BOLD = readFileSync(fileURLToPath(new URL("../fonts/Inter-SemiBold.ttf", import.meta.url)));

const A4 = { w: 595.28, h: 841.89 };
const M = 50;
const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.42, 0.42, 0.45);
const rule = rgb(0.85, 0.85, 0.87);

/**
 * The human-readable invoice (UStG §14 contents): issuer and recipient with
 * addresses and VAT IDs, number and date, service period, the services with
 * quantity and price, net, VAT and gross per rate, deposits deducted with
 * their VAT, the amount due and payment details.
 */
export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  const L = LABELS[doc.language];
  const locale = doc.language === "de" ? "de-DE" : "en-GB";
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: doc.currency }).format(n);
  const num = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  const day = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const fill = (t: string, v: Record<string, string>) => Object.entries(v).reduce((s, [k, x]) => s.replaceAll(`{${k}}`, x), t);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(FONT, { subset: false });
  const bold = await pdf.embedFont(BOLD, { subset: false });
  pdf.setTitle(`${doc.kind === "deposit" ? L.deposit : L.final} ${doc.number}`);
  pdf.setAuthor(doc.seller.name);
  pdf.setLanguage(doc.language === "de" ? "de-DE" : "en-GB");

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const text = (s: string, x: number, size = 9, color = ink, f: PDFFont = font) => page.drawText(s, { x, y, size, font: f, color });
  const right = (s: string, x: number, size = 9, color = ink, f: PDFFont = font) => page.drawText(s, { x: x - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  const line = () => page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4.w - M, y: y + 4 }, thickness: 0.5, color: rule });
  const newPageIfNeeded = (room: number) => {
    if (y - room > M + 60) return;
    footer(page);
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
  };
  const footer = (p: PDFPage) => {
    const s = doc.seller;
    const parts = [
      `${s.name} · ${[s.addressLine1, s.addressLine2].filter(Boolean).join(", ")} · ${s.postalCode} ${s.city}`,
      [s.vatId ? `${L.vatId} ${s.vatId}` : "", s.taxNumber ? `${L.taxNumber} ${s.taxNumber}` : "", s.iban ? `${L.bank}: ${s.accountHolder ?? s.name}, IBAN ${s.iban}${s.bic ? `, BIC ${s.bic}` : ""}` : ""]
        .filter(Boolean)
        .join(" · "),
    ];
    parts.forEach((t, i) => p.drawText(t, { x: M, y: M - 10 - i * 10, size: 7, font, color: grey }));
  };

  // issuer, top right
  const sellerLines = [doc.seller.name, doc.seller.addressLine1, doc.seller.addressLine2, `${doc.seller.postalCode} ${doc.seller.city}`].filter(Boolean);
  for (const s of sellerLines) {
    right(s, A4.w - M, 9, grey);
    y -= 12;
  }
  // recipient
  y = A4.h - M - 90;
  page.drawText(`${doc.seller.name} · ${doc.seller.addressLine1} · ${doc.seller.postalCode} ${doc.seller.city}`, { x: M, y: y + 14, size: 6.5, font, color: grey });
  for (const s of [doc.buyer.name, doc.buyer.addressLine1, doc.buyer.addressLine2, `${doc.buyer.postalCode} ${doc.buyer.city}`.trim(), doc.buyer.country]) {
    if (!s) continue;
    text(s, M, 10);
    y -= 13;
  }
  if (doc.buyer.vatId) {
    text(`${L.vatId} ${doc.buyer.vatId}`, M, 8, grey);
    y -= 12;
  }

  // title and facts
  y = A4.h - M - 210;
  text(doc.kind === "deposit" ? L.deposit : L.final, M, 16, ink, bold);
  y -= 24;
  const facts: [string, string][] = [
    [L.number, doc.number],
    [L.date, day(doc.issueDate)],
    doc.kind === "deposit" && doc.receivedOn ? [L.received, day(doc.receivedOn)] : [L.period, `${day(doc.periodStart)} – ${day(doc.periodEnd)}`],
    [L.reference, doc.reference],
  ];
  for (const [k, v] of facts) {
    text(k, M, 9, grey);
    text(v, M + 120, 9);
    y -= 13;
  }
  y -= 14;

  // services
  const col = { qty: M, item: M + 40, tax: A4.w - M - 175, unit: A4.w - M - 75, amount: A4.w - M };
  text(L.qty, col.qty, 8, grey);
  text(L.item, col.item, 8, grey);
  right(L.tax, col.tax + 30, 8, grey);
  right(L.unit, col.unit, 8, grey);
  right(L.amount, col.amount, 8, grey);
  y -= 6;
  line();
  y -= 12;
  for (const l of doc.totals.lines) {
    newPageIfNeeded(28);
    text(num(l.quantity), col.qty);
    text(l.description, col.item);
    right(`${num(l.rate)} %`, col.tax + 30);
    right(money(l.unitGross), col.unit);
    right(money(l.gross), col.amount);
    y -= 11;
    text(l.periodStart === l.periodEnd ? day(l.periodStart) : `${day(l.periodStart)} – ${day(l.periodEnd)}`, col.item, 7.5, grey);
    y -= 14;
  }
  line();
  y -= 14;
  newPageIfNeeded(40);
  text(L.total, col.item, 10, ink, bold);
  right(money(doc.totals.gross), col.amount, 10, ink, bold);
  y -= 22;

  // VAT per rate
  newPageIfNeeded(30 + doc.totals.byTax.length * 13);
  text(L.taxBreakdown, col.item, 8, grey);
  right(L.net, col.tax + 30, 8, grey);
  right(L.vat, col.unit, 8, grey);
  right(L.gross, col.amount, 8, grey);
  y -= 13;
  for (const t of doc.totals.byTax) {
    text(`${t.taxCode} ${num(t.rate)} %`, col.item);
    right(money(t.net), col.tax + 30);
    right(money(t.vat), col.unit);
    right(money(t.gross), col.amount);
    y -= 13;
  }
  y -= 8;

  // deposits with their VAT, payments, what remains
  for (const d of doc.deposits) {
    newPageIfNeeded(30);
    const gross = d.byTax.reduce((s, x) => s + x.gross, 0);
    const vat = d.byTax.reduce((s, x) => s + x.vat, 0);
    text(fill(L.lessDeposit, { number: d.number, date: day(d.issueDate) }), col.item);
    right(`- ${money(gross)}`, col.amount);
    y -= 11;
    text(`${L.ofWhichVat} ${d.byTax.map((x) => `${x.taxCode} ${num(x.rate)} %: ${money(x.vat)}`).join(", ")} (${money(vat)})`, col.item, 7.5, grey);
    y -= 14;
  }
  if (doc.totals.paid) {
    text(L.paid, col.item);
    right(`- ${money(doc.totals.paid)}`, col.amount);
    y -= 14;
  }
  line();
  y -= 14;
  text(L.due, col.item, 11, ink, bold);
  right(money(doc.totals.due), col.amount, 11, ink, bold);
  y -= 18;
  text(doc.totals.due > 0 && doc.dueDate ? fill(L.dueBy, { date: day(doc.dueDate) }) : L.settled, col.item, 9, grey);
  y -= 16;
  for (const n of doc.notes) {
    newPageIfNeeded(14);
    text(n, col.item, 8, grey);
    y -= 12;
  }
  footer(page);
  // page numbers
  const pages = pdf.getPages();
  if (pages.length > 1) pages.forEach((p, i) => p.drawText(`${L.page} ${i + 1} / ${pages.length}`, { x: A4.w - M - 50, y: M - 30, size: 7, font, color: grey }));
  return pdf.save({ useObjectStreams: false });
}
