import { describe, expect, it } from "vitest";
import { canAtAnyProperty, type Actor } from "../src/permissions";
import { PROPERTY_ACTIONS } from "../src/permissions";
import { mergeGuestData, needsPostalCode, normaliseEmail, normalisePhone, phoneSearchDigits, type GuestData } from "../src/guests";

/** Seams: guest data rules (duplicate keys, merge keeps the most complete data) and guest permissions. */
describe("guest data", () => {
  it("normalises email and phone for duplicate detection", () => {
    expect(normaliseEmail("  Aiko.Tanaka@Example.COM ")).toBe("aiko.tanaka@example.com");
    expect(normaliseEmail("")).toBeNull();
    expect(normalisePhone("+49 (30) 123-456")).toBe("4930123456");
    expect(normalisePhone("0049 30 123456")).toBe("4930123456");
    expect(normalisePhone("12")).toBeNull();
    expect(phoneSearchDigits("0049 30")).toBe("4930");
  });

  it("asks for a postal code from residents of Austria and Germany only", () => {
    expect(needsPostalCode("DE")).toBe(true);
    expect(needsPostalCode("AT")).toBe(true);
    expect(needsPostalCode("CH")).toBe(false);
    expect(needsPostalCode(null)).toBe(false);
  });

  const base: GuestData = {
    salutation: null,
    placeOfBirth: null,
    addressLine2: "",
    region: "",
    firstName: "Aiko",
    lastName: "Tanaka",
    dateOfBirth: null,
    nationality: "JP",
    countryOfResidence: "DE",
    postalCode: null,
    addressLine1: "",
    city: "",
    email: "aiko@example.com",
    phone: null,
    language: "en",
    preferences: "Quiet room",
    vip: false,
    marketingConsent: false,
    marketingConsentAt: null,
    marketingConsentSource: null,
    documentType: null,
    documentNumber: null,
    documentCountry: null,
    documentExpiry: null,
  };

  it("merge keeps the kept profile's values and fills its gaps from the other", () => {
    const other: GuestData = {
      ...base,
      firstName: "A.",
      dateOfBirth: "1990-04-02",
      postalCode: "10115",
      city: "Berlin",
      email: "aiko.t@example.com",
      phone: "+49 30 1",
      preferences: "Feather-free pillows",
      vip: true,
      marketingConsent: true,
      marketingConsentAt: "2026-05-01T10:00:00.000Z",
      marketingConsentSource: "Registration form, signed",
      documentType: "passport",
      documentNumber: "TK123",
      documentCountry: "JP",
      documentExpiry: "2031-01-01",
    };
    const merged = mergeGuestData(base, other);
    expect(merged.firstName).toBe("Aiko");
    expect(merged.email).toBe("aiko@example.com");
    expect(merged.dateOfBirth).toBe("1990-04-02");
    expect(merged.postalCode).toBe("10115");
    expect(merged.phone).toBe("+49 30 1");
    expect(merged.preferences).toBe("Quiet room\nFeather-free pillows");
    expect(merged.vip).toBe(true);
    // consent travels only with its proof
    expect(merged).toMatchObject({ marketingConsent: true, marketingConsentAt: "2026-05-01T10:00:00.000Z", marketingConsentSource: "Registration form, signed" });
    // the document is taken as a whole, never mixed
    expect(merged).toMatchObject({ documentType: "passport", documentNumber: "TK123", documentCountry: "JP", documentExpiry: "2031-01-01" });
  });

  it("merge does not repeat identical preferences", () => {
    expect(mergeGuestData(base, base).preferences).toBe("Quiet room");
  });
});

describe("guest permissions (permission matrix)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const at = (role: Actor["propertyRoles"][number]["role"]): Actor => ({ propertyRoles: [{ propertyId: A, role }] });

  it("guests are tenant-wide: a right at any property counts", () => {
    expect(canAtAnyProperty(at("front_desk"), "edit_guests")).toBe(true);
    expect(canAtAnyProperty(at("front_desk"), "merge_guests")).toBe(true);
    expect(canAtAnyProperty(at("accounting"), "view_guests")).toBe(true);
    expect(canAtAnyProperty(at("accounting"), "edit_guests")).toBe(false);
    expect(canAtAnyProperty(at("housekeeper"), "view_guests")).toBe(false);
    expect(canAtAnyProperty({ tenantRole: "owner", propertyRoles: [] }, "merge_guests")).toBe(true);
  });

  it("whoever may view, edit or merge guests may also see their contact data (profile pages and forms carry every field)", () => {
    for (const role of [...PROPERTY_ACTIONS.view_guests, ...PROPERTY_ACTIONS.edit_guests, ...PROPERTY_ACTIONS.merge_guests]) expect(PROPERTY_ACTIONS.view_guest_contacts).toContain(role);
  });

  it("Revenue has no Guest profiles (matrix) and no contact details anywhere", () => {
    expect(canAtAnyProperty(at("revenue"), "view_guests")).toBe(false);
    expect(canAtAnyProperty(at("revenue"), "view_companies")).toBe(false);
    expect(canAtAnyProperty(at("revenue"), "view_guest_contacts")).toBe(false);
    expect(canAtAnyProperty(at("front_desk"), "view_guest_contacts")).toBe(true);
    expect(canAtAnyProperty(at("accounting"), "view_guest_contacts")).toBe(true);
  });
});
