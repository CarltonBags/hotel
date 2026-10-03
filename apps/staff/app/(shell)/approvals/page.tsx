import { listApprovals, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { DecideButtons } from "./decide-buttons";

/** Approval requests of the property selected in the navbar (ticket 31): open ones first, then the last 30 days. */
export default async function ApprovalsPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["appr.title"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("approve_requests", property.id);
  const [requests, users] = await Promise.all([listApprovals(pool(), tenant.schemaName, property.id), listTenantUsers(pool(), tenant.id)]);
  const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : "");
  const when = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone });
  const open = requests.filter((r) => r.status === "pending");
  const recent = requests.filter((r) => r.status !== "pending");
  return (
    <div className="mx-auto grid max-w-4xl gap-5 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["appr.title"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["appr.help"]}</p>
      </div>
      <section aria-label={m["appr.open"]} className="grid gap-2 text-sm">
        <h2 className="font-medium">{m["appr.open"]}</h2>
        {open.length === 0 ? <p className="text-ink-60">{m["appr.none"]}</p> : null}
        {open.map((r) => (
          <div key={r.id} data-approval={r.id} className="grid gap-2 rounded-2xl bg-surface-2 p-4">
            <p className="font-medium">{r.summary}</p>
            <p className="text-xs text-ink-60">
              {fill(m["appr.requestedBy"], { name: name(r.requestedBy), when: when.format(r.requestedAt) })} · {fill(m["appr.expires"], { when: when.format(r.expiresAt) })}
            </p>
            <DecideButtons approvalId={r.id} m={m} />
          </div>
        ))}
      </section>
      <section aria-label={m["appr.recent"]} className="grid gap-1 text-sm">
        <h2 className="font-medium">{m["appr.recent"]}</h2>
        {recent.length === 0 ? <p className="text-ink-60">{m["appr.none"]}</p> : null}
        <ul className="grid gap-1">
          {recent.map((r) => (
            <li key={r.id} data-approval={r.id} className="flex flex-wrap gap-2 rounded-xl bg-surface-2 px-3 py-2">
              <span className="min-w-0 flex-1">{r.summary}</span>
              <span className="text-ink-60">
                {fill(m["appr.requestedBy"], { name: name(r.requestedBy), when: when.format(r.requestedAt) })} · {m[`appr.status.${r.status}`]}
                {r.decidedBy ? ` ${fill(m["appr.decidedBy"], { name: name(r.decidedBy) })}` : ""}
                {r.inPlace ? ` · ${m["appr.inPlace"]}` : ""}
                {r.note ? ` · ${r.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
