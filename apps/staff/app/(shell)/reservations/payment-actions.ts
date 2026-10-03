"use server";

import { revalidatePath } from "next/cache";
import { can } from "@hoteloftware/domain";
import {
  cancelPendingPayment,
  captureCardHold,
  coverBalanceWithHold,
  incrementCardHold,
  listCardHolds,
  loadFolios,
  placeCardHold,
  refundPayment,
  releaseCardHold,
  simulateCard,
  syncCardHold,
  syncPayment,
  takePayment,
  type CardHold,
  type Payment,
} from "@hoteloftware/db";
import { paymentProvider } from "@hoteloftware/payments";
import { announceReservations } from "@/lib/live";
import { reservationScope } from "@/lib/reservation-scope";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/**
 * Payments and Card Holds on one reservation (ticket 27). The reservation's
 * own property decides each right; a payment or hold id from the browser
 * must belong to that reservation.
 */

async function ownPayment(schema: string, reservationId: string, paymentId: string): Promise<Payment> {
  const p = (await loadFolios(pool(), schema, reservationId)).folios.flatMap((f) => f.payments).find((x) => x.id === String(paymentId));
  if (!p) throw new Error("Payment not found on this reservation");
  return p;
}

async function ownHold(schema: string, reservationId: string, holdId: string): Promise<CardHold> {
  const h = (await listCardHolds(pool(), schema, reservationId)).find((x) => x.id === String(holdId));
  if (!h) throw new Error("Card Hold not found on this reservation");
  return h;
}

const done = async (tenantId: string, reservation: { id: string; propertyId: string }, message: string): Promise<FormState> => {
  revalidatePath(`/reservations/${reservation.id}`);
  revalidatePath("/");
  await announceReservations(tenantId, reservation.propertyId);
  return { ok: true, message };
};

export async function takePaymentAction(
  reservationId: string,
  input: { folioId: string; tender: string; amount: number; readerId?: string; reference?: string },
): Promise<FormState & { paymentId?: string; pending?: boolean }> {
  let extra: { paymentId?: string; pending?: boolean } = {};
  const state = await formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "take_payments");
    const p = await takePayment(
      pool(),
      schema,
      paymentProvider(),
      { reservationId: reservation.id, folioId: String(input?.folioId ?? "") || undefined, tender: String(input?.tender), amount: Number(input?.amount), readerId: input?.readerId ? String(input.readerId) : undefined, reference: String(input?.reference ?? "") },
      userId,
    );
    extra = { paymentId: p.id, pending: p.status === "pending" };
    return done(tenantId, reservation, p.status === "pending" ? "Waiting for the card on the reader…" : "Payment recorded.");
  });
  return { ...state, ...extra };
}

/** Polled while a payment waits at the reader. */
export async function paymentStatusAction(reservationId: string, paymentId: string): Promise<{ status: string; error: string | null } | { failure: string }> {
  let out: { status: string; error: string | null } | undefined;
  const state = await formAction(async () => {
    const { schema, tenantId, reservation } = await reservationScope(reservationId, "take_payments");
    await ownPayment(schema, reservation.id, paymentId);
    const p = await syncPayment(pool(), schema, paymentProvider(), String(paymentId));
    out = { status: p.status, error: p.error };
    if (p.status !== "pending") await done(tenantId, reservation, "");
  });
  return out ?? { failure: state.error ?? "Something went wrong." };
}

export async function cancelPaymentAction(reservationId: string, paymentId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation } = await reservationScope(reservationId, "take_payments");
    await ownPayment(schema, reservation.id, paymentId);
    const p = await cancelPendingPayment(pool(), schema, paymentProvider(), String(paymentId));
    // the card may have been presented just before: then it was paid, not cancelled
    return done(tenantId, reservation, p.status === "succeeded" ? "The card had already been presented: the payment was received." : "Cancelled.");
  });
}

/** Test mode only: present the simulated card on the reader. */
export async function simulateCardAction(reservationId: string, target: { paymentId?: string; holdId?: string }): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation } = await reservationScope(reservationId, "take_payments");
    if (target?.paymentId) await ownPayment(schema, reservation.id, target.paymentId);
    else if (target?.holdId) await ownHold(schema, reservation.id, target.holdId);
    else throw new Error("Nothing to present a card for");
    await simulateCard(pool(), schema, paymentProvider(), target.paymentId ? { paymentId: String(target.paymentId) } : { holdId: String(target.holdId) });
    return done(tenantId, reservation, "Card presented.");
  });
}

export async function refundAction(reservationId: string, paymentId: string, amount: number, reason: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId, actor } = await reservationScope(reservationId, "refund_payments");
    await ownPayment(schema, reservation.id, paymentId);
    const r = await refundPayment(
      pool(),
      schema,
      paymentProvider(),
      { paymentId: String(paymentId), amount: Number(amount), reason: String(reason ?? "") },
      { userId, unlimited: can(actor, "refund_without_limit", reservation.propertyId) },
    );
    return done(tenantId, reservation, r.status === "refund_pending_balance" ? "Refund waiting: the hotel's balance at the provider cannot cover it yet." : "Refunded.");
  });
}

export async function placeHoldAction(reservationId: string, amount: number, readerId: string): Promise<FormState & { holdId?: string }> {
  let holdId: string | undefined;
  const state = await formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "take_payments");
    holdId = (await placeCardHold(pool(), schema, paymentProvider(), { reservationId: reservation.id, amount: Number(amount), readerId: String(readerId) }, userId)).id;
    return done(tenantId, reservation, "Waiting for the card on the reader…");
  });
  return { ...state, ...(holdId ? { holdId } : {}) };
}

export async function holdStatusAction(reservationId: string, holdId: string): Promise<{ status: string; error: string | null } | { failure: string }> {
  let out: { status: string; error: string | null } | undefined;
  const state = await formAction(async () => {
    const { schema, tenantId, reservation } = await reservationScope(reservationId, "take_payments");
    await ownHold(schema, reservation.id, holdId);
    const h = await syncCardHold(pool(), schema, paymentProvider(), String(holdId));
    out = { status: h.status, error: h.error };
    if (h.status !== "pending") await done(tenantId, reservation, "");
  });
  return out ?? { failure: state.error ?? "Something went wrong." };
}

export async function incrementHoldAction(reservationId: string, holdId: string, increment: number): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation } = await reservationScope(reservationId, "take_payments");
    await ownHold(schema, reservation.id, holdId);
    await incrementCardHold(pool(), schema, paymentProvider(), { holdId: String(holdId), increment: Number(increment) });
    return done(tenantId, reservation, "Hold raised.");
  });
}

/** Without an amount: what the guest owes, never more than held. */
export async function captureHoldAction(reservationId: string, holdId: string, amount: number | null): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "take_payments");
    await ownHold(schema, reservation.id, holdId);
    await captureCardHold(pool(), schema, paymentProvider(), { holdId: String(holdId), amount: typeof amount === "number" ? amount : undefined }, userId);
    return done(tenantId, reservation, "Captured.");
  });
}

export async function releaseHoldAction(reservationId: string, holdId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation } = await reservationScope(reservationId, "take_payments");
    await ownHold(schema, reservation.id, holdId);
    await releaseCardHold(pool(), schema, paymentProvider(), String(holdId));
    return done(tenantId, reservation, "Hold released.");
  });
}

/** Incidentals in one batch: raise the hold to what the guest owes (a fresh hold on the saved card beyond its limits). */
export async function coverBalanceAction(reservationId: string, holdId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "take_payments");
    await ownHold(schema, reservation.id, holdId);
    const r = await coverBalanceWithHold(pool(), schema, paymentProvider(), String(holdId), userId);
    return done(tenantId, reservation, r.raisedBy === 0 ? "The holds already cover the balance." : r.newHoldId ? "A new hold for the rest was placed on the saved card." : "Hold raised to the balance.");
  });
}
