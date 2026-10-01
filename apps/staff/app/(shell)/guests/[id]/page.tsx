import { notFound } from "next/navigation";
import { can } from "@hoteloftware/domain";
import Link from "next/link";
import { findGuest, findGuestDuplicates, guestHistory, listGuestMerges, listGuestReservations, listProperties, listTenantUsers, searchGuests } from "@hoteloftware/db";
import { RecordTab } from "@/shell/RecordTab";
import { requireAllowedAnywhere } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { guestRights } from "../guest-access";
import { GuestProfile } from "./guest-profile";

/** One Guest profile as a record tab: data, stays across properties, merges and change history. */
export default async function GuestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mergeQ?: string }> }) {
  const { tenant, actor } = await requireAllowedAnywhere("view_guests");
  const { messages: m, language } = await loadShell();
  const rights = guestRights(actor);
  const { id } = await params;
  const stored = await findGuest(pool(), tenant.schemaName, id);
  if (!stored) notFound();
  const guest = stored;
  const mergeQ = ((await searchParams).mergeQ ?? "").slice(0, 100);
  const [history, merges, users, properties, duplicates, candidates, allStays] = await Promise.all([
    guestHistory(pool(), tenant.schemaName, id),
    listGuestMerges(pool(), tenant.schemaName, id),
    listTenantUsers(pool(), tenant.id),
    listProperties(pool(), tenant.schemaName),
    rights.merge ? findGuestDuplicates(pool(), tenant.schemaName, stored, id) : Promise.resolve([]),
    rights.merge && mergeQ ? searchGuests(pool(), tenant.schemaName, mergeQ) : Promise.resolve([]),
    listGuestReservations(pool(), tenant.schemaName, id),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  // reservations only at properties where the user may see reservations
  const stays = allStays.filter((s) => can(actor, "view_reservations", s.propertyId));
  const createdAt = properties.find((p) => p.id === stored.createdPropertyId)?.name ?? null;
  const fmt = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const title = `${guest.firstName} ${guest.lastName}`.trim();
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6">
      <RecordTab module="guests" recordId={id} title={title} href={`/guests/${id}`} />
      <div>
        <Link href="/guests" className="text-sm text-ink-60 hover:underline">
          ← {m["module.guests"]}
        </Link>
        <h1 className="mt-1 text-xl font-medium">
          {title} {guest.vip ? <span className="ml-1 rounded-full bg-accent/15 px-2 align-middle text-xs text-accent">VIP</span> : null}
        </h1>
        <p className="text-sm text-ink-60">{createdAt ? fill(m["guests.createdAt"], { property: createdAt, date: fmt.format(stored.createdAt) }) : fmt.format(stored.createdAt)}</p>
      </div>

      <GuestProfile
        guest={guest}
        rights={rights}
        duplicates={duplicates.filter((d) => d.id !== id)}
        candidates={candidates.filter((c) => c.id !== id)}
        mergeQ={mergeQ}
        m={m}
      />

      <section aria-label={m["guests.stays"]} className="rounded-2xl bg-surface-2 p-5">
        <h2 className="font-medium">{m["guests.stays"]}</h2>
        {stays.length === 0 ? <p className="mt-1 text-sm text-ink-60">{m["guests.noStays"]}</p> : null}
        <ul className="mt-2 grid gap-1 text-sm">
          {stays.map((s) => (
            <li key={s.reservationId}>
              <Link href={`/reservations/${s.reservationId}`} className="underline">
                {s.confirmationNumber}
              </Link>{" "}
              · {s.propertyName} · {s.roomTypeCode} · {s.arrival} – {s.departure} · {m[`res.status.${s.status}`]}
            </li>
          ))}
        </ul>
      </section>

      {merges.length ? (
        <section aria-label={m["guests.merges"]} className="rounded-2xl bg-surface-2 p-5">
          <h2 className="font-medium">{m["guests.merges"]}</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {merges.map((x) => (
              <li key={`${x.mergedId}`}>
                {fmt.format(x.at)} · {names.get(x.userId) ?? x.userId} · {fill(m["guests.mergeLine"], { fields: String(x.filledFields.length), records: String(x.movedRecords) })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* everyone who may view the profile sees its history (matrix) */}
      <section aria-label={m["guests.history"]} className="rounded-2xl bg-surface-2 p-5">
          <h2 className="font-medium">{m["guests.history"]}</h2>
          {history.length === 0 ? <p className="mt-1 text-sm text-ink-60">{m["guests.noHistory"]}</p> : null}
          <ul className="mt-2 grid gap-1 text-sm">
            {history.map((h, i) => (
              <li key={i}>
                <span className="text-ink-60">{fmt.format(h.at)}</span> · {names.get(h.userId) ?? h.userId} · {h.field}: {h.oldValue ?? "—"} → {h.newValue ?? "—"}
              </li>
            ))}
          </ul>
        </section>
    </div>
  );
}
