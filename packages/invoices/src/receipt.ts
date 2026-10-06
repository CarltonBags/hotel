import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fonts } from "./fonts";

/** A Receipt as issued at the desk (ticket 50), as a small PDF (the exit export, ticket 89). */
export interface ReceiptDocument {
  number: number;
  issuedAt: Date;
  timeZone: string;
  propertyName: string;
  legalEntity: { name: string; addressLine1: string; postalCode: string; city: string; country: string; vatId: string | null };
  amount: number;
  currency: string;
  tender: string;
  cardBrand: string | null;
  cardLast4: string | null;
  refund: boolean;
  confirmationNumber: string;
  guestName: string;
}

export async function renderReceiptPdf(r: ReceiptDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fonts().regular, { subset: false });
  const bold = await pdf.embedFont(fonts().bold, { subset: false });
  // a receipt printer's width
  const page = pdf.addPage([226, 340]);
  let y = 315;
  const line = (s: string, size = 8, f = font) => {
    page.drawText(s, { x: 14, y, size, font: f, color: rgb(0.1, 0.1, 0.12) });
    y -= size + 5;
  };
  line(r.legalEntity.name, 9, bold);
  line(r.legalEntity.addressLine1);
  line(`${r.legalEntity.postalCode} ${r.legalEntity.city}`);
  if (r.legalEntity.vatId) line(`VAT ${r.legalEntity.vatId}`);
  line(r.propertyName);
  y -= 6;
  line(`${r.refund ? "Refund receipt" : "Receipt"} ${r.number}`, 11, bold);
  line(new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: r.timeZone }).format(r.issuedAt));
  line(`Booking ${r.confirmationNumber} · ${r.guestName}`);
  y -= 6;
  line(`${r.amount.toFixed(2)} ${r.currency}`, 14, bold);
  line(r.tender === "cash" ? "Cash" : `Card ${r.cardBrand ?? ""} ${r.cardLast4 ? `…${r.cardLast4}` : ""}`.trim());
  return pdf.save({ useObjectStreams: false });
}
