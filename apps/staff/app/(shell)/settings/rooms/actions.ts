"use server";

import { revalidatePath } from "next/cache";
import { GUEST_LANGUAGES, expandRoomNumbers } from "@hoteloftware/domain";
import { fill } from "@/i18n/messages";
import { loadShell } from "@/lib/shell";
import {
  AgeBandError,
  createRoomFeature,
  createRoomType,
  createRooms,
  createSection,
  deleteRoom,
  deleteRoomFeature,
  deleteRoomType,
  deleteSection,
  findProperty,
  renameSection,
  saveAgeBands,
  updateRoom,
  updateRoomFeature,
  updateRoomType,
} from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

const PATH = "/settings/rooms";

/** Every action names its property and goes through the one permission check for it. */
async function scoped(formData: FormData) {
  const propertyId = field(formData, "propertyId");
  const { tenant } = await authorize("manage_property_settings", propertyId);
  const property = await findProperty(pool(), tenant.schemaName, propertyId);
  if (!property) throw new Error("Property not found");
  return { schema: tenant.schemaName, propertyId };
}

function int(formData: FormData, name: string, fallback?: number): number {
  const raw = field(formData, name);
  if (raw === "" && fallback !== undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name}: whole number expected`);
  return n;
}

/** Every guest language's field, empty meaning "remove this version" (merged in the repository). */
function names(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of GUEST_LANGUAGES) out[lang] = field(formData, `name_${lang}`);
  return out;
}

export async function saveRoomType(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    const input = {
      code: field(formData, "code"),
      name: field(formData, "name"),
      names: names(formData),
      maxOccupancy: int(formData, "maxOccupancy"),
      maxAdults: int(formData, "maxAdults"),
      bedPlaces: int(formData, "bedPlaces"),
      extraBeds: int(formData, "extraBeds", 0),
    };
    const id = field(formData, "id");
    if (id) await updateRoomType(pool(), schema, propertyId, id, input);
    else await createRoomType(pool(), schema, { propertyId, ...input });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function removeRoomType(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    await deleteRoomType(pool(), schema, propertyId, field(formData, "id"));
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function addRooms(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    const numbers = expandRoomNumbers(field(formData, "numbers"));
    const created = await createRooms(pool(), schema, {
      propertyId,
      roomTypeId: field(formData, "roomTypeId"),
      numbers,
      floor: field(formData, "floor"),
      sectionId: field(formData, "sectionId") || null,
    });
    revalidatePath(PATH);
    return { ok: true, message: `${created.length} rooms added.` };
  });
}

export async function saveRoom(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    await updateRoom(pool(), schema, propertyId, field(formData, "id"), {
      number: field(formData, "number"),
      name: field(formData, "name"),
      names: names(formData),
      floor: field(formData, "floor"),
      roomTypeId: field(formData, "roomTypeId"),
      sectionId: field(formData, "sectionId") || null,
      featureIds: formData.getAll("featureIds").map(String),
      bedPlaces: int(formData, "bedPlaces"),
      extraBeds: int(formData, "extraBeds", 0),
      ...(field(formData, "validFrom") ? { validFrom: field(formData, "validFrom") } : {}),
    });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function removeRoom(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    await deleteRoom(pool(), schema, propertyId, field(formData, "id"));
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function addFeature(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    await createRoomFeature(pool(), schema, { propertyId, code: field(formData, "code") || field(formData, "name"), name: field(formData, "name"), names: names(formData) });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function saveFeature(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    await updateRoomFeature(pool(), schema, propertyId, field(formData, "id"), { name: field(formData, "name"), names: names(formData) });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function removeFeature(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    await deleteRoomFeature(pool(), schema, propertyId, field(formData, "id"));
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function addSection(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    await createSection(pool(), schema, { propertyId, name: field(formData, "name") });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function saveSection(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    if (formData.get("delete")) await deleteSection(pool(), schema, propertyId, field(formData, "id"));
    else await renameSection(pool(), schema, propertyId, field(formData, "id"), field(formData, "name"));
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function saveBands(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scoped(formData);
    const names = formData.getAll("bandName").map(String);
    const mins = formData.getAll("bandMin").map(String);
    const maxs = formData.getAll("bandMax").map(String);
    const bands = names
      .map((name, i) => ({ name: name.trim(), min: (mins[i] ?? "").trim(), max: (maxs[i] ?? "").trim() }))
      .filter((b) => b.name !== "" || b.min !== "" || b.max !== "")
      .map((b) => {
        if (!b.name) throw new Error("Every Age Band needs a name");
        const minAge = Number(b.min);
        const maxAge = b.max === "" ? null : Number(b.max);
        if (b.min === "" || !Number.isInteger(minAge) || (maxAge !== null && !Number.isInteger(maxAge))) throw new Error(`Age Band ${b.name}: ages must be whole numbers`);
        return { name: b.name, minAge, maxAge };
      });
    try {
      await saveAgeBands(pool(), schema, propertyId, bands);
    } catch (err) {
      if (err instanceof AgeBandError) {
        const { messages } = await loadShell();
        throw new Error(fill(messages[`rooms.ageBandProblem.${err.problem}`], { band: err.bandName }));
      }
      throw err;
    }
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}
