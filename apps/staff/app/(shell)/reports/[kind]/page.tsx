import { notFound } from "next/navigation";
import { listReportSchedules, listRoomTypes, runReport } from "@hoteloftware/db";
import { REPORT_TITLES, SCHEDULE_FREQUENCIES, formatCell, type ReportTable } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { pool } from "@/lib/db";
import { reportRequestFrom, type ReportParams } from "@/lib/reports";
import { loadShell } from "@/lib/shell";
import { deleteScheduleAction, scheduleReportAction } from "../actions";

/** A fixed report as its own Workspace Tab (ticket 82): filters, the table, export and scheduling. */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<ReportParams> }) {
  const { kind } = await params;
  const query = await searchParams;
  const shell = await loadShell();
  const { messages: m } = shell;
  const language = shell.language === "de" ? "de" : "en";
  const { tenant, session } = shell.principal;
  const parsed = await reportRequestFrom(kind, query);
  if (!parsed) notFound();
  const { request, properties } = parsed;
  const title = REPORT_TITLES[request.kind][language];
  if (!properties.length) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{title}</h1>
        <p className="mt-2 text-ink-60">{m["reports.noProperty"]}</p>
      </div>
    );
  }
  let table: ReportTable | null = null;
  let error: string | null = null;
  try {
    table = await runReport(pool(), tenant.schemaName, request);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const roomTypes = properties.length === 1 && ["occupancy", "pickup", "source_mix", "cancellations"].includes(request.kind) ? await listRoomTypes(pool(), tenant.schemaName, properties[0]!.id) : [];
  const schedules = (await listReportSchedules(pool(), tenant.schemaName, session.user.id)).filter((s) => s.kind === request.kind);
  const currencies = [...new Set(properties.map((p) => p.currency))];
  const locale = language === "de" ? "de-DE" : "en-GB";
  // the same query, for the export links
  const qs = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string]))));
  qs.set("kind", request.kind);
  const input = "h-9 rounded-xl border border-ink-10 bg-surface-2 px-2 text-sm";
  const dated = request.kind !== "receivables";
  return (
    <div className="grid gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">{title}</h1>
        <p className="text-sm text-ink-60">{properties.map((p) => p.name).join(", ")}</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl bg-surface-2 p-3 text-sm print:hidden" data-report-filters>
        {dated ? (
          <>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["reports.from"]}</span>
              <input type="date" name="from" defaultValue={request.from} className={input} />
            </label>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["reports.to"]}</span>
              <input type="date" name="to" defaultValue={request.to} className={input} />
            </label>
          </>
        ) : null}
        {request.kind === "occupancy" ? (
          <>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["reports.grain"]}</span>
              <select name="grain" defaultValue={request.grain} className={input}>
                {(["day", "week", "month"] as const).map((g) => (
                  <option key={g} value={g}>
                    {m[`reports.grain.${g}`]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["reports.rows"]}</span>
              <select name="by" defaultValue={request.byRoomType ? "roomType" : "period"} className={input}>
                <option value="period">{m["reports.byPeriod"]}</option>
                <option value="roomType">{m["reports.byRoomType"]}</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="pp" defaultChecked={request.compare.previous} /> {m["reports.comparePrevious"]}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="ly" defaultChecked={request.compare.lastYear} /> {m["reports.compareLastYear"]}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="bu" defaultChecked={request.compare.budget} /> {m["reports.compareBudget"]}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="fc" defaultChecked={request.compare.forecast} /> {m["reports.compareForecast"]}
            </label>
          </>
        ) : null}
        {request.kind === "pickup" ? (
          <label className="grid gap-1">
            <span className="text-ink-60">{m["reports.since"]}</span>
            <input type="date" name="since" defaultValue={request.pickupSince ?? ""} className={input} />
          </label>
        ) : null}
        {roomTypes.length ? (
          <label className="grid gap-1">
            <span className="text-ink-60">{m["reports.roomType"]}</span>
            <select name="roomType" defaultValue={request.roomTypeId ?? ""} className={input}>
              <option value="">{m["reports.allRoomTypes"]}</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {currencies.length > 1 ? (
          <>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["reports.currency"]}</span>
              <select name="currency" defaultValue={request.currency} className={input}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {currencies
              .filter((c) => c !== request.currency)
              .map((c) => (
                <label key={c} className="grid gap-1" data-rate={c}>
                  <span className="text-ink-60">
                    1 {c} = … {request.currency}
                  </span>
                  <input name={`rate_${c}`} inputMode="decimal" defaultValue={request.rates?.[c] ?? ""} className={`${input} w-24`} />
                </label>
              ))}
          </>
        ) : null}
        <button type="submit" className="h-9 rounded-full bg-accent px-4 font-medium text-white">
          {m["reports.show"]}
        </button>
        <span className="ml-auto flex gap-2">
          <a href={`/reports/export?${qs}&format=csv`} className="rounded-full bg-surface px-3 py-2 font-medium" data-export="csv">
            {m["reports.csv"]}
          </a>
          <a href={`/reports/export?${qs}&format=pdf`} target="_blank" className="rounded-full bg-surface px-3 py-2 font-medium" data-export="pdf">
            PDF
          </a>
        </span>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {table ? (
        <section className="grid gap-2">
          <ul className="text-xs text-ink-60">
            {table.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="overflow-x-auto rounded-2xl bg-surface-2">
            <table className="w-full text-right text-sm tabular-nums" data-report={request.kind}>
              <thead className="text-xs text-ink-60">
                <tr>
                  {table.columns.map((c, i) => (
                    <th key={c.key} className={`p-2 align-bottom font-medium ${i === 0 ? "text-left" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className={r.emphasis ? "border-t border-ink-10 font-medium" : ""} data-row={String(r.cells[table!.columns[0]!.key] ?? "")}>
                    {table!.columns.map((c, j) => (
                      <td key={c.key} data-col={c.key} className={`whitespace-nowrap p-2 ${j === 0 ? "text-left" : ""}`}>
                        {formatCell(r.cells[c.key] ?? null, c.kind, locale)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm print:hidden" data-schedules>
        <h2 className="font-medium">{m["reports.schedule"]}</h2>
        <p className="text-ink-60">{m["reports.scheduleHelp"]}</p>
        {schedules.length ? (
          <ul className="grid gap-1">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2" data-schedule={s.frequency}>
                <span>
                  {m[`reports.frequency.${s.frequency}`]} · {shell.properties.filter((p) => s.propertyIds.includes(p.id)).map((p) => p.name).join(", ")}
                  {s.lastSentOn ? ` · ${m["reports.lastSent"]} ${s.lastSentOn}` : ""}
                </span>
                {s.stoppedReason ? <span className="text-danger">{s.stoppedReason}</span> : null}
                <ActionForm action={deleteScheduleAction} submitLabel={m["reports.unschedule"]} className="contents">
                  <input type="hidden" name="id" value={s.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : null}
        <ActionForm action={scheduleReportAction} submitLabel={m["reports.scheduleIt"]} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="query" value={qs.toString()} />
          <label className="grid gap-1">
            <span className="text-ink-60">{m["reports.frequency"]}</span>
            <select name="frequency" defaultValue="weekly" className={input}>
              {SCHEDULE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {m[`reports.frequency.${f}`]}
                </option>
              ))}
            </select>
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
