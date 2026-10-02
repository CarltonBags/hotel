"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, type Language } from "@hoteloftware/domain";
import { fill, type Messages } from "@/i18n/messages";
import { assignRoomAction, cancelAction, editReservationAction, feeAction, freeRoomsAction, previewCancelAction, unassignAction } from "../actions";

interface Props {
  reservation: {
    id: string;
    status: string;
    arrival: string;
    departure: string;
    adults: number;
    childAges: number[];
    roomTypeId: string;
    nights: string[];
    assignments: { roomName: string; from: string; to: string }[];
    cancellationFee: number | null;
    cancellationFeeStatus: "open" | "confirmed" | "waived" | null;
    /** Confirmed reservations in the booking, this one included. */
    openInBooking: number;
  };
  roomTypes: { id: string; label: string }[];
  currency: { code: string; language: Language; country: string };
  m: Messages;
}

const input = "h-9 w-full rounded-xl border border-ink-10 bg-surface px-3 text-sm";
const button = "h-9 rounded-full px-4 text-sm font-medium";

/** Edit, cancel and room assignment on the reservation tab. Every action is checked again on the server. */
export function ReservationActions({ reservation: r, roomTypes, currency, m }: Props) {
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const done = (res: { ok?: boolean; error?: string; message?: string }) => {
    setMessage(res.error ? { kind: "error", text: res.error } : { kind: "ok", text: res.message ?? m["grid.saved"] });
    if (!res.error) router.refresh();
  };
  const open = r.status === "confirmed" || r.status === "checked_in";

  // edit
  const [arrival, setArrival] = useState(r.arrival);
  const [departure, setDeparture] = useState(r.departure);
  const [adults, setAdults] = useState(String(r.adults));
  const [children, setChildren] = useState(r.childAges.join(", "));
  const [roomTypeId, setRoomTypeId] = useState(r.roomTypeId);
  const [overbookAsk, setOverbookAsk] = useState(false);
  const save = (force: boolean) =>
    startTransition(async () => {
      const ages = children.split(/[,\s]+/).filter(Boolean).map(Number);
      const res = await editReservationAction(r.id, { arrival, departure, adults: Number(adults), childAges: ages, roomTypeId }, force);
      setOverbookAsk(Boolean(res.needsOverbooking));
      if (res.needsOverbooking) setMessage(null);
      else done(res);
    });

  // cancel
  const [cancelAsk, setCancelAsk] = useState<null | { whole: boolean; amount: number; deadline: string | null }>(null);
  const askCancel = (whole: boolean) =>
    startTransition(async () => {
      const p = await previewCancelAction(r.id, whole);
      if ("error" in p) setMessage({ kind: "error", text: p.error });
      else setCancelAsk({ whole, ...p });
    });

  // rooms
  const [rooms, setRooms] = useState<{ id: string; name: string }[] | null>(null);
  // the night a move starts; defaults to the second night once a room is assigned (also after an assignment made here)
  const [moveFromChoice, setMoveFrom] = useState<string>("");
  const moveFrom = moveFromChoice && r.nights.includes(moveFromChoice) ? moveFromChoice : (r.nights[1] ?? r.nights[0] ?? "");
  const [room, setRoom] = useState("");
  const loadRooms = (from: string) =>
    startTransition(async () => {
      setRooms(await freeRoomsAction(r.id, from || undefined));
      setRoom("");
    });

  return (
    <div className="grid gap-4">
      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : "text-ink-60"}`}>
          {message.text}
        </p>
      ) : null}

      {open ? (
        <section aria-label={m["res.edit"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5">
          <h2 className="font-medium">{m["res.edit"]}</h2>
          <div className="grid gap-3 md:grid-cols-5">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-80">{m["res.arrival"]}</span>
              <input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} disabled={r.status === "checked_in"} className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-80">{m["res.departure"]}</span>
              <input type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-80">{m["res.adults"]}</span>
              <input type="number" min={1} value={adults} onChange={(e) => setAdults(e.target.value)} className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-80">{m["res.childAges"]}</span>
              <input value={children} onChange={(e) => setChildren(e.target.value)} placeholder="7, 3" className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-80">{m["res.roomType"]}</span>
              <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} className={input}>
                {roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-ink-60">{m["res.editHelp"]}</p>
          {overbookAsk ? (
            <div role="alertdialog" aria-label={m["res.overbookTitle"]} className="grid gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm">
              <p className="font-medium">{m["res.overbookTitle"]}</p>
              <p>{m["res.overbookText"]}</p>
              <div className="flex gap-2">
                <button type="button" disabled={pending} onClick={() => save(true)} className={`${button} bg-danger text-white`}>
                  {m["res.overbookConfirm"]}
                </button>
                <button type="button" onClick={() => setOverbookAsk(false)} className={`${button} hover:bg-ink-5`}>
                  {m["res.keepAsIs"]}
                </button>
              </div>
            </div>
          ) : null}
          <button type="button" disabled={pending} onClick={() => save(false)} className={`${button} justify-self-start bg-accent text-white disabled:opacity-60`}>
            {pending ? m["action.saving"] : m["action.save"]}
          </button>
        </section>
      ) : null}

      {open ? (
        <section aria-label={m["res.roomAssignment"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
          <h2 className="font-medium">{m["res.roomAssignment"]}</h2>
          {r.assignments.length === 0 ? <p className="text-ink-60">{m["res.noRoom"]}</p> : null}
          <ul className="grid gap-1">
            {r.assignments.map((a) => (
              <li key={`${a.from}`}>
                {fill(m["res.roomSegment"], { room: a.roomName, from: a.from, to: a.to })}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            {r.assignments.length ? (
              <label className="grid gap-1">
                <span className="text-ink-80">{m["res.moveFrom"]}</span>
                <select value={moveFrom} onChange={(e) => setMoveFrom(e.target.value)} className={input}>
                  {r.nights.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button type="button" onClick={() => loadRooms(r.assignments.length ? moveFrom : "")} className={`${button} hover:bg-ink-5`}>
              {m["res.findRooms"]}
            </button>
            {rooms ? (
              rooms.length ? (
                <>
                  <label className="grid gap-1">
                    <span className="text-ink-80">{m["res.freeRoom"]}</span>
                    <select value={room} onChange={(e) => setRoom(e.target.value)} className={input} aria-label={m["res.freeRoom"]}>
                      <option value="">–</option>
                      {rooms.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!room || pending}
                    onClick={() => startTransition(async () => done(await assignRoomAction(r.id, room, r.assignments.length ? moveFrom : null)))}
                    className={`${button} bg-accent text-white disabled:opacity-40`}
                  >
                    {r.assignments.length ? m["res.move"] : m["res.assign"]}
                  </button>
                </>
              ) : (
                <span className="text-danger">{m["res.noFreeRoom"]}</span>
              )
            ) : null}
            {r.assignments.length ? (
              <button type="button" onClick={() => startTransition(async () => done(await unassignAction(r.id)))} className={`${button} hover:bg-ink-5`}>
                {m["res.unassign"]}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {r.status === "confirmed" ? (
        <section aria-label={m["res.cancel"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
          <h2 className="font-medium">{m["res.cancel"]}</h2>
          {cancelAsk ? (
            <div role="alertdialog" aria-label={m["res.cancel"]} className="grid gap-2 rounded-xl border border-ink-10 bg-surface p-3">
              <p>
                {cancelAsk.amount > 0 ? fill(m["res.feeDue"], { fee: money(cancelAsk.amount) }) : m["res.freeCancel"]}
              </p>
              {cancelAsk.whole ? <p className="text-ink-60">{fill(m["res.cancelWholeNote"], { n: String(r.openInBooking) })}</p> : null}
              <div className="flex gap-2">
                <button type="button" disabled={pending} onClick={() => startTransition(async () => done(await cancelAction(r.id, cancelAsk.whole)))} className={`${button} bg-danger text-white`}>
                  {cancelAsk.whole ? m["res.cancelWhole"] : m["res.cancelThis"]}
                </button>
                <button type="button" onClick={() => setCancelAsk(null)} className={`${button} hover:bg-ink-5`}>
                  {m["res.keepAsIs"]}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => askCancel(false)} className={`${button} hover:bg-ink-5`}>
                {m["res.cancelThis"]}
              </button>
              {r.openInBooking > 1 ? (
                <button type="button" onClick={() => askCancel(true)} className={`${button} hover:bg-ink-5`}>
                  {m["res.cancelWhole"]}
                </button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {r.cancellationFeeStatus ? (
        <section aria-label={m["res.cancellationFee"]} className="grid gap-2 rounded-2xl bg-surface-2 p-5 text-sm">
          <h2 className="font-medium">{m["res.cancellationFee"]}</h2>
          <p>
            {money(r.cancellationFee ?? 0)} · {m[`res.fee.${r.cancellationFeeStatus}`]}
          </p>
          {r.cancellationFeeStatus === "open" ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => startTransition(async () => done(await feeAction(r.id, "confirmed")))} className={`${button} bg-accent text-white`}>
                {m["res.feeConfirm"]}
              </button>
              <button type="button" onClick={() => startTransition(async () => done(await feeAction(r.id, "waived")))} className={`${button} hover:bg-ink-5`}>
                {m["res.feeWaive"]}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

