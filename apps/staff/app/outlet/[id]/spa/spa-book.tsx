"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SpaDay } from "@hoteloftware/db";
import { instantAt } from "@hoteloftware/domain";
import type { Messages } from "@/i18n/messages";
import { billAppointmentAction, bookAppointmentAction, cancelAppointmentAction, spaGuestsAction, spaHoursAction } from "./actions";

type Guest = Awaited<ReturnType<typeof spaGuestsAction>>[number];

/** The day's book per therapist, a new appointment, the therapists' hours (ticket 63). */
export function SpaBook({ outletId, date, timeZone, day, m }: { outletId: string; date: string; timeZone: string; day: SpaDay; m: Messages }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [treatment, setTreatment] = useState(day.treatments[0]?.id ?? "");
  const [therapist, setTherapist] = useState(day.therapists[0]?.id ?? "");
  const [time, setTime] = useState("10:00");
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [visitor, setVisitor] = useState("");
  const [hours, setHours] = useState({ therapistId: day.therapists[0]?.id ?? "", from: "09:00", to: "17:00", released: true });
  const clock = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeStyle: "short", timeZone }).format(new Date(iso));
  const done = (r: { error?: string; message?: string }) => {
    setNote(r.error ? { error: true, text: r.error } : { error: false, text: r.message ?? "" });
    if (!r.error) router.refresh();
  };
  const input = "h-10 rounded-xl border border-ink-10 bg-surface px-3";
  const button = "h-10 rounded-full px-4 text-sm font-medium disabled:opacity-50";
  return (
    <div className="grid gap-4">
      {note ? (
        <p role={note.error ? "alert" : "status"} className={note.error ? "text-danger" : "text-ink-60"}>
          {note.text}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {day.therapists.map((t) => (
          <section key={t.id} className="grid content-start gap-2 rounded-2xl bg-surface-2 p-3 text-sm" data-therapist={t.name}>
            <h2 className="font-medium">{t.name}</h2>
            <p className="text-xs text-ink-60">
              {t.hours.map((h) => `${clock(h.startsAt)}–${clock(h.endsAt)}${h.released ? " ✓" : ""}`).join(" · ") || "–"}
            </p>
            {day.appointments
              .filter((a) => a.therapistId === t.id && a.status !== "cancelled")
              .map((a) => (
                <article key={a.id} className="grid gap-1 rounded-xl bg-surface p-2" data-appointment={a.guest} data-status={a.status}>
                  <span className="font-medium">
                    {clock(a.startsAt)}–{clock(a.endsAt)} · {a.treatment}
                  </span>
                  <span>
                    {a.guest}
                    {a.room ? ` · ${a.room}` : ""} · {m[`spa.status.${a.status}`]}
                    {a.bookedVia === "portal" ? " · Portal" : ""}
                  </span>
                  {a.status === "booked" ? (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const r = await billAppointmentAction(outletId, a.id);
                            if (r.billId) router.push(`/outlet/${outletId}/bill/${r.billId}`);
                            else done(r);
                          })
                        }
                        className="text-accent underline"
                        data-bill-appointment
                      >
                        {m["spa.bill"]}
                      </button>
                      <button type="button" disabled={pending} onClick={() => start(async () => done(await cancelAppointmentAction(outletId, a.id)))} className="text-danger underline">
                        {m["spa.cancel"]}
                      </button>
                    </span>
                  ) : a.billId ? (
                    <a href={`/outlet/${outletId}/bill/${a.billId}`} className="text-accent underline">
                      {m["spa.bill"]}
                    </a>
                  ) : null}
                </article>
              ))}
          </section>
        ))}
      </div>
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-3 text-sm" data-new-appointment>
        <h2 className="font-medium">{m["spa.newAppointment"]}</h2>
        <div className="flex flex-wrap gap-2">
          <select value={treatment} onChange={(e) => setTreatment(e.target.value)} aria-label={m["spa.treatment"]} className={input}>
            {day.treatments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.minutes} min
              </option>
            ))}
          </select>
          <select value={therapist} onChange={(e) => setTherapist(e.target.value)} aria-label={m["spa.therapist"]} className={input}>
            {day.therapists.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={m["spa.time"]} className={input} />
        </div>
        <input
          value={query}
          onChange={(e) => {
            const q = e.target.value;
            setQuery(q);
            setGuest(null);
            if (q.trim()) start(async () => setGuests(await spaGuestsAction(outletId, q)));
          }}
          placeholder={m["spa.hotelGuest"]}
          aria-label={m["spa.hotelGuest"]}
          className={input}
        />
        <div className="flex flex-wrap gap-2">
          {guests.map((g) => (
            <button key={g.reservationId} type="button" onClick={() => setGuest(g)} className={`rounded-xl px-3 py-1 ${guest?.reservationId === g.reservationId ? "bg-accent/15" : "bg-surface"}`} data-spa-guest={g.lastName}>
              {g.room ?? "–"} · {g.lastName} · {g.arrival.slice(5)}–{g.departure.slice(5)}
            </button>
          ))}
        </div>
        <input value={visitor} onChange={(e) => setVisitor(e.target.value)} placeholder={m["spa.dayVisitor"]} aria-label={m["spa.dayVisitor"]} className={input} disabled={!!guest} />
        <button
          type="button"
          disabled={pending || !treatment || !therapist || (!guest && !visitor.trim())}
          onClick={() =>
            start(async () =>
              done(await bookAppointmentAction(outletId, { treatmentId: treatment, therapistId: therapist, startsAt: instantAt(date, time, timeZone).toISOString(), reservationId: guest?.reservationId ?? null, guestName: guest ? "" : visitor })),
            )
          }
          className={`${button} bg-accent text-white`}
          data-book
        >
          {m["spa.bookIt"]}
        </button>
      </section>
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-3 text-sm" data-spa-hours>
        <h2 className="font-medium">{m["spa.hours"]}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={hours.therapistId} onChange={(e) => setHours({ ...hours, therapistId: e.target.value })} aria-label={m["spa.therapist"]} className={input}>
            {day.therapists.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <input type="time" value={hours.from} onChange={(e) => setHours({ ...hours, from: e.target.value })} aria-label={m["spa.from"]} className={input} />
          <input type="time" value={hours.to} onChange={(e) => setHours({ ...hours, to: e.target.value })} aria-label={m["spa.to"]} className={input} />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={hours.released} onChange={(e) => setHours({ ...hours, released: e.target.checked })} />
            {m["spa.released"]}
          </label>
          <button
            type="button"
            disabled={pending || !hours.therapistId}
            onClick={() => start(async () => done(await spaHoursAction(outletId, { therapistId: hours.therapistId, from: instantAt(date, hours.from, timeZone).toISOString(), to: instantAt(date, hours.to, timeZone).toISOString(), released: hours.released })))}
            className={`${button} border border-ink-10`}
            data-add-hours
          >
            {m["spa.addHours"]}
          </button>
        </div>
      </section>
    </div>
  );
}
