import Link from "next/link";
import { searchGuests } from "@hoteloftware/db";
import { requireAllowedAnywhere } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { guestRights } from "./guest-access";
import { NewGuestForm } from "./new-guest-form";

/** Guest profiles of the whole tenant: search across properties, create with duplicate check. */
export default async function GuestsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { tenant, actor } = await requireAllowedAnywhere("view_guests");
  const { messages: m } = await loadShell();
  const rights = guestRights(actor);
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const rows = q ? await searchGuests(pool(), tenant.schemaName, q) : [];
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6">
      <h1 className="text-xl font-medium">{m["module.guests"]}</h1>
      <form role="search" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder={m["guests.searchHint"]}
          aria-label={m["guests.search"]}
          className="h-10 flex-1 rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm"
        />
        <button type="submit" className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-white">
          {m["guests.search"]}
        </button>
      </form>
      {q ? (
        <section aria-label={m["guests.results"]}>
          {rows.length === 0 ? (
            <p className="text-ink-60">{m["guests.noneFound"]}</p>
          ) : (
            <ul className="divide-y divide-ink-5 rounded-2xl bg-surface-2">
              {rows.map((g) => (
                <li key={g.id}>
                  <Link href={`/guests/${g.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-ink-5">
                    <span className="font-medium">
                      {g.lastName}, {g.firstName}
                    </span>
                    {g.vip ? <span className="rounded-full bg-accent/15 px-2 text-xs text-accent">VIP</span> : null}
                    <span className="text-sm text-ink-60">
                      {[g.dateOfBirth, g.countryOfResidence, g.email, g.phone].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {rights.edit ? (
        <section className="rounded-2xl bg-surface-2 p-5">
          <h2 className="mb-3 font-medium">{m["guests.new"]}</h2>
          <NewGuestForm m={m} />
        </section>
      ) : null}
    </div>
  );
}
