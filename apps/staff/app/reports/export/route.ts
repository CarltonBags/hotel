import { logReportExport, runReport } from "@hoteloftware/db";
import { renderReportPdf, reportCsv } from "@hoteloftware/invoices";
import { pool } from "@/lib/db";
import { reportRequestFrom } from "@/lib/reports";
import { loadShell } from "@/lib/shell";

/** A fixed report as the page shows it, as spreadsheet file or PDF (ticket 82). */
export async function GET(req: Request) {
  const shell = await loadShell();
  const { tenant, session } = shell.principal;
  const query = Object.fromEntries(new URL(req.url).searchParams);
  const format = query.format;
  if (format !== "pdf" && format !== "csv") return new Response("Not found", { status: 404 });
  const language = shell.language === "de" ? "de" : "en";
  const parsed = await reportRequestFrom(query.kind ?? "", query);
  if (!parsed) return new Response("Not found", { status: 404 });
  if (!parsed.properties.length) return new Response("Not allowed", { status: 403 });
  let table;
  try {
    table = await runReport(pool(), tenant.schemaName, parsed.request);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Cannot build the report", { status: 400 });
  }
  const r = parsed.request;
  await logReportExport(pool(), tenant.schemaName, { userId: session.user.id, kind: r.kind, propertyIds: r.propertyIds, format, rowCount: table.rows.length });
  const name = `${r.kind}-${r.from}-${r.to}`;
  if (format === "csv") {
    return new Response(reportCsv(table), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  }
  const pdf = await renderReportPdf(table, language, `Hoteloftware · ${tenant.name} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
}
