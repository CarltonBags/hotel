import { DATA_SETS, FILTER_OPS, checkDefinition, formatCell } from "@hoteloftware/domain";
import { listSavedReports, runBuilder } from "@hoteloftware/db";
import { ActionForm } from "@/components/form-fields";
import { pool } from "@/lib/db";
import { builderFrom, builderQuery, offeredColumns, type BuilderQuery } from "@/lib/report-builder";
import { loadShell } from "@/lib/shell";
import { deleteReportAction, saveReportAction } from "./actions";

/** The report builder (ticket 84): one data set, columns, filters, grouping, totals; saved reports; raw data export. */
export default async function BuilderPage({ searchParams }: { searchParams: Promise<BuilderQuery> }) {
  const q = await searchParams;
  const shell = await loadShell();
  const { messages: m } = shell;
  const { tenant, session, actor } = shell.principal;
  const b = await builderFrom(q);
  if (!b.available.length) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.report_builder"]}</h1>
        <p className="mt-2 text-ink-60">{m["reports.noProperty"]}</p>
      </div>
    );
  }
  const columns = await offeredColumns(b.dataSet, b.properties);
  let table = null;
  let failed: string | null = b.problem;
  try {
    table = b.def ? await runBuilder(pool(), tenant.schemaName, b.def, { propertyIds: b.properties.map((p) => p.id), from: b.from, to: b.to, language: b.language }) : null;
  } catch (err) {
    failed = err instanceof Error && !("code" in err) ? err.message : "Cannot build the report";
  }
  // shared reports: of a property this user works at, and only if every column and filter in it is one they may see there
  const saved = await listSavedReports(pool(), tenant.schemaName, session.user.id, (r) => shell.properties.some((p) => p.id === r.propertyId) && "ok" in checkDefinition(actor, r.definition, [r.propertyId]));
  const locale = b.language === "de" ? "de-DE" : "en-GB";
  const chosen = new Set(b.def?.columns ?? []);
  const input = "h-9 rounded-xl border border-ink-10 bg-surface px-2 text-sm";
  const current = b.def ? builderQuery(b.def, b) : "";
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]![0] : q[k]) ?? "";
  return (
    <div className="grid gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">{m["module.report_builder"]}</h1>
        <p className="text-sm text-ink-60">
          {b.properties.map((p) => p.name).join(", ")} · {m["builder.help"]}
        </p>
      </div>
      <form method="get" className="grid gap-3 rounded-2xl bg-surface-2 p-4 text-sm" data-builder>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="text-ink-60">{m["builder.dataSet"]}</span>
            <select name="set" defaultValue={b.dataSet} className={input}>
              {DATA_SETS.filter((d) => b.available.includes(d)).map((d) => (
                <option key={d} value={d}>
                  {m[`builder.set.${d}`]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["reports.from"]}</span>
            <input type="date" name="from" defaultValue={b.from} className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["reports.to"]}</span>
            <input type="date" name="to" defaultValue={b.to} className={input} />
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-3" data-columns>
          <legend className="mb-1 text-ink-60">{m["builder.columns"]}</legend>
          {columns.map((c) => (
            <label key={c.key} className="flex items-center gap-1" data-column={c.key}>
              <input type="checkbox" name="col" value={c.key} defaultChecked={chosen.has(c.key)} /> {c.label[b.language]}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-2">
          <span className="text-ink-60">{m["builder.filters"]}</span>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <select name={`fc${i}`} defaultValue={one(`fc${i}`)} className={input}>
                <option value="">–</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label[b.language]}
                  </option>
                ))}
              </select>
              <select name={`fo${i}`} defaultValue={one(`fo${i}`) || "eq"} className={input}>
                {FILTER_OPS.map((o) => (
                  <option key={o} value={o}>
                    {m[`builder.op.${o}`]}
                  </option>
                ))}
              </select>
              <input name={`fv${i}`} defaultValue={one(`fv${i}`)} className={input} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {[1, 2].map((i) => (
            <label key={i} className="grid gap-1">
              <span className="text-ink-60">
                {m["builder.groupBy"]} {i}
              </span>
              <select name={`g${i}`} defaultValue={one(`g${i}`)} className={input}>
                <option value="">–</option>
                {columns
                  .filter((c) => c.groupable)
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label[b.language]}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label className="flex items-center gap-1">
            <input type="checkbox" name="totals" defaultChecked={b.def?.totals ?? false} /> {m["builder.totals"]}
          </label>
          <button type="submit" className="h-9 rounded-full bg-accent px-4 font-medium text-white">
            {m["reports.show"]}
          </button>
        </div>
      </form>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {failed}
        </p>
      ) : null}
      {table ? (
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-60">{table.truncated ? m["builder.truncated"] : `${table.rows.length} ${m["builder.rows"]}`}</span>
            <a href={`/reports/builder-export?${current}&format=csv`} className="rounded-full bg-surface-2 px-3 py-1 font-medium" data-export="csv">
              {m["reports.csv"]}
            </a>
            <a href={`/reports/builder-export?${current}&format=pdf`} target="_blank" className="rounded-full bg-surface-2 px-3 py-1 font-medium">
              PDF
            </a>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-surface-2">
            <table className="w-full text-sm tabular-nums" data-builder-table>
              <thead className="text-xs text-ink-60">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c.key} className={`p-2 ${c.kind === "text" ? "text-left" : "text-right"}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className={r.emphasis ? "border-t border-ink-10 font-medium" : ""}>
                    {table.columns.map((c) => (
                      <td key={c.key} className={`whitespace-nowrap p-2 ${c.kind === "text" ? "" : "text-right"}`}>
                        {formatCell(r.cells[c.key] ?? null, c.kind, locale)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.properties.length === 1 ? (
            <ActionForm action={saveReportAction} submitLabel={m["builder.save"]} className="flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="query" value={current} />
              <input name="name" required placeholder={m["builder.name"]} className={input} />
              <label className="flex items-center gap-1">
                <input type="checkbox" name="shared" /> {m["builder.shared"]}
              </label>
            </ActionForm>
          ) : null}
        </section>
      ) : null}
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm" data-saved>
        <h2 className="font-medium">{m["builder.saved"]}</h2>
        <ul className="grid gap-1">
          {saved.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2" data-saved-report={r.name}>
              <a href={`/reports/builder?${builderQuery(r.definition, b, r.propertyId)}`} className="text-accent underline">
                {r.name}
              </a>
              <span className="text-xs text-ink-60">
                {shell.properties.find((p) => p.id === r.propertyId)?.name} · {r.shared ? m["builder.sharedTag"] : m["builder.private"]}
              </span>
              {r.ownerId === session.user.id ? (
                <ActionForm action={deleteReportAction} submitLabel={m["builder.delete"]} className="contents">
                  <input type="hidden" name="id" value={r.id} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface-2 p-4 text-sm" data-raw>
        <h2 className="mr-2 font-medium">{m["builder.raw"]}</h2>
        {(["reservations", "charges", "payments"] as const)
          .filter((d) => b.available.includes(d))
          .map((d) => (
            <a key={d} href={`/reports/builder-export?raw=1&set=${d}&from=${b.from}&to=${b.to}&format=csv`} className="rounded-full bg-surface px-3 py-1 font-medium" data-raw-export={d}>
              {m[`builder.set.${d}`]}
            </a>
          ))}
        <span className="text-xs text-ink-60">{m["builder.rawHelp"]}</span>
      </section>
    </div>
  );
}
