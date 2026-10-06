"use server";

import { revalidatePath } from "next/cache";
import {
  assignGroupRooms,
  checkInGroup,
  createPlaceholderReservations,
  importRoomingList,
  invoiceMasterFolio,
  markGroupRegistrationSigned,
  nameGroupReservation,
  postGroupFee,
  previewRoomingList,
  roomingLink,
  saveGroupRegistration,
  setDepositSchedule,
  setGroupRouting,
  takeGroupPayment,
  type RoomingPreview,
} from "@hoteloftware/db";
import type { PropertyAction } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { authorizeGroup } from "@/lib/groups";
import { decimal, field, formAction, type FormState } from "@/lib/form";

/** A group's rooms and money (ticket 59): each action checked at the group's own property with the Groups Module on (the db layer checks again). */
async function viewer(action: PropertyAction, ref: { groupId?: string; holdingId?: string }) {
  const { tenant, session, actor } = await authorizeGroup(action, ref);
  return { schema: tenant.schemaName, viewer: { userId: session.user.id, actor } };
}

const refresh = (groupId: string) => {
  revalidatePath(`/groups/${groupId}`, "layout");
};

export async function groupRoutingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const groupId = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("manage_groups", { groupId });
    await setGroupRouting(pool(), schema, groupId, formData.getAll("category").map(String), v);
    refresh(groupId);
    return { ok: true, message: "Saved." };
  });
}

export async function placeholdersAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const holdingId = field(formData, "holdingId");
    const { schema, viewer: v } = await viewer("manage_groups", { holdingId });
    const n = await createPlaceholderReservations(pool(), schema, holdingId, v);
    refresh(field(formData, "groupId"));
    return { ok: true, message: `${n} reservation(s) made under placeholder names.` };
  });
}

export async function previewRoomingAction(holdingId: string, text: string): Promise<{ preview?: RoomingPreview; error?: string }> {
  try {
    const { schema, viewer: v } = await viewer("manage_groups", { holdingId });
    return { preview: await previewRoomingList(pool(), schema, holdingId, text, v) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The list could not be read" };
  }
}

export async function importRoomingAction(groupId: string, holdingId: string, text: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer("manage_groups", { holdingId });
    const r = await importRoomingList(pool(), schema, holdingId, text, v);
    refresh(groupId);
    return { ok: true, message: `${r.named} named, ${r.booked} booked, ${r.skipped} skipped.` };
  });
}

export async function roomingLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const groupId = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("manage_groups", { groupId });
    await roomingLink(pool(), schema, groupId, v);
    refresh(groupId);
    return { ok: true, message: "Link ready." };
  });
}

export async function depositScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const groupId = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("edit_group_contract", { groupId });
    const dates = formData.getAll("dueDate").map(String);
    const amounts = formData.getAll("amount").map((a) => Number(String(a).replace(",", ".")));
    await setDepositSchedule(pool(), schema, groupId, dates.map((d, i) => ({ dueDate: d, amount: amounts[i] ?? 0 })).filter((x) => x.dueDate || x.amount), v);
    refresh(groupId);
    return { ok: true, message: "Saved." };
  });
}

export async function groupPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const groupId = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("take_payments", { groupId });
    const r = await takeGroupPayment(pool(), schema, groupId, { amount: decimal(formData, "amount"), reference: field(formData, "reference") }, v);
    refresh(groupId);
    return { ok: true, message: r.depositInvoice ? `Payment recorded; Deposit Invoice ${r.depositInvoice.number} issued.` : "Payment recorded." };
  });
}

export async function masterInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const groupId = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("issue_invoices", { groupId });
    const inv = await invoiceMasterFolio(pool(), schema, groupId, v);
    refresh(groupId);
    return { ok: true, message: `Invoice ${inv.number} issued.` };
  });
}

export async function groupFeeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const groupId = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("post_charges", { groupId });
    await postGroupFee(pool(), schema, groupId, { description: field(formData, "description"), amount: decimal(formData, "amount") }, v);
    refresh(groupId);
    return { ok: true, message: "The fee is on the Master Folio." };
  });
}

export async function assignGroupRoomsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const holdingId = field(formData, "holdingId");
    const { schema, viewer: v } = await viewer("check_in", { holdingId });
    const r = await assignGroupRooms(pool(), schema, holdingId, field(formData, "by") === "section" ? "section" : "floor", v);
    refresh(field(formData, "groupId"));
    return { ok: true, message: r.without ? `${r.assigned} room(s) assigned; ${r.without} without a free room of their type.` : `${r.assigned} room(s) assigned.` };
  });
}

export async function checkInGroupAction(groupId: string, holdingId: string, reservationIds: string[] | null): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer("check_in", { holdingId });
    const r = await checkInGroup(pool(), schema, holdingId, reservationIds, v);
    refresh(groupId);
    if (r.failed.length) return { ok: false, error: `${r.checkedIn} checked in. Not checked in: ${r.failed.map((f) => `${f.guest} (${f.error})`).join("; ")}` };
    return { ok: true, message: `${r.checkedIn} checked in.` };
  });
}

export async function nameReservationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const holdingId = field(formData, "holdingId");
    const { schema, viewer: v } = await viewer("manage_groups", { holdingId });
    await nameGroupReservation(pool(), schema, field(formData, "reservationId"), { firstName: field(formData, "firstName"), lastName: field(formData, "lastName") }, v);
    refresh(field(formData, "groupId"));
    return { ok: true, message: "Saved." };
  });
}

export async function groupRegistrationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const holdingId = field(formData, "holdingId");
    const { schema, viewer: v } = await viewer("check_in", { holdingId });
    const nationalities = formData.getAll("memberNationality").map(String);
    const counts = formData.getAll("memberCount").map((c) => Number(c || 0));
    await saveGroupRegistration(
      pool(),
      schema,
      holdingId,
      {
        leaderFirstName: field(formData, "leaderFirstName"),
        leaderLastName: field(formData, "leaderLastName"),
        leaderNationality: field(formData, "leaderNationality"),
        leaderBirthDate: field(formData, "leaderBirthDate") || null,
        leaderAddress: field(formData, "leaderAddress"),
        members: nationalities.map((n, i) => ({ nationality: n, count: counts[i] ?? 0 })),
      },
      v,
    );
    refresh(field(formData, "groupId"));
    return { ok: true, message: "Saved." };
  });
}

export async function registrationSignedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const holdingId = field(formData, "holdingId");
    const { schema, viewer: v } = await viewer("check_in", { holdingId });
    await markGroupRegistrationSigned(pool(), schema, holdingId, v);
    refresh(field(formData, "groupId"));
    return { ok: true, message: "Marked as signed." };
  });
}
