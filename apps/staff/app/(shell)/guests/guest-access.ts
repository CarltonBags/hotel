import { canAtAnyProperty, type Actor } from "@hoteloftware/domain";

/**
 * What the signed-in user may do with tenant-wide Guest profiles (permission
 * matrix). Everyone who may view a profile may also see its contact data
 * (domain test guards this), so profile pages need no redaction.
 */
export function guestRights(actor: Actor) {
  return {
    edit: canAtAnyProperty(actor, "edit_guests"),
    merge: canAtAnyProperty(actor, "merge_guests"),
  };
}
