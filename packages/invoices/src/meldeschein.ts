import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fonts } from "./fonts";

const A4 = { w: 595.28, h: 841.89 };
const M = 50;
const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.42, 0.42, 0.45);

/** One person's Meldeschein as stored and printed (ticket 45; Switzerland ticket 47): the statutory fields only. */
export interface MeldescheinDocument {
  country: "DE" | "AT" | "CH";
  /** Switzerland: the canton and how it is confirmed (no signature line where the ID Check confirms). */
  canton?: string;
  signature?: Uint8Array | null;
  signatureMode?: "handwritten" | "tablet" | "id_check";
  property: { name: string; address: string };
  arrival: string;
  departure: string;
  person: { firstName: string; lastName: string; dateOfBirth: string | null; nationality: string; addressLine1: string; postalCode: string; city: string; country: string; documentNumber: string; placeOfBirth?: string; documentType?: string; carNumber?: string };
  companions: { role: string; name: string; nationality: string; dateOfBirth: string | null }[];
  /** PNG of the signature given on the tablet (Austria; Switzerland where the canton allows it). */
  /** "tablet", "paper:<who>", or "" while not yet confirmed (a form printed for signing). */
  confirmedBy: string;
  idCheck: string;
}

const L = {
  title: { DE: "Meldeschein für Beherbergungsstätten (§ 30 BMG)", AT: "Gästeblatt (§ 5 Meldegesetz)", CH: "Meldeschein / Fiche d'hôtel / Scheda di notifica (VZAE Art. 18)" },
  rows: [
    ["Familienname", "lastName"],
    ["Vorname(n)", "firstName"],
    ["Geburtsdatum", "dateOfBirth"],
    ["Staatsangehörigkeit", "nationality"],
    ["Anschrift", "addressLine1"],
    ["PLZ, Ort", "place"],
    ["Land", "country"],
    ["Reisedokument", "documentNumber"],
  ] as const,
};

export async function renderMeldescheinPdf(doc: MeldescheinDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fonts().regular, { subset: false });
  const bold = await pdf.embedFont(fonts().bold, { subset: false });
  const page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const text = (s: string, x: number, size = 10, f = font, color = ink) => page.drawText(s, { x, y, size, font: f, color });
  text(`${doc.property.name} · ${doc.property.address}`, M, 9, font, grey);
  y -= 26;
  text(L.title[doc.country], M, doc.country === "CH" ? 12 : 15, bold);
  if (doc.canton) {
    y -= 14;
    text(`Kanton / Canton: ${doc.canton}`, M, 9, font, grey);
  }
  y -= 28;
  text(`Anreise / Arrival: ${doc.arrival}    Abreise / Departure: ${doc.departure}`, M);
  y -= 26;
  const p = doc.person;
  const value = (k: (typeof L.rows)[number][1]) => (k === "place" ? `${p.postalCode} ${p.city}`.trim() : (p[k] ?? "") || "");
  const DOCUMENT_TYPES: Record<string, string> = { passport: "Pass / Passport", id_card: "Identitätskarte / ID card", other: "Anderes / Other", "": "" };
  // Switzerland's federal minimum adds place of birth and the document's type; Tessin the car's number
  const rows: [string, string][] = L.rows.map(([label, key]) => [label, value(key)]);
  if (doc.country === "CH") {
    rows.splice(3, 0, ["Geburtsort / Place of birth", p.placeOfBirth ?? ""]);
    rows.push(["Dokumenttyp / Document type", DOCUMENT_TYPES[p.documentType ?? ""] ?? ""]);
    if (p.carNumber) rows.push(["Fahrzeug / Car", p.carNumber]);
  }
  for (const [label, shown] of rows) {
    text(label, M, 9, font, grey);
    text(shown, M + 150, 11);
    page.drawLine({ start: { x: M + 148, y: y - 4 }, end: { x: A4.w - M, y: y - 4 }, thickness: 0.4, color: grey });
    y -= 24;
  }
  if (doc.companions.length) {
    y -= 8;
    text(doc.country === "AT" ? "Mitreisende minderjährige Kinder" : "Mitreisende Ehegatten, Lebenspartner und Kinder / Accompanying spouse, partner and children", M, 9, bold);
    y -= 16;
    text(`Anzahl / Number: ${doc.companions.length}`, M);
    y -= 14;
    for (const c of doc.companions) {
      // Germany: number and nationality only; Austria lists the children
      text(doc.country === "DE" ? `${c.role}: ${c.nationality}` : `${c.name} · ${c.dateOfBirth ?? ""} · ${c.nationality}`, M + 10);
      y -= 14;
    }
  }
  y -= 30;
  if (doc.signatureMode === "id_check") {
    text("Ohne Unterschrift, Angaben mit dem Ausweis verglichen / No signature, details checked against the ID", M, 9, font, grey);
    y -= 20;
    if (doc.idCheck) text("ID Check recorded", M, 8, font, grey);
    return pdf.save({ useObjectStreams: false });
  }
  text("Unterschrift / Signature", M, 9, font, grey);
  if (doc.signature?.length) {
    try {
      const img = await pdf.embedPng(doc.signature);
      const scale = Math.min(220 / img.width, 70 / img.height);
      page.drawImage(img, { x: M + 150, y: y - 10, width: img.width * scale, height: img.height * scale });
    } catch {
      text("(signature image unreadable)", M + 150, 9, font, grey);
    }
  }
  page.drawLine({ start: { x: M + 148, y: y - 14 }, end: { x: A4.w - M, y: y - 14 }, thickness: 0.4, color: grey });
  y -= 40;
  const confirmed = doc.confirmedBy === "tablet" ? "Signed on the tablet" : doc.confirmedBy.startsWith("paper:") ? "Signed on paper at the desk" : "";
  if (confirmed) text(confirmed, M, 8, font, grey);
  if (doc.idCheck) {
    y -= 12;
    text("ID Check recorded", M, 8, font, grey);
  }
  return pdf.save({ useObjectStreams: false });
}
