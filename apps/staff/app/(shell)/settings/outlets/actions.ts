"use server";

import { revalidatePath } from "next/cache";
import { createOutlet, saveMenuItem, savePrinter, saveSpaRoom, saveTable, saveTherapist, saveTreatment, setOutletManagers, setSpaCancelHours, setSpendingLimit, updateOutlet } from "@hoteloftware/db";
import { authorizeOutlet } from "@/lib/outlets";
import { field, flag, formAction, type FormState } from "@/lib/form";
import { pool } from "@/lib/db";

/** Outlets (ticket 60): defined by the Property Manager; menu, printers and tables by the Property Manager or the outlet's own Outlet Manager (the db layer checks which). */
const outletInput = (formData: FormData) => ({
  name: field(formData, "name"),
  kind: field(formData, "kind"),
  cashRegisterId: field(formData, "cashRegisterId") || null,
  active: flag(formData, "active"),
  ...(field(formData, "discountPercent") ? { discountPercent: Number(field(formData, "discountPercent").replace(",", ".")) } : {}),
});

/** The property's Spending Limit per night for Room Charges (ticket 61). */
export async function spendingLimitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, viewer } = await authorizeOutlet("manage_outlets", { propertyId });
    await setSpendingLimit(pool(), tenant.schemaName, propertyId, Number(field(formData, "limit").replace(",", ".")), viewer);
    revalidatePath("/settings/outlets");
    return { ok: true, message: "Saved." };
  });
}

export async function createOutletAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, viewer } = await authorizeOutlet("manage_outlets", { propertyId });
    await createOutlet(pool(), tenant.schemaName, propertyId, outletInput(formData), viewer);
    revalidatePath("/settings/outlets");
    return { ok: true, message: "Outlet created." };
  });
}

export async function updateOutletAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const outletId = field(formData, "outletId");
    const { tenant, viewer } = await authorizeOutlet("manage_outlets", { outletId });
    await updateOutlet(pool(), tenant.schemaName, outletId, outletInput(formData), viewer);
    await setOutletManagers(pool(), tenant.schemaName, outletId, formData.getAll("managerId").map(String), viewer);
    revalidatePath("/settings/outlets");
    return { ok: true, message: "Saved." };
  });
}

const setupPath = (outletId: string) => `/outlets/${outletId}`;

export async function savePrinterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const outletId = field(formData, "outletId");
    const { tenant, viewer } = await authorizeOutlet("manage_own_outlets", { outletId });
    await savePrinter(pool(), tenant.schemaName, outletId, { id: field(formData, "id") || undefined, name: field(formData, "name"), kind: field(formData, "kind") as "kitchen", address: field(formData, "address"), active: flag(formData, "active") }, viewer);
    revalidatePath(setupPath(outletId));
    return { ok: true, message: "Saved." };
  });
}

export async function saveTableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const outletId = field(formData, "outletId");
    const { tenant, viewer } = await authorizeOutlet("manage_own_outlets", { outletId });
    await saveTable(pool(), tenant.schemaName, outletId, { id: field(formData, "id") || undefined, name: field(formData, "name"), seats: Number(field(formData, "seats") || 4), sortOrder: Number(field(formData, "sortOrder") || 0), active: flag(formData, "active") }, viewer);
    revalidatePath(setupPath(outletId));
    return { ok: true, message: "Saved." };
  });
}

/** Modifiers typed as "no ice:0; double:4". */
const modifiersOf = (text: string) =>
  text
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [name, price] = x.split(":");
      return { name: (name ?? "").trim(), price: Number(String(price ?? "0").replace(",", ".")) || 0 };
    });

export async function saveMenuItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const outletId = field(formData, "outletId");
    const { tenant, viewer } = await authorizeOutlet("manage_own_outlets", { outletId });
    await saveMenuItem(
      pool(),
      tenant.schemaName,
      outletId,
      {
        id: field(formData, "id") || undefined,
        serviceId: field(formData, "serviceId"),
        name: field(formData, "name"),
        category: field(formData, "category"),
        price: Number(field(formData, "price").replace(",", ".")),
        printerId: field(formData, "printerId") || null,
        modifiers: modifiersOf(field(formData, "modifiers")),
        active: flag(formData, "active"),
        sortOrder: Number(field(formData, "sortOrder") || 0),
      },
      viewer,
    );
    revalidatePath(setupPath(outletId));
    return { ok: true, message: "Saved." };
  });
}

// ── the spa (ticket 63): therapists, treatment rooms, treatments ──

export async function spaCancelHoursAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const outletId = field(formData, "outletId");
    const { tenant, viewer } = await authorizeOutlet("manage_own_outlets", { outletId });
    await setSpaCancelHours(pool(), tenant.schemaName, outletId, Number(field(formData, "hours")), viewer);
    revalidatePath(setupPath(outletId));
    return { ok: true, message: "Saved." };
  });
}

export async function saveTherapistAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const outletId = field(formData, "outletId");
    const { tenant, viewer } = await authorizeOutlet("manage_own_outlets", { outletId });
    await saveTherapist(pool(), tenant.schemaName, outletId, { id: field(formData, "id") || undefined, name: field(formData, "name"), active: flag(formData, "active") }, viewer);
    revalidatePath(setupPath(outletId));
    return { ok: true, message: "Saved." };
  });
}

export async function saveSpaRoomAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const outletId = field(formData, "outletId");
    const { tenant, viewer } = await authorizeOutlet("manage_own_outlets", { outletId });
    await saveSpaRoom(pool(), tenant.schemaName, outletId, { id: field(formData, "id") || undefined, name: field(formData, "name"), active: flag(formData, "active") }, viewer);
    revalidatePath(setupPath(outletId));
    return { ok: true, message: "Saved." };
  });
}

export async function saveTreatmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const outletId = field(formData, "outletId");
    const { tenant, viewer } = await authorizeOutlet("manage_own_outlets", { outletId });
    await saveTreatment(pool(), tenant.schemaName, outletId, { menuItemId: field(formData, "menuItemId"), minutes: Number(field(formData, "minutes")), needsRoom: flag(formData, "needsRoom"), active: flag(formData, "active") }, viewer);
    revalidatePath(setupPath(outletId));
    return { ok: true, message: "Saved." };
  });
}
