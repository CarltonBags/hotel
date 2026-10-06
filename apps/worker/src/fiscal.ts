import type { Pool } from "pg";
import {
  FISCAL_USER,
  atDepArchive,
  atFiscalProperties,
  atMonthsToArchive,
  atOutagesToReport,
  closeFiscalDay,
  fiscalArchive,
  fiscalDaysToClose,
  fiscalMonthsToArchive,
  fiscalProperties,
  receiptsToSign,
  registerAtClients,
  registerFiscalClients,
  signOutletOrders,
  signReceipt,
  syncAtSystemReceipts,
  yearlyReceiptsToCheck,
  type FiscalDeps,
  type Tenant,
} from "@hoteloftware/db";
import { todayIn } from "@hoteloftware/domain";
import { notifyAtOutageReport, notifyFiscalOutage, notifyReceiptRefused, notifyYearlyReceipt } from "@hoteloftware/events";
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
  const austrian = await atFiscalProperties(pool, s);
  if (!properties.length && !austrian.length) return out;
  for (const p of properties) {
    const r = await registerFiscalClients(pool, s, deps, p);
    for (const f of r.failed) console.error(`[fiscal] ${tenant.slug} client ${f}`);
  }
  for (const p of austrian) {
    const r = await registerAtClients(pool, s, deps, p);
    for (const f of r.failed) console.error(`[fiscal] ${tenant.slug} register ${f}`);
  }
  for (const id of await receiptsToSign(pool, s)) {
    const r = await signReceipt(pool, s, deps, id);
    if (r.state === "signed") out.signed++;
    if (r.state === "failed") {
      out.failed++;
      if (r.outageStarted) await notifyFiscalOutage(pool, tenant, { propertyId: r.propertyId, error: r.error }).catch((err) => console.error("[fiscal] outage not told", err));
    }
    if (r.state === "refused" && r.newly) await notifyReceiptRefused(pool, tenant, { propertyId: r.propertyId, error: r.error ?? "" }).catch((err) => console.error("[fiscal] refusal not told", err));
  }
  // outlet orders (ticket 62) the device did not get signed: every minute
  const orders = await signOutletOrders(pool, s, deps);
  out.signed += orders.signed;
  out.failed += orders.failed;
  // Austria: outages over 48 hours, reminded once a day until reported
  for (const o of await atOutagesToReport(pool, s)) await notifyAtOutageReport(pool, tenant, o).catch((err) => console.error("[fiscal] outage report reminder", err));
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
  // the night's first run (read before anything slow): Austria's monthly and yearly receipts kept, the yearly one reminded until 15 February
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Vienna" }).format(new Date()).split(":").map(Number);
  const first = hour === 2 && minute! < 20;
  const today = todayIn("Europe/Vienna");
  if (first) {
    for (const p of await atFiscalProperties(pool, tenant.schemaName)) await syncAtSystemReceipts(pool, tenant.schemaName, deps, p).catch((err) => console.error(`[fiscal] ${tenant.slug} system receipts`, err));
    if (today.slice(5) <= "02-15") for (const y of await yearlyReceiptsToCheck(pool, tenant.schemaName)) if (today <= y.checkBy) await notifyYearlyReceipt(pool, tenant, y).catch(() => undefined);
  }
  // Austria's DEP per month not archived yet (a failed one again after a day)
  for (const m of await atMonthsToArchive(pool, tenant.schemaName, today)) {
    const a = await atDepArchive(pool, tenant.schemaName, { ...deps, tenantId: tenant.id }, m, FISCAL_USER).catch((err) => (console.error(`[fiscal] ${tenant.slug} DEP`, err), null));
    if (a?.state === "completed") done++;
  }
  for (const m of await fiscalMonthsToArchive(pool, tenant.schemaName, todayIn("Europe/Berlin"))) {
    const a = await fiscalArchive(pool, tenant.schemaName, { ...deps, tenantId: tenant.id }, { propertyId: m.propertyId, kind: m.kind, from: m.from, to: m.to }, FISCAL_USER);
    if (a.state === "completed") done++;
    if (a.state === "failed") console.error(`[fiscal] ${tenant.slug} ${m.kind} archive ${m.from}: ${a.error}`);
  }
  return done;
}
