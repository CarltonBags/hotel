import { describe, expect, it } from "vitest";
import { LockRefused, LockUnavailable, NukiLocks } from "../src";

/** Seam: the Nuki plugin speaks the Web API (keypad codes on the room's smartlock), checked against a hand-written fake of it (no Nuki account yet). */
describe("Nuki plugin", () => {
  const recorder = () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (init.method === "GET" && url.endsWith("/auth")) return new Response(JSON.stringify([{ id: 9, name: "hs-key1" }]), { status: 200 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    return { calls, http };
  };
  const req = { keyId: "key-1", lockRef: "17", kind: "pin" as const, validFrom: new Date("2026-10-06T12:00:00Z"), validUntil: new Date("2026-10-09T10:00:00Z"), guestName: "Tanaka", pin: "345678" };

  it("issues a keypad code valid for the stay and finds its id again; extends and revokes it", async () => {
    const { calls, http } = recorder();
    const nuki = new NukiLocks("token", http);
    expect(await nuki.issueKey(req)).toEqual({ externalId: "9" });
    expect(calls[0]).toEqual({ method: "PUT", url: "https://api.nuki.io/smartlock/17/auth", body: { name: "hs-key1", type: 13, code: 345678, allowedFromDate: "2026-10-06T12:00:00.000Z", allowedUntilDate: "2026-10-09T10:00:00.000Z", allowedWeekDays: 127, allowedFromTime: 0, allowedUntilTime: 0 } });
    await nuki.updateKey("9", { ...req, validUntil: new Date("2026-10-10T10:00:00Z") });
    expect(calls[2]).toMatchObject({ method: "POST", url: "https://api.nuki.io/smartlock/17/auth/9", body: { allowedUntilDate: "2026-10-10T10:00:00.000Z" } });
    await nuki.revokeKey("9", "17");
    expect(calls[3]).toMatchObject({ method: "DELETE", url: "https://api.nuki.io/smartlock/17/auth/9" });
  });

  it("a Nuki that does not answer is unavailable, one that refuses says so; no cards, no encoders", async () => {
    const nuki = new NukiLocks("token", (async () => new Response(null, { status: 503 })) as typeof fetch);
    await expect(nuki.issueKey(req)).rejects.toBeInstanceOf(LockUnavailable);
    await expect(new NukiLocks("bad", (async () => new Response(null, { status: 401 })) as typeof fetch).issueKey(req)).rejects.toBeInstanceOf(LockRefused);
    expect(nuki.capabilities).toMatchObject({ card: false, pin: true, remoteRevoke: true, encoders: false });
    expect((await nuki.health()).ok).toBe(false);
  });
});
