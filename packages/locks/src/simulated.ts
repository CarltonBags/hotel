import type { LockCapabilities } from "@hoteloftware/domain";
import { LockUnavailable, type CardRead, type IssuedKey, type KeyRequest, type LockPlugin } from "./plugin";

/**
 * A simulated lock system (tests and development): online locks with key
 * cards, door PINs and encoders, keeping its keys in memory. Its
 * capabilities can be narrowed to stand in for a vendor that lacks some.
 */
export class SimulatedLocks implements LockPlugin {
  readonly name = "simulated";
  readonly keys = new Map<string, KeyRequest & { revoked: boolean }>();
  /** The last card written on each encoder, for reading it back. */
  private readonly lastCard = new Map<string, string>();
  down = false;
  private next = 1;

  constructor(readonly capabilities: LockCapabilities = { card: true, pin: true, phoneKey: true, remoteRevoke: true, readCard: true, encoders: true }) {}

  private up(): void {
    if (this.down) throw new LockUnavailable("The simulated lock system is down");
  }

  async issueKey(r: KeyRequest): Promise<IssuedKey> {
    this.up();
    const externalId = `sim-${this.next++}`;
    this.keys.set(externalId, { ...r, revoked: false });
    if (r.kind === "card" && r.encoderId) this.lastCard.set(r.encoderId, externalId);
    return { externalId };
  }

  async updateKey(externalId: string, r: KeyRequest): Promise<void> {
    this.up();
    const k = this.keys.get(externalId);
    if (!k) throw new LockUnavailable("Key not found at the lock system");
    this.keys.set(externalId, { ...k, validUntil: r.validUntil });
  }

  async revokeKey(externalId: string): Promise<void> {
    this.up();
    const k = this.keys.get(externalId);
    if (k) k.revoked = true;
  }

  async readCard(encoderId: string): Promise<CardRead | null> {
    this.up();
    const id = this.lastCard.get(encoderId);
    const k = id ? this.keys.get(id) : undefined;
    return k ? { lockRef: k.lockRef, validUntil: k.validUntil, externalId: id! } : null;
  }

  async listEncoders(): Promise<{ id: string; name: string }[]> {
    return [
      { id: "enc-desk-1", name: "Desk 1" },
      { id: "enc-desk-2", name: "Desk 2" },
      { id: "enc-kiosk", name: "Kiosk" },
    ];
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return this.down ? { ok: false, detail: "down" } : { ok: true, detail: "simulated" };
  }
}
