"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { MEAL_PLANS, formatDate, sortRows, type Language, type PersonsByMealPlan } from "@hoteloftware/domain";
import type { ListRow } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { CheckInButton } from "../../reservations/check-in-button";

export type ListKind = "arrivals" | "departures" | "in-house" | "house" | "breakfast";

type Column = "room" | "guest" | "persons" | "roomTypeCode" | "arrival" | "departure" | "nights" | "ratePlanName" | "mealPlan" | "status" | "bookerName" | "confirmationNumber";

const COLUMNS: Record<ListKind, Column[]> = {
  arrivals: ["room", "guest", "persons", "roomTypeCode", "nights", "departure", "ratePlanName", "mealPlan", "bookerName", "confirmationNumber"],
  departures: ["room", "guest", "persons", "roomTypeCode", "arrival", "nights", "bookerName", "status", "confirmationNumber"],
  "in-house": ["room", "guest", "persons", "roomTypeCode", "arrival", "departure", "mealPlan", "confirmationNumber"],
  house: ["room", "guest", "persons", "roomTypeCode", "arrival", "departure", "mealPlan", "status", "confirmationNumber"],
  breakfast: ["room", "guest", "persons", "mealPlan", "departure", "confirmationNumber"],
};

/** A sortable, printable operational list; the date moves by day except for in-house (always now). */
export function OperationalList({
  kind,
  property,
  date,
  today,
  prevDate,
  nextDate,
  rows,
  breakfastCounts,
  checkIn = false,
  language,
  m,
}: {
  kind: ListKind;
  property: { name: string; country: string };
  date: string;
  today: string;
  prevDate: string;
  nextDate: string;
  rows: ListRow[];
  breakfastCounts: PersonsByMealPlan | null;
  /** Arrivals of today with the check-in right: a Check in button on confirmed rows. */
  checkIn?: boolean;
  language: Language;
  m: Messages;
}) {
  const [sort, setSort] = useState<{ key: Column; dir: "asc" | "desc" }>({ key: "room", dir: "asc" });
  const day = (d: string) => formatDate(new Date(`${d}T12:00:00Z`), language, property.country, "UTC");
  const value = (r: ListRow, c: Column): string | number | null => {
    if (c === "guest") return `${r.guestLastName}, ${r.guestFirstName}`;
    if (c === "persons") return r.adults + r.children;
    return r[c] as string | number | null;
  };
  // sortable values per column, with the row itself carried along
  const view = sortRows<Record<string, unknown> & { _row: ListRow }>(
    rows.map((r) => ({ ...Object.fromEntries(COLUMNS[kind].map((c) => [c, value(r, c)])), _row: r })),
    sort.key,
    sort.dir,
  );
  const cell = (r: ListRow, c: Column) => {
    if (c === "guest")
      return (
        <Link href={`/reservations/${r.reservationId}`} className="underline-offset-2 hover:underline">
          {r.guestLastName}, {r.guestFirstName}
          {r.overbooked ? <span className="ml-1 text-danger">●</span> : null}
        </Link>
      );
    if (c === "persons") return `${r.adults}${r.children ? ` + ${r.children}` : ""}`;
    if (c === "arrival" || c === "departure") return day(r[c]);
    if (c === "mealPlan") return m[`rates.mealPlan.${r.mealPlan}`];
    if (c === "status") return m[`res.status.${r.status}`];
    if (c === "room") return r.room ?? "—";
    return String(r[c]);
  };
  const totals = rows.reduce((t, r) => ({ adults: t.adults + r.adults, children: t.children + r.children }), { adults: 0, children: 0 });

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-medium">
          {m[`lists.title.${kind}`]} <span className="text-ink-60">· {property.name} · {day(date)}</span>
        </h1>
        <div className="ml-auto flex items-center gap-1 print:hidden">
          {kind !== "in-house" ? (
            <>
              <Link href={`?date=${prevDate}`} aria-label={m["lists.prevDay"]} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
                <ChevronLeft size={16} />
              </Link>
              <Link href={`?date=${today}`} className="h-8 rounded-full px-3 text-sm leading-8 hover:bg-ink-5">
                {m["grid.today"]}
              </Link>
              <Link href={`?date=${nextDate}`} aria-label={m["lists.nextDay"]} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
                <ChevronRight size={16} />
              </Link>
            </>
          ) : null}
          <button type="button" onClick={() => window.print()} className="ml-2 flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-sm font-medium text-white">
            <Printer size={14} />
            {m["lists.print"]}
          </button>
        </div>
      </div>

      {breakfastCounts ? (
        <section aria-label={m["lists.breakfastCounts"]} className="flex flex-wrap gap-3">
          {MEAL_PLANS.map((p) => (
            <div key={p} data-meal-plan={p} className="rounded-2xl bg-surface-2 px-4 py-3 print:border print:border-ink-10">
              <div className="text-xs text-ink-60">{m[`rates.mealPlan.${p}`]}</div>
              <div className="text-lg font-medium">{fill(m["lists.persons"], { adults: String(breakfastCounts[p].adults), children: String(breakfastCounts[p].children) })}</div>
            </div>
          ))}
        </section>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-ink-60">{m["lists.empty"]}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-10 text-left text-ink-60">
              {COLUMNS[kind].map((c) => (
                <th key={c} scope="col" aria-sort={sort.key === c ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="py-2 pr-3 font-normal">
                  <button type="button" onClick={() => setSort({ key: c, dir: sort.key === c && sort.dir === "asc" ? "desc" : "asc" })} className="hover:text-ink print:pointer-events-none">
                    {m[`lists.col.${c}`]}
                    {sort.key === c ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              {checkIn ? <th className="print:hidden" /> : null}
            </tr>
          </thead>
          <tbody>
            {view.map(({ _row: r }) => (
              <tr key={r.reservationId} data-res={r.confirmationNumber} className="border-b border-ink-5">
                {COLUMNS[kind].map((c) => (
                  <td key={c} className="py-2 pr-3">
                    {cell(r, c)}
                  </td>
                ))}
                {checkIn ? (
                  <td className="py-2 pr-3 print:hidden">{r.status === "confirmed" ? <CheckInButton reservationId={r.reservationId} needsRoom={r.room === null} compact m={m} /> : null}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-ink-60">
              <td className="py-2 pr-3" colSpan={COLUMNS[kind].length + (checkIn ? 1 : 0)}>
                {fill(m["lists.total"], { n: String(rows.length), adults: String(totals.adults), children: String(totals.children) })}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
