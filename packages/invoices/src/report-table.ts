import { formatCell, type ReportTable } from "@hoteloftware/domain";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { csvCell } from "./csv";
import { fonts } from "./fonts";

// landscape A4: reports are wide
const PAGE = { w: 841.89, h: 595.28 };
const M = 36;
const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.42, 0.42, 0.45);
const rule = rgb(0.85, 0.85, 0.87);

/** A fixed report (ticket 82) as PDF: title, its notes (period, properties, base, rates), the table with repeated headings, page numbers. */
export async function renderReportPdf(table: ReportTable, language: "de" | "en", footer: string): Promise<Uint8Array> {
  const locale = language === "de" ? "de-DE" : "en-GB";
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fonts().regular, { subset: false });
  const bold = await pdf.embedFont(fonts().bold, { subset: false });
  pdf.setTitle(table.title);
  const size = table.columns.length > 9 ? 6.5 : 7.5;
  // the first column takes what its texts need (at most a third), the figures share the rest
  const firstWidth = Math.min(
    (PAGE.w - 2 * M) / 3,
    Math.max(70, ...table.rows.map((r) => font.widthOfTextAtSize(formatCell(r.cells[table.columns[0]!.key] ?? null, table.columns[0]!.kind, locale), size) + 8)),
  );
  const rest = (PAGE.w - 2 * M - firstWidth) / Math.max(1, table.columns.length - 1);
  const right = (i: number) => M + firstWidth + rest * i;
  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M;
  const fit = (s: string, width: number, f: PDFFont, sz: number) => {
    let out = s;
    while (out.length > 1 && f.widthOfTextAtSize(out, sz) > width - 4) out = `${out.slice(0, -2)}…`;
    return out;
  };
  const heading = () => {
    // headings wrap onto two lines when long
    const lines = table.columns.map((c, i) => {
      const width = i === 0 ? firstWidth : rest;
      const words = c.label.split(" ");
      const first: string[] = [];
      while (words.length && bold.widthOfTextAtSize([...first, words[0]].join(" "), size) < width - 4) first.push(words.shift()!);
      return [first.join(" ") || fit(c.label, width, bold, size), fit(words.join(" "), width, bold, size)];
    });
    for (const line of [0, 1]) {
      table.columns.forEach((c, i) => {
        const s = lines[i]![line]!;
        if (!s) return;
        if (i === 0) page.drawText(s, { x: M, y, size, font: bold, color: grey });
        else page.drawText(s, { x: right(i) - bold.widthOfTextAtSize(s, size), y, size, font: bold, color: grey });
      });
      y -= size + 3;
    }
    page.drawLine({ start: { x: M, y: y + size - 1 }, end: { x: PAGE.w - M, y: y + size - 1 }, thickness: 0.5, color: rule });
    y -= 3;
  };
  page.drawText(table.title, { x: M, y, size: 14, font: bold, color: ink });
  y -= 18;
  for (const n of table.notes) {
    page.drawText(fit(n, PAGE.w - 2 * M, font, 7.5), { x: M, y, size: 7.5, font, color: grey });
    y -= 10;
  }
  y -= 8;
  heading();
  for (const row of table.rows) {
    if (y < M + 20) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - M;
      heading();
    }
    const f = row.emphasis ? bold : font;
    table.columns.forEach((c, i) => {
      const s = formatCell(row.cells[c.key] ?? null, c.kind, locale);
      if (i === 0) page.drawText(fit(s, firstWidth, f, size), { x: M, y, size, font: f, color: ink });
      else {
        const t = fit(s, rest, f, size);
        page.drawText(t, { x: right(i) - f.widthOfTextAtSize(t, size), y, size, font: f, color: ink });
      }
    });
    y -= size + 4;
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(footer, { x: M, y: M - 18, size: 6.5, font, color: grey });
    const n = `${i + 1} / ${pages.length}`;
    p.drawText(n, { x: PAGE.w - M - font.widthOfTextAtSize(n, 6.5), y: M - 18, size: 6.5, font, color: grey });
  });
  return pdf.save({ useObjectStreams: false });
}

/** The report as a spreadsheet file (CSV, semicolon separated, UTF-8 with BOM): notes first, then the table with plain numbers. */
export function reportCsv(table: ReportTable): string {
  const lines: (string | number)[][] = [
    [table.title],
    ...table.notes.map((n) => [n]),
    [],
    table.columns.map((c) => c.label),
    ...table.rows.map((r) => table.columns.map((c) => {
      const v = r.cells[c.key];
      return v === null || v === undefined ? "" : v;
    })),
  ];
  return `﻿${lines.map((l) => l.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
