import { describe, expect, it } from "vitest";
import { doorPin, guestHandover, handoverSupported, keyActions, keyPlan, keyValidUntil } from "../src";

const caps = { card: false, pin: true, phoneKey: false, remoteRevoke: true, readCard: false, encoders: false };
const cardCaps = { card: true, pin: false, phoneKey: false, remoteRevoke: false, readCard: true, encoders: true };
const until = new Date("2026-10-09T10:00:00Z");

describe("door keys", () => {
  it("a key runs to check-out time plus the grace on the departure day, in the property's zone", () => {
    expect(keyValidUntil("2026-10-09", "11:00", 60, "Europe/Berlin").toISOString()).toBe("2026-10-09T10:00:00.000Z");
    expect(keyValidUntil("2026-12-01", "10:30", 0, "Europe/Berlin").toISOString()).toBe("2026-12-01T09:30:00.000Z");
  });

  it("a checked-in stay with door PINs gets one in its room; an extension updates it; a room move revokes the old one", () => {
    const stay = { status: "checked_in", roomId: "r1", validUntil: until };
    expect(keyPlan(stay, [], caps, "pin")).toEqual({ issue: [{ roomId: "r1", kind: "pin" }], update: [], revoke: [], warnings: [] });
    const key = { id: "k1", roomId: "r1", kind: "pin" as const, status: "active" as const, validUntil: new Date("2026-10-08T10:00:00Z") };
    expect(keyPlan(stay, [key], caps, "pin")).toEqual({ issue: [], update: [{ keyId: "k1", validUntil: until }], revoke: [], warnings: [] });
    expect(keyPlan({ ...stay, roomId: "r2" }, [{ ...key, validUntil: until }], caps, "pin")).toEqual({ issue: [{ roomId: "r2", kind: "pin" }], update: [], revoke: [{ keyId: "k1", reason: "room_move" }], warnings: [] });
  });

  it("check-out, no-show and cancellation revoke; an offline card runs to its expiry and says so", () => {
    const active = { id: "k1", roomId: "r1", kind: "card" as const, status: "active" as const, validUntil: until };
    expect(keyPlan({ status: "checked_out", roomId: "r1", validUntil: until }, [active], cardCaps, null)).toEqual({ issue: [], update: [], revoke: [{ keyId: "k1", reason: "checked_out" }], warnings: ["offline_card_runs_to_expiry"] });
    expect(keyPlan({ status: "no_show", roomId: null, validUntil: until }, [], caps, "pin").revoke).toEqual([]);
    // cards are encoded at the desk, never by themselves; a move asks for a new card
    expect(keyPlan({ status: "checked_in", roomId: "r2", validUntil: until }, [active], cardCaps, null)).toEqual({ issue: [], update: [], revoke: [{ keyId: "k1", reason: "room_move" }], warnings: ["offline_card_runs_to_expiry", "new_card_needed"] });
  });

  it("a changed handover takes the other kind of key back, cards stay", () => {
    const pin = { id: "k1", roomId: "r1", kind: "pin" as const, status: "active" as const, validUntil: until };
    const card = { ...pin, id: "k2", kind: "card" as const };
    expect(keyPlan({ status: "checked_in", roomId: "r1", validUntil: until }, [pin, card], { ...caps, phoneKey: true }, "phone")).toEqual({ issue: [{ roomId: "r1", kind: "phone" }], update: [], revoke: [{ keyId: "k1", reason: "handover_changed" }], warnings: [] });
  });

  it("an extension cannot change an offline card: the desk writes it again", () => {
    const card = { id: "k1", roomId: "r1", kind: "card" as const, status: "active" as const, validUntil: new Date("2026-10-08T10:00:00Z") };
    expect(keyPlan({ status: "checked_in", roomId: "r1", validUntil: until }, [card], cardCaps, null)).toEqual({ issue: [], update: [], revoke: [], warnings: ["card_reencode_needed"] });
    expect(handoverSupported("digital_key", caps)).toBe(false);
    expect(handoverSupported("door_pin", caps)).toBe(true);
    expect(handoverSupported("kiosk_encoder", cardCaps)).toBe(true);
  });

  it("only what the lock system can do is offered; an unsupported lock offers nothing", () => {
    expect(keyActions(caps)).toEqual({ issueCard: false, revoke: true, readCard: false, showPin: true });
    expect(keyActions(cardCaps)).toEqual({ issueCard: true, revoke: true, readCard: true, showPin: false });
    expect(keyActions(null)).toEqual({ issueCard: false, revoke: false, readCard: false, showPin: false });
  });

  it("a door PIN has six digits from 1 to 9 and never starts with 12", () => {
    for (let i = 0; i < 200; i++) {
      const p = doorPin();
      expect(p).toMatch(/^[1-9]{6}$/);
      expect(p.startsWith("12")).toBe(false);
    }
  });

  it("the guest is told how the key comes: the setting where the lock system can do it, else reception", () => {
    expect(guestHandover("door_pin", caps)).toBe("door_pin");
    expect(guestHandover("digital_key", caps)).toBe("reception");
    expect(guestHandover("kiosk_encoder", cardCaps)).toBe("kiosk_encoder");
    expect(guestHandover("door_pin", null)).toBe("reception");
  });
});
