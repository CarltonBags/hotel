import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const FONT = readFileSync(fileURLToPath(new URL("../fonts/Inter.ttf", import.meta.url)));
const BOLD = readFileSync(fileURLToPath(new URL("../fonts/Inter-SemiBold.ttf", import.meta.url)));
const A4 = { w: 595.28, h: 841.89 };
const M = 45;
const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.42, 0.42, 0.45);

type Stay = { confirmationNumber: string; guestName: string; roomNumber?: string | null };
/** A closed Night Audit's report, as stored. */
export interface NightAuditReportDocument {
  property: { name: string; currency: string };
  businessDate: string;
  closedAt: string;
  closedBy: string;
  occupancy: { rooms: number; occupied: number; percent: number };
  arrivals: Stay[];
  departures: Stay[];
  noShows: (Stay & { fee: number; feeStatus: string | null; waiveReason: string | null })[];
  lateArrivals: Stay[];
  revenue: { service: string; taxCode: string; taxRate: number; gross: number }[];
  payments: { tender: string; amount: number; count: number }[];
  cityTax: { charged: number; absorbed: number; nights: number };
  openBalances: (Stay & { balance: number })[];
  expiringHolds: (Stay & { amount: number; expiresAt: string })[];
  changes: {
    voids: { confirmationNumber: string; description: string; amount: number; reason: string | null; userId: string }[];
    corrections: { confirmationNumber: string; description: string; amount: number; serviceDate: string; userId: string }[];
    priceOverrides: { confirmationNumber: string; reason: unknown; userId: string; approvedBy: string | null }[];
    refunds: { confirmationNumber: string; amount: number; tender: string; reason: string | null; userId: string; approvedBy: string | null }[];
    cancellationInvoices: { number: string; gross: number; reason: string | null; userId: string }[];
    approvals: { summary: string; status: string; requestedBy: string; decidedBy: string | null }[];
  };
  warnings: { incompleteRegistrations: (Stay & { missing: string[] })[]; arrivalsWithoutRoom: Stay[] };
}

const L = {
  de: {
    title: "Tagesabschluss",
    closed: "Abgeschlossen {at} von {by}",
    occupancy: "Belegung",
    rooms: "Zimmer belegt",
    arrivals: "Anreisen",
    departures: "Abreisen",
    noShows: "No-shows",
    fee: "Gebühr",
    waived: "erlassen",
    lateArrivals: "Späte Anreisen",
    revenue: "Umsatz nach Leistung und Steuerschlüssel (Leistungsdatum)",
    payments: "Zahlungen nach Zahlungsart",
    cityTax: "Beherbergungsabgabe",
    charged: "berechnet",
    absorbed: "vom Betrieb getragen",
    openBalances: "Offene Salden",
    expiringHolds: "Ablaufende Vorautorisierungen",
    voids: "Stornierte Buchungen",
    corrections: "Korrekturen",
    priceOverrides: "Preisänderungen",
    refunds: "Erstattungen",
    cancellationInvoices: "Stornorechnungen",
    approvals: "Freigaben",
    warnings: "Hinweise (übernommen)",
    registrations: "Meldedaten unvollständig",
    withoutRoom: "Anreisen morgen ohne Zimmer",
    none: "keine",
    total: "Summe",
    tenders: { card_terminal: "Karte (Terminal)", card_online: "Karte (online)", bank_transfer: "Überweisung", on_account: "Auf Rechnung", ota_virtual_card: "OTA-Kreditkarte", ota_collect: "Inkasso OTA", cash: "Bar", voucher: "Gutschein" } as Record<string, string>,
    page: "Seite",
  },
  en: {
    title: "Night Audit report",
    closed: "Closed {at} by {by}",
    occupancy: "Occupancy",
    rooms: "rooms occupied",
    arrivals: "Arrivals",
    departures: "Departures",
    noShows: "No-shows",
    fee: "fee",
    waived: "waived",
    lateArrivals: "Late Arrivals",
    revenue: "Revenue by Service and Tax Code (Service Date)",
    payments: "Payments by Tender",
    cityTax: "City Tax",
    charged: "charged",
    absorbed: "absorbed",
    openBalances: "Open balances",
    expiringHolds: "Card Holds expiring",
    voids: "Voids",
    corrections: "Corrections",
    priceOverrides: "Price Overrides",
    refunds: "Refunds",
    cancellationInvoices: "Cancellation invoices",
    approvals: "Approvals",
    warnings: "Warnings carried forward",
    registrations: "Incomplete registrations",
    withoutRoom: "Tomorrow's arrivals without room",
    none: "none",
    total: "Total",
    tenders: { card_terminal: "Card (terminal)", card_online: "Card (online)", bank_transfer: "Bank transfer", on_account: "On account", ota_virtual_card: "OTA virtual card", ota_collect: "Collected by OTA", cash: "Cash", voucher: "Voucher" } as Record<string, string>,
    page: "Page",
  },
};

/** The report of a closed Night Audit as PDF (the stored data is the record; the PDF is kept at first render). */
export async function renderNightAuditPdf(r: NightAuditReportDocument, language: "de" | "en", names: Record<string, string> = {}): Promise<Uint8Array> {
  const t = L[language];
  const locale = language === "de" ? "de-DE" : "en-GB";
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: r.property.currency }).format(n);
  const day = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const who = (id: string | null) => (id ? (names[id] ?? id) : "");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(FONT, { subset: false });
  const bold = await pdf.embedFont(BOLD, { subset: false });
  pdf.setTitle(`${t.title} ${r.businessDate}`);
  pdf.setCreationDate(new Date(r.closedAt));
  pdf.setModificationDate(new Date(r.closedAt));
  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const text = (s: string, x: number, size = 9, f: PDFFont = font, color = ink) => page.drawText(s, { x, y, size, font: f, color });
  const right = (s: string, x: number, size = 9, f: PDFFont = font) => page.drawText(s, { x: x - f.widthOfTextAtSize(s, size), y, size, font: f, color: ink });
  const fit = (s: string, width: number, size = 9) => {
    let out = s;
    while (out.length > 1 && font.widthOfTextAtSize(out, size) > width) out = out.slice(0, -1);
    return out === s ? s : `${out.slice(0, -1)}…`;
  };
  const need = (h: number) => {
    if (y - h < M + 20) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M;
    }
  };
  const heading = (s: string) => {
    need(36);
    y -= 12;
    text(s, M, 11, bold);
    y -= 15;
  };
  const line = (left: string, amount?: string | undefined) => {
    need(13);
    text(fit(left, amount ? 400 : A4.w - 2 * M), M);
    if (amount) right(amount, A4.w - M);
    y -= 13;
  };
  const list = <T>(title: string, rows: T[], render: (row: T) => [string, (string | undefined)?]) => {
    heading(`${title} (${rows.length})`);
    if (!rows.length) {
      text(t.none, M, 9, font, grey);
      y -= 13;
    }
    for (const row of rows) line(...render(row));
  };
  const stay = (s: Stay) => [s.confirmationNumber, s.roomNumber, s.guestName].filter(Boolean).join(" · ");

  text(r.property.name, M, 9, font, grey);
  y -= 22;
  text(`${t.title} · ${day(r.businessDate)}`, M, 15, bold);
  y -= 16;
  text(t.closed.replace("{at}", when(r.closedAt)).replace("{by}", who(r.closedBy)), M, 9, font, grey);
  y -= 6;

  heading(t.occupancy);
  line(`${r.occupancy.occupied} / ${r.occupancy.rooms} ${t.rooms}`, `${r.occupancy.percent.toFixed(1)} %`);
  list(t.arrivals, r.arrivals, (s) => [stay(s)]);
  list(t.departures, r.departures, (s) => [stay(s)]);
  list(t.noShows, r.noShows, (s) => [`${stay(s)}${s.feeStatus === "waived" ? ` · ${t.waived}: ${s.waiveReason ?? ""}` : ""}`, s.feeStatus === "confirmed" ? money(s.fee) : undefined]);
  list(t.lateArrivals, r.lateArrivals, (s) => [stay(s)]);
  list(t.revenue, r.revenue, (x) => [`${x.service} · ${x.taxCode} ${x.taxRate} %`, money(x.gross)]);
  if (r.revenue.length) line(t.total, money(r.revenue.reduce((s, x) => s + x.gross, 0)));
  const tender = (k: string) => t.tenders[k] ?? k;
  list(t.payments, r.payments, (x) => [`${tender(x.tender)} (${x.count})`, money(x.amount)]);
  heading(t.cityTax);
  line(`${t.charged}`, money(r.cityTax.charged));
  line(`${t.absorbed}`, money(r.cityTax.absorbed));
  list(t.openBalances, r.openBalances, (s) => [stay(s), money(s.balance)]);
  list(t.expiringHolds, r.expiringHolds, (s) => [`${stay(s)} · ${when(s.expiresAt)}`, money(s.amount)]);
  list(t.voids, r.changes.voids, (v) => [`${v.confirmationNumber} · ${v.description} · ${v.reason ?? ""} · ${who(v.userId)}`, money(v.amount)]);
  list(t.corrections, r.changes.corrections, (c) => [`${c.confirmationNumber} · ${c.description} · ${c.serviceDate} · ${who(c.userId)}`, money(c.amount)]);
  list(t.priceOverrides, r.changes.priceOverrides, (o) => [`${o.confirmationNumber} · ${String(o.reason ?? "")} · ${who(o.userId)}${o.approvedBy ? ` ✓ ${who(o.approvedBy)}` : ""}`]);
  list(t.refunds, r.changes.refunds, (x) => [`${x.confirmationNumber} · ${tender(x.tender)} · ${x.reason ?? ""} · ${who(x.userId)}${x.approvedBy ? ` ✓ ${who(x.approvedBy)}` : ""}`, money(x.amount)]);
  list(t.cancellationInvoices, r.changes.cancellationInvoices, (c) => [`${c.number} · ${c.reason ?? ""} · ${who(c.userId)}`, money(c.gross)]);
  list(t.approvals, r.changes.approvals, (a) => [`${a.summary} · ${a.status} · ${who(a.requestedBy)}${a.decidedBy ? ` → ${who(a.decidedBy)}` : ""}`]);
  heading(t.warnings);
  list(t.registrations, r.warnings.incompleteRegistrations, (s) => [`${stay(s)} · ${s.missing.join(", ")}`]);
  list(t.withoutRoom, r.warnings.arrivalsWithoutRoom, (s) => [stay(s)]);
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${t.page} ${i + 1} / ${pages.length}`, { x: A4.w - M - 50, y: M - 20, size: 7, font, color: grey }));
  return pdf.save({ useObjectStreams: false });
}
