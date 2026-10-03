import { InvoiceService, type Invoice } from "@e-invoice-eu/core";
import type { InvoiceDocument, Party } from "./document";

const money = (n: number) => n.toFixed(2);
type Currency = Invoice["ubl:Invoice"]["cbc:DocumentCurrencyCode"];
type TaxSchemes = Invoice["ubl:Invoice"]["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyTaxScheme"];

function address(p: Party) {
  return {
    "cbc:StreetName": p.addressLine1 || "-",
    ...(p.addressLine2 ? { "cbc:AdditionalStreetName": p.addressLine2 } : {}),
    "cbc:CityName": p.city || "-",
    "cbc:PostalZone": p.postalCode || "-",
    "cac:Country": { "cbc:IdentificationCode": p.country as never },
  };
}

/** The seller: VAT ID (scheme VAT) and tax number (scheme FC, Steuernummer), contact for questions. */
function seller(p: Party) {
  const schemes = [
    ...(p.vatId ? [{ "cbc:CompanyID": p.vatId, "cac:TaxScheme": { "cbc:ID": "VAT" } }] : []),
    ...(p.taxNumber ? [{ "cbc:CompanyID": p.taxNumber, "cac:TaxScheme": { "cbc:ID": "FC" } }] : []),
  ] as TaxSchemes;
  return {
    "cac:Party": {
      "cac:PostalAddress": address(p),
      ...(schemes?.length ? { "cac:PartyTaxScheme": schemes } : {}),
      "cac:PartyLegalEntity": { "cbc:RegistrationName": p.name },
      // only real contact data; XRechnung, which requires it, refuses without
      ...(p.email || p.phone ? { "cac:Contact": { "cbc:Name": p.name, ...(p.phone ? { "cbc:Telephone": p.phone } : {}), ...(p.email ? { "cbc:ElectronicMail": p.email } : {}) } } : {}),
    },
  };
}

function buyer(p: Party) {
  return {
    "cac:Party": {
      "cac:PostalAddress": address(p),
      ...(p.vatId ? { "cac:PartyTaxScheme": { "cbc:CompanyID": p.vatId, "cac:TaxScheme": { "cbc:ID": "VAT" as const } } } : {}),
      "cac:PartyLegalEntity": { "cbc:RegistrationName": p.name },
    },
  };
}

/**
 * The invoice in the EN16931 data model (UBL-shaped, as e-invoice-eu takes
 * it). A deposit invoice is a prepayment invoice (386); a final invoice
 * refers to its deposit invoices and shows them as paid in advance.
 */
export function toEn16931(doc: InvoiceDocument): Invoice {
  const t = doc.totals;
  const cur = doc.currency as Currency;
  const amount = (n: number) => money(n);
  const lines = t.lines.map((l, i) => ({
    "cbc:ID": String(i + 1),
    "cbc:InvoicedQuantity": String(l.quantity),
    "cbc:InvoicedQuantity@unitCode": "C62" as const,
    "cbc:LineExtensionAmount": amount(l.net),
    "cbc:LineExtensionAmount@currencyID": cur,
    "cac:InvoicePeriod": { "cbc:StartDate": l.periodStart, "cbc:EndDate": l.periodEnd },
    "cac:Item": {
      "cbc:Name": l.description,
      "cac:ClassifiedTaxCategory": { "cbc:ID": (l.rate > 0 ? "S" : "Z") as "S", "cbc:Percent": String(l.rate), "cac:TaxScheme": { "cbc:ID": "VAT" as const } },
    },
    // the net unit price follows from the line's net share; four decimals keep quantity × price close to the line
    "cac:Price": { "cbc:PriceAmount": (l.net / l.quantity).toFixed(4), "cbc:PriceAmount@currencyID": cur },
  }));
  const paidInAdvance = Math.round((t.depositsGross + t.paid) * 100) / 100;
  // EN16931 computes VAT per rate from the net (BR-S-09); prices here are gross, so the cent it may differ by is the rounding amount
  const rates = mergeRates(t.byTax).map((x) => ({ ...x, vat: Math.round(((x.net * x.rate) / 100) * 100) / 100 }));
  const vat = Math.round(rates.reduce((s, x) => s + x.vat, 0) * 100) / 100;
  const inclusive = Math.round((t.net + vat) * 100) / 100;
  const rounding = Math.round((t.gross - inclusive) * 100) / 100;
  return {
    "ubl:Invoice": {
      "cbc:CustomizationID": "urn:cen.eu:en16931:2017",
      "cbc:ID": doc.number,
      "cbc:IssueDate": doc.issueDate,
      ...(doc.dueDate && t.due > 0 ? { "cbc:DueDate": doc.dueDate } : {}),
      "cbc:InvoiceTypeCode": doc.kind === "deposit" ? "386" : "380",
      ...(doc.notes.length ? { "cbc:Note": doc.notes } : {}),
      "cbc:DocumentCurrencyCode": cur,
      "cbc:BuyerReference": doc.reference,
      "cac:InvoicePeriod": { "cbc:StartDate": doc.periodStart, "cbc:EndDate": doc.periodEnd },
      ...(doc.deposits.length
        ? { "cac:BillingReference": doc.deposits.map((d) => ({ "cac:InvoiceDocumentReference": { "cbc:ID": d.number, "cbc:IssueDate": d.issueDate } })) }
        : {}),
      "cac:AccountingSupplierParty": seller(doc.seller),
      "cac:AccountingCustomerParty": buyer(doc.buyer),
      // CII needs the delivery block: the stay's last service day
      "cac:Delivery": { "cbc:ActualDeliveryDate": doc.periodEnd },
      ...(doc.seller.iban
        ? {
            "cac:PaymentMeans": [
              {
                "cbc:PaymentMeansCode": "58",
                "cbc:PaymentID": doc.number,
                "cac:PayeeFinancialAccount": { "cbc:ID": doc.seller.iban.replace(/\s+/g, ""), ...(doc.seller.accountHolder ? { "cbc:Name": doc.seller.accountHolder } : {}) },
              },
            ],
          }
        : {}),
      "cac:TaxTotal": [
        {
          "cbc:TaxAmount": amount(vat),
          "cbc:TaxAmount@currencyID": cur,
          "cac:TaxSubtotal": rates.map((x) => ({
            "cbc:TaxableAmount": amount(x.net),
            "cbc:TaxableAmount@currencyID": cur,
            "cbc:TaxAmount": amount(x.vat),
            "cbc:TaxAmount@currencyID": cur,
            "cac:TaxCategory": { "cbc:ID": (x.rate > 0 ? "S" : "Z") as "S", "cbc:Percent": String(x.rate), "cac:TaxScheme": { "cbc:ID": "VAT" as const } },
          })),
        },
      ],
      "cac:LegalMonetaryTotal": {
        "cbc:LineExtensionAmount": amount(t.net),
        "cbc:LineExtensionAmount@currencyID": cur,
        "cbc:TaxExclusiveAmount": amount(t.net),
        "cbc:TaxExclusiveAmount@currencyID": cur,
        "cbc:TaxInclusiveAmount": amount(inclusive),
        "cbc:TaxInclusiveAmount@currencyID": cur,
        ...(paidInAdvance ? { "cbc:PrepaidAmount": amount(paidInAdvance), "cbc:PrepaidAmount@currencyID": cur } : {}),
        ...(rounding ? { "cbc:PayableRoundingAmount": amount(rounding), "cbc:PayableRoundingAmount@currencyID": cur } : {}),
        "cbc:PayableAmount": amount(t.due),
        "cbc:PayableAmount@currencyID": cur,
      },
      "cac:InvoiceLine": lines as never,
    },
  } as Invoice;
}

/** EN16931 groups VAT by category and rate: Tax Codes with the same rate share one breakdown. */
function mergeRates(parts: { rate: number; net: number; vat: number }[]) {
  const by = new Map<number, { rate: number; net: number; vat: number }>();
  for (const p of parts) {
    const r = by.get(p.rate) ?? { rate: p.rate, net: 0, vat: 0 };
    r.net = Math.round((r.net + p.net) * 100) / 100;
    r.vat = Math.round((r.vat + p.vat) * 100) / 100;
    by.set(p.rate, r);
  }
  return [...by.values()].sort((a, b) => a.rate - b.rate);
}

const quiet = { log: () => undefined, warn: () => undefined, error: (m: unknown) => console.error(m) };

/** The ZUGFeRD / Factur-X PDF (EN16931 profile): the visual PDF with the XML embedded, PDF/A-3. */
export async function facturX(doc: InvoiceDocument, visualPdf: Uint8Array): Promise<Uint8Array> {
  const out = await new InvoiceService(quiet).generate(toEn16931(doc), {
    format: "Factur-X-EN16931",
    lang: doc.language === "de" ? "de-de" : "en-gb",
    pdf: { buffer: visualPdf, filename: `${doc.number}.pdf`, mimetype: "application/pdf" },
  });
  return typeof out === "string" ? new TextEncoder().encode(out) : out;
}

/** XRechnung (CII) XML for public-sector buyers, on request; it needs the seller's contact (BR-DE-2). */
export async function xrechnung(doc: InvoiceDocument): Promise<string> {
  if (!doc.seller.email || !doc.seller.phone) throw new Error("XRechnung needs the Legal Entity's invoice email and phone (Settings → Legal Entities)");
  const out = await new InvoiceService(quiet).generate(toEn16931(doc), { format: "XRechnung-CII", lang: doc.language === "de" ? "de-de" : "en-gb" });
  return typeof out === "string" ? out : new TextDecoder().decode(out);
}
