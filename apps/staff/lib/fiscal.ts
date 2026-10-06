import { receiptsOfPaymentToSign, signReceipt, type FiscalDeps } from "@hoteloftware/db";
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
  for (const id of await receiptsOfPaymentToSign(pool(), tenant.schemaName, paymentId).catch(() => [])) await signIssuedReceipt(tenant, id);
}

/** Sign a Receipt right after it was issued (a Voucher sold, ticket 53). */
export async function signIssuedReceipt(tenant: { id: string; schemaName: string }, receiptId: string): Promise<void> {
  const r = await signReceipt(pool(), tenant.schemaName, fiscalDeps(), receiptId).catch((err) => (console.error("[fiscal] sign", err), null));
  if (r?.state === "failed" && r.outageStarted) await notifyFiscalOutage(pool(), tenant, { propertyId: r.propertyId, error: r.error }).catch(() => undefined);
  if (r?.state === "refused" && r.newly) await notifyReceiptRefused(pool(), tenant, { propertyId: r.propertyId, error: r.error ?? "" }).catch(() => undefined);
}
