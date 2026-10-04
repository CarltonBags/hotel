import { listSupportAccesses } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";

/** Every access of the platform's support to this tenant: who, when, why (ticket 93). */
export default async function SupportAccessPage() {
  const { messages: m, language } = await loadShell();
  const { tenant } = await requireAllowed("view_support_accesses");
  const entries = await listSupportAccesses(pool(), tenant.id);
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">{m["module.settings_support_access"]}</h1>
        <p className="text-sm text-ink-60">{m["support.listHelp"]}</p>
      </div>
      <table className="w-full rounded-2xl bg-surface-2 text-left text-sm">
        <thead className="text-xs text-ink-60">
          <tr>
            <th className="p-3">{m["support.when"]}</th>
            <th>{m["support.who"]}</th>
            <th>{m["support.reason"]}</th>
            <th className="pr-3">{m["support.until"]}</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-3 text-ink-60">
                {m["support.none"]}
              </td>
            </tr>
          ) : null}
          {entries.map((e) => (
            <tr key={e.id} data-access={e.staffName} className="border-t border-ink-5">
              <td className="p-3 whitespace-nowrap">{when(e.startedAt)}</td>
              <td>{e.staffName}</td>
              <td>{e.reason}</td>
              <td className="pr-3 whitespace-nowrap">{e.endedAt ? when(e.endedAt) : e.expiresAt > new Date() ? m["support.active"] : when(e.expiresAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
