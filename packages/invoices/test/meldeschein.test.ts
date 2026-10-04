import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { renderMeldescheinPdf } from "../src/meldeschein";

describe("Meldeschein PDF", () => {
  it("renders the Austrian form with the signature image", async () => {
    // a tiny PNG made with pdf-lib's own encoder is not available: build one by hand (1×1, black)
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const bytes = await renderMeldescheinPdf({
      country: "AT",
      property: { name: "Haus am Ring", address: "Ring 1, 1010 Wien" },
      arrival: "2026-10-05",
      departure: "2026-10-07",
      person: { firstName: "Aiko", lastName: "Brandt", dateOfBirth: "1988-04-12", nationality: "DE", addressLine1: "Ringstraße 5", postalCode: "1010", city: "Wien", country: "AT", documentNumber: "C01X00T47" },
      companions: [{ role: "child", name: "Lea Brandt", nationality: "DE", dateOfBirth: "2016-01-01" }],
      signature: png,
      confirmedBy: "tablet",
      idCheck: "user_frida",
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // the signature is drawn as an image object
    expect(Buffer.from(bytes).toString("latin1")).toContain("/Subtype /Image");
  });
});
