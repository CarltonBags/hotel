import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReminderDocument } from "./document";
import { LABELS } from "./labels";

const FONT = readFileSync(fileURLToPath(new URL("../fonts/Inter.ttf", import.meta.url)));
const BOLD = readFileSync(fileURLToPath(new URL("../fonts/Inter-SemiBold.ttf", import.meta.url)));
const A4 = { w: 595.28, h: 841.89 };
const M = 50;
const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.42, 0.42, 0.45);

/** A reminder letter (levels 1 to 3) with the open invoices and the Legal Entity's footer. */
export async function renderReminderPdf(doc: ReminderDocument): Promise<Uint8Array> {
  const L = LABELS[doc.language];
  const locale = doc.language === "de" ? "de-DE" : "en-GB";
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: doc.currency }).format(n);
  const day = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(FONT, { subset: false });
  const bold = await pdf.embedFont(BOLD, { subset: false });
  const issued = new Date(`${doc.issueDate}T12:00:00Z`);
  pdf.setCreationDate(issued);
  pdf.setModificationDate(issued);
  const title = L[`reminderTitle${doc.level}`];
  pdf.setTitle(title);
  const page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const t = (s: string, x: number, size = 10, color = ink, f = font) => page.drawText(s, { x, y, size, font: f, color });
  const right = (s: string, x: number, size = 10) => page.drawText(s, { x: x - font.widthOfTextAtSize(s, size), y, size, font, color: ink });
  const s = doc.seller;
  for (const line of [s.name, s.addressLine1, s.addressLine2, `${s.postalCode} ${s.city}`].filter(Boolean)) {
    page.drawText(line, { x: A4.w - M - font.widthOfTextAtSize(line, 9), y, size: 9, font, color: grey });
    y -= 12;
  }
  y = A4.h - M - 90;
  for (const line of [doc.buyer.name, doc.buyer.addressLine1, doc.buyer.addressLine2, `${doc.buyer.postalCode} ${doc.buyer.city}`.trim(), doc.buyer.country]) {
    if (!line) continue;
    t(line, M);
    y -= 13;
  }
  y = A4.h - M - 210;
  right(day(doc.issueDate), A4.w - M, 9);
  t(title, M, 16, ink, bold);
  y -= 30;
  t(L.reminderGreeting, M);
  y -= 16;
  // the letter's paragraphs wrap at the page width
  const paragraph = (s: string, size: number, color = ink) => {
    let line = "";
    for (const word of s.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > A4.w - 2 * M && line) {
        t(line, M, size, color);
        y -= size + 4;
        line = word;
      } else line = next;
    }
    if (line) t(line, M, size, color);
  };
  paragraph(L[`reminderText${doc.level}`].replace("{date}", day(doc.payBy)), 10);
  y -= 28;
  t(L.invoiceCol, M, 8, grey);
  t(L.date, M + 160, 8, grey);
  t(L.dueCol, M + 270, 8, grey);
  right(L.openCol, A4.w - M, 8);
  y -= 14;
  for (const i of doc.invoices) {
    t(i.number, M);
    t(day(i.issueDate), M + 160);
    t(day(i.dueDate), M + 270);
    right(money(i.open), A4.w - M);
    y -= 14;
  }
  y -= 6;
  t(L.totalOpen, M, 11, ink, bold);
  const total = money(doc.invoices.reduce((a, i) => a + i.open, 0));
  page.drawText(total, { x: A4.w - M - bold.widthOfTextAtSize(total, 11), y, size: 11, font: bold, color: ink });
  y -= 30;
  paragraph(L.reminderClosing, 9, grey);
  y -= 20;
  t(L.reminderRegards, M, 9, grey);
  y -= 14;
  t(s.name, M, 9, grey);
  // the Legal Entity's footer, as on its invoices
  const footer = [
    `${s.name} · ${[s.addressLine1, s.addressLine2].filter(Boolean).join(", ")} · ${s.postalCode} ${s.city}`,
    [s.vatId ? `${L.vatId} ${s.vatId}` : "", s.taxNumber ? `${L.taxNumber} ${s.taxNumber}` : "", s.iban ? `${L.bank}: ${s.accountHolder ?? s.name}, IBAN ${s.iban}${s.bic ? `, BIC ${s.bic}` : ""}` : ""].filter(Boolean).join(" · "),
  ];
  footer.forEach((f, i) => page.drawText(f, { x: M, y: M - 10 - i * 10, size: 7, font, color: grey }));
  return pdf.save({ useObjectStreams: false });
}
