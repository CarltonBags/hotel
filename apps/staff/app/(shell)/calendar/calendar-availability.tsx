"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CALENDAR_RANGES, addDays, cellReservations, datesFrom, formatCurrency, localeFor, occupancyPercent, weekdayIndex, type CalendarRange, type Language } from "@hoteloftware/domain";
import type { CalendarData, CalendarDay, EventMarker } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { MARKER_STYLE } from "../rates/marker-style";

/** Free rooms as a heat map: none left, few left, plenty. */
function tone(day: CalendarDay): string {
  if (day.stopSell) return "bg-ink-5 text-ink-40";
  if (day.free <= 0) return "bg-danger/15 text-danger";
  if (day.free <= 2) return "bg-warning/20";
  return "bg-success/10";
}

function marks(day: CalendarDay): string {
  return [day.stopSell && "STOP", day.minStay && `min ${day.minStay}`, day.closedToArrival && "CTA", day.closedToDeparture && "CTD", day.maxStay && `≤${day.maxStay}`].filter(Boolean).join(" ");
}

/** Rooms / Availability: the Calendar's two views of one property. */
export function ViewToggle({ view, from, range, m }: { view: "rooms" | "availability"; from: string; range: number; m: Messages }) {
  const cls = (on: boolean) => `flex h-8 items-center rounded-full px-3 text-[13px] ${on ? "bg-ink text-canvas" : "text-ink-80 hover:bg-ink-5"}`;
  return (
    <div className="flex gap-1 rounded-full bg-surface-2 p-1" role="group" aria-label={m["cal.view"]}>
      <Link href={`/calendar?from=${from}&range=${range}`} aria-pressed={view === "rooms"} className={cls(view === "rooms")}>
        {m["cal.view.rooms"]}
      </Link>
      <Link href={`/calendar?from=${from}&range=${range}&view=availability`} aria-pressed={view === "availability"} className={cls(view === "availability")}>
        {m["cal.view.availability"]}
      </Link>
    </div>
  );
}

/**
 * The Availability matrix (Calendar prototype variant C): room types by
 * days, free rooms as a heat map with the lowest price and restriction
 * marks, occupancy per day. Selecting a cell lists the reservations behind
 * it. Compact (All properties) it only shows the matrix.
 */
export function AvailabilityMatrix(props: {
  property: { id: string; name: string; currency: string; country: string };
  data: CalendarData;
  today: string;
  range: number;
  markers: EventMarker[];
  language: Language;
  m: Messages;
  compact?: boolean;
}) {
  const { property, data, today, m, language, compact } = props;
  const dates = useMemo(() => datesFrom(data.from, Math.min(props.range, data.days)), [data.from, data.days, props.range]);
  const locale = localeFor(language, property.country);
  const fmtWd = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }), [locale]);
  const fmtDay = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }), [locale]);
  const fmtLong = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }), [locale]);
  const at = (d: string) => new Date(`${d}T00:00:00Z`);
  const [picked, setPicked] = useState<{ typeId: string; date: string } | null>(null);
  const money = (n: number) => formatCurrency(n, property.currency, language, property.country).replace(/[.,]00(?=\D*$)/, "");
  const cw = compact ? 44 : 58;

  const type = picked ? data.roomTypes.find((t) => t.id === picked.typeId) : undefined;
  const day = type && picked ? type.days.find((x) => x.date === picked.date) : undefined;
  const cell = picked ? cellReservations(data.reservations, picked.typeId, picked.date) : null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto" data-testid={compact ? `availability-${property.id}` : "availability"}>
        <table className="border-separate border-spacing-0 text-center">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="sticky left-0 z-10 min-w-40 bg-surface px-4 text-left text-[12px] font-semibold tracking-wide text-ink-40 uppercase">{m["cal.roomType"]}</th>
              {dates.map((d) => {
                const on = props.markers.filter((x) => x.from <= d && x.to >= d);
                return (
                  <th
                    key={d}
                    title={on.map((x) => x.name).join(", ") || undefined}
                    aria-current={d === today ? "date" : undefined}
                    className={`h-11 text-[11px] font-normal leading-tight ${on.length ? `${MARKER_STYLE.top} ${MARKER_STYLE.day}` : weekdayIndex(d) >= 5 ? "bg-ink-5" : ""} ${d === today ? "font-semibold text-accent" : "text-ink-60"}`}
                    style={{ minWidth: cw }}
                  >
                    {fmtWd.format(at(d))}
                    <br />
                    <span className="text-[13px]">{fmtDay.format(at(d))}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.roomTypes.map((t) => (
              <tr key={t.id} data-type={t.code}>
                <th className="sticky left-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-ink-5 bg-surface px-4 text-left text-[13px] font-medium">
                  {t.name}
                  <span className="text-[11px] font-normal text-ink-40">{t.rooms.length}</span>
                </th>
                {t.days.slice(0, dates.length).map((x) => {
                  const on = picked?.typeId === t.id && picked.date === x.date;
                  return (
                    <td key={x.date} className="border-b border-r border-canvas p-0">
                      <button
                        type="button"
                        data-cell={`${t.code}|${x.date}`}
                        data-free={x.free}
                        disabled={compact}
                        onClick={() => setPicked({ typeId: t.id, date: x.date })}
                        className={`flex h-14 w-full flex-col items-center justify-center leading-tight ${tone(x)} ${on ? "outline outline-2 -outline-offset-2 outline-ink" : ""}`}
                      >
                        <span className="text-[16px] font-semibold">{x.free}</span>
                        {!compact && x.lowestPrice !== null ? <span className="text-[10px] text-ink-60">{money(x.lowestPrice)}</span> : null}
                        {!compact && marks(x) ? <span className="text-[9px] font-semibold text-ink-80">{marks(x)}</span> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th className="sticky left-0 z-10 h-10 bg-surface-2 px-4 text-left text-[13px] font-semibold">{m["cal.occupancy"]}</th>
              {dates.map((d, i) => {
                const counts = data.roomTypes.map((t) => ({ rooms: t.rooms.length, free: t.days[i]!.free }));
                const rooms = counts.reduce((n, c) => n + c.rooms, 0);
                return (
                  <td key={d} data-occupancy={d} className="bg-surface-2 text-[12px] text-ink-80">
                    {rooms ? `${occupancyPercent(counts.reduce((n, c) => n + c.rooms - c.free, 0), rooms)}%` : "–"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {compact ? null : (
        <aside aria-label={m["cal.cell"]} className="w-[320px] shrink-0 overflow-auto border-l border-ink-10 p-4">
          {!type || !day || !cell ? (
            <p className="text-[13px] text-ink-60">{m["cal.pickCell"]}</p>
          ) : (
            <>
              <p className="text-[12px] text-ink-60">{fmtLong.format(at(day.date))}</p>
              <h2 className="text-lg font-semibold">{type.name}</h2>
              <p className="text-[13px] text-ink-60">
                {fill(m["cal.cellSummary"], { free: String(day.free), rooms: String(type.rooms.length), staying: String(cell.staying.length), leaving: String(cell.leaving.length) })}
                {day.lowestPrice !== null ? ` · ${money(day.lowestPrice)}` : ""}
              </p>
              <ul className="mt-3 space-y-2" data-testid="cell-reservations">
                {cell.staying.length + cell.leaving.length === 0 ? <li className="text-[13px] text-ink-40">{m["cal.noStays"]}</li> : null}
                {[...cell.staying, ...cell.leaving].map((r) => {
                  const role = r.departure === day.date ? "leaves" : r.arrival === day.date ? "arrives" : "staying";
                  const nights = Math.round((Date.parse(r.departure) - Date.parse(r.arrival)) / 86_400_000);
                  return (
                    <li key={r.id}>
                      <Link href={`/reservations/${r.id}`} className={`flex items-center gap-2 rounded-[10px] border-l-4 bg-surface-2 px-3 py-2 text-[13px] ${r.status === "checked_in" ? "border-success" : r.status === "checked_out" ? "border-ink-10" : "border-accent"}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{r.guestLastName}</span>
                          <span className="block text-[11px] text-ink-60">
                            {m[`cal.role.${role}`]} · {fill(m["cal.nightsN"], { n: String(nights) })} · {m[`res.status.${r.status}`]}
                          </span>
                        </span>
                        <span className="rounded-full bg-surface px-2 text-[11px] text-ink-60">{r.confirmationNumber}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

/** The Availability view of one property with its toolbar. */
export function CalendarAvailability(props: Parameters<typeof AvailabilityMatrix>[0] & { range: CalendarRange }) {
  const { data, range, m } = props;
  const router = useRouter();
  const go = (from: string, r: number) => router.push(`/calendar?from=${from}&range=${r}&view=availability`);
  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-10 px-5 py-3">
        <h1 className="text-xl font-medium">{m["module.calendar"]}</h1>
        <span className="text-ink-60">· {props.property.name}</span>
        <ViewToggle view="availability" from={data.from} range={range} m={m} />
        <div className="flex gap-1 rounded-full bg-surface-2 p-1" role="group" aria-label={m["cal.range"]}>
          {CALENDAR_RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => go(data.from, r)} className={`h-8 rounded-full px-3 text-[13px] ${range === r ? "bg-ink text-canvas" : "text-ink-80 hover:bg-ink-5"}`}>
              {fill(m["cal.days"], { n: String(r) })}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={m["grid.prev"]} onClick={() => go(addDays(data.from, -range), range)} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => router.push(`/calendar?range=${range}&view=availability`)} className="h-8 rounded-full px-3 text-sm hover:bg-ink-5">
            {m["grid.today"]}
          </button>
          <button type="button" aria-label={m["grid.next"]} onClick={() => go(addDays(data.from, range), range)} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
            <ChevronRight size={16} />
          </button>
        </div>
      </header>
      <AvailabilityMatrix {...props} />
    </div>
  );
}
