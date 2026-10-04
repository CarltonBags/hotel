import Link from "next/link";
import { getBudget } from "@hoteloftware/db";
import { BUDGET_VERSIONS, type BudgetVersion } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { importBudgetAction, saveBudgetAction } from "./actions";

/** Budget and Forecast of the property in the navbar, by month (ticket 83). */
export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string; version?: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.budget"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_budget", property.id);
  const q = await searchParams;
  const thisYear = Number(property.businessDate.slice(0, 4));
  const year = Number(q.year) >= 2000 && Number(q.year) <= 2100 ? Number(q.year) : thisYear;
  const version: BudgetVersion = BUDGET_VERSIONS.includes(q.version as BudgetVersion) ? (q.version as BudgetVersion) : "budget";
  const { months, updatedAt } = await getBudget(pool(), tenant.schemaName, property.id, year, version);
  const byMonth = new Map(months.map((x) => [x.month, x]));
  const input = "h-9 w-28 rounded-xl border border-ink-10 bg-surface px-2 text-right tabular-nums";
  const hidden = (
    <>
      <input type="hidden" name="propertyId" value={property.id} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="version" value={version} />
    </>
  );
  const monthName = (n: number) => new Intl.DateTimeFormat(shell.language === "de" ? "de-DE" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, n - 1, 1)));
  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-medium">
            {m["module.budget"]} <span className="text-ink-60">· {property.name}</span>
          </h1>
          <p className="text-sm text-ink-60">{m["budget.help"]}</p>
        </div>
        <nav className="flex gap-1 text-sm">
          {[year - 1, year, year + 1].map((y) => (
            <Link key={y} href={`/budget?year=${y}&version=${version}`} className={`rounded-full px-3 py-1 ${y === year ? "bg-ink text-canvas" : "bg-surface-2"}`}>
              {y}
            </Link>
          ))}
        </nav>
        <nav className="flex gap-1 text-sm">
          {BUDGET_VERSIONS.map((v) => (
            <Link key={v} href={`/budget?year=${year}&version=${v}`} className={`rounded-full px-3 py-1 ${v === version ? "bg-ink text-canvas" : "bg-surface-2"}`} data-version={v}>
              {m[`budget.version.${v}`]}
            </Link>
          ))}
        </nav>
      </div>
      <ActionForm action={saveBudgetAction} submitLabel={m["action.save"]} className="grid gap-3">
        {hidden}
        <table className="w-full rounded-2xl bg-surface-2 text-sm" data-budget-table>
          <thead className="text-xs text-ink-60">
            <tr>
              <th className="p-2 text-left">{m["budget.month"]}</th>
              <th className="p-2 text-right">{m["budget.occupancy"]}</th>
              <th className="p-2 text-right">{m["budget.adr"]}</th>
              <th className="p-2 text-right">{m["budget.nrr"]}</th>
              <th className="p-2 text-right">{m["budget.total"]}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
              const x = byMonth.get(n);
              return (
                <tr key={n}>
                  <td className="p-2">{monthName(n)}</td>
                  {(
                    [
                      ["occupancy", x?.occupancy],
                      ["adr", x?.adr],
                      ["nrr", x?.netRoomRevenue],
                      ["total", x?.totalRevenue],
                    ] as const
                  ).map(([k, v]) => (
                    <td key={k} className="p-1 text-right">
                      <input name={`${k}_${n}`} inputMode="decimal" defaultValue={v ?? ""} className={input} aria-label={`${monthName(n)} ${m[`budget.${k === "nrr" ? "nrr" : k}`]}`} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {updatedAt ? <p className="text-xs text-ink-60">{m["budget.updated"]} {updatedAt.toISOString().slice(0, 16).replace("T", " ")}</p> : null}
      </ActionForm>
      <ActionForm action={importBudgetAction} submitLabel={m["budget.import"]} className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
        {hidden}
        <input type="file" name="file" accept=".csv,text/csv" />
        <span className="text-xs text-ink-60">{m["budget.importHelp"]}</span>
      </ActionForm>
    </div>
  );
}
