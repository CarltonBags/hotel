import type { Pool } from "pg";
import { closeFiscalDay, fiscalArchive, fiscalDaysToClose, fiscalMonthsToArchive, receiptsToSign, signReceipt, FISCAL_USER, type FiscalDeps, type Tenant } from "@hoteloftware/db";
import { todayIn } from "@hoteloftware/domain";
import { notifyFiscalOutage } from "@hoteloftware/events";
import type { FileStore } from "@hoteloftware/storage";

/**
 * The fiscal module in the worker (ticket 51), every minute per tenant:
 * Receipts nobody opened yet are signed (an outage starting is told to the
 * managers); Business Dates behind the open one are closed for DSFinV-K;
 * at night, months not yet archived are fetched from the provider and kept.
 */
export async function runFiscal(pool: Pool, tenant: Tenant, deps: FiscalDeps & { store: FileStore }, now = new Date()): Promise<{ signed: number; failed: number; closed: number }> {
  const s = tenant.schemaName;
  const out = { signed: 0, failed: 0, closed: 0 };
  for (const id of await receiptsToSign(pool, s)) {
    const r = await signReceipt(pool, s, deps, id);
    if (r.state === "signed") out.signed++;
    if (r.state === "failed") {
      out.failed++;
      if (r.outageStarted) await notifyFiscalOutage(pool, tenant, { propertyId: r.propertyId, error: r.error }).catch((err) => console.error("[fiscal] outage not told", err));
    }
  }
  for (const d of await fiscalDaysToClose(pool, s)) {
    const r = await closeFiscalDay(pool, s, deps, d.propertyId, d.businessDate);
    out.closed += r.completed;
    for (const f of r.failed) console.error(`[fiscal] ${tenant.slug} closing ${d.businessDate}: ${f}`);
  }
  // exports can hold up signing at the provider: only at night
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Berlin" }).format(now));
  if (hour >= 2 && hour < 5) {
    for (const m of await fiscalMonthsToArchive(pool, s, todayIn("Europe/Berlin"))) {
      const a = await fiscalArchive(pool, s, { ...deps, tenantId: tenant.id }, { propertyId: m.propertyId, kind: "tss", from: m.from, to: m.to }, FISCAL_USER);
      if (a.state === "failed") console.error(`[fiscal] ${tenant.slug} archive ${m.from}: ${a.error}`);
    }
  }
  return out;
}
