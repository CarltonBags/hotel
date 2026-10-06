import { describe, expect, it } from "vitest";
import { CANTON_PRESETS, documentCopyAllowed, idCheckSignatureAllowed, tessinXmlProblems, registrationAtReception, registrationNeeds, registrationRetentionUntil, registrationComplete, tessinCsv, tessinXml, type TessinRecord } from "../src/registration";

const p = (id: string, role: "primary" | "spouse" | "partner" | "child" | "other", nationality: string, dateOfBirth: string | null = "1980-01-01") => ({ id, role, nationality, dateOfBirth });

describe("Switzerland: Canton Profiles (ticket 47)", () => {
  it("Zürich registers all guests; Graubünden foreign guests only (Bern, by its statute, all)", () => {
    const people = [p("a", "primary", "CH"), p("b", "other", "DE")];
    expect(registrationNeeds("CH", people, "2026-10-05", CANTON_PRESETS.ZH)).toEqual({ a: "own_form", b: "own_form" });
    expect(registrationNeeds("CH", people, "2026-10-05", CANTON_PRESETS.GR)).toEqual({ a: "none", b: "own_form" });
    expect(CANTON_PRESETS.BE.registers).toBe("all");
  });

  it("Tessin: a notification per adult; elsewhere spouse and minor children on the guest's form", () => {
    const fam = [p("h", "primary", "FR"), p("s", "spouse", "FR"), p("k", "child", "FR", "2015-05-05")];
    expect(registrationNeeds("CH", fam, "2026-10-05", CANTON_PRESETS.TI)).toEqual({ h: "own_form", s: "own_form", k: "counted" });
    expect(registrationNeeds("CH", fam, "2026-10-05", CANTON_PRESETS.LU)).toEqual({ h: "own_form", s: "counted", k: "counted" });
  });

  it("the ID Check stands in for the signature only where the canton confirmed it, never in Graubünden", () => {
    expect(idCheckSignatureAllowed({ canton: "GR", idCheckConfirmed: true })).toBe(false);
    expect(idCheckSignatureAllowed({ canton: "ZH" })).toBe(false);
    expect(idCheckSignatureAllowed({ canton: "ZH", idCheckConfirmed: true })).toBe(true);
  });

  it("one form per adult, couple or family", () => {
    const fam = [p("h", "primary", "FR"), p("s", "spouse", "FR"), p("k", "child", "FR", "2015-05-05"), p("t", "child", "FR", "2001-05-05")];
    expect(registrationNeeds("CH", fam, "2026-10-05", { ...CANTON_PRESETS.ZH, grouping: "adult" })).toEqual({ h: "own_form", s: "own_form", k: "counted", t: "own_form" });
    expect(registrationNeeds("CH", fam, "2026-10-05", { ...CANTON_PRESETS.ZH, grouping: "couple" })).toEqual({ h: "own_form", s: "counted", k: "counted", t: "own_form" });
    expect(registrationNeeds("CH", fam, "2026-10-05", { ...CANTON_PRESETS.ZH, grouping: "family" })).toEqual({ h: "own_form", s: "counted", k: "counted", t: "counted" });
  });

  it("Tessin keeps no copy of the identity document", () => {
    expect(documentCopyAllowed("CH", CANTON_PRESETS.TI)).toBe(false);
    expect(documentCopyAllowed("CH", CANTON_PRESETS.ZH)).toBe(true);
    expect(documentCopyAllowed("DE", null)).toBe(true);
    expect(documentCopyAllowed("FR", null)).toBe(false);
  });

  it("retention by canton: years, or Geneva's end of the following January", () => {
    expect(registrationRetentionUntil("CH", "2026-10-05", CANTON_PRESETS.GR)).toBe("2027-10-05");
    expect(registrationRetentionUntil("CH", "2026-10-05", CANTON_PRESETS.GE)).toBe("2027-02-01");
    expect(registrationRetentionUntil("CH", "2026-10-05", CANTON_PRESETS.TI)).toBe("2031-10-05");
  });

  it("a handwritten signature hands over to reception; ID Check alone completes where the canton allows it", () => {
    expect(registrationAtReception("CH", CANTON_PRESETS.ZH)).toBe(true);
    expect(registrationAtReception("CH", { ...CANTON_PRESETS.ZH, signature: "tablet" })).toBe(false);
    expect(registrationAtReception("DE", null)).toBe(true);
    expect(registrationComplete({ guestDone: true, confirmation: null, idChecked: true, signature: "id_check" })).toBe(true);
    expect(registrationComplete({ guestDone: true, confirmation: null, idChecked: true, signature: "handwritten" })).toBe(false);
  });

  it("Tessin's import formats: one XML per form, CSV for many", () => {
    const r: TessinRecord = { userId: "XNA9999", firstName: "Pallino", lastName: "Pinco", dateOfBirth: "1984-01-04", nationality: "CH", arrival: "2026-05-01", departure: "2026-05-02", placeOfBirth: "Zurigo", street: "Via Berna 11", postalCode: "6500", city: "Bellinzona", country: "CH", over14: 1, under14: 1, documentType: "passport", documentNumber: "faf3e23", carNumber: "TI383883", reference: "33fa" };
    expect(tessinXml(r)).toContain("<nationality>CHE</nationality>");
    expect(tessinXml(r)).toContain("<documentType>Passport</documentType>");
    expect(tessinXml({ ...r, firstName: "A & <B>" })).toContain("<firstname>A &amp; &lt;B&gt;</firstname>");
    // what the schema cannot take is named, not made up
    expect(tessinXmlProblems({ ...r, postalCode: "SW1A 1AA", dateOfBirth: "" })).toEqual(["date of birth", "postcode in digits"]);
    expect(() => tessinXml({ ...r, nationality: "" })).toThrow(/nationality/);
    expect(tessinCsv([{ ...r, lastName: "=HYPERLINK(1)" }]).split("\r\n")[1]).toContain(";'=HYPERLINK(1);");
    expect(tessinCsv([r])).toBe(
      "Id Struttura;Cognome;Nome;Data di nascita;Nazionalità;Data di arrivo;Data di partenza;Luogo di nascita;Numero bollettino;Indirizzo;CAP;Domicilio;Nazione;Numero autovettura;Mag14;Min14;Tipo documento;Numero documento\r\n" +
        "XNA9999;Pinco;Pallino;04.01.1984;CHE;01.05.2026;02.05.2026;Zurigo;33fa;Via Berna 11;6500;Bellinzona;CHE;TI383883;1;1;Passaporto;faf3e23\r\n",
    );
  });
});
