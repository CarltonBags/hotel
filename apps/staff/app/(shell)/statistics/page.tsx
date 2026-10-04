import Link from "next/link";
import { dueTourismReport, listTenantUsers, statsDeadline, statsSettings, tourismReport } from "@hoteloftware/db";
import { addDays } from "@hoteloftware/domain";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { ActionForm, Field } from "@/components/form-fields";
import { addClosedPeriodAction, removeClosedPeriodAction, statsSettingsAction, submitReportAction } from "./actions";

/** Official tourism statistics of the property selected in the navbar, per calendar month (ticket 85). */
export default async function StatisticsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.tourism_statistics"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("tourism_statistics", property.id);
  const s = tenant.schemaName;
  // the months up to the current one, the last finished month first
  const thisMonth = property.businessDate.slice(0, 7);
  const months = Array.from({ length: 13 }, (_, i) => {
    let d = `${thisMonth}-01`;
    for (let k = 0; k < i; k++) d = addDays(d, -1).slice(0, 7) + "-01";
    return d.slice(0, 7);
  });
  const requested = (await searchParams).month;
  const month = requested && months.includes(requested) ? requested : months[1]!;
  let report;
  try {
    report = await tourismReport(pool(), s, property.id, month);
  } catch (err) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.tourism_statistics"]}</h1>
        <p className="mt-2 text-ink-60">{err instanceof Error ? err.message : ""}</p>
      </div>
    );
  }
  const [settings, due, users] = await Promise.all([statsSettings(pool(), s, property.id), dueTourismReport(pool(), s, property.id), listTenantUsers(pool(), tenant.id)]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const { current, versions } = report;
  const lang = language === "de" ? "de" : "en";
  const when = (d: Date) => new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: property.timeZone }).format(d);
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const c = current.capacity;
  // what changed since the last submitted version: a correction is needed
  const last = versions[0]?.data;
  const changed = last
    ? current.rows.filter((r) => {
        const before = last.rows.find((x) => x.key === r.key);
        return (before?.arrivals ?? 0) !== r.arrivals || (before?.nights ?? 0) !== r.nights;
      })
    : [];
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-medium">
            {m["module.tourism_statistics"]} <span className="text-ink-60">· {property.name}</span>
          </h1>
          <p className="text-sm text-ink-60">{m[`stats.form.${current.variant}`]}</p>
        </div>
        <nav aria-label={m["stats.month"]} className="flex flex-wrap gap-1">
          {months.slice(0, 7).map((mo) => (
            <Link key={mo} href={`/statistics?month=${mo}`} aria-current={mo === month ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm ${mo === month ? "bg-ink text-canvas" : "bg-surface-2"}`}>
              {mo}
            </Link>
          ))}
        </nav>
      </div>

      {due ? (
        <p role="alert" data-reminder={due.month} className="rounded-2xl bg-danger/15 px-4 py-2 text-sm">
          {fill(m["stats.due"], { month: due.month, deadline: due.deadline })}
        </p>
      ) : null}

      <section aria-label={m["stats.report"]} className={section}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 font-medium">{fill(m["stats.reportOf"], { month })}</h2>
          <a href={`/statistics/report/pdf?month=${month}`} target="_blank" rel="noreferrer" className="text-accent underline">
            PDF
          </a>
          <a href={`/statistics/report/csv?month=${month}`} className="text-accent underline">
            {m["stats.spreadsheet"]}
          </a>
        </div>
        <p className="text-xs text-ink-60">{fill(m["stats.deadline"], { date: statsDeadline(month, settings.deadlineDay), identity: settings.identity || "–" })}</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          <dt className="text-ink-60">{m["stats.openingDays"]}</dt>
          <dd data-capacity="openingDays">{c.openingDays}</dd>
          <dt className="text-ink-60">{m["stats.bedPlaces"]}</dt>
          <dd data-capacity="bedPlaces">{c.bedPlaces}</dd>
          <dt className="text-ink-60">{m["stats.extraBeds"]}</dt>
          <dd>{c.extraBeds}</dd>
          <dt className="text-ink-60">{m["stats.rooms"]}</dt>
          <dd>{c.rooms}</dd>
          {current.variant === "DE" && c.rooms >= 25 ? (
            <>
              <dt className="text-ink-60">{m["stats.roomDaysOffered"]}</dt>
              <dd>{c.roomDaysOffered}</dd>
              <dt className="text-ink-60">{m["stats.roomDaysOccupied"]}</dt>
              <dd>{c.roomDaysOccupied}</dd>
            </>
          ) : null}
          {current.variant === "CH" ? (
            <>
              <dt className="text-ink-60">{m["stats.roomDaysOccupied"]}</dt>
              <dd>{c.roomDaysOccupied}</dd>
              <dt className="text-ink-60">{m["stats.takings"]}</dt>
              <dd>{c.takingsPerPersonNight === null ? "–" : c.takingsPerPersonNight.toFixed(2)}</dd>
            </>
          ) : null}
        </dl>
        <table className="w-full text-left">
          <thead className="text-xs text-ink-60">
            <tr>
              <th className="py-1">{m["stats.residence"]}</th>
              <th className="text-right">{m["stats.arrivals"]}</th>
              <th className="text-right">{m["stats.nights"]}</th>
            </tr>
          </thead>
          <tbody>
            {current.rows.map((r) => (
              <tr key={r.key} data-row={r.key} className={`border-t border-ink-5 ${r.arrivals || r.nights ? "font-medium" : "text-ink-60"}`}>
                <td className="py-0.5">{r.label[lang]}</td>
                <td className="text-right tabular-nums">{r.arrivals}</td>
                <td className="text-right tabular-nums">{r.nights}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink-10 font-semibold" data-row="total">
              <td className="py-1">{m["stats.total"]}</td>
              <td className="text-right tabular-nums">{current.totals.arrivals}</td>
              <td className="text-right tabular-nums">{current.totals.nights}</td>
            </tr>
          </tbody>
        </table>
        {last && changed.length ? (
          <div role="note" data-testid="changed" className="rounded-xl bg-warning/15 p-3">
            <p className="font-medium">{fill(m["stats.changedSince"], { n: String(versions[0]!.version) })}</p>
            <ul>
              {changed.map((r) => {
                const before = last.rows.find((x) => x.key === r.key);
                return (
                  <li key={r.key}>
                    {r.label[lang]}: {before?.arrivals ?? 0} → {r.arrivals} · {before?.nights ?? 0} → {r.nights}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {current.incomplete.length ? (
          <div data-testid="incomplete">
            <h3 className="font-medium text-warning">{m["stats.incomplete"]}</h3>
            <ul className="grid gap-0.5">
              {current.incomplete.map((x) => (
                <li key={x.reservationId}>
                  <Link href={`/reservations/${x.reservationId}`} className="underline">
                    {x.confirmationNumber} · {x.guestName}
                  </Link>{" "}
                  <span className="text-ink-60">· {m[`stats.missing.${x.missing}`]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {current.excluded.length ? (
          <div>
            <h3 className="font-medium">{m["stats.excluded"]}</h3>
            <ul className="grid gap-0.5">
              {current.excluded.map((x) => (
                <li key={x.reservationId}>
                  <Link href={`/reservations/${x.reservationId}`} className="underline">
                    {x.confirmationNumber} · {x.guestName}
                  </Link>{" "}
                  <span className="text-ink-60">· {x.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/* a month is submitted once it is over */}
        {month < thisMonth ? (
          <ActionForm action={submitReportAction} submitLabel={versions.length ? m["stats.correct"] : m["stats.submit"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-center gap-3">
            {hidden}
            <input type="hidden" name="month" value={month} />
            <span className="text-xs text-ink-60">{m["stats.submitHelp"]}</span>
          </ActionForm>
        ) : null}
      </section>

      <section aria-label={m["stats.versions"]} className={section}>
        <h2 className="font-medium">{m["stats.versions"]}</h2>
        {versions.length === 0 ? <p className="text-ink-60">{m["stats.notSubmitted"]}</p> : null}
        <ul className="grid gap-1">
          {versions.map((v) => (
            <li key={v.version} data-version={v.version} className="flex flex-wrap gap-3">
              <span className="font-medium">{fill(m["stats.version"], { n: String(v.version) })}</span>
              <span className="text-ink-60">
                {when(v.submittedAt)} · {name.get(v.submittedBy) ?? "?"} · {fill(m["stats.versionTotals"], { arrivals: String(v.data.totals.arrivals), nights: String(v.data.totals.nights) })}
              </span>
              <a href={`/statistics/report/pdf?month=${month}&version=${v.version}`} target="_blank" rel="noreferrer" className="text-accent underline">
                PDF
              </a>
              <a href={`/statistics/report/csv?month=${month}&version=${v.version}`} className="text-accent underline">
                {m["stats.spreadsheet"]}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={m["stats.settings"]} className={section}>
        <h2 className="font-medium">{m["stats.settings"]}</h2>
        <ActionForm action={statsSettingsAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-3">
          {hidden}
          <Field label={m["stats.identity"]} name="identity" defaultValue={settings.identity} />
          <Field label={m["stats.deadlineDay"]} name="deadlineDay" type="number" defaultValue={String(settings.deadlineDay)} />
        </ActionForm>
        <h3 className="font-medium">{m["stats.closedPeriods"]}</h3>
        <ul className="grid gap-1">
          {settings.closedPeriods.map((x) => (
            <li key={x.id} className="flex items-center gap-3">
              <span>
                {x.from} – {x.to}
                {x.reason ? ` · ${x.reason}` : ""}
              </span>
              <ActionForm action={removeClosedPeriodAction} submitLabel={m["tools.remove"]} className="inline">
                {hidden}
                <input type="hidden" name="closedPeriodId" value={x.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={addClosedPeriodAction} submitLabel={m["stats.addClosedPeriod"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
          {hidden}
          <Field label={m["tools.markerFrom"]} name="from" type="date" required />
          <Field label={m["tools.markerTo"]} name="to" type="date" />
          <Field label={m["cash.reason"]} name="reason" />
        </ActionForm>
      </section>
    </div>
  );
}
