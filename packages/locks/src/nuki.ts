import type { LockCapabilities } from "@hoteloftware/domain";
import { LockRefused, LockUnavailable, type CardRead, type IssuedKey, type KeyRequest, type LockPlugin } from "./plugin";

/**
 * Nuki through its public Web API (decision "Digital key": the first cloud
 * plugin). Keys are made, changed and taken back by the worker; the
 * settings page only asks its health. A key is a keypad code (door PIN) on the
 * room's smartlock, valid from check-in to check-out plus the grace; the lock
 * is online, so taking a code back works at once. No cards, no encoders.
 * Web API: https://api.nuki.io (Bearer API token of the hotel's Nuki Web account).
 */
const API = "https://api.nuki.io";
/** Nuki's authorization type for a keypad code. */
const KEYPAD_CODE = 13;

type Fetch = typeof fetch;

/** The authorization's name at Nuki: our key's id, within Nuki's 32 characters. */
const nameOf = (keyId: string) => `hs-${keyId.replace(/-/g, "")}`.slice(0, 32);

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
    // a refusal (bad token, a code Nuki does not take) is not tried again; a server error is
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new LockRefused(`Nuki refused: ${res.status}`);
    if (!res.ok) throw new LockUnavailable(`Nuki answered ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  private authBody(r: KeyRequest) {
    if (!r.pin) throw new Error("A Nuki key is a door PIN");
    return { name: nameOf(r.keyId), type: KEYPAD_CODE, code: Number(r.pin), allowedFromDate: r.validFrom.toISOString(), allowedUntilDate: r.validUntil.toISOString(), allowedWeekDays: 127, allowedFromTime: 0, allowedUntilTime: 0 };
  }

  private async findByKeyId(keyId: string, lockRef: string): Promise<string | null> {
    // Nuki answers a new authorization without its id: found again by the name we gave it
    const list = (await this.call("GET", `/smartlock/${encodeURIComponent(lockRef)}/auth`)) as { id: string | number; name: string }[] | null;
    const made = (list ?? []).find((a) => a.name === nameOf(keyId));
    return made ? String(made.id) : null;
  }

  async issueKey(r: KeyRequest): Promise<IssuedKey> {
    await this.call("PUT", `/smartlock/${encodeURIComponent(r.lockRef)}/auth`, this.authBody(r));
    const id = await this.findByKeyId(r.keyId, r.lockRef);
    if (!id) throw new LockUnavailable("Nuki did not keep the keypad code");
    return { externalId: id };
  }

  async revokeByKeyId(keyId: string, lockRef: string): Promise<void> {
    const id = await this.findByKeyId(keyId, lockRef);
    if (id) await this.revokeKey(id, lockRef);
  }

  async updateKey(externalId: string, r: KeyRequest): Promise<void> {
    await this.call("POST", `/smartlock/${encodeURIComponent(r.lockRef)}/auth/${encodeURIComponent(externalId)}`, this.authBody(r));
  }

  async revokeKey(externalId: string, lockRef: string): Promise<void> {
    try {
      await this.call("DELETE", `/smartlock/${encodeURIComponent(lockRef)}/auth/${encodeURIComponent(externalId)}`);
    } catch (err) {
      // already gone at Nuki: taken back all the same
      if (!(err instanceof LockRefused && err.message.endsWith("404"))) throw err;
    }
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
