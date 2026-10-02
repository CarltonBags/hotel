import Link from "next/link";
import { DATA_KINDS, can, formatCurrency, formatDate, formatDateTime, todayIn } from "@hoteloftware/domain";
import { WORKSPACE_LISTS, listOverbooked, todaySummary, workspaceCounts, workspaceList, type WorkspaceList as ListKind } from "@hoteloftware/db";
import { paymentProps, reservationView } from "@/lib/reservation-view";
import { WorkspaceList } from "./_today/workspace-list";
import { WorkspaceReservation } from "./_today/workspace-reservation";
import { LiveRefresh } from "@/shell/LiveRefresh";
import { fill } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";

/**
 * Today: per property, arrivals, departures, in-house, Occupancy tonight and
 * overbooked reservations. With one property selected its card only; with
 * "All properties" the consolidated view of every property the user may see.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ list?: string; r?: string }> }) {
  const { principal, properties, messages, language, scope } = await loadShell();
  const { tenant, session, actor } = principal;
  // one property and the right to its lists: the front-office workspace (ticket 96)
  const property = properties.find((p) => p.id === scope);
  if (property && can(actor, "view_operational_lists", property.id)) {
    const sp = await searchParams;
    return <Workspace property={property} list={(WORKSPACE_LISTS as readonly string[]).includes(sp.list ?? "") ? (sp.list as ListKind) : "arrivals"} selected={sp.r ?? null} />;
  }
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

/**
 * The Today workspace: list buttons, search and filters on the left, the
 * chosen reservation editable on the right. Fills the Stage; only the list
 * and the reservation scroll, each in its own box.
 */
async function Workspace({ property, list, selected }: { property: Awaited<ReturnType<typeof loadShell>>["properties"][number]; list: ListKind; selected: string | null }) {
  const { principal, messages: m, language } = await loadShell();
  const s = principal.tenant.schemaName;
  // TODO(Night Audit ticket): the open Business Date
  const today = todayIn(property.timeZone);
  const [counts, rows] = await Promise.all([workspaceCounts(pool(), s, property.id, today), workspaceList(pool(), s, property.id, list, today)]);
  const currency = { code: property.currency, language, country: property.country };
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  const date = (d: string) => formatDate(new Date(`${d}T12:00:00Z`), language, property.country, "UTC");
  // only a reservation of this property opens here; another one is ignored
  const view = selected ? await reservationView(selected, { propertyId: property.id }) : null;
  const row = view ? rows.find((x) => x.reservationId === view.r.id) : undefined;
  return (
    <div className="flex h-full min-h-0 gap-5 p-5">
      <LiveRefresh kind={DATA_KINDS.reservations} propertyIds={[property.id]} />
      <aside className="flex w-[400px] shrink-0 flex-col">
        <WorkspaceList kind={list} counts={counts} rows={rows} selectedId={view?.r.id ?? null} currency={currency} m={m} />
      </aside>
      <section aria-label={m["ws.reservation"]} className="min-h-0 min-w-0 flex-1 overflow-auto rounded-2xl bg-surface-2 p-5">
        {view ? (
          <WorkspaceReservation
            // a new reservation starts with fresh forms, never the previous one's typed values
            key={view.r.id}
            summary={{
              id: view.r.id,
              status: view.r.status,
              confirmationNumber: view.r.booking.confirmationNumber,
              guestName: view.guestName,
              stay: `${date(view.r.arrival)} – ${date(view.r.departure)}`,
              room: row?.room ?? view.r.assignments.find((a) => a.from <= today && a.to > today)?.roomName ?? view.r.assignments[0]?.roomName ?? null,
              roomType: view.r.roomType.code,
              ratePlan: view.r.ratePlan.name,
              booker: view.r.booking.bookerName,
              balance: money(row?.balance ?? view.payments.guestBalance),
              canCheckIn: view.r.status === "confirmed" && view.rights.checkIn && view.r.arrival <= today && today < view.r.departure,
              // notes may carry contact details (permission matrix)
              notes: view.rights.contacts ? view.r.booking.notes : "",
              companyFolios: view.folioProps.view.folios.filter((f) => f.billTo === "company").map((f) => `${f.number} · ${f.billToName}`),
            }}
            rights={{
              manage: view.rights.manage,
              folio: view.rights.folio,
              post: view.rights.post,
              manageFolios: view.rights.manageFolios,
              companies: view.rights.companies,
              editGuests: view.rights.editGuests,
              contacts: view.rights.contacts,
            }}
            actionsProps={view.actionsProps}
            folioProps={view.folioProps}
            paymentsProps={{ ...paymentProps(view), folios: view.payments.folios, rights: { take: view.rights.takePayments, refund: view.rights.refunds } }}
            holdsProps={{ ...paymentProps(view), holds: view.payments.holds, balance: view.payments.guestBalance, canTake: view.rights.takePayments }}
            fixedProps={{
              reservationId: view.r.id,
              arrival: view.r.arrival,
              departure: view.r.departure,
              items: view.fixedCharges,
              services: view.serviceOptions,
              rights: { add: view.rights.post, remove: view.rights.manageFolios },
              currency,
            }}
            guest={view.guest}
            registration={view.registration}
            m={m}
          />
        ) : (
          <p className="grid h-full place-items-center text-sm text-ink-60">{m["ws.pick"]}</p>
        )}
      </section>
    </div>
  );
}
