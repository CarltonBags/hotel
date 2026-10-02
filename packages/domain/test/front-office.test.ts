import { describe, expect, it } from "vitest";
import {
  EMPTY_GUEST,
  WORLD_COUNTRIES,
  fixedChargeNights,
  isFrontOfficeOnly,
  registrationGaps,
  workspaceRows,
  type Actor,
  type WorkspaceRow,
} from "../src/index";

/** Seams: who works one property at a time; registration gaps per country; Fixed Charge nights; the Today workspace list. */
describe("front office only", () => {
  const actor = (roles: Actor["propertyRoles"], tenantRole?: Actor["tenantRole"]): Actor => ({ propertyRoles: roles, ...(tenantRole ? { tenantRole } : {}) });
  it("holds for users with front-office roles alone", () => {
    expect(isFrontOfficeOnly(actor([{ propertyId: "a", role: "front_desk" }]))).toBe(true);
    expect(isFrontOfficeOnly(actor([{ propertyId: "a", role: "front_desk" }, { propertyId: "b", role: "housekeeper" }]))).toBe(true);
  });
  it("does not hold with a back-office role, a tenant role or no role", () => {
    expect(isFrontOfficeOnly(actor([{ propertyId: "a", role: "front_desk" }, { propertyId: "a", role: "accounting" }]))).toBe(false);
    expect(isFrontOfficeOnly(actor([{ propertyId: "a", role: "property_manager" }]))).toBe(false);
    expect(isFrontOfficeOnly(actor([{ propertyId: "a", role: "front_desk" }], "owner"))).toBe(false);
    expect(isFrontOfficeOnly(actor([]))).toBe(false);
  });
});

describe("registration gaps", () => {
  const complete = {
    ...EMPTY_GUEST,
    firstName: "Aiko",
    lastName: "Tanaka",
    dateOfBirth: "1990-04-01",
    nationality: "JP",
    countryOfResidence: "JP",
    addressLine1: "1-2-3 Shibuya",
    postalCode: "150-0002",
    city: "Tokyo",
    placeOfBirth: "Osaka",
    documentType: "passport" as const,
    documentNumber: "TR1234567",
  };
  it("a complete foreign guest has no gaps in Germany, Austria or Switzerland", () => {
    for (const c of ["DE", "AT", "CH"]) expect(registrationGaps(complete, c)).toEqual([]);
  });
  it("Germany needs the address and, for foreigners, the document; not the place of birth", () => {
    expect(registrationGaps({ ...complete, addressLine1: "", documentNumber: null, placeOfBirth: null }, "DE")).toEqual(["addressLine1", "documentNumber"]);
    expect(registrationGaps({ ...complete, nationality: "DE", documentType: null, documentNumber: null }, "DE")).toEqual([]);
  });
  it("Switzerland needs the place of birth and the document for everyone", () => {
    expect(registrationGaps({ ...complete, nationality: "CH", placeOfBirth: null, documentNumber: null }, "CH")).toEqual(["placeOfBirth", "documentNumber"]);
  });
  it("a country without rules has no gaps", () => {
    expect(registrationGaps(EMPTY_GUEST, "IT")).toEqual([]);
  });
});

describe("Fixed Charge nights", () => {
  it("are the stay's nights inside the Fixed Charge's range", () => {
    expect(fixedChargeNights({ from: "2026-10-03", to: "2026-10-05" }, "2026-10-02", "2026-10-06")).toEqual(["2026-10-03", "2026-10-04"]);
    expect(fixedChargeNights({ from: "2026-10-01", to: "2026-10-09" }, "2026-10-02", "2026-10-04")).toEqual(["2026-10-02", "2026-10-03"]);
    expect(fixedChargeNights({ from: "2026-10-07", to: "2026-10-09" }, "2026-10-02", "2026-10-04")).toEqual([]);
  });
});

describe("workspace rows", () => {
  const row = (room: string | null, last: string, extra: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
    reservationId: last,
    confirmationNumber: "1",
    room,
    guestFirstName: "X",
    guestLastName: last,
    roomTypeCode: "DBL",
    ratePlanName: "Flexible",
    bookerName: "X",
    arrival: "2026-10-02",
    departure: "2026-10-04",
    vip: false,
    balance: 0,
    cardHold: null,
    ...extra,
  });
  const rows = [row("102", "Brandt", { balance: 40 }), row("101", "Adler", { vip: true }), row(null, "Zeller", { roomTypeCode: "SGL" }), row("201", "Meier")];
  it("search matches the room number from its start or the guest name anywhere", () => {
    expect(workspaceRows(rows, { query: "10" }).map((r) => r.guestLastName)).toEqual(["Adler", "Brandt"]);
    expect(workspaceRows(rows, { query: "eier" }).map((r) => r.guestLastName)).toEqual(["Meier"]);
  });
  it("filters narrow and sorting orders, rooms first with unassigned last", () => {
    expect(workspaceRows(rows, { filters: { openBalance: true } }).map((r) => r.guestLastName)).toEqual(["Brandt"]);
    expect(workspaceRows(rows, { filters: { vip: true } }).map((r) => r.guestLastName)).toEqual(["Adler"]);
    expect(workspaceRows(rows, { filters: { unassigned: true } }).map((r) => r.guestLastName)).toEqual(["Zeller"]);
    expect(workspaceRows(rows, { filters: { roomTypeCode: "SGL" } }).map((r) => r.guestLastName)).toEqual(["Zeller"]);
    expect(workspaceRows(rows, {}).map((r) => r.room)).toEqual(["101", "102", "201", null]);
    expect(workspaceRows(rows, { sort: { key: "name", dir: "asc" } }).map((r) => r.guestLastName)).toEqual(["Adler", "Brandt", "Meier", "Zeller"]);
    expect(workspaceRows(rows, { sort: { key: "balance", dir: "desc" } })[0]!.guestLastName).toBe("Brandt");
  });
  it("the world country list has every ISO country once, DACH first", () => {
    expect(WORLD_COUNTRIES.slice(0, 3)).toEqual(["DE", "AT", "CH"]);
    expect(new Set(WORLD_COUNTRIES).size).toBe(WORLD_COUNTRIES.length);
    expect(WORLD_COUNTRIES.length).toBeGreaterThan(240);
    expect(WORLD_COUNTRIES).toContain("JP");
  });
});
