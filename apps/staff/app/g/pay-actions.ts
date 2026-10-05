"use server";

import { revalidatePath } from "next/cache";
import { expressCheckout, startCardSetup, startPortalPayment } from "@hoteloftware/db";
import { FakePaymentProvider, paymentProvider } from "@hoteloftware/payments";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

/** Paying in the Guest Portal (ticket 41): the key is the guest's only authority. */
async function tenant() {
  const t = await currentTenant();
  if (!t) throw new Error("Not found");
  return t;
}

export type PayStart = { ok: true; id: string; clientSecret: string; publishableKey: string | null; accountId: string } | { ok: false; error: string };

const fail = (err: unknown): { ok: false; error: string } => ({ ok: false, error: err instanceof Error && !("code" in err) ? err.message : "Something went wrong. Please try again." });

export async function startPayAction(key: string, saveCard: boolean): Promise<PayStart> {
  try {
    const t = await tenant();
    const p = await startPortalPayment(pool(), t.schemaName, paymentProvider(), key, { saveCard: saveCard === true });
    return { ok: true, id: p.paymentId, clientSecret: p.clientSecret, publishableKey: p.publishableKey, accountId: p.accountId };
  } catch (err) {
    return fail(err);
  }
}

export async function startCardAction(key: string): Promise<PayStart> {
  try {
    const t = await tenant();
    const s = await startCardSetup(pool(), t.schemaName, paymentProvider(), key);
    return { ok: true, id: s.setupId, clientSecret: s.clientSecret, publishableKey: s.publishableKey, accountId: s.accountId };
  } catch (err) {
    return fail(err);
  }
}

/** Development only (the stand-in provider): the guest's card answers, as the provider's form would. */
export async function simulateAction(accountId: string, kind: "payment" | "setup", clientSecret: string, outcome: "succeed" | "decline"): Promise<void> {
  const provider = paymentProvider();
  if (!(provider instanceof FakePaymentProvider) || process.env.NODE_ENV === "production") throw new Error("Not available");
  // the stand-in's client secret is its id with "_secret"
  const id = clientSecret.replace(/_secret$/, "");
  if (kind === "setup") await provider.simulateSetup(accountId, id, outcome);
  else await provider.simulateOnline(accountId, id, outcome);
}

export async function checkoutAction(key: string): Promise<{ ok: true; checkedOut: boolean; invoices: { id: string; number: string }[] } | { ok: false; error: string }> {
  try {
    const t = await tenant();
    const r = await expressCheckout(pool(), t.schemaName, paymentProvider(), key);
    revalidatePath(`/g/${key}`);
    return { ok: true, checkedOut: r.checkedOut, invoices: r.invoices.map((i) => ({ id: i.id, number: i.number })) };
  } catch (err) {
    return fail(err);
  }
}
