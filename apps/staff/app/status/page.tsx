import { AVAILABILITY_TARGET } from "@hoteloftware/domain";
import { statusPage } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { deviceMessages } from "@/lib/device";

export const dynamic = "force-dynamic";

/** The public status page (ticket 93): service state, incidents, planned maintenance, monthly availability against 99.95 %. */
export default async function StatusPage() {
  const m = await deviceMessages();
  const s = await statusPage(pool());
  const when = (d: Date) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);
  const tone = { operational: "bg-success/15 text-success", degraded: "bg-warning/20", outage: "bg-danger/15 text-danger" }[s.state];
  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-6">
      <h1 className="text-2xl font-semibold">Hoteloftware · {m["status.title"]}</h1>
      <p data-state={s.state} className={`rounded-2xl px-5 py-4 text-lg font-medium ${tone}`}>
        {m[`status.state.${s.state}`]}
      </p>
      {s.open.map((i) => (
        <section key={i.id} data-incident={i.title} className="grid gap-1 rounded-2xl bg-surface p-5 shadow-card">
          <h2 className="font-medium">
            {i.title} <span className="text-sm text-ink-60">· {m[`support.impact.${i.impact}`]} · {when(i.startedAt)}</span>
          </h2>
          {i.updates.map((u, k) => (
            <p key={k} className="text-sm">
              <span className="font-medium">{u.state}</span> · {when(u.at)} · {u.message}
            </p>
          ))}
        </section>
      ))}
      <section className="grid gap-2">
        <h2 className="font-medium">{m["support.maintenance"]}</h2>
        {s.maintenance.length === 0 ? <p className="text-sm text-ink-60">{m["status.noMaintenance"]}</p> : null}
        {s.maintenance.map((w) => (
          <p key={w.id} data-maintenance={w.title} className="text-sm">
            <span className="font-medium">{w.title}</span> · {when(w.startsAt)} – {when(w.endsAt)}
            {w.description ? ` · ${w.description}` : ""}
          </p>
        ))}
      </section>
      <section className="grid gap-2">
        <h2 className="font-medium">
          {m["status.availability"]} <span className="text-sm text-ink-60">({m["status.target"]} {AVAILABILITY_TARGET.toFixed(2)} %)</span>
        </h2>
        <ul className="grid gap-1">
          {s.availability.map((a) => (
            <li key={a.month} data-availability={a.month} className="flex justify-between text-sm">
              <span>{a.month}</span>
              <span className={a.met ? "" : "text-danger"}>
                {a.percent.toFixed(3)} % · {a.downMinutes} min
              </span>
            </li>
          ))}
        </ul>
      </section>
      {s.recent.length ? (
        <section className="grid gap-2">
          <h2 className="font-medium">{m["status.recent"]}</h2>
          {s.recent.map((i) => (
            <p key={i.id} className="text-sm">
              {i.title} · {when(i.startedAt)} – {i.resolvedAt ? when(i.resolvedAt) : ""}
            </p>
          ))}
        </section>
      ) : null}
    </main>
  );
}
