"use server";

import { revalidatePath } from "next/cache";
import { addHolding, bookFromGroup, createGroup, createSeries, setGroupPrices, setGroupStatus, setHeldRooms, setReleaseDate, updateGroup, type GroupInput } from "@hoteloftware/db";
import type { GroupStatus, PropertyAction } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { authorizeGroup } from "@/lib/groups";
import { field, formAction, type FormState } from "@/lib/form";

/** Groups (ticket 58): every action goes through the one permission check at the group's property (and the db layer checks again). */
async function viewer(action: PropertyAction, ref: { groupId?: string; holdingId?: string; propertyId?: string }) {
  const { tenant, session, actor } = await authorizeGroup(action, ref);
  return { schema: tenant.schemaName, viewer: { userId: session.user.id, actor } };
}

/** The organiser chosen: a Company; none chosen keeps a person organiser the group already has. */
const organiserOf = (formData: FormData): GroupInput["organiser"] => {
  const company = field(formData, "companyId");
  const guest = field(formData, "organiserGuestId");
  return company ? { companyId: company } : guest ? { guestId: guest } : null;
};

export async function createGroupAction(_prev: FormState & { id?: string }, formData: FormData): Promise<FormState & { id?: string }> {
  let id: string | undefined;
  const state = await formAction(async () => {
    const { schema, viewer: v } = await viewer("manage_groups", { propertyId: field(formData, "propertyId") });
    id = (
      await createGroup(
        pool(),
        schema,
        {
          propertyId: field(formData, "propertyId"),
          name: field(formData, "name"),
          organiser: organiserOf(formData),
          contact: field(formData, "contact"),
          optionDate: field(formData, "optionDate") || null,
          terms: field(formData, "terms"),
          reductionRules: field(formData, "reductionRules"),
          releaseDays: Number(field(formData, "releaseDays") || 14),
          basePlanId: field(formData, "basePlanId"),
        },
        v,
      )
    ).id;
    revalidatePath("/groups");
    return { ok: true, message: "Group created." };
  });
  return { ...state, ...(id ? { id } : {}) };
}

export async function updateGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const id = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("manage_groups", { groupId: id });
    await updateGroup(
      pool(),
      schema,
      id,
      { name: field(formData, "name"), organiser: organiserOf(formData), contact: field(formData, "contact"), optionDate: field(formData, "optionDate") || null, terms: field(formData, "terms"), reductionRules: field(formData, "reductionRules"), releaseDays: Number(field(formData, "releaseDays") || 14) },
      v,
    );
    revalidatePath(`/groups/${id}`);
    return { ok: true, message: "Saved." };
  });
}

export async function groupStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const id = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("manage_groups", { groupId: id });
    await setGroupStatus(pool(), schema, id, field(formData, "status") as GroupStatus, v);
    revalidatePath(`/groups/${id}`);
    return { ok: true, message: "Saved." };
  });
}

export async function addHoldingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const id = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("manage_groups", { groupId: id });
    const rooms = formData.getAll("roomTypeId").map((t, i) => ({ roomTypeId: String(t), rooms: Number(formData.getAll("rooms")[i] ?? 0) })).filter((r) => r.rooms > 0);
    await addHolding(pool(), schema, id, { arrival: field(formData, "arrival"), departure: field(formData, "departure"), releaseDate: field(formData, "releaseDate") || null, rooms }, v);
    revalidatePath(`/groups/${id}`);
    return { ok: true, message: "Held Rooms added." };
  });
}

export async function seriesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const id = field(formData, "groupId");
    const { schema, viewer: v } = await viewer("manage_groups", { groupId: id });
    const rooms = formData.getAll("roomTypeId").map((t, i) => ({ roomTypeId: String(t), rooms: Number(formData.getAll("rooms")[i] ?? 0) })).filter((r) => r.rooms > 0);
    const n = await createSeries(pool(), schema, id, { from: field(formData, "from"), to: field(formData, "to"), weekday: Number(field(formData, "weekday")), nights: Number(field(formData, "nights")), rooms }, v);
    revalidatePath(`/groups/${id}`);
    return { ok: true, message: `${n} departures created.` };
  });
}

/** The holding's grid: Held Rooms (the desk's) and contract prices (Revenue too) per room type and night; only what changed is sent. */
export async function saveGridAction(groupId: string, holdingId: string, changed: { rooms: { roomTypeId: string; date: string; rooms: number }[]; prices: { roomTypeId: string; date: string; price: number }[] }): Promise<FormState> {
  return formAction(async () => {
    if (changed.rooms.length) {
      const { schema, viewer: v } = await viewer("manage_groups", { holdingId });
      await setHeldRooms(pool(), schema, holdingId, changed.rooms.map((c) => ({ roomTypeId: c.roomTypeId, date: c.date, rooms: Number(c.rooms) })), v);
    }
    if (changed.prices.length) {
      const { schema, viewer: v } = await viewer("edit_group_contract", { groupId });
      await setGroupPrices(pool(), schema, groupId, changed.prices.map((c) => ({ roomTypeId: c.roomTypeId, date: c.date, price: Number(c.price) })), v);
    }
    revalidatePath(`/groups/${groupId}`);
    return { ok: true, message: "Saved." };
  });
}

export async function releaseDateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer("edit_group_contract", { holdingId: field(formData, "holdingId") });
    await setReleaseDate(pool(), schema, field(formData, "holdingId"), field(formData, "releaseDate"), v);
    revalidatePath(`/groups/${field(formData, "groupId")}`);
    return { ok: true, message: "Release Date saved." };
  });
}

export async function bookFromGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer("manage_groups", { holdingId: field(formData, "holdingId") });
    await bookFromGroup(pool(), schema, field(formData, "holdingId"), { roomTypeId: field(formData, "roomTypeId"), firstName: field(formData, "firstName"), lastName: field(formData, "lastName"), adults: Number(field(formData, "adults") || 2) }, v);
    revalidatePath(`/groups/${field(formData, "groupId")}`);
    return { ok: true, message: "Room booked for the group." };
  });
}
