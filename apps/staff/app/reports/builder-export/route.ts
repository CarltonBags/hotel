import { RAW_ROW_LIMIT, logReportExport, runBuilder } from "@hoteloftware/db";
import { renderReportPdf, reportCsv } from "@hoteloftware/invoices";
import { pool } from "@/lib/db";
import { builderFrom, offeredColumns, queryMap } from "@/lib/report-builder";
import { loadShell } from "@/lib/shell";

const RAW_SETS = ["reservations", "charges", "payments"];

/**
 * A builder table as spreadsheet file or PDF, or a raw data export
 * (reservations, charges, payments: every column the user may see) as
 * spreadsheet file (ticket 84). Every export is logged with user and rows.
 */
export async function GET(req: Request) {
  const shell = await loadShell();
  const { tenant, session } = shell.principal;
  const url = new URL(req.url);
  const query = queryMap(url.searchParams);
  const format = url.searchParams.get("format");
  const raw = url.searchParams.get("raw") === "1";
  if (format !== "csv" && format !== "pdf") return new Response("Not found", { status: 404 });
  if (raw) {
    const set = url.searchParams.get("set") ?? "";
    query.col = undefined;
    if (!RAW_SETS.includes(set) || format !== "csv") return new Response("Not found", { status: 404 });
    const pre = await builderFrom(query);
    if (!(pre.available as string[]).includes(set)) return new Response("Not allowed", { status: 403 });
    query.col = (await offeredColumns(pre.dataSet, pre.properties)).filter((c) => c.key !== "count").map((c) => c.key);
  }
  const b = await builderFrom(query);
  if (!b.def) return new Response(b.problem ?? "Choose columns", { status: b.problem ? 403 : 400 });
  let table;
  try {
    table = await runBuilder(pool(), tenant.schemaName, b.def, { propertyIds: b.properties.map((p) => p.id), from: b.from, to: b.to, language: b.language, ...(raw ? { limit: RAW_ROW_LIMIT } : {}) });
  } catch (err) {
    // our own messages say what to change; a database error is not for the browser
    if (err instanceof Error && !("code" in err)) return new Response(err.message, { status: 400 });
    console.error(err);
    return new Response("Cannot build the report", { status: 500 });
  }
  // the lines exported, the totals line not counted
  await logReportExport(pool(), tenant.schemaName, { userId: session.user.id, kind: raw ? `raw:${b.dataSet}` : `builder:${b.dataSet}`, propertyIds: b.properties.map((p) => p.id), format, rowCount: table.rows.filter((r) => r.ref !== "total").length });
  const name = `${raw ? "raw" : "report"}-${b.dataSet}-${b.from}-${b.to}`;
  const titled = { ...table, title: `${raw ? "Raw" : "Report"}: ${b.dataSet}`, notes: [...table.notes, b.properties.map((p) => p.name).join(", "), ...(table.truncated ? [`First ${table.rows.length} rows only`] : [])] };
  if (format === "csv") return new Response(reportCsv(titled), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  const pdf = await renderReportPdf(titled, b.language, `Hoteloftware · ${tenant.name} · ${session.user.name}`);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
}
