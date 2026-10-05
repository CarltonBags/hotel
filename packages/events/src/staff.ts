import type { Pool } from "pg";
import { URGENT_NOTIFICATIONS, can, receivesUrgentSms, type Action } from "@hoteloftware/domain";
import { listTenantUsers, notificationChannelsOf, queueMail, queueSms, type TenantUser } from "@hoteloftware/db";
import { publishNotification } from "./index";

export interface StaffNotification {
  kind: string;
  title: string;
  body?: string;
  href?: string;
  /** The property it is about: whose Property Managers count for SMS. Null for the whole tenant. */
  propertyId: string | null;
}

/**
 * Notify staff users (ticket 39): in the app always; by email where the user
 * wants it; by SMS for the urgent kinds, to Property Managers (Owner and
 * Tenant Admin count as one) who gave a phone. Mail and SMS go through the
 * outboxes, sent by the worker's dispatch.
 */
export async function notifyStaff(pool: Pool, tenant: { id: string; schemaName: string }, users: TenantUser[], n: StaffNotification): Promise<void> {
  const channels = await notificationChannelsOf(pool, users.map((u) => u.id));
  const urgent = (URGENT_NOTIFICATIONS as readonly string[]).includes(n.kind);
  for (const u of users) {
    await publishNotification(pool, { tenantId: tenant.id, userId: u.id, kind: n.kind, title: n.title, body: n.body ?? "", ...(n.href ? { href: n.href } : {}) });
    const c = channels.get(u.id)!;
    // PIN-only floor staff have no address of their own
    if (c.email && !u.pinOnly && u.email) await queueMail(pool, tenant.schemaName, { tenantId: tenant.id, toUserId: u.id, subject: n.title, body: n.body || n.title });
    if (urgent && c.sms && c.phone && receivesUrgentSms({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, n.propertyId)) {
      await queueSms(pool, tenant.schemaName, { toUserId: u.id, toPhone: c.phone, body: `Hoteloftware: ${n.title}` });
    }
  }
}

/** Notify the users who hold a right at the property (the desk that can take a payment, say). */
export async function notifyWithRight(pool: Pool, tenant: { id: string; schemaName: string }, action: Action, propertyId: string, n: Omit<StaffNotification, "propertyId">): Promise<void> {
  await notifyStaff(pool, tenant, await usersWithRight(pool, tenant.id, action, propertyId), { ...n, propertyId });
}

async function usersWithRight(pool: Pool, tenantId: string, action: Action, propertyId: string): Promise<TenantUser[]> {
  return (await listTenantUsers(pool, tenantId)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, action, propertyId));
}

/** A guest's online payment was declined in the Guest Portal: the desk is told once (ticket 41). */
export function notifyPortalDecline(pool: Pool, tenant: { id: string; schemaName: string }, d: { reservationId: string; propertyId: string; reason: string }): Promise<void> {
  return notifyWithRight(pool, tenant, "take_payments", d.propertyId, { kind: "payments.portal_declined", title: "Online payment declined in the Guest Portal", body: d.reason, href: `/reservations/${d.reservationId}` });
}

/** Why a guest needs help at Self Check-in, in the desk's words (ticket 49). */
const SELF_CHECKIN_REASON: Record<string, string> = {
  arrival_day: "not the arrival day",
  too_early: "before the check-in time",
  registration: "the registration needs reception",
  payment: "a balance is due",
  room_not_ready: "the room is not ready",
};

/**
 * How a Self Check-in ended, told to the desk (ticket 49): a guest who needs
 * help, or waits for a room, as any notification; a completed check-in only
 * in the app (one per arrival would flood the mailbox), unless the
 * registration still waits for the desk's ID Check.
 */
export async function notifySelfCheckin(
  pool: Pool,
  tenant: { id: string; schemaName: string },
  r: { reservationId: string; propertyId: string; guestName: string; outcome: "checked_in" | "waiting" | "help"; roomNumber: string | null; failed: string[]; idCheckOpen: boolean },
): Promise<void> {
  const href = `/reservations/${r.reservationId}`;
  if (r.outcome === "help") {
    const why = r.failed.map((c) => SELF_CHECKIN_REASON[c] ?? c).join(", ") || "the stay changed meanwhile";
    return notifyWithRight(pool, tenant, "check_in", r.propertyId, { kind: "self_checkin.help", title: `${r.guestName} needs help at Self Check-in`, body: `Reason: ${why}.`, href });
  }
  if (r.outcome === "waiting") return notifyWithRight(pool, tenant, "check_in", r.propertyId, { kind: "self_checkin.waiting", title: `${r.guestName} is waiting for a room`, body: "Arrived, Waiting for Room: tell the guest the room once it is ready.", href });
  const body = `${r.guestName} · Room ${r.roomNumber ?? "?"}`;
  if (r.idCheckOpen) return notifyWithRight(pool, tenant, "check_in", r.propertyId, { kind: "self_checkin.id_check", title: "Self check-in complete: ID Check open", body: `${body}. Compare the registration with the guest's document to complete it.`, href });
  for (const u of await usersWithRight(pool, tenant.id, "check_in", r.propertyId)) await publishNotification(pool, { tenantId: tenant.id, userId: u.id, kind: "self_checkin.done", title: "Self check-in complete", body, href });
}

/** The TSE could not sign (ticket 51): who runs the property's cash desk hears of the outage once, when it starts (urgent: the Property Managers by SMS too). */
export function notifyFiscalOutage(pool: Pool, tenant: { id: string; schemaName: string }, o: { propertyId: string; error: string }): Promise<void> {
  return notifyWithRight(pool, tenant, "manage_cash_desk", o.propertyId, {
    kind: "fiscal.outage",
    title: "TSE outage: Receipts are not signed",
    body: `The desk goes on; Receipts carry the outage notice until the TSE answers again. Reason: ${o.error}`,
    href: "/settings/cash-desk",
  });
}

/** Austria (ticket 52): an outage over 48 hours, to be reported to FinanzOnline within a week, with what the report needs. */
export function notifyAtOutageReport(pool: Pool, tenant: { id: string; schemaName: string }, o: { propertyId: string; propertyName: string; registerSerial: string; startedAt: Date; endedAt: Date | null; reportBy: Date; error: string }): Promise<void> {
  const at = (d: Date) => d.toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
  return notifyWithRight(pool, tenant, "manage_cash_desk", o.propertyId, {
    kind: "fiscal.outage",
    title: `Report the outage to FinanzOnline by ${at(o.reportBy)}`,
    body: `${o.propertyName}, Kassen-ID ${o.registerSerial}: out since ${at(o.startedAt)}${o.endedAt ? ` until ${at(o.endedAt)}` : " (ongoing)"}. Reason: ${o.error}. Report it in FinanzOnline, then mark it reported in Settings → Cash desk.`,
    href: "/settings/cash-desk",
  });
}

/** Austria: the yearly receipt is printed and checked by 15 February. */
export function notifyYearlyReceipt(pool: Pool, tenant: { id: string; schemaName: string }, r: { propertyId: string; registerSerial: string; checkBy: string }): Promise<void> {
  return notifyWithRight(pool, tenant, "manage_cash_desk", r.propertyId, {
    kind: "fiscal.yearly_receipt",
    title: `Print and check the yearly receipt by ${r.checkBy}`,
    body: `Kassen-ID ${r.registerSerial}: print the yearly receipt, check it, then mark it in Settings → Cash desk.`,
    href: "/settings/cash-desk",
  });
}
