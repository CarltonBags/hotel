/**
 * Devices and PIN Sign-in (ticket 14, decided in "Shared-device login for
 * floor staff"): floor and service roles sign in on an enrolled Device by
 * choosing their name and entering a personal PIN of 4 to 6 digits.
 */
import { can, type Actor, type PropertyRole } from "./permissions";

/** Floor and service roles may use PIN Sign-in; everyone else signs in with full credentials. */
export const PIN_ROLES: readonly PropertyRole[] = ["housekeeper", "housekeeping_supervisor", "maintenance", "service", "spa_staff"];

/** Five wrong PINs lock the user on every Device. */
export const PIN_MAX_TRIES = 5;

/** May this user sign in by PIN at the property: only floor roles there, no other role anywhere. */
export function canUsePin(actor: Actor, propertyId: string): boolean {
  if (actor.tenantRole !== undefined) return false;
  if (!actor.propertyRoles.some((r) => r.propertyId === propertyId)) return false;
  return actor.propertyRoles.every((r) => PIN_ROLES.includes(r.role));
}

/** Why a PIN is refused, or null: 4 to 6 digits, not one digit repeated, not a run, not a repeated pair, not a year. */
export function pinProblem(pin: string): "format" | "simple" | null {
  if (!/^\d{4,6}$/.test(pin)) return "format";
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return "simple";
  const step = d[1]! - d[0]!;
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1]! === step)) return "simple";
  if (pin.length % 2 === 0 && pin === pin.slice(0, 2).repeat(pin.length / 2)) return "simple";
  if (pin.length === 4 && Number(pin) >= 1900 && Number(pin) <= 2099) return "simple";
  return null;
}

/** Idle minutes before a Device locks: 1 to 10, default 2. */
export function deviceIdleMinutes(setting: number | null | undefined): number {
  return setting && Number.isInteger(setting) && setting >= 1 && setting <= 10 ? setting : 2;
}

/** The PIN roles a user may give at the property: every one for the Property Manager, Housekeeper for the Housekeeping Supervisor. */
export function pinRolesFor(viewer: Actor, propertyId: string): PropertyRole[] {
  if (can(viewer, "manage_devices", propertyId)) return [...PIN_ROLES];
  return can(viewer, "manage_floor_users", propertyId) ? ["housekeeper"] : [];
}

/**
 * May the viewer create, reset or unlock this PIN user? A PIN works on every
 * Device of the tenant, so every role the person holds, at every property,
 * must be one the viewer may give there.
 */
export function mayLookAfterPinUser(viewer: Actor, target: Actor): boolean {
  if (target.tenantRole !== undefined || target.propertyRoles.length === 0) return false;
  return target.propertyRoles.every((r) => pinRolesFor(viewer, r.propertyId).includes(r.role));
}
