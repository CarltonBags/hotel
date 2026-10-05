import { redirect } from "next/navigation";
import { listTenantUsers, outletReport } from "@hoteloftware/db";
import { addDays, formatCurrency } from "@hoteloftware/domain";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { outletsModuleOn } from "@/lib/outlets";
import { loadShell } from "@/lib/shell";

/** Outlet reports (ticket 61): per outlet, day and user who closed the bills; the Property Manager and Accounting every outlet, an Outlet Manager own outlets. */
export default async function OutletReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.outlet_reports"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = await requireAllowed("view_outlet_reports", property.id);
  if (!(await outletsModuleOn(tenant.schemaName, property.id))) redirect("/not-allowed");
  const q = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const to = q.to && day.test(q.to) ? q.to : property.businessDate;
  const from = q.from && day.test(q.from) ? q.from : addDays(to, -6);
  const [rows, users] = await Promise.all([outletReport(pool(), tenant.schemaName, property.id, { from, to }, { userId: session.user.id, actor }), listTenantUsers(pool(), tenant.id)]);
  const money = (n: number) => formatCurrency(n, property.currency, language, property.country);
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const cols: [string, (r: (typeof rows)[number]) => string][] = [
    [m["outlet.report.bills"], (r) => String(r.bills)],
    [m["outlet.report.paid"], (r) => money(r.paid)],
    [m["outlet.report.room"], (r) => money(r.roomCharged)],
    [m["outlet.report.invoiced"], (r) => money(r.invoiced)],
    [m["outlet.report.discounts"], (r) => money(r.discounts)],
    [m["outlet.report.tips"], (r) => money(r.tips)],
    [m["outlet.report.voids"], (r) => String(r.voids)],
  ];
  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-6" data-outlet-report>
      <h1 className="text-xl font-medium">
        {m["module.outlet_reports"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <label className="grid gap-1">
          <span className="text-ink-80">{m["group.from"]}</span>
          <input type="date" name="from" defaultValue={from} className="h-10 rounded-xl border border-ink-10 bg-surface px-3" />
        </label>
        <label className="grid gap-1">
          <span className="text-ink-80">{m["group.to"]}</span>
          <input type="date" name="to" defaultValue={to} className="h-10 rounded-xl border border-ink-10 bg-surface px-3" />
        </label>
        <button className="h-10 rounded-full bg-accent px-4 font-medium text-white">{m["canton.show"]}</button>
      </form>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-60">
            <th className="py-1 font-normal">{m["outlet.choose"]}</th>
            <th className="py-1 font-normal">{m["group.arrival"]}</th>
            <th className="py-1 font-normal">{m["outlet.report.user"]}</th>
            {cols.map(([label]) => (
              <th key={label} className="py-1 text-right font-normal">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.outletId}|${r.date}|${r.userId}`} className="border-t border-ink-5" data-report-row={`${r.outlet}|${r.date}`}>
              <td className="py-1">{r.outlet}</td>
              <td className="py-1">{r.date}</td>
              <td className="py-1">{name(r.userId)}</td>
              {cols.map(([label, value]) => (
                <td key={label} className="py-1 text-right">
                  {value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="text-ink-60">–</p> : null}
    </div>
  );
}
