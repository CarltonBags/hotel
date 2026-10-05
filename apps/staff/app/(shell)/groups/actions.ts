"use server";

import { revalidatePath } from "next/cache";
import { addHolding, bookFromGroup, createGroup, createSeries, setGroupPrices, setGroupStatus, setHeldRooms, setReleaseDate, updateGroup, type GroupInput } from "@hoteloftware/db";
import type { GroupStatus } from "@hoteloftware/domain";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

/** Groups (ticket 58): every change checks the group's right at its property in the db layer. */
async function viewer() {
  const { tenant, session, actor } = await requirePrincipal();
  return { schema: tenant.schemaName, viewer: { userId: session.user.id, actor } };
}

const organiserOf = (formData: FormData): GroupInput["organiser"] => {
  const company = field(formData, "companyId");
  return company ? { companyId: company } : null;
};

export async function createGroupAction(_prev: FormState & { id?: string }, formData: FormData): Promise<FormState & { id?: string }> {
  let id: string | undefined;
  const state = await formAction(async () => {
    const { schema, viewer: v } = await viewer();
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
    const { schema, viewer: v } = await viewer();
    const id = field(formData, "groupId");
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
    const { schema, viewer: v } = await viewer();
    const id = field(formData, "groupId");
    await setGroupStatus(pool(), schema, id, field(formData, "status") as GroupStatus, v);
    revalidatePath(`/groups/${id}`);
    return { ok: true, message: "Saved." };
  });
}

export async function addHoldingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer();
    const id = field(formData, "groupId");
    const rooms = formData.getAll("roomTypeId").map((t, i) => ({ roomTypeId: String(t), rooms: Number(formData.getAll("rooms")[i] ?? 0) })).filter((r) => r.rooms > 0);
    await addHolding(pool(), schema, id, { arrival: field(formData, "arrival"), departure: field(formData, "departure"), releaseDate: field(formData, "releaseDate") || null, rooms }, v);
    revalidatePath(`/groups/${id}`);
    return { ok: true, message: "Held Rooms added." };
  });
}

export async function seriesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer();
    const id = field(formData, "groupId");
    const rooms = formData.getAll("roomTypeId").map((t, i) => ({ roomTypeId: String(t), rooms: Number(formData.getAll("rooms")[i] ?? 0) })).filter((r) => r.rooms > 0);
    const n = await createSeries(pool(), schema, id, { from: field(formData, "from"), to: field(formData, "to"), weekday: Number(field(formData, "weekday")), nights: Number(field(formData, "nights")), rooms }, v);
    revalidatePath(`/groups/${id}`);
    return { ok: true, message: `${n} departures created.` };
  });
}

/** The holding's grid: Held Rooms and contract prices per room type and night. */
export async function saveGridAction(groupId: string, holdingId: string, cells: { roomTypeId: string; date: string; rooms: number; price: number | null }[]): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer();
    await setHeldRooms(pool(), schema, holdingId, cells.map((c) => ({ roomTypeId: c.roomTypeId, date: c.date, rooms: Number(c.rooms) })), v);
    const priced = cells.filter((c) => c.price !== null && Number.isFinite(c.price));
    if (priced.length) await setGroupPrices(pool(), schema, groupId, priced.map((c) => ({ roomTypeId: c.roomTypeId, date: c.date, price: Number(c.price) })), v);
    revalidatePath(`/groups/${groupId}`);
    return { ok: true, message: "Saved." };
  });
}

export async function releaseDateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer();
    await setReleaseDate(pool(), schema, field(formData, "holdingId"), field(formData, "releaseDate"), v);
    revalidatePath(`/groups/${field(formData, "groupId")}`);
    return { ok: true, message: "Release Date saved." };
  });
}

export async function bookFromGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer: v } = await viewer();
    await bookFromGroup(pool(), schema, field(formData, "holdingId"), { roomTypeId: field(formData, "roomTypeId"), firstName: field(formData, "firstName"), lastName: field(formData, "lastName"), adults: Number(field(formData, "adults") || 2) }, v);
    revalidatePath(`/groups/${field(formData, "groupId")}`);
    return { ok: true, message: "Room booked for the group." };
  });
}
