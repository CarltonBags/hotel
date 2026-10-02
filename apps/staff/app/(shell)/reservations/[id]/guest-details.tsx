"use client";

import type { Guest } from "@hoteloftware/db";
import type { RegistrationField } from "@hoteloftware/domain";
import { fill, type Messages } from "@/i18n/messages";
import { ActionForm } from "@/components/form-fields";
import { saveGuestAction } from "../../guests/actions";
import { GuestFields } from "../../guests/guest-fields";

/** Field keys to labels, for the list of registration gaps. */
export const REGISTRATION_LABEL: Record<RegistrationField, string> = {
  firstName: "guests.firstName",
  lastName: "guests.lastName",
  dateOfBirth: "guests.dateOfBirth",
  placeOfBirth: "guests.placeOfBirth",
  nationality: "guests.nationality",
  addressLine1: "guests.address",
  postalCode: "guests.postalCode",
  city: "field.city",
  countryOfResidence: "guests.countryOfResidence",
  documentType: "guests.reg.documentType",
  documentNumber: "guests.reg.documentNumber",
};

/** What the guest's registration still needs, or that it is complete. */
export function RegistrationStatus({ gaps, m }: { gaps: RegistrationField[]; m: Messages }) {
  return (
    <p role="status" className={`rounded-xl px-3 py-2 text-sm ${gaps.length ? "bg-danger/5 text-danger" : "bg-ink-5 text-ink-60"}`}>
      {gaps.length ? fill(m["guests.registrationGaps"], { fields: gaps.map((f) => m[REGISTRATION_LABEL[f] as keyof Messages]).join(", ") }) : m["guests.registrationComplete"]}
    </p>
  );
}

/** The Primary Guest's full details, editable in place, with what registration still needs. */
export function GuestDetails({
  guest,
  gaps,
  marked,
  canEdit,
  contacts,
  compact = false,
  m,
}: {
  guest: Guest;
  gaps: RegistrationField[];
  marked: RegistrationField[];
  canEdit: boolean;
  contacts: boolean;
  compact?: boolean;
  m: Messages;
}) {
  return (
    <div className="grid gap-3">
      <RegistrationStatus gaps={gaps} m={m} />
      {canEdit ? (
        <ActionForm action={saveGuestAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]}>
          <input type="hidden" name="id" value={guest.id} />
          <GuestFields guest={guest} contacts={contacts} readOnly={false} marked={marked} compact={compact} m={m} />
        </ActionForm>
      ) : (
        <GuestFields guest={guest} contacts={contacts} readOnly marked={marked} compact={compact} m={m} />
      )}
    </div>
  );
}
