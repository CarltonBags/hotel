"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  CALENDAR_RANGES,
  OCCUPYING_STATUSES,
  addDays,
  datesFrom,
  dropOutcome,
  formatCurrency,
  localeFor,
  packLanes,
  weekdayIndex,
  type AssignmentSegment,
  type CalendarBar,
  type CalendarRange,
  type DropRefusal,
  type Language,
  type ReservationStatus,
} from "@hoteloftware/domain";
import type { CalendarData, CalendarReservation, CalendarRoom, CalendarRoomType, ChangePreview } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { useShell } from "@/shell/ShellProvider";
import { applyDrop, dropOnRoom, previewDrop, undoDrop, type DropResult, type StayMove } from "./actions";

interface Props {
  property: { id: string; name: string; currency: string; country: string };
  data: CalendarData;
  today: string;
  range: CalendarRange;
  canEdit: boolean;
  language: Language;
  m: Messages;
}

const LEFT = 168;
const HEAD = 48;
const TYPE_H = 40;
const ROW_H = 32;
/** Pixels of rows rendered above and below the viewport while scrolling. */
const OVERSCAN_PX = 400;
const UNDO_MS = 10_000;

type Row =
  | { kind: "type"; type: CalendarRoomType; key: string; height: number }
  | { kind: "lane"; type: CalendarRoomType; bars: CalendarReservation[]; label: string | null; key: string; height: number }
  | { kind: "room"; type: CalendarRoomType; room: CalendarRoom; key: string; height: number };

const STATUS_BAR: Partial<Record<ReservationStatus, string>> = {
  confirmed: "bg-accent text-white",
  checked_in: "bg-success text-white",
  checked_out: "bg-ink-10 text-ink-80",
};

export function CalendarRooms({ property, data, today, range, canEdit, language, m }: Props) {
  const router = useRouter();
  const { openRecord } = useShell();
  const [pending, startTransition] = useTransition();
  const dw = range === 7 ? 150 : range === 14 ? 84 : 44;
  const dates = useMemo(() => datesFrom(data.from, data.days), [data.from, data.days]);
  const W = dates.length * dw;
  const locale = localeFor(language, property.country);
  const fmtWd = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }), [locale]);
  const fmtDay = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }), [locale]);
  const show = (d: string) => fmtDay.format(new Date(`${d}T00:00:00Z`));
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  const dayIndex = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${data.from}T00:00:00Z`)) / 86_400_000);

  // filters
  const [typeFilter, setTypeFilter] = useState("");
  const [floor, setFloor] = useState("");
  const [section, setSection] = useState("");
  const [feature, setFeature] = useState("");
  const [arrivalsToday, setArrivalsToday] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const floors = useMemo(() => [...new Set(data.roomTypes.flatMap((t) => t.rooms.map((r) => r.floor)).filter(Boolean))].sort(), [data.roomTypes]);

  const visibleRes = useMemo(() => data.reservations.filter((r) => !arrivalsToday || r.arrival === today), [data.reservations, arrivalsToday, today]);
  const byRoom = useMemo(() => {
    const map = new Map<string, { res: CalendarReservation; seg: AssignmentSegment }[]>();
    for (const r of visibleRes) for (const seg of r.segments) map.set(seg.roomId, [...(map.get(seg.roomId) ?? []), { res: r, seg }]);
    return map;
  }, [visibleRes]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const t of data.roomTypes) {
      if (typeFilter && t.id !== typeFilter) continue;
      out.push({ kind: "type", type: t, key: `t:${t.id}`, height: TYPE_H });
      if (closed[t.id]) continue;
      const unassigned = visibleRes.filter((r) => r.roomTypeId === t.id && r.segments.length === 0 && r.status !== "checked_out");
      packLanes(unassigned).forEach((bars, i) => out.push({ kind: "lane", type: t, bars, label: i === 0 ? fill(m["cal.unassigned"], { n: String(unassigned.length) }) : null, key: `l:${t.id}:${i}`, height: ROW_H }));
      if (unassignedOnly) continue;
      for (const room of t.rooms) {
        if (floor && room.floor !== floor) continue;
        if (section && room.sectionId !== section) continue;
        if (feature && !room.featureIds.includes(feature)) continue;
        if (arrivalsToday && !byRoom.has(room.id)) continue;
        out.push({ kind: "room", type: t, room, key: `r:${room.id}`, height: ROW_H });
      }
    }
    return out;
  }, [data.roomTypes, typeFilter, closed, visibleRes, unassignedOnly, floor, section, feature, arrivalsToday, byRoom, m]);

  const offsets = useMemo(() => {
    const o: number[] = [];
    let y = 0;
    for (const r of rows) {
      o.push(y);
      y += r.height;
    }
    o.push(y);
    return o;
  }, [rows]);

  // row virtualisation: only rows near the viewport are in the DOM
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // start with the open Business Date a little in from the left
    el.scrollLeft = Math.max(0, dayIndex(today) * dw - 2 * dw);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dw]);
  const first = Math.max(0, upperBound(offsets, view.top - OVERSCAN_PX) - 1);
  const last = Math.min(rows.length, upperBound(offsets, view.top + view.height + OVERSCAN_PX));

  // selection, messages, undo, confirmation
  // the id survives a refresh; the reservation is read from the latest data
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = pickedId ? (data.reservations.find((r) => r.id === pickedId) ?? null) : null;
  const [message, setMessage] = useState<{ kind: "hint" | "error" | "ok"; text: string }>({ kind: "hint", text: canEdit ? m["cal.hint"] : m["cal.hintReadOnly"] });
  const [undo, setUndo] = useState<DropResult["undo"] | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);
  const [confirm, setConfirm] = useState<null | { res: CalendarReservation; roomId: string; change: StayMove; preview: ChangePreview }>(null);
  const typeCode = (id: string) => data.roomTypes.find((t) => t.id === id)?.code ?? "?";
  const roomNumber = (id: string) => data.roomTypes.flatMap((t) => t.rooms).find((r) => r.id === id)?.number ?? "?";

  /** As the server sees it: an in-house guest's move starts today, so earlier nights do not count. */
  const roomFree = (res: CalendarReservation) => (roomId: string, from: string, to: string) => {
    const start = res.status === "checked_in" && from < today ? today : from;
    return !data.reservations.some((r) => r.id !== res.id && OCCUPYING_STATUSES.includes(r.status) && r.segments.some((s) => s.roomId === roomId && s.from < to && s.to > start));
  };

  const drag = useRef<{ res: CalendarReservation; seg: AssignmentSegment | null; grab: number } | null>(null);

  const onDrop = (row: Extract<Row, { kind: "room" }>, clientX: number, trackLeft: number) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !canEdit) return;
    const left = clientX - trackLeft - d.grab * dw;
    const dropped = addDays(data.from, Math.round((left - dw / 2) / dw));
    // a later part of a moved stay keeps its nights: dropping it only picks the room
    const target = { roomId: row.room.id, roomTypeId: row.type.id, arrival: d.seg && d.seg.from !== d.res.arrival ? d.seg.from : dropped };
    const bar: CalendarBar = { reservationId: d.res.id, status: d.res.status, roomTypeId: d.res.roomTypeId, arrival: d.res.arrival, departure: d.res.departure, segment: d.seg };
    const outcome = dropOutcome(bar, target, roomFree(d.res));
    const who = `${d.res.guestLastName} (${d.res.confirmationNumber})`;
    if (outcome.kind === "refuse") return setMessage({ kind: "error", text: `${who}: ${refusalText(outcome.reason, roomNumber(row.room.id), m)}` });
    if (outcome.kind === "move_room" || outcome.kind === "assign") {
      startTransition(async () => {
        const r = await dropOnRoom(d.res.id, outcome.roomId, outcome.kind === "move_room" ? outcome.from : null);
        if (r.error) setMessage({ kind: "error", text: r.error });
        else {
          setMessage({ kind: "ok", text: fill(m[outcome.kind === "assign" ? "cal.assigned" : "cal.moved"], { who, room: roomNumber(outcome.roomId) }) });
          setUndo(r.undo ?? null);
          router.refresh();
        }
      });
      return;
    }
    const change = { arrival: outcome.arrival, departure: outcome.departure, roomTypeId: outcome.roomTypeId };
    startTransition(async () => {
      const p = await previewDrop(d.res.id, change);
      if ("error" in p) setMessage({ kind: "error", text: `${who}: ${p.error}` });
      else setConfirm({ res: d.res, roomId: outcome.roomId, change, preview: p.preview });
    });
  };

  const bar = (r: CalendarReservation, from: string, to: string, seg: { roomId: string; from: string; to: string } | null, dashed: boolean) => {
    const start = dayIndex(from) * dw + dw / 2;
    const end = dayIndex(to) * dw + dw / 2;
    const l = Math.max(2, start);
    const w = Math.min(W, end) - l - 3;
    if (w < 8) return null;
    return (
      <button
        key={`${r.id}:${from}`}
        type="button"
        data-res={r.confirmationNumber}
        draggable={canEdit}
        onDragStart={(e) => {
          drag.current = { res: r, seg, grab: (e.clientX - e.currentTarget.getBoundingClientRect().left + (l - start)) / dw };
          e.dataTransfer.setData("text/plain", r.id);
        }}
        onClick={() => setPickedId(r.id)}
        title={`${r.guestFirstName} ${r.guestLastName} · ${r.confirmationNumber} · ${show(r.arrival)}–${show(r.departure)} · ${m[`res.status.${r.status}`]}`}
        className={`absolute top-1 flex h-6 items-center gap-1.5 overflow-hidden rounded-[8px] px-2 text-left text-[12px] font-medium ${STATUS_BAR[r.status] ?? "bg-ink-10"} ${dashed ? "outline-dashed outline-1 -outline-offset-1 outline-white/80" : ""} ${r.overbooked ? "ring-2 ring-danger" : ""} ${picked?.id === r.id ? "ring-2 ring-ink" : ""}`}
        style={{ left: l, width: w }}
      >
        <span className="truncate">{r.guestLastName}</span>
        {w > 90 ? <span className="shrink-0 opacity-80">{r.guests}p</span> : null}
      </button>
    );
  };

  const grid = { backgroundImage: "linear-gradient(to right, var(--color-ink-5) 1px, transparent 1px)", backgroundSize: `${dw}px 100%` };
  const shift = (days: number) => router.push(`/calendar?from=${addDays(data.from, days)}&range=${range}`);
  const select = "h-8 rounded-full border border-ink-10 bg-surface-2 px-3 text-[13px]";

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-10 px-5 py-3">
        <h1 className="text-xl font-medium">{m["module.calendar"]}</h1>
        <span className="text-ink-60">· {property.name}</span>
        <div className="flex gap-1 rounded-full bg-surface-2 p-1" role="group" aria-label={m["cal.range"]}>
          {CALENDAR_RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => router.push(`/calendar?from=${data.from}&range=${r}`)} className={`h-8 rounded-full px-3 text-[13px] ${range === r ? "bg-ink text-canvas" : "text-ink-80 hover:bg-ink-5"}`}>
              {fill(m["cal.days"], { n: String(r) })}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={m["grid.prev"]} onClick={() => shift(-range)} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => router.push(`/calendar?range=${range}`)} className="h-8 rounded-full px-3 text-sm hover:bg-ink-5">
            {m["grid.today"]}
          </button>
          <button type="button" aria-label={m["grid.next"]} onClick={() => shift(range)} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
            <ChevronRight size={16} />
          </button>
        </div>
        <ul className="ml-auto flex flex-wrap gap-3 text-[12px] text-ink-60" aria-label={m["cal.legend"]}>
          <li className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-accent" />{m["res.status.confirmed"]}</li>
          <li className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-success" />{m["res.status.checked_in"]}</li>
          <li className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-ink-10" />{m["res.status.checked_out"]}</li>
          <li className="flex items-center gap-1"><span className="size-2.5 rounded-full border border-dashed border-ink-40" />{m["cal.unassignedShort"]}</li>
          <li className="flex items-center gap-1"><span className="size-2.5 rounded-full ring-2 ring-danger" />{m["res.overbooked"]}</li>
        </ul>
      </header>

      <div role="search" aria-label={m["cal.filters"]} className="flex flex-wrap items-center gap-2 border-b border-ink-10 px-5 py-2 text-[13px]">
        <select aria-label={m["res.roomType"]} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={select}>
          <option value="">{m["cal.allTypes"]}</option>
          {data.roomTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} · {t.name}
            </option>
          ))}
        </select>
        {floors.length ? (
          <select aria-label={m["cal.floor"]} value={floor} onChange={(e) => setFloor(e.target.value)} className={select}>
            <option value="">{m["cal.allFloors"]}</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {fill(m["cal.floorN"], { n: f })}
              </option>
            ))}
          </select>
        ) : null}
        {data.sections.length ? (
          <select aria-label={m["cal.section"]} value={section} onChange={(e) => setSection(e.target.value)} className={select}>
            <option value="">{m["cal.allSections"]}</option>
            {data.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
        {data.features.length ? (
          <select aria-label={m["cal.feature"]} value={feature} onChange={(e) => setFeature(e.target.value)} className={select}>
            <option value="">{m["cal.anyFeature"]}</option>
            {data.features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        ) : null}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={arrivalsToday} onChange={(e) => setArrivalsToday(e.target.checked)} />
          {m["cal.arrivalsToday"]}
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
          {m["cal.unassignedOnly"]}
        </label>
      </div>

      <div
        ref={box}
        onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        className="relative min-h-0 flex-1 overflow-auto"
        role="region"
        aria-label={m["module.calendar"]}
        data-testid="calendar"
        data-rows={rows.length}
      >
        <div className="relative" style={{ width: LEFT + W, height: HEAD + offsets[rows.length]! }}>
          {/* weekend shading and the line at the open Business Date */}
          <div className="pointer-events-none absolute z-0" style={{ left: LEFT, width: W, top: 0, bottom: 0 }}>
            {dates.map((d, i) => (weekdayIndex(d) >= 5 ? <div key={d} className="absolute inset-y-0 bg-ink-5" style={{ left: i * dw, width: dw }} /> : null))}
            {dayIndex(today) >= 0 && dayIndex(today) < dates.length ? <div data-testid="today-line" className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: dayIndex(today) * dw + dw / 2 }} /> : null}
          </div>

          <div className="sticky top-0 z-30 flex border-b border-ink-10 bg-surface" style={{ height: HEAD }}>
            <div className="sticky left-0 z-10 flex shrink-0 items-center bg-surface px-4 text-[12px] font-semibold uppercase tracking-wide text-ink-40" style={{ width: LEFT }}>
              {m["cal.room"]}
            </div>
            {dates.map((d) => (
              <div key={d} aria-current={d === today ? "date" : undefined} className={`flex shrink-0 flex-col items-center justify-center text-[12px] ${d === today ? "font-semibold text-accent" : weekdayIndex(d) >= 5 ? "text-ink-80" : "text-ink-60"}`} style={{ width: dw }}>
                <span>{fmtWd.format(new Date(`${d}T00:00:00Z`))}</span>
                <span className="text-[13px]">{show(d)}</span>
              </div>
            ))}
          </div>

          {rows.slice(first, last).map((row, i) => {
            const top = HEAD + offsets[first + i]!;
            if (row.kind === "type") {
              const open = !closed[row.type.id];
              return (
                <div key={row.key} data-row data-type={row.type.code} className="absolute left-0 z-10 flex border-b border-ink-10 bg-surface-2" style={{ top, height: row.height, width: LEFT + W }}>
                  <button type="button" aria-expanded={open} onClick={() => setClosed({ ...closed, [row.type.id]: open })} className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 bg-surface-2 px-3 text-left text-[13px] font-semibold" style={{ width: LEFT }}>
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <span className="truncate">
                      {row.type.code} · {row.type.name}
                    </span>
                    <span className="ml-auto font-normal text-ink-40">{row.type.rooms.length}</span>
                  </button>
                  {row.type.days.map((day) => (
                    <div key={day.date} data-date={day.date} className="flex shrink-0 flex-col items-center justify-center leading-tight" style={{ width: dw }}>
                      <span className={`text-[13px] font-semibold ${day.stopSell ? "text-ink-40 line-through" : day.free <= 0 ? "text-danger" : day.free <= 2 ? "text-warning" : ""}`}>{day.free}</span>
                      {dw > 60 ? (
                        <span className="text-[11px] text-ink-60">
                          {day.lowestPrice !== null ? money(day.lowestPrice) : "—"}
                          {restrictionMarks(day) ? ` · ${restrictionMarks(day)}` : ""}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            }
            if (row.kind === "lane") {
              return (
                <div key={row.key} data-row data-lane={row.type.code} className="absolute left-0 z-10 flex border-b border-ink-5" style={{ top, height: row.height, width: LEFT + W }}>
                  <div className="sticky left-0 z-10 flex shrink-0 items-center bg-surface px-4 text-[12px] text-warning" style={{ width: LEFT }}>
                    {row.label ?? ""}
                  </div>
                  <div className="relative shrink-0" style={{ width: W, height: row.height, ...grid }}>
                    {row.bars.map((r) => bar(r, r.arrival, r.departure, null, true))}
                  </div>
                </div>
              );
            }
            const placed = byRoom.get(row.room.id) ?? [];
            return (
              <div key={row.key} data-row data-room={row.room.number} className="absolute left-0 z-10 flex border-b border-ink-5 hover:bg-ink-5/40" style={{ top, height: row.height, width: LEFT + W }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center bg-surface px-4 text-[13px] font-medium" style={{ width: LEFT }}>
                  {row.room.number}
                </div>
                <div
                  className="relative shrink-0"
                  style={{ width: W, height: row.height, ...grid }}
                  onDragOver={(e) => {
                    if (canEdit) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    onDrop(row, e.clientX, e.currentTarget.getBoundingClientRect().left);
                  }}
                >
                  {placed.map(({ res, seg }) => bar(res, seg.from, seg.to, seg, false))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirm ? (
        <div role="alertdialog" aria-label={m["cal.confirmTitle"]} className="grid gap-2 border-t border-ink-10 bg-surface-2 px-5 py-3 text-sm">
          <p className="font-medium">
            {m["cal.confirmTitle"]} · {confirm.res.guestLastName} ({confirm.res.confirmationNumber})
          </p>
          <p>
            {fill(m["cal.confirmDates"], {
              old: `${show(confirm.preview.before.arrival)}–${show(confirm.preview.before.departure)} ${typeCode(confirm.preview.before.roomTypeId)}`,
              new: `${show(confirm.preview.after.arrival)}–${show(confirm.preview.after.departure)} ${typeCode(confirm.preview.after.roomTypeId)} · ${m["cal.room"]} ${roomNumber(confirm.roomId)}`,
            })}
          </p>
          <p>
            {fill(m["cal.confirmPrice"], { old: money(confirm.preview.before.total), new: money(confirm.preview.after.total), diff: `${confirm.preview.difference >= 0 ? "+" : ""}${money(confirm.preview.difference)}` })}
          </p>
          {confirm.preview.needsOverbooking ? <p className="text-danger">{m["cal.confirmSoldOut"]}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || confirm.preview.needsOverbooking}
              onClick={() =>
                startTransition(async () => {
                  const r = await applyDrop(confirm.res.id, confirm.change, confirm.roomId, confirm.preview.after.total);
                  setConfirm(null);
                  if (r.error) setMessage({ kind: "error", text: r.error });
                  else {
                    setMessage({ kind: "ok", text: m["grid.saved"] });
                    router.refresh();
                  }
                })
              }
              className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              {m["cal.confirmApply"]}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="h-9 rounded-full px-4 text-sm hover:bg-ink-5">
              {m["res.keepAsIs"]}
            </button>
          </div>
        </div>
      ) : null}

      <footer className="flex min-h-11 flex-wrap items-center gap-3 border-t border-ink-10 px-5 py-2 text-[13px]">
        {picked ? (
          <>
            <span className="font-medium">
              {picked.guestFirstName} {picked.guestLastName}
            </span>
            <span className="text-ink-60">
              {picked.confirmationNumber} · {show(picked.arrival)}–{show(picked.departure)} · {picked.guests}p · {typeCode(picked.roomTypeId)}
              {picked.segments.length ? ` · ${picked.segments.map((s) => roomNumber(s.roomId)).join(" → ")}` : ` · ${m["cal.unassignedShort"]}`} · {m[`res.status.${picked.status}`]} · {money(picked.total)}
            </span>
            <button type="button" onClick={() => openRecord("reservations", picked.id, `${picked.confirmationNumber} · ${picked.guestFirstName} ${picked.guestLastName}`.trim(), `/reservations/${picked.id}`)} className="ml-auto h-8 rounded-full bg-accent px-3 text-[13px] font-medium text-white">
              {m["cal.openTab"]}
            </button>
          </>
        ) : (
          <span className={message.kind === "error" ? "text-danger" : "text-ink-60"}>{pending ? m["action.saving"] : message.text}</span>
        )}
        {undo ? (
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                const r = await undoDrop(undo.reservationId, undo.segments, undo.current);
                setUndo(null);
                setMessage(r.error ? { kind: "error", text: r.error } : { kind: "ok", text: m["cal.undone"] });
                router.refresh();
              })
            }
            disabled={pending}
            className={`${picked ? "" : "ml-auto"} h-8 rounded-full border border-ink-10 px-3 text-[13px] disabled:opacity-40`}
          >
            {m["grid.undo"]}
          </button>
        ) : null}
        {picked ? (
          <button type="button" aria-label={m["bulk.clear"]} onClick={() => setPickedId(null)} className="h-8 rounded-full px-2 text-[13px] text-ink-60 hover:bg-ink-5">
            ×
          </button>
        ) : null}
      </footer>
      {picked && message.kind !== "hint" ? <p className={`px-5 pb-2 text-[13px] ${message.kind === "error" ? "text-danger" : "text-ink-60"}`}>{message.text}</p> : null}
      {/* always mounted, so screen readers announce every outcome of a drop; moves are also possible from the reservation tab by keyboard */}
      <p role="status" aria-live="polite" className="sr-only">
        {message.kind !== "error" ? message.text : ""}
      </p>
      <p role="alert" className="sr-only">
        {message.kind === "error" ? message.text : ""}
      </p>
    </div>
  );
}

/** The grid's compact marks: 2N minimum stay, CTA, CTD, ≤7 maximum stay. */
function restrictionMarks(day: { minStay: number | null; closedToArrival: boolean; closedToDeparture: boolean; maxStay: number | null }): string {
  return [day.minStay ? `${day.minStay}N` : "", day.closedToArrival ? "CTA" : "", day.closedToDeparture ? "CTD" : "", day.maxStay ? `≤${day.maxStay}` : ""].filter(Boolean).join(" ");
}

/** Index of the first offset above `y` (offsets ascending). */
function upperBound(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function refusalText(reason: DropRefusal, room: string, m: Messages): string {
  return reason === "room_taken" ? fill(m["cal.refuse.room_taken"], { room }) : m[`cal.refuse.${reason}`];
}
