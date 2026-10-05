import type { Pool } from "pg";
import { FISCAL_USER, closeFiscalDay, fiscalArchive, fiscalDaysToClose, fiscalMonthsToArchive, fiscalProperties, receiptsToSign, registerFiscalClients, signReceipt, type FiscalDeps, type Tenant } from "@hoteloftware/db";
import { todayIn } from "@hoteloftware/domain";
import { notifyFiscalOutage } from "@hoteloftware/events";
import type { FileStore } from "@hoteloftware/storage";

/**
 * The fiscal module in the worker (ticket 51), every minute for a tenant
 * with a TSE in use: clients registered, Receipts the desk could not sign
 * signed (an outage starting is told to the managers), Business Dates
 * behind the open one closed for DSFinV-K.
 */
export async function runFiscal(pool: Pool, tenant: Tenant, deps: FiscalDeps): Promise<{ signed: number; failed: number; closed: number }> {
  const s = tenant.schemaName;
  const out = { signed: 0, failed: 0, closed: 0 };
  const properties = await fiscalProperties(pool, s);
  if (!properties.length) return out;
  for (const p of properties) {
    const r = await registerFiscalClients(pool, s, deps, p);
    for (const f of r.failed) console.error(`[fiscal] ${tenant.slug} client ${f}`);
  }
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
  return out;
}

/**
 * At night (exports can hold up signing at the provider): each month's TSE
 * data and DSFinV-K export fetched and kept outside the provider, which
 * keeps them only for a while; asked again until the provider has them.
 */
export async function archiveFiscal(pool: Pool, tenant: Tenant, deps: FiscalDeps & { store: FileStore }): Promise<number> {
  let done = 0;
  for (const m of await fiscalMonthsToArchive(pool, tenant.schemaName, todayIn("Europe/Berlin"))) {
    const a = await fiscalArchive(pool, tenant.schemaName, { ...deps, tenantId: tenant.id }, { propertyId: m.propertyId, kind: m.kind, from: m.from, to: m.to }, FISCAL_USER);
    if (a.state === "completed") done++;
    if (a.state === "failed") console.error(`[fiscal] ${tenant.slug} ${m.kind} archive ${m.from}: ${a.error}`);
  }
  return done;
}
