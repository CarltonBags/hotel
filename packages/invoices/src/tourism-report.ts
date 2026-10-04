import { fonts } from "./fonts";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const A4 = { w: 595.28, h: 841.89 };
const M = 45;
const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.42, 0.42, 0.45);

/** The official tourism statistics of a property and month, as the database computes or froze them. */
export interface TourismReportDocument {
  variant: "DE" | "AT" | "CH";
  month: string;
  property: { name: string; identity: string };
  rows: { key: string; label: { de: string; en: string }; arrivals: number; nights: number }[];
  totals: { arrivals: number; nights: number };
  capacity: { bedPlaces: number; extraBeds: number; rooms: number; openingDays: number; roomDaysOffered: number; roomDaysOccupied: number; takingsPerPersonNight: number | null };
  /** Set for a submitted version. */
  version?: number;
  submittedAt?: string;
}

const FORM = { DE: "Monatliche Beherbergungsstatistik (Fragebogen HOT)", AT: "Nächtigungsstatistik (Betriebsbogen F-B1/2)", CH: "Beherbergungsstatistik HESTA" };

/** The rows of the official form that the report fills: capacity first, then persons by residence. */
function capacityRows(r: TourismReportDocument): [string, string][] {
  const c = r.capacity;
  const rows: [string, string][] = [
    ["Öffnungstage im Monat / Opening days", String(c.openingDays)],
    ["Angebotene Schlafgelegenheiten (letzter Öffnungstag) / Bed places", String(c.bedPlaces)],
    ["Zusatzbetten / Extra beds", String(c.extraBeds)],
    ["Gästezimmer / Guest rooms", String(c.rooms)],
  ];
  if (r.variant === "DE" && c.rooms >= 25) rows.push(["Angebotene Zimmertage / Room days offered", String(c.roomDaysOffered)], ["Belegte Zimmertage / Room days occupied", String(c.roomDaysOccupied)]);
  if (r.variant === "CH") rows.push(["Belegte Zimmer (Zimmernächte) / Occupied rooms", String(c.roomDaysOccupied)], ["Ø Einnahmen pro Person und Nacht / Takings per person and night", c.takingsPerPersonNight === null ? "–" : c.takingsPerPersonNight.toFixed(2)]);
  return rows;
}

export async function renderTourismReportPdf(r: TourismReportDocument, language: "de" | "en"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fonts().regular, { subset: false });
  const bold = await pdf.embedFont(fonts().bold, { subset: false });
  pdf.setTitle(`${FORM[r.variant]} ${r.month}`);
  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const text = (s: string, x: number, size = 9, f: PDFFont = font, color = ink) => page.drawText(s, { x, y, size, font: f, color });
  const right = (s: string, x: number, size = 9, f: PDFFont = font) => page.drawText(s, { x: x - f.widthOfTextAtSize(s, size), y, size, font: f, color: ink });
  const need = (h: number) => {
    if (y - h < M + 20) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M;
    }
  };
  text(r.property.name, M, 9, font, grey);
  y -= 22;
  text(FORM[r.variant], M, 15, bold);
  y -= 20;
  text(`${language === "de" ? "Berichtsmonat" : "Month"}: ${r.month}`, M);
  y -= 13;
  text(`${language === "de" ? "Statistische Kennung" : "Statistical identity"}: ${r.property.identity || "–"}`, M);
  y -= 13;
  if (r.version) {
    text(`${language === "de" ? "Gemeldet (Version" : "Submitted (version"} ${r.version}): ${r.submittedAt ?? ""}`, M);
    y -= 13;
  }
  y -= 8;
  for (const [k, v] of capacityRows(r)) {
    text(k, M);
    right(v, A4.w - M);
    y -= 13;
  }
  y -= 10;
  text(r.variant === "AT" ? "Herkunft / Origin" : "Wohnsitz der Gäste (nicht Staatsangehörigkeit) / Country of residence", M, 9, bold);
  right(language === "de" ? "Ankünfte" : "Arrivals", A4.w - M - 80, 9, bold);
  right(language === "de" ? "Übernachtungen" : "Nights", A4.w - M, 9, bold);
  y -= 14;
  for (const row of r.rows) {
    need(13);
    text(row.label[language], M);
    right(String(row.arrivals), A4.w - M - 80);
    right(String(row.nights), A4.w - M);
    y -= 12;
  }
  need(16);
  y -= 4;
  text(language === "de" ? "Insgesamt" : "Total", M, 9, bold);
  right(String(r.totals.arrivals), A4.w - M - 80, 9, bold);
  right(String(r.totals.nights), A4.w - M, 9, bold);
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: A4.w - M - 20, y: M - 20, size: 7, font, color: grey }));
  return pdf.save({ useObjectStreams: false });
}

const cell = (v: string | number) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The report as a spreadsheet file (CSV, semicolon separated, UTF-8 with BOM), in the form's order. */
export function tourismReportCsv(r: TourismReportDocument): string {
  const lines: (string | number)[][] = [
    [FORM[r.variant]],
    ["Berichtsmonat", r.month],
    ["Betrieb", r.property.name],
    ["Statistische Kennung", r.property.identity],
    ...(r.version ? [["Version", r.version], ["Gemeldet", r.submittedAt ?? ""]] : []),
    [],
    ...capacityRows(r),
    [],
    ["Zeile", "Herkunft / Wohnsitz", "Ankünfte", "Übernachtungen"],
    ...r.rows.map((row) => [row.key, row.label.de, row.arrivals, row.nights]),
    ["total", "Insgesamt", r.totals.arrivals, r.totals.nights],
  ];
  return `﻿${lines.map((l) => l.map(cell).join(";")).join("\r\n")}\r\n`;
}
