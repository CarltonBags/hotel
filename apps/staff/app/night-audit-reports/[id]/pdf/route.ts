import { keepNightAuditPdf, listTenantUsers, nightAuditReport } from "@hoteloftware/db";
import { renderNightAuditPdf, type NightAuditReportDocument } from "@hoteloftware/invoices";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";

/** A Night Audit report as PDF: rendered once from its stored data and kept. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requirePrincipal();
  let audit;
  try {
    audit = await nightAuditReport(pool(), tenant.schemaName, id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  try {
    await authorize("view_night_audit_reports", audit.propertyId);
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
  let pdf = audit.pdf;
  if (!pdf) {
    const { language } = await loadShell();
    const names = Object.fromEntries((await listTenantUsers(pool(), tenant.id)).map((u) => [u.id, u.name]));
    await keepNightAuditPdf(pool(), tenant.schemaName, audit.id, await renderNightAuditPdf(audit.report as NightAuditReportDocument, language === "de" ? "de" : "en", names));
    pdf = (await nightAuditReport(pool(), tenant.schemaName, id)).pdf!;
  }
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="night-audit-${audit.businessDate}.pdf"`, "cache-control": "private, no-store" } });
}
