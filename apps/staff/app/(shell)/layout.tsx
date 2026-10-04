import Link from "next/link";
import { dueTourismReports, findProperty, tenantLifecycle } from "@hoteloftware/db";
import { isSupportConsoleUser } from "@/lib/support";
import { endSupportAccessAction } from "./support/actions";
import { PROPERTY_ACTIONS, auditOverdue, can, daysBehind, deviceIdleMinutes, todayIn, trialDaysLeft, type PropertyAction } from "@hoteloftware/domain";
import { IdleLock } from "@/app/device/idle-lock";
import { pool } from "@/lib/db";
import { fill } from "@/i18n/messages";
import { loadShell } from "@/lib/shell";
import { Shell } from "@/shell/Shell";
import { ShellProvider } from "@/shell/ShellProvider";
import { PropertyChooser } from "@/shell/PropertyChooser";

/** Every signed-in page renders inside the shell's Stage. */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const shell = await loadShell();
  const { tenant, session, actor } = shell.principal;
  // signed in by PIN on an enrolled Device (ticket 14): the screen locks when idle
  const idleMinutes = session.device ? deviceIdleMinutes((await findProperty(pool(), tenant.schemaName, session.device.propertyId))?.deviceIdleMinutes) : null;
  const propertyActions = (Object.keys(PROPERTY_ACTIONS) as PropertyAction[]).filter((a) => shell.properties.some((p) => can(actor, a, p.id)));
  // the Night Audit banner (ticket 32): for whoever runs the audit, while it is overdue or the Business Date lags
  const now = new Date();
  const late = shell.properties
    .filter((p) => (shell.scope === "all" || p.id === shell.scope) && can(actor, "run_night_audit", p.id))
    .map((p) => ({ p, behind: daysBehind(p.businessDate, todayIn(p.timeZone)), overdue: auditOverdue({ businessDate: p.businessDate, timeZone: p.timeZone, windowFrom: p.nightAuditFrom, deadline: p.nightAuditDeadline }, now) }))
    .filter((x) => x.overdue || x.behind > 1);
  const m = shell.messages;
  // the official statistics reminder (ticket 85): from the deadline day until the month is submitted; one query for all properties in view
  const statsProperties = shell.properties.filter((p) => (shell.scope === "all" || p.id === shell.scope) && can(actor, "tourism_statistics", p.id));
  const dueByProperty = statsProperties.length ? await dueTourismReports(pool(), tenant.schemaName, statsProperties.map((p) => p.id)) : new Map<string, { month: string; deadline: string }>();
  const dueStats = statsProperties.filter((p) => dueByProperty.has(p.id)).map((p) => ({ p, due: dueByProperty.get(p.id) }));
  const statsBanner = dueStats.length ? (
    <div role="alert" data-stats-reminder className="flex shrink-0 flex-wrap items-center gap-3 rounded-2xl bg-warning/20 px-4 py-2 text-sm print:hidden">
      {dueStats.map(({ p, due }) => (
        <span key={p.id}>
          {shell.properties.length > 1 ? `${p.name}: ` : ""}
          {fill(m["stats.due"], { month: due!.month, deadline: due!.deadline })}
        </span>
      ))}
      <Link href="/statistics" className="font-medium underline">
        {m["module.tourism_statistics"]}
      </Link>
    </div>
  ) : null;
  const banner = late.length ? (
    <div role="alert" className="flex shrink-0 flex-wrap items-center gap-3 rounded-2xl bg-danger/15 px-4 py-2 text-sm print:hidden">
      {late.map(({ p, behind }) => (
        <span key={p.id}>
          {shell.properties.length > 1 ? `${p.name}: ` : ""}
          {behind > 1 ? fill(m["na.bannerBehind"], { date: p.businessDate, n: String(behind) }) : fill(m["na.banner"], { date: p.businessDate })}
        </span>
      ))}
      <Link href="/night-audit" className="font-medium underline">
        {m["na.run"]}
      </Link>
    </div>
  ) : null;
  // a support access shows itself for as long as it lasts (ticket 93)
  const supportBanner = session.support ? (
    <div role="status" data-support-banner className="flex shrink-0 flex-wrap items-center gap-3 rounded-2xl bg-accent/15 px-4 py-2 text-sm print:hidden">
      <span>{fill(m["support.banner"], { name: session.user.name, reason: session.support.reason })}</span>
      <form action={endSupportAccessAction}>
        <button type="submit" className="font-medium underline">
          {m["support.end"]}
        </button>
      </form>
    </div>
  ) : null;
  // Test Mode (ticket 87): for everyone, until go-live
  const life = await tenantLifecycle(pool(), tenant.id);
  const daysLeft = life.trialEndsAt ? trialDaysLeft(life.trialEndsAt, now) : null;
  const testBanner = life.liveAt ? null : (
    <div role="status" data-test-mode className="flex shrink-0 flex-wrap items-center gap-3 rounded-2xl bg-warning/25 px-4 py-2 text-sm print:hidden">
      <span className="font-medium">{m["golive.banner"]}</span>
      {daysLeft !== null ? <span>{daysLeft > 0 ? fill(m["golive.trialLeft"], { n: daysLeft }) : m["golive.trialEnded"]}</span> : null}
      {life.trialKind === "demo" ? <span>{m["golive.demo"]}</span> : null}
      {can(actor, "manage_tenant_settings") ? (
        <Link href="/settings/go-live" className="font-medium underline">
          {m["golive.open"]}
        </Link>
      ) : null}
    </div>
  );
  const banners = banner || statsBanner || supportBanner || testBanner ? (
    <>
      {testBanner}
      {supportBanner}
      {banner}
      {statsBanner}
    </>
  ) : null;
  return (
    <ShellProvider
      tenant={{ id: tenant.id, name: tenant.name, slug: tenant.slug }}
      user={{ id: session.user.id, name: session.user.name, email: session.user.email, username: session.user.username }}
      properties={shell.properties}
      scope={shell.scope}
      propertyChoices={shell.propertyChoices}
      pinnedTabs={shell.pinnedTabs}
      quickAccess={shell.quickAccess}
      messages={shell.messages}
      language={shell.language}
      theme={shell.theme}
      accent={shell.accent}
      canManageTenant={can(actor, "manage_tenant_settings")}
      propertyActions={propertyActions}
      supportStaff={(await isSupportConsoleUser()) !== null}
    >
      {idleMinutes ? <IdleLock minutes={idleMinutes} /> : null}
      {/* a front-office user with several properties picks the one they work in first */}
      {shell.frontOffice && !shell.scope && shell.propertyChoices.length > 1 ? <PropertyChooser /> : <Shell banner={banners}>{children}</Shell>}
    </ShellProvider>
  );
}
