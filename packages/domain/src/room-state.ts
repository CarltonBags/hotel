/**
 * Room state (ticket 33, ADR 0011): Cleanliness set by staff, Occupancy
 * derived from reservations, dated Room Blocks. Who may see and set what
 * follows the permission matrix: a Housekeeper works only their own rooms
 * (those with a Housekeeping Task assigned to them for the Business Date).
 */
import { rolesAt, type Actor, type PropertyRole } from "./permissions";

export const CLEANLINESS = ["dirty", "clean", "inspected"] as const;
export type Cleanliness = (typeof CLEANLINESS)[number];

export const ROOM_BLOCK_KINDS = ["out_of_order", "out_of_service"] as const;
export type RoomBlockKind = (typeof ROOM_BLOCK_KINDS)[number];

/** Why a room turned Dirty (or was set by hand). */
export type CleanlinessSource = "manual" | "check_out" | "room_move" | "block_end" | "night_audit";

/** Ready for a guest: Inspected, or Clean where the property does not inspect. */
export function isReady(cleanliness: Cleanliness, inspectionRequired: boolean): boolean {
  return cleanliness === "inspected" || (!inspectionRequired && cleanliness === "clean");
}

/** "all" rooms, only the user's "own" rooms (Housekeeper), or "none". */
export type RoomScope = "all" | "own" | "none";

const ALL_ROOMS: readonly PropertyRole[] = ["property_manager", "front_desk", "housekeeping_supervisor", "maintenance"];

/** Matrix "View Cleanliness and Room Blocks". */
export function roomViewScope(actor: Actor, propertyId: string): RoomScope {
  const roles = rolesAt(actor, propertyId);
  if (roles.some((r) => ALL_ROOMS.includes(r))) return "all";
  return roles.includes("housekeeper") ? "own" : "none";
}

/** Matrix "Set Dirty", "Set Clean", "Set Inspected": Front Desk may set Clean and Inspected; a Housekeeper Dirty and Clean on own rooms. */
export function cleanlinessScope(actor: Actor, propertyId: string, to: Cleanliness): RoomScope {
  const roles = rolesAt(actor, propertyId);
  if (roles.some((r) => r === "property_manager" || r === "front_desk" || r === "housekeeping_supervisor")) return "all";
  return to !== "inspected" && roles.includes("housekeeper") ? "own" : "none";
}

/**
 * The Room Features a guest's preferences mention: a feature counts when its
 * name or code appears in the free-text preferences (case and accents aside).
 */
export function preferredFeatures<F extends { code: string; name: string }>(preferences: string, features: F[]): F[] {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
  const text = ` ${norm(preferences).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  if (!text.trim()) return [];
  return features.filter((f) => [f.name, f.code].some((w) => {
    const word = norm(w).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return word.length >= 2 && text.includes(` ${word} `);
  }));
}
