import type { KeyKind, LockCapabilities } from "@hoteloftware/domain";

/**
 * The one internal lock interface (decision "Digital key", ADR 0014): issue
 * a key, change its validity, revoke it, read a card, list encoders, health.
 * Each vendor is a Lock Plugin behind it, declaring what it can do; cloud
 * systems run in the worker, on-premises ones in the Site Bridge.
 */

export interface KeyRequest {
  /** Our key's id, named at the lock so the key is found again. */
  keyId: string;
  /** The room's door at the lock system (a Nuki smartlock id, a Salto door id …). */
  lockRef: string;
  kind: KeyKind;
  validFrom: Date;
  validUntil: Date;
  guestName: string;
  /** A door PIN chosen by us. */
  pin?: string | undefined;
  /** The encoder a key card is written on (the desk's or the kiosk's). */
  encoderId?: string | undefined;
}

export interface IssuedKey {
  /** The key's id at the lock system. */
  externalId: string;
}

export interface CardRead {
  lockRef: string;
  validUntil: Date;
  externalId: string | null;
}

export interface LockPlugin {
  readonly name: string;
  readonly capabilities: LockCapabilities;
  issueKey(r: KeyRequest): Promise<IssuedKey>;
  updateKey(externalId: string, r: KeyRequest): Promise<void>;
  revokeKey(externalId: string, lockRef: string): Promise<void>;
  readCard(encoderId: string): Promise<CardRead | null>;
  listEncoders(): Promise<{ id: string; name: string }[]>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

/** The lock system did not answer or refused; tried again later where it makes sense. */
export class LockUnavailable extends Error {}
