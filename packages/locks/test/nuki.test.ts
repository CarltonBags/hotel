import { describe, expect, it } from "vitest";
import { NukiLocks } from "../src";

/** Seam: the Nuki plugin speaks the Web API (keypad codes on the room's smartlock), checked against a recorded fake. */
describe("Nuki plugin", () => {
  const recorder = () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (init.method === "GET" && url.endsWith("/auth")) return new Response(JSON.stringify([{ id: "auth-9", name: "hs-key-1" }]), { status: 200 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    return { calls, http };
  };
  const req = { keyId: "key-1", lockRef: "17", kind: "pin" as const, validFrom: new Date("2026-10-06T12:00:00Z"), validUntil: new Date("2026-10-09T10:00:00Z"), guestName: "Tanaka", pin: "345678" };

  it("issues a keypad code valid for the stay and finds its id again; extends and revokes it", async () => {
    const { calls, http } = recorder();
    const nuki = new NukiLocks("token", http);
    expect(await nuki.issueKey(req)).toEqual({ externalId: "auth-9" });
    expect(calls[0]).toEqual({ method: "PUT", url: "https://api.nuki.io/smartlock/17/auth", body: { name: "hs-key-1", type: 13, code: 345678, allowedFromDate: "2026-10-06T12:00:00.000Z", allowedUntilDate: "2026-10-09T10:00:00.000Z", allowedWeekDays: 127, allowedFromTime: 0, allowedUntilTime: 0 } });
    await nuki.updateKey("auth-9", { ...req, validUntil: new Date("2026-10-10T10:00:00Z") });
    expect(calls[2]).toMatchObject({ method: "POST", url: "https://api.nuki.io/smartlock/17/auth/auth-9", body: { allowedUntilDate: "2026-10-10T10:00:00.000Z" } });
    await nuki.revokeKey("auth-9", "17");
    expect(calls[3]).toMatchObject({ method: "DELETE", url: "https://api.nuki.io/smartlock/17/auth/auth-9" });
  });

  it("a Nuki that does not answer is unavailable; no cards, no encoders", async () => {
    const nuki = new NukiLocks("token", (async () => new Response(null, { status: 503 })) as typeof fetch);
    await expect(nuki.issueKey(req)).rejects.toThrow(/503/);
    expect(nuki.capabilities).toMatchObject({ card: false, pin: true, remoteRevoke: true, encoders: false });
    expect((await nuki.health()).ok).toBe(false);
  });
});
