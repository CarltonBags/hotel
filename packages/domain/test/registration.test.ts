import { describe, expect, it } from "vitest";
import { registrationComplete, registrationDeletionDue, registrationNeeds, type RegistrationPerson } from "../src/registration";

const p = (id: string, role: RegistrationPerson["role"], nationality: string, dateOfBirth: string | null = "1980-01-01"): RegistrationPerson => ({ id, role, nationality, dateOfBirth });

describe("who registers how", () => {
  it("Germany: a German national needs no form", () => {
    expect(registrationNeeds("DE", [p("a", "primary", "DE")], "2026-10-05")).toEqual({ a: "none" });
  });

  it("Germany: a foreign family fills one form, spouse and minor children counted on it", () => {
    const family = [p("a", "primary", "JP"), p("b", "spouse", "JP"), p("c", "child", "JP", "2015-03-01"), p("d", "child", "JP", "2000-01-01"), p("e", "other", "FR")];
    expect(registrationNeeds("DE", family, "2026-10-05")).toEqual({ a: "own_form", b: "counted", c: "counted", d: "own_form", e: "own_form" });
  });

  it("Germany: with a German primary guest, a foreign spouse heads the form", () => {
    expect(registrationNeeds("DE", [p("a", "primary", "DE"), p("b", "spouse", "US"), p("c", "child", "US", "2018-01-01")], "2026-10-05")).toEqual({ a: "none", b: "own_form", c: "counted" });
  });

  it("Austria: everyone registers; minors on a parent's form", () => {
    expect(registrationNeeds("AT", [p("a", "primary", "AT"), p("b", "partner", "DE"), p("c", "child", "AT", "2012-05-05"), p("d", "other", "IT")], "2026-10-05")).toEqual({ a: "own_form", b: "own_form", c: "counted", d: "own_form" });
  });

  it("a child turning 18 during the stay counts as a minor on arrival", () => {
    expect(registrationNeeds("AT", [p("a", "primary", "AT"), p("c", "child", "AT", "2008-10-06")], "2026-10-05").c).toBe("counted");
    expect(registrationNeeds("AT", [p("a", "primary", "AT"), p("c", "child", "AT", "2008-10-05")], "2026-10-05").c).toBe("own_form");
  });
});

describe("keeping and completing", () => {
  it("German records go from day 365 after departure; Austrian ones after 7 years", () => {
    expect(registrationDeletionDue("DE", "2025-09-01", "2026-08-31")).toBe(false);
    expect(registrationDeletionDue("DE", "2025-09-01", "2026-09-01")).toBe(true);
    expect(registrationDeletionDue("DE", "2025-09-01", "2026-10-06")).toBe(true); // day 400
    expect(registrationDeletionDue("AT", "2025-09-01", "2026-10-06")).toBe(false);
    expect(registrationDeletionDue("AT", "2025-09-01", "2032-09-01")).toBe(true);
  });

  it("complete only with the guest's part, a confirmation and the ID Check", () => {
    expect(registrationComplete({ guestDone: true, confirmation: "tablet_signature", idChecked: false })).toBe(false);
    expect(registrationComplete({ guestDone: true, confirmation: null, idChecked: true })).toBe(false);
    expect(registrationComplete({ guestDone: true, confirmation: "paper", idChecked: true })).toBe(true);
  });
});
