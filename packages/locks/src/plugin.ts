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
  /** A Digital Key: what the guest's phone opens (an invitation link or key token). */
  guestKey?: string | undefined;
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
  /** A Digital Key the lock system renews on a change comes back with its new guest key. */
  updateKey(externalId: string, r: KeyRequest): Promise<void | { guestKey?: string | undefined }>;
  revokeKey(externalId: string, lockRef: string): Promise<void>;
  /** Take back a key whose id at the lock we never learnt (the issue answered with an error after the key was made). */
  revokeByKeyId(keyId: string, lockRef: string): Promise<void>;
  readCard(encoderId: string): Promise<CardRead | null>;
  listEncoders(): Promise<{ id: string; name: string }[]>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

/** The lock system did not answer; tried again later. */
export class LockUnavailable extends Error {}

/** The lock system refused the request (a wrong token, a code it does not take): trying again will not help. */
export class LockRefused extends Error {}
