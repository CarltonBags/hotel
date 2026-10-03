import { listNightAuditReports, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";

/** The property's Night Audit reports (ticket 32): Property Manager and Accounting. */
export default async function NightAuditReportsPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.night_audit_reports"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("view_night_audit_reports", property.id);
  const [reports, users] = await Promise.all([listNightAuditReports(pool(), tenant.schemaName, property.id), listTenantUsers(pool(), tenant.id)]);
  const day = (d: string) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const when = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone });
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.night_audit_reports"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["na.reportsHelp"]}</p>
      </div>
      {reports.length === 0 ? <p className="text-ink-60">{m["na.noReports"]}</p> : null}
      <ul className="grid gap-1 text-sm">
        {reports.map((r) => (
          <li key={r.id} data-report={r.businessDate} className="flex flex-wrap gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <a href={`/night-audit-reports/${r.id}/pdf`} target="_blank" rel="noreferrer" className="font-medium underline">
              {day(r.businessDate)}
            </a>
            <span className="text-ink-60">{fill(m["na.closedBy"], { when: when.format(r.closedAt), name: users.find((u) => u.id === r.closedBy)?.name ?? r.closedBy })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
