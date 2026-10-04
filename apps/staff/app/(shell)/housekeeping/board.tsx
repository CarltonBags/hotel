"use client";

import { useState } from "react";
import { STAYOVER_RHYTHMS, type StayoverRhythm, type TaskKind } from "@hoteloftware/domain";
import type { BoardTask, HousekeepingBoard } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { useFormAction } from "../reservations/use-form-action";
import { failInspectionAction, generateAction, inspectAction, moveTaskAction, proposeAction, publishAction, roomTypeAction, rulesAction } from "./actions";

const button = "h-9 rounded-full border border-ink-10 bg-surface px-4 text-sm hover:bg-ink-5 disabled:opacity-40";
const input = "h-8 rounded-lg border border-ink-10 bg-surface px-2 text-sm";
const KIND_TONE: Record<TaskKind, string> = { departure: "bg-danger/15", stayover: "bg-accent/15", arrival: "bg-success/15", linen: "bg-warning/15", clean: "bg-ink-10" };

/** Columns per housekeeper plus Unassigned; rooms as chips dragged between them; minutes against the shift; inspection; rules. */
export function HousekeepingBoardView({
  propertyId,
  board,
  housekeepers,
  roomTypes,
  rules,
  m,
}: {
  propertyId: string;
  board: HousekeepingBoard;
  housekeepers: { id: string; name: string }[];
  roomTypes: { id: string; code: string; name: string }[];
  rules: { stayover: StayoverRhythm; linenEvery: number | null; shiftMinutes: number };
  m: Messages;
}) {
  const { pending, run, note } = useFormAction(m);
  const [dragging, setDragging] = useState<string | null>(null);
  const [failing, setFailing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({ stayover: rules.stayover, linenEvery: rules.linenEvery === null ? "" : String(rules.linenEvery), shiftMinutes: String(rules.shiftMinutes) });
  const columns = [{ id: "", name: m["hk.unassigned"] }, ...housekeepers];
  const minutes = (id: string) => board.workload.find((w) => w.assigneeId === id)?.minutes ?? 0;
  const move = (taskId: string, to: string) =>
    run(async () => {
      const r = await moveTaskAction(propertyId, taskId, to || null, false);
      if (r.started && window.confirm(m["hk.startedConfirm"])) return moveTaskAction(propertyId, taskId, to || null, true);
      return r;
    });
  const chip = (t: BoardTask) => (
    <li
      key={t.id}
      data-task={`${t.roomNumber}:${t.kind}`}
      draggable
      onDragStart={() => setDragging(t.id)}
      onDragEnd={() => setDragging(null)}
      className={`grid cursor-grab gap-0.5 rounded-xl px-3 py-2 text-xs ${KIND_TONE[t.kind]} ${t.status === "done" ? "opacity-60" : ""}`}
    >
      <span className="flex items-center gap-2">
        <strong className="text-base">{t.roomNumber}</strong>
        <span>{m[`hk.kind.${t.kind}`]}</span>
        <span className="ml-auto tabular-nums">{fill(m["hk.min"], { n: String(t.minutes) })}</span>
      </span>
      <span className="text-ink-60">
        {[t.section, t.guestSurname, m[`hk.status.${t.status}`]].filter(Boolean).join(" · ")}
        {t.changed ? <strong className="ml-1 text-warning">{m["hk.changed"]}</strong> : null}
      </span>
      {t.note ? <span className="text-danger">{t.note}</span> : null}
    </li>
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-sm ${board.published ? "bg-success/15" : "bg-warning/15"}`}>{board.published ? m["hk.published"] : m["hk.draft"]}</span>
        <button type="button" disabled={pending} onClick={() => run(() => generateAction(propertyId))} className={button}>
          {m["hk.generate"]}
        </button>
        <button type="button" disabled={pending || !housekeepers.length} onClick={() => run(() => proposeAction(propertyId))} className={button}>
          {m["hk.propose"]}
        </button>
        <button type="button" disabled={pending || board.published} onClick={() => run(() => publishAction(propertyId))} className={`${button} border-accent bg-accent text-white`}>
          {m["hk.publish"]}
        </button>
        {note}
      </div>
      {!housekeepers.length ? <p className="text-sm text-ink-60">{m["hk.noHousekeepers"]}</p> : null}
      <div className="grid grid-flow-col auto-cols-[minmax(14rem,1fr)] gap-3 overflow-x-auto pb-2">
        {columns.map((c) => {
          const used = minutes(c.id);
          const over = c.id && used > board.shiftMinutes;
          return (
            <section
              key={c.id || "unassigned"}
              aria-label={c.name}
              data-column={c.id || "unassigned"}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragging) move(dragging, c.id);
                setDragging(null);
              }}
              className={`grid content-start gap-2 rounded-2xl bg-surface-2 p-3 ${dragging ? "ring-1 ring-accent/40" : ""}`}
            >
              <header className="grid gap-1">
                <span className="font-medium">{c.name}</span>
                {c.id ? (
                  <>
                    <span className={`text-xs ${over ? "text-danger" : "text-ink-60"}`}>{fill(m["hk.minutes"], { used: String(used), shift: String(board.shiftMinutes) })}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-ink-10">
                      <span className={`block h-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min(100, (used / board.shiftMinutes) * 100)}%` }} />
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-ink-60">{fill(m["hk.min"], { n: String(used) })}</span>
                )}
              </header>
              <ul className="grid gap-1.5">{board.tasks.filter((t) => (t.assigneeId ?? "") === c.id).map(chip)}</ul>
            </section>
          );
        })}
      </div>
      {board.tasks.length === 0 ? <p className="text-ink-60">{m["hk.none"]}</p> : null}

      <section aria-label={m["hk.inspect"]} className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm">
        <h2 className="font-medium">{m["hk.inspect"]}</h2>
        <p className="text-xs text-ink-60">{m["hk.inspectHelp"]}</p>
        {board.toInspect.length === 0 ? <p className="text-ink-60">{m["hk.none"]}</p> : null}
        <ul className="grid gap-1">
          {board.toInspect.map((r) => (
            <li key={r.roomId} data-inspect={r.roomNumber} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2">
              <strong>{r.roomNumber}</strong>
              <span className="text-ink-60">{housekeepers.find((h) => h.id === r.assigneeId)?.name ?? ""}</span>
              <span className="flex-1" />
              <button type="button" disabled={pending} onClick={() => run(() => inspectAction(r.roomId))} className={button}>
                {m["hk.inspected"]}
              </button>
              <button type="button" onClick={() => (setFailing(failing === r.roomId ? null : r.roomId), setReason(""))} className={button}>
                {m["hk.fail"]}
              </button>
              {failing === r.roomId ? (
                <form
                  className="flex w-full gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(
                      () => failInspectionAction(r.roomId, reason),
                      () => setFailing(null),
                    );
                  }}
                >
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={m["hk.failReason"]} required maxLength={300} className={`${input} flex-1`} />
                  <button type="submit" disabled={pending || !reason.trim()} className={`${button} border-danger text-danger`}>
                    {m["hk.fail"]}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <details className="rounded-2xl bg-surface-2 p-4 text-sm">
        <summary className="cursor-pointer font-medium">{m["hk.rules"]}</summary>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => rulesAction(propertyId, { stayover: form.stayover, linenEvery: form.linenEvery ? Number(form.linenEvery) : null, shiftMinutes: Number(form.shiftMinutes) }));
          }}
        >
          <label className="grid gap-1 text-xs text-ink-60">
            {m["hk.stayover"]}
            <select value={form.stayover} onChange={(e) => setForm({ ...form, stayover: e.target.value as StayoverRhythm })} className={input}>
              {STAYOVER_RHYTHMS.map((r) => (
                <option key={r} value={r}>
                  {m[`hk.rhythm.${r}`]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-60">
            {m["hk.linenEvery"]}
            <input value={form.linenEvery} onChange={(e) => setForm({ ...form, linenEvery: e.target.value })} inputMode="numeric" className={`${input} w-24`} />
          </label>
          <label className="grid gap-1 text-xs text-ink-60">
            {m["hk.shift"]}
            <input value={form.shiftMinutes} onChange={(e) => setForm({ ...form, shiftMinutes: e.target.value })} inputMode="numeric" className={`${input} w-24`} />
          </label>
          <button type="submit" disabled={pending} className={button}>
            {m["action.save"]}
          </button>
        </form>
        <h3 className="mt-4 text-ink-80">{m["hk.typeMinutes"]}</h3>
        <ul className="mt-1 grid gap-2">
          {roomTypes.map((t) => (
            <RoomTypeRow key={t.id} propertyId={propertyId} type={t} pending={pending} run={run} m={m} />
          ))}
        </ul>
      </details>
    </div>
  );
}

function RoomTypeRow({
  propertyId,
  type,
  pending,
  run,
  m,
}: {
  propertyId: string;
  type: { id: string; code: string; name: string };
  pending: boolean;
  run: ReturnType<typeof useFormAction>["run"];
  m: Messages;
}) {
  const kinds: TaskKind[] = ["departure", "stayover", "arrival", "linen"];
  const [values, setValues] = useState<Record<string, string>>({});
  const [stayover, setStayover] = useState<string>("");
  return (
    <li className="flex flex-wrap items-end gap-2">
      <strong className="w-24">{type.code}</strong>
      <select value={stayover} onChange={(e) => setStayover(e.target.value)} aria-label={`${type.code} ${m["hk.stayover"]}`} className={input}>
        <option value="">{m["hk.propertyRhythm"]}</option>
        {STAYOVER_RHYTHMS.map((r) => (
          <option key={r} value={r}>
            {m[`hk.rhythm.${r}`]}
          </option>
        ))}
      </select>
      {kinds.map((k) => (
        <label key={k} className="grid gap-0.5 text-xs text-ink-60">
          {m[`hk.kind.${k}`]}
          <input value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} inputMode="numeric" placeholder="min" className={`${input} w-16`} />
        </label>
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(() =>
            roomTypeAction(propertyId, type.id, {
              stayover: (stayover || null) as StayoverRhythm | null,
              linenEvery: null,
              minutes: Object.fromEntries(Object.entries(values).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])),
            }),
          )
        }
        className="h-8 rounded-full border border-ink-10 bg-surface px-3 text-xs"
      >
        {m["action.save"]}
      </button>
    </li>
  );
}
