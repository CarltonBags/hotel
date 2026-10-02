import { notFound } from "next/navigation";
import { DATA_KINDS, addDays, can, todayIn, isCalendarDate } from "@hoteloftware/domain";
import { breakfastList, houseList, listArrivals, listDepartures, listInHouse, type BreakfastList, type ListRow } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { LiveRefresh } from "@/shell/LiveRefresh";
import { OperationalList, type ListKind } from "./operational-list";

const KINDS: ListKind[] = ["arrivals", "departures", "in-house", "house", "breakfast"];

/** The operational lists of the property selected in the navbar, for a date (in-house: now). */
export default async function ListPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ date?: string }> }) {
  const { kind } = await params;
  if (!KINDS.includes(kind as ListKind)) notFound();
  const listKind = kind as ListKind;
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m[`lists.title.${listKind}`]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("view_operational_lists", property.id);
  // TODO(Night Audit ticket): default to the open Business Date
  const today = todayIn(property.timeZone);
  const requested = (await searchParams).date;
  const date = isCalendarDate(requested) ? requested : today;
  const s = tenant.schemaName;
  let rows: ListRow[] = [];
  let breakfast: BreakfastList | null = null;
  if (listKind === "arrivals") rows = await listArrivals(pool(), s, property.id, date);
  else if (listKind === "departures") rows = await listDepartures(pool(), s, property.id, date);
  else if (listKind === "in-house") rows = await listInHouse(pool(), s, property.id, today);
  else if (listKind === "house") rows = await houseList(pool(), s, property.id, date);
  else {
    breakfast = await breakfastList(pool(), s, property.id, date, today);
    rows = breakfast.rows;
  }
  return (
    <>
      <LiveRefresh kind={DATA_KINDS.reservations} propertyIds={[property.id]} />
      <OperationalList
        kind={listKind}
        property={{ name: property.name, country: property.country }}
        date={listKind === "in-house" ? today : date}
        today={today}
        prevDate={addDays(date, -1)}
        nextDate={addDays(date, 1)}
        rows={rows}
        breakfastCounts={breakfast?.counts ?? null}
        checkIn={listKind === "arrivals" && date === today && can(actor, "check_in", property.id)}
        language={shell.language}
        m={m}
      />
    </>
  );
}
