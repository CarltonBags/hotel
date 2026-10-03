import Link from "next/link";
import { PROPERTY_ACTIONS, auditOverdue, can, daysBehind, todayIn, type PropertyAction } from "@hoteloftware/domain";
import { fill } from "@/i18n/messages";
import { loadShell } from "@/lib/shell";
import { Shell } from "@/shell/Shell";
import { ShellProvider } from "@/shell/ShellProvider";
import { PropertyChooser } from "@/shell/PropertyChooser";

/** Every signed-in page renders inside the shell's Stage. */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const shell = await loadShell();
  const { tenant, session, actor } = shell.principal;
  const propertyActions = (Object.keys(PROPERTY_ACTIONS) as PropertyAction[]).filter((a) => shell.properties.some((p) => can(actor, a, p.id)));
  // the Night Audit banner (ticket 32): for whoever runs the audit, while it is overdue or the Business Date lags
  const now = new Date();
  const late = shell.properties
    .filter((p) => (shell.scope === "all" || p.id === shell.scope) && can(actor, "run_night_audit", p.id))
    .map((p) => ({ p, behind: daysBehind(p.businessDate, todayIn(p.timeZone)), overdue: auditOverdue({ businessDate: p.businessDate, timeZone: p.timeZone, windowFrom: p.nightAuditFrom, deadline: p.nightAuditDeadline }, now) }))
    .filter((x) => x.overdue || x.behind > 1);
  const m = shell.messages;
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
    >
      {/* a front-office user with several properties picks the one they work in first */}
      {shell.frontOffice && !shell.scope && shell.propertyChoices.length > 1 ? <PropertyChooser /> : <Shell banner={banner}>{children}</Shell>}
    </ShellProvider>
  );
}
