import { describe, expect, it } from "vitest";
import { DEMO_KEPT_DAYS, TRIAL_DAYS, demoDeletionDue, goLiveBlockers, goLiveChecklist, testModeMailRecipient, trialDaysLeft, type GoLiveFacts } from "../src/go-live";

const ready: GoLiveFacts = {
  legalEntities: [{ name: "Alpha GmbH", hasTaxData: true, hasTaxCodes: true, hasInvoiceNumbering: true, card: null }],
  properties: [{ name: "Berlin", rooms: 12, pricedThrough: "2028-02-17", cityTaxRule: true, country: "DE", receiptPrinter: false, signatureUnit: false, today: "2026-10-04" }],
  staffUsers: 3,
  devices: 0,
};

describe("go-live checklist", () => {
  it("a complete setup has no blockers; optional and unused items never block", () => {
    const items = goLiveChecklist(ready);
    expect(goLiveBlockers(items)).toEqual([]);
    expect(items.find((i) => i.id === "devices")).toMatchObject({ level: "optional", done: false });
    expect(items.find((i) => i.id === "card_provider")).toMatchObject({ level: "if_used", used: false });
  });

  it("each missing required item blocks, by name", () => {
    const facts: GoLiveFacts = {
      ...ready,
      legalEntities: [{ ...ready.legalEntities[0]!, hasTaxData: false, hasInvoiceNumbering: false }],
      // prices only 400 days ahead, where 500 are required
      properties: [{ name: "Berlin", rooms: 0, pricedThrough: "2027-11-08", cityTaxRule: false, country: "DE", receiptPrinter: false, signatureUnit: false, today: "2026-10-04" }],
      staffUsers: 0,
    };
    expect(goLiveBlockers(goLiveChecklist(facts)).map((i) => i.id).sort()).toEqual(["city_tax", "invoice_numbering", "legal_entity_tax", "rates_500_days", "rooms", "users"]);
  });

  it("each property's price horizon counts from its own date", () => {
    const two = { ...ready, properties: [ready.properties[0]!, { name: "Tokyo", rooms: 5, pricedThrough: "2028-02-17", cityTaxRule: true, country: "JP", receiptPrinter: false, signatureUnit: false, today: "2026-10-05" }] };
    expect(goLiveBlockers(goLiveChecklist(two))).toEqual([]);
    const late = { ...ready, properties: [ready.properties[0]!, { name: "Tokyo", rooms: 5, pricedThrough: "2028-02-17", cityTaxRule: true, country: "JP", receiptPrinter: false, signatureUnit: false, today: "2026-10-06" }] };
    expect(goLiveBlockers(goLiveChecklist(late))).toMatchObject([{ id: "rates_500_days", missing: ["Tokyo"] }]);
  });

  it("an Austrian property cannot go live without a receipt printer and its signature unit", () => {
    const wien = { ...ready.properties[0]!, name: "Wien", country: "AT" };
    expect(goLiveBlockers(goLiveChecklist({ ...ready, properties: [{ ...wien, signatureUnit: true }] }))).toMatchObject([{ id: "receipt_printer", missing: ["Wien"] }]);
    expect(goLiveBlockers(goLiveChecklist({ ...ready, properties: [{ ...wien, receiptPrinter: true }] }))).toMatchObject([{ id: "signature_unit", missing: ["Wien"] }]);
    expect(goLiveBlockers(goLiveChecklist({ ...ready, properties: [{ ...wien, receiptPrinter: true, signatureUnit: true }] }))).toEqual([]);
  });

  it("prices exactly 500 days ahead are enough", () => {
    expect(goLiveBlockers(goLiveChecklist({ ...ready, properties: [{ ...ready.properties[0]!, pricedThrough: "2028-02-16" }] }))).toEqual([]);
    expect(goLiveBlockers(goLiveChecklist({ ...ready, properties: [{ ...ready.properties[0]!, pricedThrough: "2028-02-15" }] })).map((i) => i.id)).toEqual(["rates_500_days"]);
  });

  it("a card provider account in use must be fully onboarded", () => {
    const started = { ...ready, legalEntities: [{ ...ready.legalEntities[0]!, card: { chargesEnabled: false } }] };
    expect(goLiveBlockers(goLiveChecklist(started)).map((i) => i.id)).toEqual(["card_provider"]);
    const done = { ...ready, legalEntities: [{ ...ready.legalEntities[0]!, card: { chargesEnabled: true } }] };
    expect(goLiveBlockers(goLiveChecklist(done))).toEqual([]);
  });

  it("without any property or Legal Entity nothing is ready", () => {
    const ids = goLiveBlockers(goLiveChecklist({ ...ready, legalEntities: [], properties: [] })).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["legal_entity_tax", "property", "rooms", "rates_500_days"]));
  });
});

describe("trial", () => {
  it("runs 30 days; a demo tenant is deleted 30 days after it ends", () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(DEMO_KEPT_DAYS).toBe(30);
    const ends = new Date("2026-11-03T10:00:00Z");
    expect(trialDaysLeft(ends, new Date("2026-10-04T10:00:00Z"))).toBe(30);
    expect(trialDaysLeft(ends, new Date("2026-11-03T09:00:00Z"))).toBe(1);
    expect(trialDaysLeft(ends, new Date("2026-11-04T10:00:00Z"))).toBe(0);
    expect(demoDeletionDue(ends, new Date("2026-12-03T09:59:00Z"))).toBe(false);
    expect(demoDeletionDue(ends, new Date("2026-12-03T10:00:00Z"))).toBe(true);
  });

  it("in Test Mode mail goes only to the trial user, never to guests", () => {
    expect(testModeMailRecipient({ testMode: true, trialUserEmail: "owner@hotel.example" }, "guest@example.com")).toBe(null);
    expect(testModeMailRecipient({ testMode: true, trialUserEmail: "owner@hotel.example" }, "Owner@Hotel.example")).toBe("Owner@Hotel.example");
    expect(testModeMailRecipient({ testMode: false, trialUserEmail: "owner@hotel.example" }, "guest@example.com")).toBe("guest@example.com");
  });

  it("a property whose locks or till run through the Site Bridge needs it connected before going live", () => {
    const berlin = ready.properties[0]!;
    expect(goLiveChecklist(ready).find((i) => i.id === "site_bridge")).toMatchObject({ used: false, done: true });
    expect(goLiveBlockers(goLiveChecklist({ ...ready, properties: [{ ...berlin, siteBridge: "offline" }] }))).toMatchObject([{ id: "site_bridge", missing: ["Berlin"] }]);
    expect(goLiveBlockers(goLiveChecklist({ ...ready, properties: [{ ...berlin, siteBridge: "online" }] }))).toEqual([]);
  });
});
