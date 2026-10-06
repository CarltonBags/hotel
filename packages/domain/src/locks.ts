import { instantAt } from "./spa";

/**
 * Door keys (ticket 67, decision "Digital key"): one lock interface, a Lock
 * Plugin per vendor declaring what it can do. A key is issued only for a
 * Checked-in stay and runs to check-out time plus a grace; extension updates
 * it, a room move takes the old one back where the lock is online (an
 * offline card runs to its written expiry), check-out, no-show and
 * cancellation revoke.
 */

export type KeyKind = "card" | "pin" | "phone";

export interface LockCapabilities {
  /** Key cards written by an encoder. */
  card: boolean;
  /** A door PIN on a keypad. */
  pin: boolean;
  /** A Digital Key on the guest's phone. */
  phoneKey: boolean;
  /** A key can be taken back at the door at once (online locks); else a card runs to its expiry. */
  remoteRevoke: boolean;
  readCard: boolean;
  encoders: boolean;
}

export const KEY_HANDOVERS = ["reception", "kiosk_encoder", "digital_key", "door_pin"] as const;
export type KeyHandover = (typeof KEY_HANDOVERS)[number];

/** Whether the lock system can hand keys over this way. */
export function handoverSupported(handover: KeyHandover, caps: LockCapabilities): boolean {
  if (handover === "door_pin") return caps.pin;
  if (handover === "digital_key") return caps.phoneKey;
  if (handover === "kiosk_encoder") return caps.card && caps.encoders;
  return true;
}

/** How the guest gets the key: the property's setting where its lock system can do it, else at reception. */
export function guestHandover(handover: KeyHandover, caps: LockCapabilities | null): KeyHandover {
  return caps && handoverSupported(handover, caps) ? handover : "reception";
}

/** The kind of key issued without anyone at the desk, for a handover setting the lock system supports. */
export function automaticKeyKind(handover: KeyHandover, caps: LockCapabilities): KeyKind | null {
  if (handover === "door_pin" && caps.pin) return "pin";
  if (handover === "digital_key" && caps.phoneKey) return "phone";
  return null;
}

/** Check-out time on the departure day plus the grace, at the property. */
export function keyValidUntil(departure: string, checkoutTime: string, graceMinutes: number, timeZone: string): Date {
  return new Date(instantAt(departure, checkoutTime.slice(0, 5), timeZone).getTime() + graceMinutes * 60_000);
}

export type RevokeReason = "checked_out" | "no_show" | "cancelled" | "room_move" | "not_checked_in" | "lost" | "handover_changed";
export type KeyWarning = "offline_card_runs_to_expiry" | "new_card_needed" | "card_reencode_needed";

export interface PlannedKey {
  id: string;
  roomId: string;
  kind: KeyKind;
  status: "pending" | "active" | "revoked" | "failed";
  validUntil: Date;
}

export interface KeyPlan {
  issue: { roomId: string; kind: KeyKind }[];
  update: { keyId: string; validUntil: Date }[];
  revoke: { keyId: string; reason: RevokeReason }[];
  warnings: KeyWarning[];
}

const REVOKE_REASON: Record<string, RevokeReason> = { checked_out: "checked_out", no_show: "no_show", cancelled: "cancelled" };

/** What to do with a stay's keys for where it stands now. */
export function keyPlan(stay: { status: string; roomId: string | null; validUntil: Date }, keys: PlannedKey[], caps: LockCapabilities, automatic: KeyKind | null): KeyPlan {
  const plan: KeyPlan = { issue: [], update: [], revoke: [], warnings: [] };
  const live = keys.filter((k) => k.status === "active" || k.status === "pending");
  const warn = (w: KeyWarning) => {
    if (!plan.warnings.includes(w)) plan.warnings.push(w);
  };
  const revoke = (k: PlannedKey, reason: RevokeReason) => {
    plan.revoke.push({ keyId: k.id, reason });
    if (k.kind === "card" && !caps.remoteRevoke) warn("offline_card_runs_to_expiry");
  };
  if (stay.status !== "checked_in" || !stay.roomId) {
    for (const k of live) revoke(k, REVOKE_REASON[stay.status] ?? "not_checked_in");
    return plan;
  }
  for (const k of live.filter((x) => x.roomId !== stay.roomId)) {
    revoke(k, "room_move");
    if (k.kind === "card") warn("new_card_needed");
  }
  // one way of handing keys over: a door PIN or Digital Key of another setting goes (cards stay with their guest)
  for (const k of live.filter((x) => x.roomId === stay.roomId && x.kind !== "card" && x.kind !== automatic)) revoke(k, "handover_changed");
  const here = live.filter((x) => x.roomId === stay.roomId && (x.kind === "card" || x.kind === automatic));
  for (const k of here) {
    if (k.validUntil.getTime() === stay.validUntil.getTime()) continue;
    // an offline card keeps what was written on it: the desk writes it again
    if (k.kind === "card" && !caps.remoteRevoke) warn("card_reencode_needed");
    else plan.update.push({ keyId: k.id, validUntil: stay.validUntil });
  }
  if (automatic && !here.some((k) => k.kind === automatic)) plan.issue.push({ roomId: stay.roomId, kind: automatic });
  return plan;
}

/** The key actions the desk is offered; none where the lock is unsupported ("key by lock software"). */
export function keyActions(caps: LockCapabilities | null): { issueCard: boolean; revoke: boolean; readCard: boolean; showPin: boolean } {
  if (!caps) return { issueCard: false, revoke: false, readCard: false, showPin: false };
  return { issueCard: caps.card && caps.encoders, revoke: true, readCard: caps.readCard, showPin: caps.pin };
}

/** A door PIN: six digits from 1 to 9, not starting with 12 (keypad rules, Nuki). */
export function doorPin(): string {
  // bytes from 252 up are drawn again, so each digit is equally likely
  const digit = (): string => {
    for (;;) {
      const b = globalThis.crypto.getRandomValues(new Uint8Array(1))[0]!;
      if (b < 252) return String((b % 9) + 1);
    }
  };
  const digits = () => Array.from({ length: 6 }, digit).join("");
  let pin = digits();
  while (pin.startsWith("12")) pin = digits();
  return pin;
}
