import { CALENDAR_RANGES, DATA_KINDS, addDays, can, isCalendarDate } from "@hoteloftware/domain";
import { listEventMarkers, loadCalendar } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { LiveRefresh } from "@/shell/LiveRefresh";
import { CalendarRooms } from "./calendar-rooms";
import { CalendarAvailability } from "./calendar-availability";
import { AllPropertiesCalendar } from "./all-properties";

/** The timeline holds more days than are visible; it scrolls beyond the chosen range. */
const LOADED_DAYS = 45;

/** The Calendar of the property selected in the navbar: Rooms view (variant A) or Availability view (variant C); with "All properties", one Availability block per hotel. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ from?: string; range?: string; view?: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const sp = await searchParams;
  const range = CALENDAR_RANGES.find((r) => String(r) === sp.range) ?? 14;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    // "All properties": the Availability view with one block per hotel the user may see reservations of
    const { tenant, actor } = shell.principal;
    // front-office users never get "All properties" (their scope is one property)
    const visible = shell.scope === "all" && !shell.frontOffice ? shell.properties.filter((p) => can(actor, "view_reservations", p.id)) : [];
    if (!visible.length) {
      return (
        <div className="mx-auto max-w-3xl p-6">
          <h1 className="text-xl font-medium">{m["module.calendar"]}</h1>
          <p className="mt-2 text-ink-60">{m["cal.pickProperty"]}</p>
        </div>
      );
    }
    const blocks = await Promise.all(
      visible.map(async (p) => {
        // each hotel from three days before its own Business Date, as its Rooms view
        const from = isCalendarDate(sp.from) ? sp.from : addDays(p.businessDate, -3);
        const [data, markers] = await Promise.all([
          loadCalendar(pool(), tenant.schemaName, p.id, from, range),
          listEventMarkers(pool(), tenant.schemaName, p.id, { from, to: addDays(from, range - 1) }),
        ]);
        // the blocks show free rooms only: no guest data goes to the browser
        return { property: { id: p.id, name: p.name, currency: p.currency, country: p.country }, data: { ...data, reservations: [], sections: [], features: [] }, markers, today: p.businessDate };
      }),
    );
    return (
      <>
        <LiveRefresh kind={DATA_KINDS.reservations} propertyIds={visible.map((p) => p.id)} />
        <AllPropertiesCalendar blocks={blocks} range={range} language={shell.language} m={m} />
      </>
    );
  }
  const { tenant, actor } = await requireAllowed("view_reservations", property.id);
  // the line marks the property's open Business Date (ticket 32)
  const today = property.businessDate;
  const from = isCalendarDate(sp.from) ? sp.from : addDays(today, -3);
  const [data, markers] = await Promise.all([
    loadCalendar(pool(), tenant.schemaName, property.id, from, LOADED_DAYS),
    listEventMarkers(pool(), tenant.schemaName, property.id, { from, to: addDays(from, LOADED_DAYS - 1) }),
  ]);
  const info = { id: property.id, name: property.name, currency: property.currency, country: property.country };
  return (
    <>
      <LiveRefresh kind={DATA_KINDS.reservations} propertyIds={[property.id]} />
      {sp.view === "availability" ? (
        <CalendarAvailability property={info} data={data} today={today} range={range} markers={markers} language={shell.language} m={m} />
      ) : (
        <CalendarRooms property={info} data={data} today={today} markers={markers} range={range} canEdit={can(actor, "manage_reservations", property.id)} language={shell.language} m={m} />
      )}
    </>
  );
}
