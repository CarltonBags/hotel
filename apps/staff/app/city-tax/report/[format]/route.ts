import { cityTaxReport } from "@hoteloftware/db";
import { cityTaxReportCsv, renderCityTaxReportPdf } from "@hoteloftware/invoices";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { isDate } from "@/lib/periods";

/** The City Tax filing report of the property selected in the navbar, as PDF (/city-tax/report/pdf) or CSV (/city-tax/report/csv). */
export async function GET(req: Request, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  if (format !== "pdf" && format !== "csv") return new Response("Not found", { status: 404 });
  const { tenant } = await requirePrincipal();
  const { scope, language } = await loadShell();
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  if (!scope || !isDate(from) || !isDate(to)) return new Response("Choose a property and a period", { status: 400 });
  try {
    await authorize("view_financial_reports", scope);
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
  let report;
  try {
    report = await cityTaxReport(pool(), tenant.schemaName, scope, { from, to });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Cannot build the report", { status: 400 });
  }
  const name = `city-tax-${from}-${to}`;
  if (format === "csv") {
    return new Response(cityTaxReportCsv(report), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  }
  const pdf = await renderCityTaxReportPdf(report, language === "de" ? "de" : "en");
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
}
