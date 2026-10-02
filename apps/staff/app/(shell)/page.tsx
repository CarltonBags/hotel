import Link from "next/link";
import { DATA_KINDS, can, formatDateTime, todayIn } from "@hoteloftware/domain";
import { listOverbooked, todaySummary } from "@hoteloftware/db";
import { LiveRefresh } from "@/shell/LiveRefresh";
import { fill } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";

/**
 * Today: per property, arrivals, departures, in-house, Occupancy tonight and
 * overbooked reservations. With one property selected its card only; with
 * "All properties" the consolidated view of every property the user may see.
 */
export default async function TodayPage() {
  const { principal, properties, messages, language, scope } = await loadShell();
  const { tenant, session, actor } = principal;
  const now = new Date();
  // TODO(Night Audit ticket): each property's open Business Date instead of its wall-clock date
  const shown = properties.filter((p) => (scope === "all" || p.id === scope) && can(actor, "view_reservations", p.id));
  const cards = await Promise.all(
    shown.map(async (p) => {
      const today = todayIn(p.timeZone);
      const [summary, overbooked] = await Promise.all([todaySummary(pool(), tenant.schemaName, p.id, today), listOverbooked(pool(), tenant.schemaName, p.id, today)]);
      return { property: p, summary, overbooked, lists: can(actor, "view_operational_lists", p.id) };
    }),
  );
  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="text-ink-60">{messages["home.signedInTo"]}</p>
      <h1 className="text-xl font-medium">{tenant.name}</h1>
      <p className="mt-1 text-sm text-ink-60">
        {session.user.name} · {session.user.username ?? session.user.email}
        {actor.tenantRole ? ` · ${messages[`role.${actor.tenantRole}`]}` : ""}
      </p>

      <LiveRefresh kind={DATA_KINDS.reservations} propertyIds={shown.map((p) => p.id)} />
      {cards.length ? (
        <section aria-label={messages["today.title"]} className="mt-6 grid gap-4">
          {cards.map(({ property, summary, overbooked, lists }) => (
            <article key={property.id} data-property={property.name} className="rounded-2xl bg-surface-2 p-5">
              <h2 className="font-medium">
                {property.name} <span className="text-sm font-normal text-ink-60">· {formatDateTime(now, language, property.country, property.timeZone)}</span>
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {(
                  [
                    ["arrivals", summary.arrivals, "/lists/arrivals"],
                    ["departures", summary.departures, "/lists/departures"],
                    ["inHouse", summary.inHouse, "/lists/in-house"],
                    ["occupancy", `${summary.occupancy} %`, "/lists/house"],
                  ] as const
                ).map(([key, value, href]) => (
                  <div key={key} data-figure={key} className="rounded-xl bg-surface px-4 py-3">
                    <dt className="text-xs text-ink-60">{messages[`today.${key}`]}</dt>
                    <dd className="text-2xl font-medium">
                      {lists && scope !== "all" ? (
                        <Link href={href} className="hover:underline">
                          {value}
                        </Link>
                      ) : (
                        value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-ink-60">{fill(messages["today.occupancyHelp"], { staying: summary.staying, rooms: summary.rooms })}</p>
              {overbooked.length ? (
                <div aria-label={messages["res.overbookedList"]} className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-3">
                  <h3 className="text-sm font-medium text-danger">{messages["res.overbookedList"]}</h3>
                  <ul className="mt-1 grid gap-1 text-sm">
                    {overbooked.map((r) => (
                      <li key={r.reservationId}>
                        <Link href={`/reservations/${r.reservationId}`} className="underline">
                          {r.confirmationNumber}
                        </Link>{" "}
                        · {r.guestName} · {r.roomTypeCode} · {r.arrival} – {r.departure}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

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
