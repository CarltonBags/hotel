"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { createEnrolment, createPinUser, revokeDevice, setDeviceUsers, setPin, type DeviceKind } from "@hoteloftware/auth";
import { findTenantUser, setDeviceIdleMinutes } from "@hoteloftware/db";
import { PIN_ROLES, can, canUsePin, type PropertyRole } from "@hoteloftware/domain";
import { auth } from "@/lib/auth";
import { ForbiddenError, authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, integerOrNull, type FormState } from "@/lib/form";

/** Devices and PIN users (ticket 14): Devices by the Property Manager; floor users also by the Housekeeping Supervisor. */

const PATH = "/settings/devices";

export interface EnrolState extends FormState {
  url?: string;
  qr?: string;
  expiresAt?: string;
}

async function devices(formData: FormData) {
  const propertyId = field(formData, "propertyId");
  const p = await authorize("manage_devices", propertyId);
  return { ...p, propertyId };
}

/**
 * A floor user the signed-in user may look after at the property: someone
 * who signs in by PIN there. A Housekeeping Supervisor looks after
 * Housekeepers only; the Property Manager after every floor role.
 */
async function floorUser(formData: FormData) {
  const propertyId = field(formData, "propertyId");
  const p = await authorize("manage_floor_users", propertyId);
  const user = await findTenantUser(pool(), p.tenant.id, field(formData, "userId"));
  const roles = user?.propertyRoles.filter((r) => r.propertyId === propertyId).map((r) => r.role) ?? [];
  if (!user || !canUsePin({ tenantRole: user.tenantRole, propertyRoles: user.propertyRoles }, propertyId)) throw new Error("Not a floor user of this property");
  if (!can(p.actor, "manage_devices", propertyId) && !roles.every((r) => r === "housekeeper")) throw new ForbiddenError("manage_floor_users", propertyId);
  return { ...p, propertyId, user };
}

export async function enrolAction(_prev: EnrolState, formData: FormData): Promise<EnrolState> {
  let result: EnrolState = {};
  const state = await formAction(async () => {
    const { tenant, session, propertyId } = await devices(formData);
    const owner = field(formData, "ownerUserId");
    const { code, expiresAt } = await createEnrolment(pool(), {
      tenantId: tenant.id,
      propertyId,
      kind: field(formData, "kind") as DeviceKind,
      name: field(formData, "name"),
      ownerUserId: owner || null,
      userIds: owner ? [] : formData.getAll("userIds").map(String),
      createdBy: session.user.id,
    });
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const scheme = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https");
    const url = `${scheme}://${host}/device/enrol?code=${encodeURIComponent(code)}`;
    result = { url, qr: await QRCode.toString(url, { type: "svg", margin: 1 }), expiresAt: expiresAt.toISOString() };
    revalidatePath(PATH);
  });
  return { ...state, ...result };
}

export async function revokeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await devices(formData);
    await revokeDevice(pool(), tenant.id, field(formData, "deviceId"), session.user.id);
    revalidatePath(PATH);
    return { ok: true, message: "Revoked. Its sessions have ended; it wipes its data when it next calls." };
  });
}

export async function deviceUsersAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await devices(formData);
    await setDeviceUsers(pool(), tenant.id, field(formData, "deviceId"), formData.getAll("userIds").map(String));
    revalidatePath(PATH);
  });
}

export async function idleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, propertyId } = await devices(formData);
    await setDeviceIdleMinutes(pool(), tenant.schemaName, propertyId, integerOrNull(formData, "minutes") ?? 0);
    revalidatePath(PATH);
  });
}

export async function createPinUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session, actor } = await authorize("manage_floor_users", propertyId);
    const role = field(formData, "role") as PropertyRole;
    if (!PIN_ROLES.includes(role)) throw new Error("Only floor roles sign in by PIN");
    // the Housekeeping Supervisor creates Housekeepers
    if (role !== "housekeeper" && !can(actor, "manage_devices", propertyId)) throw new ForbiddenError("manage_floor_users", propertyId);
    await createPinUser(auth(), pool(), { tenantId: tenant.id, propertyId, username: field(formData, "username"), name: field(formData, "name"), role, pin: field(formData, "pin"), createdBy: session.user.id });
    revalidatePath(PATH);
    return { ok: true, message: "Created. Add them to a Device; they choose their own PIN at first sign-in." };
  });
}

export async function resetPinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session, user } = await floorUser(formData);
    await setPin((await auth().$context).password.hash, pool(), { tenantId: tenant.id, userId: user.id, pin: field(formData, "pin"), byUserId: session.user.id, mustChange: true });
    revalidatePath(PATH);
    return { ok: true, message: "New PIN set and unlocked. They choose their own at next sign-in." };
  });
}
