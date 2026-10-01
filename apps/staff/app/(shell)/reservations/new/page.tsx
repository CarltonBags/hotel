import { addDays, can, todayIn } from "@hoteloftware/domain";
import { quoteStays } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { NewReservation } from "./new-reservation";

function isDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Child ages typed as "7, 3": whole years 0 to 17. */
function parseAges(s: string | undefined): number[] | null {
  const parts = (s ?? "").split(/[,\s]+/).filter(Boolean);
  const ages = parts.map(Number);
  return ages.every((a) => Number.isInteger(a) && a >= 0 && a <= 17) ? ages : null;
}

/** New reservation: stay and occupancy first, then availability with rate plans and prices, then guests and Booker. */
export default async function NewReservationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.new_reservation"]}</h1>
        <p className="mt-2 text-ink-60">{m["res.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("manage_reservations", property.id);
  const sp = await searchParams;
  const today = todayIn(property.timeZone);
  const arrival = isDate(sp.arrival) ? sp.arrival : today;
  const departure = isDate(sp.departure) && sp.departure > arrival ? sp.departure : addDays(arrival, 1);
  const adults = Math.min(20, Math.max(0, Number.parseInt(sp.adults ?? "2", 10) || 0));
  const childAges = parseAges(sp.children);
  const rateCode = (sp.rateCode ?? "").trim().slice(0, 50);
  const searched = sp.arrival !== undefined;
  let error: string | null = null;
  if (searched && arrival < today) error = m["res.pastArrival"];
  if (searched && childAges === null) error = m["res.badAges"];
  const quotes = searched && !error ? await quoteStays(pool(), tenant.schemaName, property.id, { arrival, departure, adults, childAges: childAges ?? [], rateCode: rateCode || undefined }) : null;
  return (
    <NewReservation
      property={{ id: property.id, name: property.name, currency: property.currency, country: property.country }}
      search={{ arrival, departure, adults, children: sp.children ?? "", rateCode }}
      childAges={childAges ?? []}
      quotes={quotes}
      error={error}
      today={today}
      canCreateGuests={can(actor, "edit_guests", property.id)}
      language={shell.language}
      m={m}
    />
  );
}
