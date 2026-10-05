import { receiptsOfPaymentToSign, signReceipt, withTenant, type FiscalDeps } from "@hoteloftware/db";
import { notifyFiscalOutage, notifyReceiptRefused } from "@hoteloftware/events";
import { atFiscalProvider, fiscalProvider, fiscalSecret } from "@hoteloftware/fiscal";
import { pool } from "./db";

/** The fiscal provider, with the platform's fiscal secret when it is set (ticket 51). Server only. */
export function fiscalDeps(): FiscalDeps {
  let secret: string | null = null;
  try {
    secret = fiscalSecret();
  } catch {
    // signing needs no secret; setting up a TSE and registering clients do, and say so
  }
  return { provider: fiscalProvider(), at: atFiscalProvider(), secret };
}

/**
 * Sign a payment's Receipt right after the desk took it (Germany, ticket 51):
 * the signature belongs to the payment, not to whenever the Receipt is
 * opened. An outage starting is told to the managers; the desk goes on
 * whatever happens here.
 */
export async function signPaymentReceipts(tenant: { id: string; schemaName: string }, paymentId: string | undefined): Promise<void> {
  if (!paymentId) return;
  const deps = fiscalDeps();
  for (const id of await receiptsOfPaymentToSign(pool(), tenant.schemaName, paymentId).catch(() => [])) {
    const r = await signReceipt(pool(), tenant.schemaName, deps, id).catch((err) => (console.error("[fiscal] sign", err), null));
    if (r?.state === "failed" && r.outageStarted) await notifyFiscalOutage(pool(), tenant, { propertyId: r.propertyId, error: r.error }).catch(() => undefined);
    if (r?.state === "refused" && r.newly) await notifyReceiptRefused(pool(), tenant, { propertyId: r.propertyId, error: r.error ?? "" }).catch(() => undefined);
  }
}

/** Sign a Receipt by its code right after it was issued (a Voucher sold, ticket 53). */
export async function signReceiptToken(tenant: { id: string; schemaName: string }, token: string): Promise<void> {
  const id = await withTenant(pool(), tenant.schemaName, async (tx) => (await tx.query<{ id: string }>("select id from receipts where token = $1", [token])).rows[0]?.id).catch(() => undefined);
  if (!id) return;
  const r = await signReceipt(pool(), tenant.schemaName, fiscalDeps(), id).catch((err) => (console.error("[fiscal] sign", err), null));
  if (r?.state === "failed" && r.outageStarted) await notifyFiscalOutage(pool(), tenant, { propertyId: r.propertyId, error: r.error }).catch(() => undefined);
  if (r?.state === "refused" && r.newly) await notifyReceiptRefused(pool(), tenant, { propertyId: r.propertyId, error: r.error ?? "" }).catch(() => undefined);
}
