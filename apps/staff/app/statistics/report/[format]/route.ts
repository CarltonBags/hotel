import { tourismReport } from "@hoteloftware/db";
import { renderTourismReportPdf, tourismReportCsv } from "@hoteloftware/invoices";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";

/** The official statistics of the property selected in the navbar for a month, as it stands or as a submitted version: PDF or spreadsheet. */
export async function GET(req: Request, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  if (format !== "pdf" && format !== "csv") return new Response("Not found", { status: 404 });
  const { tenant } = await requirePrincipal();
  const { scope, language } = await loadShell();
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const version = Number(url.searchParams.get("version") ?? "0");
  if (!scope || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Choose a property and a month", { status: 400 });
  try {
    await authorize("tourism_statistics", scope);
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
  let report;
  try {
    report = await tourismReport(pool(), tenant.schemaName, scope, month);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Cannot build the report", { status: 400 });
  }
  const frozen = version ? report.versions.find((v) => v.version === version) : undefined;
  if (version && !frozen) return new Response("Version not found", { status: 404 });
  const doc = frozen ? { ...frozen.data, version: frozen.version, submittedAt: frozen.submittedAt.toISOString().slice(0, 16).replace("T", " ") } : report.current;
  const name = `statistics-${month}${frozen ? `-v${frozen.version}` : ""}`;
  if (format === "csv") {
    return new Response(tourismReportCsv(doc), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  }
  const pdf = await renderTourismReportPdf(doc, language === "de" ? "de" : "en");
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
}
