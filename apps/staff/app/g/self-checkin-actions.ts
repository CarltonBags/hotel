"use server";

import { claimDeclineNotice, findForKiosk, finishCardSetup, finishPortalPayment, finishSelfCheckin, selfCheckinRegister, selfCheckinStep, selfCheckinView, startSelfCheckin, TabletProblem, type SelfCheckinChannel, type SelfCheckinStep, type SelfCheckinView, type TabletInput } from "@hoteloftware/db";
import type { CheckInCondition } from "@hoteloftware/domain";
import { notifyPortalDecline, notifySelfCheckin } from "@hoteloftware/events";
import { paymentProvider } from "@hoteloftware/payments";
import { pool } from "@/lib/db";
import { currentKiosk } from "@/lib/tablet";
import { currentTenant } from "@/lib/tenant";

/**
 * Self Check-in (ticket 49). The Portal Link's key is the guest's authority;
 * on an enrolled kiosk the stay is found first and the kiosk serves its own
 * property only. The guest sees plain words, never a database message.
 */
async function context(): Promise<{ schema: string; tenant: { id: string; schemaName: string }; channel: SelfCheckinChannel }> {
  const kiosk = await currentKiosk();
  if (kiosk) return { schema: kiosk.tenant.schemaName, tenant: kiosk.tenant, channel: { kind: "kiosk", deviceId: kiosk.device.id, propertyId: kiosk.device.propertyId } };
  const tenant = await currentTenant();
  if (!tenant) throw new Error("Not found");
  return { schema: tenant.schemaName, tenant, channel: { kind: "phone" } };
}

export type SelfCheckinAnswer = { ok: true; view: SelfCheckinView } | { ok: false; error: string };

/** What the guest may read of a refusal: our own words to guests; anything else is "error". */
const GUEST_WORDS = new Set([
  "This link does not open anything",
  "Start Self Check-in again",
  "This stay cannot be checked in",
  "Reception will help you with the registration",
  "Tell us you are at the hotel first",
  "Nothing is due",
  "Nothing can be paid on this stay any more",
  "A card cannot be left on this stay any more",
  "A payment is still being confirmed; please wait a moment and reload",
]);

const fail = (err: unknown): { ok: false; error: string } => {
  if (err instanceof TabletProblem) return { ok: false, error: `field:${err.message}` };
  if (err instanceof Error && GUEST_WORDS.has(err.message)) return { ok: false, error: err.message };
  console.error("[self-checkin]", err);
  return { ok: false, error: "error" };
};

/** The kiosk finds today's arrival: number and last name, or the Portal Link of the confirmation's QR code. */
export async function findAction(q: { confirmationNumber: string; lastName: string } | { link: string }): Promise<{ ok: true; key: string } | { ok: false }> {
  const kiosk = await currentKiosk();
  if (!kiosk) return { ok: false };
  const key = "link" in q ? /\/g\/([0-9a-f]{64})(?:[/?#]|$)/.exec(String(q.link))?.[1] : null;
  if ("link" in q && !key) return { ok: false };
  const found = await findForKiosk(pool(), kiosk.tenant.schemaName, kiosk.device.propertyId, key ? { key } : { confirmationNumber: String((q as { confirmationNumber: string }).confirmationNumber).slice(0, 40), lastName: String((q as { lastName: string }).lastName).slice(0, 80) });
  return found ? { ok: true, key: found } : { ok: false };
}

export async function startAction(key: string): Promise<SelfCheckinAnswer> {
  try {
    const c = await context();
    return { ok: true, view: await startSelfCheckin(pool(), c.schema, key, c.channel) };
  } catch (err) {
    return fail(err);
  }
}

export async function viewAction(key: string): Promise<SelfCheckinAnswer> {
  try {
    const c = await context();
    return { ok: true, view: await selfCheckinView(pool(), c.schema, key, c.channel) };
  } catch (err) {
    return fail(err);
  }
}

export async function stepAction(key: string, step: SelfCheckinStep): Promise<void> {
  const c = await context();
  await selfCheckinStep(pool(), c.schema, key, step, c.channel).catch(() => undefined);
}

const REGISTER_STEPS = ["details", "companions", "back", "review"];
const MAX_SIGNATURE = 512 * 1024;

/** One step of the registration on screen; the signature comes as a PNG data URL. */
export async function registerAction(key: string, raw: Record<string, unknown>): Promise<SelfCheckinAnswer> {
  try {
    if (!raw || !REGISTER_STEPS.includes(String(raw.step))) return { ok: false, error: "error" };
    const signature = typeof raw.signature === "string" && raw.signature.length < MAX_SIGNATURE ? raw.signature : null;
    const input = (raw.step === "review" ? { step: "review", signaturePng: signature ? Uint8Array.from(Buffer.from(signature.replace(/^data:image\/png;base64,/, ""), "base64")) : null } : raw) as TabletInput;
    const c = await context();
    return { ok: true, view: await selfCheckinRegister(pool(), c.schema, key, input, c.channel) };
  } catch (err) {
    return fail(err);
  }
}

/** Back from the card form without leaving the flow: the provider's answer; the desk hears of a decline once. */
export async function paidAction(key: string, paymentId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = await context();
    const r = await finishPortalPayment(pool(), c.schema, paymentProvider(), key, paymentId);
    if (r.status === "failed") {
      const declined = await claimDeclineNotice(pool(), c.schema, paymentId);
      if (declined) await notifyPortalDecline(pool(), c.tenant, { ...declined, reason: declined.error ?? "" }).catch((err) => console.error("decline not told", err));
    }
    return r.status === "succeeded" ? { ok: true } : { ok: false, error: r.error ?? r.status };
  } catch (err) {
    return fail(err);
  }
}

/** A card left as the stay's guarantee instead of paying now, confirmed in place. */
export async function cardStoredAction(key: string, setupId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = await context();
    const r = await finishCardSetup(pool(), c.schema, paymentProvider(), key, setupId);
    return r.status === "succeeded" ? { ok: true } : { ok: false, error: r.error ?? r.status };
  } catch (err) {
    return fail(err);
  }
}

/** Finish: checked in, waiting for the room, or reception helps (and why); the desk is told how it ended. */
export async function finishAction(key: string, here: boolean): Promise<{ ok: true; outcome: "checked_in" | "waiting" | "help"; roomNumber: string | null; failed: CheckInCondition[] } | { ok: false; error: string }> {
  try {
    const c = await context();
    const r = await finishSelfCheckin(pool(), c.schema, key, c.channel.kind === "phone" ? { kind: "phone", here: here === true } : c.channel);
    await notifySelfCheckin(pool(), c.tenant, r).catch((err) => console.error("self check-in not told", err));
    return { ok: true, outcome: r.outcome, roomNumber: r.roomNumber, failed: r.failed };
  } catch (err) {
    return fail(err);
  }
}
