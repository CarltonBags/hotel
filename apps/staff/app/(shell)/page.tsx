import Link from "next/link";
import { can, formatDateTime } from "@hoteloftware/domain";
import { loadShell } from "@/lib/shell";

/** Today: the dashboard arrives with ticket 25; for now the properties the user may open, in property time. */
export default async function TodayPage() {
  const { principal, properties, messages, language } = await loadShell();
  const { tenant, session, actor } = principal;
  const now = new Date();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="text-ink-60">{messages["home.signedInTo"]}</p>
      <h1 className="text-xl font-medium">{tenant.name}</h1>
      <p className="mt-1 text-sm text-ink-60">
        {session.user.name} · {session.user.username ?? session.user.email}
        {actor.tenantRole ? ` · ${messages[`role.${actor.tenantRole}`]}` : ""}
      </p>

      <h2 className="mt-6 font-medium">{messages["home.yourProperties"]}</h2>
      {properties.length === 0 ? (
        <p className="text-ink-60">
          {messages["home.noProperty"]}{" "}
          {can(actor, "manage_properties") ? <Link href="/settings/properties">{messages["home.createInSettings"]}</Link> : messages["home.askForRole"]}
        </p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {properties.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3">
              <span className="font-medium">{p.name}</span>
              <span className="text-sm text-ink-60">
                {formatDateTime(now, language, p.country, p.timeZone)} ({p.timeZone}) · {p.currency}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
