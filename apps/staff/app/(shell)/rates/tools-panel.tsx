"use client";

import { useState, useTransition } from "react";
import { CalendarRange, ClipboardPaste, Copy, Flag, MoveRight, Trash2, TriangleAlert } from "lucide-react";
import type { EventMarker, PriceEnd, RatesTool } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { MARKER_STYLE } from "./marker-style";
import { addEventMarker, removeEventMarker, runTool, type GridActionState, type ToolState } from "./actions";

type Preview = NonNullable<ToolState["toolPreview"]>;
type RowKey = { ratePlanId: string; roomTypeId: string };

/** What a tool will change, as the server computed it, with Apply and Cancel. */
export function ToolReview({ title, preview, pending, onApply, onCancel, m, note }: { title: string; preview: Preview; pending: boolean; onApply: () => void; onCancel: () => void; m: Messages; note?: string | undefined }) {
  return (
    <div data-testid="tool-preview" className="rounded-[12px] border border-ink-10 p-3 text-[13px]">
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-ink-80">{fill(m["bulk.cells"], { cells: String(preview.cells), rows: String(preview.rows) })}</div>
      {note ? <div className="mt-1 text-ink-60">{note}</div> : preview.skipped > 0 ? <div className="mt-1 text-ink-60">{fill(m["tools.skipped"], { n: String(preview.skipped) })}</div> : null}
      {preview.belowFloor > 0 ? (
        <div className="mt-1 flex items-start gap-1.5 text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {fill(m["bulk.belowFloor"], { n: String(preview.belowFloor) })}
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onCancel} className="h-9 flex-1 rounded-full bg-surface-2 text-[13px]">
          {m["tools.cancel"]}
        </button>
        <button type="button" disabled={pending || preview.cells === 0} onClick={onApply} className="h-9 flex-[2] rounded-full bg-accent text-[13px] font-medium text-white disabled:opacity-30">
          {pending ? m["action.saving"] : fill(m["bulk.apply"], { n: String(preview.cells) })}
        </button>
      </div>
    </div>
  );
}

/** Preview a tool on the server, then apply exactly what was previewed. */
export function useTool(propertyId: string, onDone: (r: GridActionState) => void) {
  const [pending, startTransition] = useTransition();
  const [review, setReview] = useState<{ tool: RatesTool; preview: Preview } | null>(null);
  const preview = (tool: RatesTool) =>
    startTransition(async () => {
      const r = await runTool(propertyId, tool, null);
      if (r.error || !r.toolPreview) return onDone(r);
      setReview({ tool, preview: r.toolPreview });
    });
  const apply = () =>
    review &&
    startTransition(async () => {
      const r = await runTool(propertyId, review.tool, review.preview.cells);
      // changed meanwhile: show the new preview to apply again
      if (r.error && r.toolPreview) setReview({ tool: review.tool, preview: r.toolPreview });
      else setReview(null);
      onDone(r);
    });
  return { pending, review, preview, apply, cancel: () => setReview(null) };
}

/**
 * The grid's tools (ticket 19): copy a period by weekday, fill prices to the
 * horizon, and the property's Event Markers. Copy takes the rows of the
 * grid's selection (all rows when nothing is selected); fill takes every row
 * whose prices end before the horizon.
 */
export function ToolsPanel(props: {
  propertyId: string;
  rows: RowKey[];
  selection: { from: string; to: string } | null;
  priceEnds: PriceEnd[];
  markers: EventMarker[];
  horizon: string;
  day: (d: string) => string;
  m: Messages;
  onDone: (r: GridActionState) => void;
}) {
  const { m, day } = props;
  const tool = useTool(props.propertyId, props.onDone);
  const [open, setOpen] = useState<"copy" | "fill" | "markers" | null>(null);
  const [source, setSource] = useState({ from: props.selection?.from ?? "", to: props.selection?.to ?? "" });
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"repeat_week" | "base">("repeat_week");
  const [base, setBase] = useState("");
  const [factor, setFactor] = useState("1.2");
  const [marker, setMarker] = useState({ name: "", from: "", to: "" });
  const [pending, startTransition] = useTransition();
  const inp = "h-9 w-full rounded-[10px] border border-ink-10 bg-surface-2 px-3 text-[14px]";
  const keys = props.rows.map(({ ratePlanId, roomTypeId }) => ({ ratePlanId, roomTypeId }));
  // the rows whose prices end before the horizon (the banner's); with a selection, those in it
  const inSelection = new Set(props.rows.map((r) => `${r.ratePlanId}|${r.roomTypeId}`));
  const ending = props.selection ? props.priceEnds.filter((e) => inSelection.has(`${e.ratePlanId}|${e.roomTypeId}`)) : props.priceEnds;
  const fillRows = ending.map(({ ratePlanId, roomTypeId }) => ({ ratePlanId, roomTypeId }));
  const rowName = (k: RowKey) => {
    const e = props.priceEnds.find((x) => x.ratePlanId === k.ratePlanId && x.roomTypeId === k.roomTypeId);
    return e ? `${e.ratePlanName} · ${e.roomTypeCode}` : "?";
  };
  const toggle = (k: typeof open) => {
    tool.cancel();
    setOpen((o) => (o === k ? null : k));
    if (k === "copy" && props.selection) setSource({ ...props.selection });
  };
  const head = (k: NonNullable<typeof open>, Icon: typeof Copy, label: string) => (
    <button type="button" aria-expanded={open === k} onClick={() => toggle(k)} className="flex w-full items-center gap-2 py-1.5 text-left text-[13px] font-medium">
      <Icon size={14} />
      {label}
    </button>
  );

  return (
    <section aria-label={m["tools.title"]} className="mt-5 space-y-1">
      <h3 className="text-[12px] font-semibold text-ink-60">{m["tools.title"]}</h3>
      <p className="flex items-center gap-1.5 text-[11px] text-ink-40">
        <ClipboardPaste size={12} />
        {m["tools.pasteHelp"]}
      </p>

      {head("copy", Copy, m["tools.copy"])}
      {open === "copy" ? (
        <div className="space-y-2 pb-2">
          <p className="text-[11px] text-ink-60">{fill(m["tools.copyHelp"], { n: String(keys.length) })}</p>
          <div className="flex items-center gap-1">
            <input type="date" aria-label={m["tools.sourceFrom"]} value={source.from} onChange={(e) => setSource((s) => ({ ...s, from: e.target.value }))} className={inp} />
            <input type="date" aria-label={m["tools.sourceTo"]} value={source.to} onChange={(e) => setSource((s) => ({ ...s, to: e.target.value }))} className={inp} />
          </div>
          <label className="flex items-center gap-1 text-[12px] text-ink-60">
            <MoveRight size={13} /> {m["tools.target"]}
          </label>
          <input type="date" aria-label={m["tools.target"]} value={target} onChange={(e) => setTarget(e.target.value)} className={inp} />
          {tool.review ? null : (
            <button type="button" disabled={!source.from || !source.to || !target || tool.pending} onClick={() => tool.preview({ kind: "copy", rows: keys, source, targetFrom: target })} className="h-9 w-full rounded-full bg-ink text-[13px] text-canvas disabled:opacity-30">
              {m["tools.preview"]}
            </button>
          )}
        </div>
      ) : null}

      {head("fill", CalendarRange, m["tools.fill"])}
      {open === "fill" ? (
        <div className="space-y-2 pb-2">
          <p className="text-[11px] text-ink-60">{fill(m["tools.fillHelp"], { date: day(props.horizon), n: String(fillRows.length) })}</p>
          <ul className="text-[11px] text-ink-80">
            {ending.map((e) => (
              <li key={`${e.ratePlanId}|${e.roomTypeId}`}>{rowName(e)}</li>
            ))}
          </ul>
          <div className="flex gap-1">
            {(["repeat_week", "base"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={`h-9 flex-1 rounded-[10px] text-[12px] ${mode === k ? "bg-ink text-canvas" : "bg-surface-2"}`}>
                {m[`tools.mode.${k}`]}
              </button>
            ))}
          </div>
          {mode === "base" ? (
            <div className="flex gap-1">
              <input aria-label={m["tools.basePrice"]} placeholder={m["tools.basePrice"]} inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value.replace(/[^0-9.,]/g, ""))} className={inp} />
              <input aria-label={m["tools.weekendFactor"]} title={m["tools.weekendFactor"]} inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value.replace(/[^0-9.,]/g, ""))} className={inp} />
            </div>
          ) : null}
          {tool.review ? null : (
            <button
              type="button"
              disabled={fillRows.length === 0 || (mode === "base" && !base) || tool.pending}
              onClick={() =>
                tool.preview({ kind: "fill", rows: fillRows, mode: mode === "base" ? { kind: "base", price: Number(base.replace(",", ".")), weekendFactor: Number(factor.replace(",", ".")) } : { kind: "repeat_week" } })
              }
              className="h-9 w-full rounded-full bg-ink text-[13px] text-canvas disabled:opacity-30"
            >
              {m["tools.preview"]}
            </button>
          )}
        </div>
      ) : null}

      {tool.review && (open === "copy" || open === "fill") ? (
        <ToolReview
          title={open === "copy" ? m["tools.copy"] : m["tools.fill"]}
          preview={tool.review.preview}
          pending={tool.pending}
          onApply={tool.apply}
          onCancel={tool.cancel}
          m={m}
          note={tool.review.preview.skippedRows.length ? fill(m["tools.noFullWeek"], { rows: tool.review.preview.skippedRows.map(rowName).join(", ") }) : undefined}
        />
      ) : null}

      {head("markers", Flag, m["tools.markers"])}
      {open === "markers" ? (
        <div className="space-y-2 pb-2">
          <ul className="space-y-1 text-[12px]">
            {props.markers.length === 0 ? <li className="text-ink-40">{m["tools.noMarkers"]}</li> : null}
            {props.markers.map((mk) => (
              <li key={mk.id} className="flex items-center gap-2">
                <Flag size={12} className={MARKER_STYLE.text} />
                <span className="flex-1">
                  {mk.name} · {day(mk.from)}
                  {mk.to !== mk.from ? ` – ${day(mk.to)}` : ""}
                </span>
                <button type="button" aria-label={`${m["tools.remove"]} ${mk.name}`} disabled={pending} onClick={() => startTransition(async () => props.onDone(await removeEventMarker(props.propertyId, mk.id)))} className="grid size-7 place-items-center rounded-full hover:bg-ink-5">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          <input aria-label={m["tools.markerName"]} placeholder={m["tools.markerName"]} value={marker.name} onChange={(e) => setMarker((x) => ({ ...x, name: e.target.value }))} className={inp} />
          <div className="flex gap-1">
            <input type="date" aria-label={m["tools.markerFrom"]} value={marker.from} onChange={(e) => setMarker((x) => ({ ...x, from: e.target.value }))} className={inp} />
            <input type="date" aria-label={m["tools.markerTo"]} value={marker.to} onChange={(e) => setMarker((x) => ({ ...x, to: e.target.value }))} className={inp} />
          </div>
          <button
            type="button"
            disabled={!marker.name.trim() || !marker.from || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await addEventMarker(props.propertyId, marker);
                if (r.ok) setMarker({ name: "", from: "", to: "" });
                props.onDone(r);
              })
            }
            className="h-9 w-full rounded-full bg-ink text-[13px] text-canvas disabled:opacity-30"
          >
            {m["tools.addMarker"]}
          </button>
        </div>
      ) : null}
    </section>
  );
}
