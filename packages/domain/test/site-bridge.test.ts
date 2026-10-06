import { describe, expect, it } from "vitest";
import { bridgeAlertDue, bridgeOnline } from "../src";

describe("Site Bridge health", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);
  it("a Bridge is online while it called within two minutes", () => {
    expect(bridgeOnline(ago(90), now)).toBe(true);
    expect(bridgeOnline(ago(150), now)).toBe(false);
    expect(bridgeOnline(null, now)).toBe(false);
  });
  it("the Property Manager is alerted once, three minutes after a Bridge went quiet; again only after it came back", () => {
    expect(bridgeAlertDue(ago(170), null, now)).toBe(false);
    expect(bridgeAlertDue(ago(200), null, now)).toBe(true);
    expect(bridgeAlertDue(ago(400), ago(100), now)).toBe(false);
    // never connected: nothing lost
    expect(bridgeAlertDue(null, null, now)).toBe(false);
  });
});
