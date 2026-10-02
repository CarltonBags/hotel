"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search, SlidersHorizontal, Star } from "lucide-react";
import { WORKSPACE_SORT_KEYS, formatCurrency, workspaceRows, type Language, type WorkspaceRow, type WorkspaceSortKey, type WorkspaceView } from "@hoteloftware/domain";
import type { WorkspaceList as WorkspaceListKind } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";

/** The workspace lists, in button order (the server's WORKSPACE_LISTS). */
const KINDS: WorkspaceListKind[] = ["arrivals", "departures", "in_house", "checked_out"];

const select = "h-8 rounded-lg border border-ink-10 bg-surface px-2 text-xs";

/** Session memory per list: search, filters and sort survive switching lists and reloads, not the session. */
function useRemembered(kind: WorkspaceListKind): [WorkspaceView, (v: WorkspaceView) => void] {
  const key = `hs:today:${kind}`;
  const [view, setView] = useState<WorkspaceView>({});
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      setView(raw ? (JSON.parse(raw) as WorkspaceView) : {});
    } catch {
      setView({});
    }
  }, [key]);
  const save = (v: WorkspaceView) => {
    setView(v);
    try {
      sessionStorage.setItem(key, JSON.stringify(v));
    } catch {
      // storage blocked: the view still works for this page
    }
  };
  return [view, save];
}

/**
 * Left side of the Today workspace: the four list buttons with counts, search,
 * filters and sorting, and the rows. The list scrolls inside its box; a click
 * opens the reservation on the right without leaving Today.
 */
export function WorkspaceList({
  kind,
  counts,
  rows,
  selectedId,
  currency,
  m,
}: {
  kind: WorkspaceListKind;
  counts: Record<WorkspaceListKind, number>;
  rows: WorkspaceRow[];
  selectedId: string | null;
  currency: { code: string; language: Language; country: string };
  m: Messages;
}) {
  const router = useRouter();
  const [view, setView] = useRemembered(kind);
  const [showFilters, setShowFilters] = useState(false);
  const shown = useMemo(() => workspaceRows(rows, view), [rows, view]);
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const options = (pick: (r: WorkspaceRow) => string) => [...new Set(rows.map(pick))].sort();
  const filters = view.filters ?? {};
  const setFilter = (patch: Partial<NonNullable<WorkspaceView["filters"]>>) => setView({ ...view, filters: { ...filters, ...patch } });
  const activeFilters = Object.values(filters).filter((x) => x !== undefined && x !== "" && x !== false).length;
  const sort = view.sort ?? { key: "room" as WorkspaceSortKey, dir: "asc" as const };
  const go = (params: string) => router.replace(`/?${params}`, { scroll: false });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div role="tablist" aria-label={m["today.title"]} className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            data-list={k}
            onClick={() => go(`list=${k}`)}
            className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium ${k === kind ? "bg-accent text-white shadow-pill" : "bg-surface-2 hover:bg-ink-5"}`}
          >
            <span>{m[`ws.list.${k}`]}</span>
            <span className={`rounded-full px-2 text-xs ${k === kind ? "bg-white/20" : "bg-surface"}`}>{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="flex gap-2">
          <label className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-ink-10 bg-surface px-3 text-ink-60">
            <Search size={15} />
            <input
              value={view.query ?? ""}
              onChange={(e) => setView({ ...view, query: e.target.value })}
              placeholder={m["ws.search"]}
              aria-label={m["ws.search"]}
              className="w-full bg-transparent text-sm text-ink outline-none"
            />
          </label>
          <button
            type="button"
            aria-expanded={showFilters}
            onClick={() => setShowFilters(!showFilters)}
            className={`flex h-9 items-center gap-1 rounded-xl px-3 text-sm ${activeFilters ? "bg-accent/15 text-accent" : "bg-surface-2 hover:bg-ink-5"}`}
          >
            <SlidersHorizontal size={15} />
            {m["ws.filters"]}
            {activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </div>
        {showFilters ? (
          <div role="group" aria-label={m["ws.filters"]} className="grid gap-2 rounded-xl bg-surface-2 p-3 text-xs">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["roomTypeCode", m["res.roomType"], options((r) => r.roomTypeCode)],
                  ["ratePlanName", m["lists.col.ratePlanName"], options((r) => r.ratePlanName)],
                  ["bookerName", m["res.booker"], options((r) => r.bookerName)],
                ] as const
              ).map(([key, label, values]) => (
                <label key={key} className="grid gap-1">
                  <span className="text-ink-60">{label}</span>
                  <select value={filters[key] ?? ""} onChange={(e) => setFilter({ [key]: e.target.value || undefined })} className={select}>
                    <option value="">{m["ws.filter.any"]}</option>
                    {values.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {(["vip", "unassigned", "openBalance", "noCardHold"] as const).map((key) => (
                <label key={key} className="flex items-center gap-1" title={key === "noCardHold" ? fill(m["ws.comesWith"], { ticket: "27" }) : undefined}>
                  <input type="checkbox" checked={Boolean(filters[key])} disabled={key === "noCardHold"} onChange={(e) => setFilter({ [key]: e.target.checked || undefined })} />
                  {m[`ws.filter.${key}`]}
                </label>
              ))}
              {activeFilters ? (
                <button type="button" onClick={() => setView({ ...view, filters: {} })} className="ml-auto underline">
                  {m["ws.filter.clear"]}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-60">{m["ws.sort"]}</span>
          <select aria-label={m["ws.sort"]} value={sort.key} onChange={(e) => setView({ ...view, sort: { key: e.target.value as WorkspaceSortKey, dir: sort.dir } })} className={select}>
            {WORKSPACE_SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {m[`ws.sort.${k}`]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={m[`ws.sort.${sort.dir}`]}
            title={m[`ws.sort.${sort.dir}`]}
            onClick={() => setView({ ...view, sort: { key: sort.key, dir: sort.dir === "asc" ? "desc" : "asc" } })}
            className="grid size-8 place-items-center rounded-lg bg-surface-2 hover:bg-ink-5"
          >
            {sort.dir === "asc" ? <ArrowUpNarrowWide size={15} /> : <ArrowDownWideNarrow size={15} />}
          </button>
        </div>
      </div>

      <div aria-label={m[`ws.list.${kind}`]} className="min-h-0 flex-1 overflow-auto rounded-xl border border-ink-10">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-ink-60">
            <tr>
              <th className="px-3 py-2 font-normal">{m["ws.col.room"]}</th>
              <th className="py-2 font-normal">{m["ws.col.guest"]}</th>
              <th className="py-2 text-right font-normal">{m["ws.col.balance"]}</th>
              <th className="px-3 py-2 text-right font-normal">{m["ws.col.cardHold"]}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.reservationId}
                data-res={r.confirmationNumber}
                aria-selected={r.reservationId === selectedId}
                tabIndex={0}
                onClick={() => go(`list=${kind}&r=${r.reservationId}`)}
                onKeyDown={(e) => e.key === "Enter" && go(`list=${kind}&r=${r.reservationId}`)}
                className={`cursor-pointer border-t border-ink-5 ${r.reservationId === selectedId ? "bg-accent/10" : "hover:bg-ink-5"}`}
              >
                <td className="px-3 py-2 font-medium">{r.room ?? <span className="text-xs font-normal text-ink-60">{m["ws.noRoom"]}</span>}</td>
                <td className="py-2">
                  <span className="flex items-center gap-1">
                    {r.vip ? <Star size={12} className="shrink-0 fill-current text-accent" aria-label="VIP" /> : null}
                    <span className="truncate">
                      {r.guestLastName}, {r.guestFirstName}
                    </span>
                  </span>
                  <span className="block text-xs text-ink-60">
                    {r.roomTypeCode} · {r.ratePlanName}
                  </span>
                </td>
                <td className={`py-2 text-right tabular-nums ${r.balance > 0 ? "font-medium" : "text-ink-60"}`}>{money(r.balance)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-60" title={r.cardHold === null ? fill(m["ws.comesWith"], { ticket: "27" }) : undefined}>
                  {r.cardHold === null ? "–" : money(r.cardHold)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="p-4 text-sm text-ink-60">{m["ws.empty"]}</p> : shown.length === 0 ? <p className="p-4 text-sm text-ink-60">{m["ws.noMatch"]}</p> : null}
      </div>
    </div>
  );
}
