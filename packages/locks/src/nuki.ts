import type { LockCapabilities } from "@hoteloftware/domain";
import { LockUnavailable, type CardRead, type IssuedKey, type KeyRequest, type LockPlugin } from "./plugin";

/**
 * Nuki through its public Web API (decision "Digital key": the first cloud
 * plugin, run in the worker). A key is a keypad code (door PIN) on the
 * room's smartlock, valid from check-in to check-out plus the grace; the lock
 * is online, so taking a code back works at once. No cards, no encoders.
 * Web API: https://api.nuki.io (Bearer API token of the hotel's Nuki Web account).
 */
const API = "https://api.nuki.io";
/** Nuki's authorization type for a keypad code. */
const KEYPAD_CODE = 13;

type Fetch = typeof fetch;

export class NukiLocks implements LockPlugin {
  readonly name = "nuki";
  readonly capabilities: LockCapabilities = { card: false, pin: true, phoneKey: false, remoteRevoke: true, readCard: false, encoders: false };

  constructor(
    private readonly token: string,
    private readonly http: Fetch = fetch,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.http(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new LockUnavailable(`Nuki did not answer: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new LockUnavailable(`Nuki answered ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  private authBody(r: KeyRequest) {
    if (!r.pin) throw new Error("A Nuki key is a door PIN");
    return { name: `hs-${r.keyId}`.slice(0, 32), type: KEYPAD_CODE, code: Number(r.pin), allowedFromDate: r.validFrom.toISOString(), allowedUntilDate: r.validUntil.toISOString(), allowedWeekDays: 127, allowedFromTime: 0, allowedUntilTime: 0 };
  }

  async issueKey(r: KeyRequest): Promise<IssuedKey> {
    await this.call("PUT", `/smartlock/${encodeURIComponent(r.lockRef)}/auth`, this.authBody(r));
    // Nuki answers without the new authorization's id: found again by its name
    const list = (await this.call("GET", `/smartlock/${encodeURIComponent(r.lockRef)}/auth`)) as { id: string; name: string }[] | null;
    const made = (list ?? []).find((a) => a.name === `hs-${r.keyId}`.slice(0, 32));
    if (!made) throw new LockUnavailable("Nuki did not keep the keypad code");
    return { externalId: made.id };
  }

  async updateKey(externalId: string, r: KeyRequest): Promise<void> {
    await this.call("POST", `/smartlock/${encodeURIComponent(r.lockRef)}/auth/${encodeURIComponent(externalId)}`, this.authBody(r));
  }

  async revokeKey(externalId: string, lockRef: string): Promise<void> {
    await this.call("DELETE", `/smartlock/${encodeURIComponent(lockRef)}/auth/${encodeURIComponent(externalId)}`);
  }

  async readCard(): Promise<CardRead | null> {
    return null;
  }

  async listEncoders(): Promise<{ id: string; name: string }[]> {
    return [];
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const locks = (await this.call("GET", "/smartlock")) as unknown[] | null;
      return { ok: true, detail: `${locks?.length ?? 0} smartlocks` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "Nuki not reachable" };
    }
  }
}
