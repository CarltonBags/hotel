import { fonts } from "./fonts";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const A4 = { w: 595.28, h: 841.89 };
const M = 45;
const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.42, 0.42, 0.45);

/** The City Tax filing report of a property for a period, as the database computes it. */
export interface CityTaxReportDocument {
  property: { name: string; currency: string };
  rule: { name: string } | null;
  from: string;
  to: string;
  totals: { nights: number; personNights: number; taxedPersonNights: number; base: number; tax: number; charged: number; absorbed: number };
  exempt: Record<string, number | undefined>;
  exemptions: { reservationId: string; confirmationNumber: string; guestName: string; person: number; reason: string; note: string; documentName: string | null; nights: number }[];
  stays: { reservationId: string; confirmationNumber: string; guestName: string; arrival: string; departure: string; nights: number; persons: number; base: number; tax: number; absorbed: boolean }[];
}

const L = {
  de: {
    title: "Beherbergungsabgabe: Meldung",
    period: "Zeitraum",
    rule: "Regel",
    noRule: "keine Regel",
    nights: "Übernachtungen (Zimmernächte)",
    personNights: "Personennächte",
    taxedPersonNights: "davon abgabepflichtig",
    base: "Bemessungsgrundlage (netto)",
    tax: "Abgabe",
    charged: "davon an Gäste berechnet",
    absorbed: "davon vom Betrieb getragen",
    exemptTitle: "Befreite Personennächte nach Grund",
    exemptionsTitle: "Befreiungen mit Nachweis",
    staysTitle: "Gästeliste mit Aufenthaltsdauer",
    guest: "Gast",
    booking: "Buchung",
    stay: "Aufenthalt",
    persons: "Pers.",
    reason: "Grund",
    evidence: "Nachweis",
    person: "Person",
    none: "keine",
    absorbedMark: "* vom Betrieb getragen, nicht an den Gast berechnet",
    page: "Seite",
    reasons: { age: "Alter", business_travel: "Dienstreise", resident: "Einwohner", disability: "Behinderung", long_stay: "Langzeitaufenthalt", student: "Studium/Ausbildung", other: "Sonstiges", night_cap: "über Höchstzahl Nächte" } as Record<string, string>,
  },
  en: {
    title: "City Tax filing report",
    period: "Period",
    rule: "Rule",
    noRule: "no rule",
    nights: "Room nights",
    personNights: "Person-nights",
    taxedPersonNights: "of which taxed",
    base: "Base (net)",
    tax: "Tax",
    charged: "of which charged to guests",
    absorbed: "of which absorbed",
    exemptTitle: "Exempt person-nights by reason",
    exemptionsTitle: "Exemptions with evidence",
    staysTitle: "Guest list with length of stay",
    guest: "Guest",
    booking: "Booking",
    stay: "Stay",
    persons: "Pers.",
    reason: "Reason",
    evidence: "Evidence",
    person: "Person",
    none: "none",
    absorbedMark: "* absorbed by the hotel, not charged to the guest",
    page: "Page",
    reasons: { age: "Age", business_travel: "Business travel", resident: "Resident", disability: "Disability", long_stay: "Long stay", student: "Student or trainee", other: "Other", night_cap: "Beyond the night cap" } as Record<string, string>,
  },
};

/** The filing report as PDF: totals, exempt nights by reason, exemptions with their evidence, and the guest list. */
export async function renderCityTaxReportPdf(r: CityTaxReportDocument, language: "de" | "en"): Promise<Uint8Array> {
  const t = L[language];
  const locale = language === "de" ? "de-DE" : "en-GB";
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: r.property.currency }).format(n);
  const day = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fonts().regular, { subset: false });
  const bold = await pdf.embedFont(fonts().bold, { subset: false });
  pdf.setTitle(`${t.title} ${r.from} – ${r.to}`);
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
    need(40);
    y -= 14;
    text(s, M, 11, bold);
    y -= 16;
  };

  text(r.property.name, M, 9, font, grey);
  y -= 22;
  text(t.title, M, 16, bold);
  y -= 22;
  text(`${t.period}: ${day(r.from)} – ${day(r.to)}`, M);
  y -= 13;
  text(`${t.rule}: ${r.rule?.name ?? t.noRule}`, M);
  y -= 10;

  heading(t.tax);
  const rows: [string, string][] = [
    [t.nights, String(r.totals.nights)],
    [t.personNights, String(r.totals.personNights)],
    [t.taxedPersonNights, String(r.totals.taxedPersonNights)],
    [t.base, money(r.totals.base)],
    [t.tax, money(r.totals.tax)],
    [t.charged, money(r.totals.charged)],
    [t.absorbed, money(r.totals.absorbed)],
  ];
  for (const [k, v] of rows) {
    text(k, M);
    right(v, M + 300, 9, k === t.tax ? bold : font);
    y -= 13;
  }

  heading(t.exemptTitle);
  const exempt = Object.entries(r.exempt).filter(([, v]) => v);
  if (!exempt.length) {
    text(t.none, M, 9, font, grey);
    y -= 13;
  }
  for (const [k, v] of exempt) {
    text(t.reasons[k] ?? k, M);
    right(String(v), M + 300);
    y -= 13;
  }

  heading(t.exemptionsTitle);
  if (!r.exemptions.length) {
    text(t.none, M, 9, font, grey);
    y -= 13;
  }
  for (const e of r.exemptions) {
    need(14);
    text(fit(`${e.confirmationNumber} · ${e.guestName}`, 170), M);
    text(`${t.person} ${e.person + 1}`, M + 175);
    text(fit(t.reasons[e.reason] ?? e.reason, 95), M + 225);
    text(fit([e.note, e.documentName].filter(Boolean).join(" · ") || "–", 160), M + 325);
    right(String(e.nights), A4.w - M);
    y -= 13;
  }

  heading(t.staysTitle);
  const cols = { booking: M, guest: M + 55, stay: M + 215, nights: M + 360, persons: M + 395, base: M + 460, tax: A4.w - M };
  const head = () => {
    text(t.booking, cols.booking, 7.5, font, grey);
    text(t.guest, cols.guest, 7.5, font, grey);
    text(t.stay, cols.stay, 7.5, font, grey);
    right("#", cols.nights, 7.5);
    right(t.persons, cols.persons, 7.5);
    right(t.base, cols.base, 7.5);
    right(t.tax, cols.tax, 7.5);
    y -= 12;
  };
  head();
  for (const s of r.stays) {
    if (y - 14 < M + 20) {
      need(1000);
      head();
    }
    text(s.confirmationNumber, cols.booking);
    text(fit(s.guestName, 155), cols.guest);
    text(`${day(s.arrival)} – ${day(s.departure)}`, cols.stay);
    right(String(s.nights), cols.nights);
    right(String(s.persons), cols.persons);
    right(money(s.base), cols.base);
    right(`${money(s.tax)}${s.absorbed ? "*" : ""}`, cols.tax);
    y -= 13;
  }
  if (r.stays.some((s) => s.absorbed)) {
    y -= 4;
    text(t.absorbedMark, M, 7.5, font, grey);
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${t.page} ${i + 1} / ${pages.length}`, { x: A4.w - M - 50, y: M - 20, size: 7, font, color: grey }));
  return pdf.save({ useObjectStreams: false });
}

/** The filing report as CSV (semicolon separated, decimal point), one row per stay. */
export function cityTaxReportCsv(r: CityTaxReportDocument): string {
  const q = (v: string | number) => {
    const s = String(v);
    // a leading formula character is neutralised so spreadsheets never run it
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const lines = [["booking", "guest", "arrival", "departure", "nights", "persons", "base", "tax", "absorbed", "exemptions"].join(";")];
  for (const s of r.stays) {
    const ex = r.exemptions.filter((e) => e.reservationId === s.reservationId).map((e) => `${e.person + 1}:${e.reason}`).join(" ");
    lines.push([s.confirmationNumber, s.guestName, s.arrival, s.departure, s.nights, s.persons, s.base.toFixed(2), s.tax.toFixed(2), s.absorbed ? "yes" : "no", ex].map(q).join(";"));
  }
  return `${lines.join("\r\n")}\r\n`;
}
