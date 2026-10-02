import { CALENDAR_RANGES, addDays, can, todayIn } from "@hoteloftware/domain";
import { loadCalendar } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { CalendarRooms } from "./calendar-rooms";

/** The timeline holds more days than are visible; it scrolls beyond the chosen range. */
const LOADED_DAYS = 45;

function isDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Calendar Rooms view of the property selected in the navbar (prototype variant A). */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ from?: string; range?: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.calendar"]}</h1>
        <p className="mt-2 text-ink-60">{m["cal.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("view_reservations", property.id);
  const sp = await searchParams;
  // TODO(Night Audit ticket): the line marks the open Business Date; until then the property's own date
  const today = todayIn(property.timeZone);
  const from = isDate(sp.from) ? sp.from : addDays(today, -3);
  const range = CALENDAR_RANGES.find((r) => String(r) === sp.range) ?? 14;
  const data = await loadCalendar(pool(), tenant.schemaName, property.id, from, LOADED_DAYS);
  return (
    <CalendarRooms
      property={{ id: property.id, name: property.name, currency: property.currency, country: property.country }}
      data={data}
      today={today}
      range={range}
      canEdit={can(actor, "manage_reservations", property.id)}
      language={shell.language}
      m={m}
    />
  );
}
