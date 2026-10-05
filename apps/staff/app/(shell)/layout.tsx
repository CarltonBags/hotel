import Link from "next/link";
import { dueTourismReports, findProperty, getDowntimeOptions, modulePeriods, tenantLifecycle } from "@hoteloftware/db";
import { OfflineDesk } from "@/shell/offline-desk";
import { downtimeText } from "@/lib/downtime-text";
import { isSupportConsoleUser } from "@/lib/support";
import { nonPaymentStage } from "@/lib/authorize";
import { endSupportAccessAction } from "./support/actions";
import { MODULES, PROPERTY_ACTIONS, TENANT_ACTIONS, atLeast, auditOverdue, can, canAtAnyProperty, lockedByNonPayment, daysBehind, deviceIdleMinutes, moduleState, moduleVisible, todayIn, trialDaysLeft, type PropertyAction, type TenantAction } from "@hoteloftware/domain";
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
  // settings and reports leave the menu while the subscription is 30 days overdue (ticket 89)
  const stage = await nonPaymentStage(tenant.id);
  const propertyActions = (Object.keys(PROPERTY_ACTIONS) as PropertyAction[]).filter((a) => !lockedByNonPayment(stage, a) && shell.properties.some((p) => can(actor, a, p.id)));
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
  // Module screens show where the Module is on, or off but readable, at a property in view (ticket 88)
  const inView = shell.properties.filter((p) => shell.scope === "all" || !shell.scope || p.id === shell.scope);
  const periods = await modulePeriods(pool(), tenant.schemaName, inView.map((p) => p.id));
  const activeModules = MODULES.filter((mod) => inView.some((p) => moduleVisible(moduleState(periods.get(p.id) ?? [], mod, todayIn(p.timeZone)))));
  // the desk keeps the property's lists for an outage (ticket 86): one property in scope, a desk role there
  const scoped = shell.properties.find((p) => p.id === shell.scope);
  const deskProperty = scoped && can(actor, "use_downtime", scoped.id) ? scoped : null;
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
  // the subscription overdue: managers see it from day 30 (the Owner is reminded before)
  const manager = can(actor, "manage_tenant_settings") || canAtAnyProperty(actor, "manage_property_settings");
  const paymentBanner =
    manager && atLeast(stage, "restricted") ? (
      <div role="alert" data-non-payment={stage} className="flex shrink-0 flex-wrap items-center gap-3 rounded-2xl bg-danger/15 px-4 py-2 text-sm print:hidden">
        <span>{m[`nonpay.banner.${stage as "restricted" | "no_new_bookings" | "termination"}`]}</span>
        {can(actor, "manage_subscription") ? (
          <Link href="/settings/subscription" className="font-medium underline">
            {m["module.settings_subscription"]}
          </Link>
        ) : null}
      </div>
    ) : null;
  const banners = banner || statsBanner || supportBanner || testBanner || paymentBanner ? (
    <>
      {paymentBanner}
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
      propertyActions={propertyActions}
      supportStaff={(await isSupportConsoleUser()) !== null}
      tenantActions={(Object.keys(TENANT_ACTIONS) as TenantAction[]).filter((a) => !lockedByNonPayment(stage, a) && can(actor, a))}
      activeModules={activeModules}
    >
      {idleMinutes ? <IdleLock minutes={idleMinutes} /> : null}
      {deskProperty ? (
        <OfflineDesk
          text={downtimeText(m)}
          labels={{ banner: m["offline.banner"], since: m["offline.since"], age: m["offline.age"], disabled: m["offline.disabled"], none: m["offline.none"], reminder: m["offline.reminder"], print: m["offline.print"] }}
          propertyId={deskProperty.id}
          reminderAt={(await getDowntimeOptions(pool(), tenant.schemaName, deskProperty.id)).reminderAt}
          timeZone={deskProperty.timeZone}
        />
      ) : null}
      {/* a front-office user with several properties picks the one they work in first */}
      {shell.frontOffice && !shell.scope && shell.propertyChoices.length > 1 ? <PropertyChooser /> : <Shell banner={banners}>{children}</Shell>}
    </ShellProvider>
  );
}
