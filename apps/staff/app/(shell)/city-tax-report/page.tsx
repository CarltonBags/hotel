import Link from "next/link";
import { formatCurrency, todayIn } from "@hoteloftware/domain";
import { cityTaxReport } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { isDate, periodsAround } from "@/lib/periods";

/** The City Tax filing report of the property selected in the navbar, for a period (ticket 30). */
export default async function CityTaxReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.city_tax_report"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("view_financial_reports", property.id);
  const periods = periodsAround(todayIn(property.timeZone));
  const q = await searchParams;
  const from = isDate(q.from) ? q.from : periods.lastQuarter.from;
  const to = isDate(q.to) && q.to >= from ? q.to : isDate(q.from) ? from : periods.lastQuarter.to;
  const report = await cityTaxReport(pool(), tenant.schemaName, property.id, { from, to });
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  const day = (d: string) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const qs = `from=${from}&to=${to}`;
  const pill = "rounded-full border border-ink-10 px-3 py-1 text-sm hover:bg-ink-5";
  return (
    <div className="mx-auto grid max-w-5xl gap-5 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.city_tax_report"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{report.rule ? `${report.rule.name} · ${m["ctaxr.help"]}` : m["ctaxr.noRule"]}</p>
      </div>
      <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
        <label className="grid gap-1 text-xs text-ink-60">
          {m["ctaxr.from"]}
          <input type="date" name="from" defaultValue={from} className="h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm" />
        </label>
        <label className="grid gap-1 text-xs text-ink-60">
          {m["ctaxr.to"]}
          <input type="date" name="to" defaultValue={to} className="h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm" />
        </label>
        <button type="submit" className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-white">
          {m["ctaxr.show"]}
        </button>
        {(["month", "quarter", "lastQuarter", "year"] as const).map((p) => (
          <Link key={p} href={`/city-tax-report?from=${periods[p].from}&to=${periods[p].to}`} className={pill}>
            {m[`ctaxr.${p}`]}
          </Link>
        ))}
        <span className="flex-1" />
        <a href={`/city-tax/report/pdf?${qs}`} target="_blank" rel="noreferrer" className={pill}>
          PDF
        </a>
        <a href={`/city-tax/report/csv?${qs}`} className={pill}>
          CSV
        </a>
      </form>

      <dl data-totals className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["ctaxr.nights", String(report.totals.nights)],
            ["ctaxr.personNights", String(report.totals.personNights)],
            ["ctaxr.taxed", String(report.totals.taxedPersonNights)],
            ["ctaxr.base", money(report.totals.base)],
            ["ctaxr.tax", money(report.totals.tax)],
            ["ctaxr.charged", money(report.totals.charged)],
            ["ctaxr.absorbed", money(report.totals.absorbed)],
          ] as const
        ).map(([k, v]) => (
          <div key={k} data-total={k} className="rounded-2xl bg-surface-2 p-3">
            <dt className="text-xs text-ink-60">{m[k]}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <section aria-label={m["ctaxr.exempt"]} className="grid gap-1 text-sm">
        <h2 className="font-medium">{m["ctaxr.exempt"]}</h2>
        {Object.keys(report.exempt).length === 0 ? <p className="text-ink-60">–</p> : null}
        <ul className="flex flex-wrap gap-2">
          {Object.entries(report.exempt).map(([k, v]) => (
            <li key={k} data-exempt={k} className="rounded-full bg-surface-2 px-3 py-1">
              {m[`ctax.reason.${k as "other"}`]}: {v}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={m["ctaxr.exemptions"]} className="grid gap-1 text-sm">
        <h2 className="font-medium">{m["ctaxr.exemptions"]}</h2>
        {report.exemptions.length === 0 ? <p className="text-ink-60">–</p> : null}
        <ul className="grid gap-1">
          {report.exemptions.map((e) => (
            <li key={e.exemptionId} className="flex flex-wrap gap-2 rounded-xl bg-surface-2 px-3 py-2">
              <span className="flex-1">
                {e.confirmationNumber} · {e.guestName} · #{e.person + 1} · {m[`ctax.reason.${e.reason}`]}
                {e.note ? <span className="text-ink-60"> · {e.note}</span> : null}
              </span>
              {e.documentName ? (
                <a href={`/city-tax/evidence/${e.exemptionId}`} target="_blank" rel="noreferrer" className="underline">
                  {e.documentName}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={m["ctaxr.stays"]} className="grid gap-1 text-sm">
        <h2 className="font-medium">{m["ctaxr.stays"]}</h2>
        {report.stays.length === 0 ? <p className="text-ink-60">{m["ctaxr.none"]}</p> : null}
        {report.stays.length ? (
          <table className="w-full">
            <thead className="text-left text-ink-60">
              <tr className="border-b border-ink-10">
                <th className="py-2 pr-3 font-normal">{m["res.confirmationShort"]}</th>
                <th className="py-2 pr-3 font-normal">{m["ws.col.guest"]}</th>
                <th className="py-2 pr-3 font-normal">{m["ctaxr.from"]}</th>
                <th className="py-2 pr-3 font-normal">{m["ctaxr.to"]}</th>
                <th className="py-2 pr-3 text-right font-normal">{m["ctaxr.nights"]}</th>
                <th className="py-2 pr-3 text-right font-normal">{m["ctaxr.base"]}</th>
                <th className="py-2 text-right font-normal">{m["ctaxr.tax"]}</th>
              </tr>
            </thead>
            <tbody>
              {report.stays.map((s) => (
                <tr key={s.reservationId} data-stay={s.confirmationNumber} className="border-b border-ink-5">
                  <td className="py-2 pr-3">
                    <Link href={`/reservations/${s.reservationId}`} className="underline">
                      {s.confirmationNumber}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{s.guestName}</td>
                  <td className="py-2 pr-3">{day(s.arrival)}</td>
                  <td className="py-2 pr-3">{day(s.departure)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.nights}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(s.base)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {money(s.tax)}
                    {s.absorbed ? <span className="text-ink-60"> · {m["ctaxr.absorbed"]}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
