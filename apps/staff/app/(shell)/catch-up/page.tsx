import { listOutages, listRooms, workspaceList } from "@hoteloftware/db";
import { CATCH_UP_KINDS, CATCH_UP_TENDERS } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { catchUpAction, endOutageAction, logOutageAction } from "./actions";

/** After an outage (ticket 86): log it, then enter what happened on paper with the time it really happened. */
export default async function CatchUpPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.catch_up"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("use_downtime", property.id);
  const s = tenant.schemaName;
  const [outages, arrivals, inHouse, checkedOut, rooms] = await Promise.all([
    listOutages(pool(), s, property.id),
    workspaceList(pool(), s, property.id, "arrivals", property.businessDate),
    workspaceList(pool(), s, property.id, "in_house", property.businessDate),
    // a stay checked out today on paper may still owe a payment entry
    workspaceList(pool(), s, property.id, "checked_out", property.businessDate),
    listRooms(pool(), s, property.id),
  ]);
  const when = (d: Date) => new Intl.DateTimeFormat(shell.language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone }).format(d);
  const input = "h-9 rounded-xl border border-ink-10 bg-surface px-2 text-sm";
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const stays = [...arrivals, ...inHouse, ...checkedOut];
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.catch_up"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["catchup.help"]}</p>
      </div>
      <section className="grid gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
        <h2 className="font-medium">{m["catchup.outages"]}</h2>
        <ul className="grid gap-1" data-outages>
          {outages.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2">
              <span>
                {when(o.startedAt)} – {o.endedAt ? when(o.endedAt) : m["catchup.ongoing"]} · {m[`catchup.cause.${o.cause}`]} {o.note ? `· ${o.note}` : ""}
              </span>
              {!o.endedAt ? (
                <ActionForm action={endOutageAction} submitLabel={m["catchup.end"]} className="flex items-center gap-2">
                  {hidden}
                  <input type="hidden" name="outageId" value={o.id} />
                  <input type="datetime-local" name="endedAt" required className={input} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
        <ActionForm action={logOutageAction} submitLabel={m["catchup.log"]} className="flex flex-wrap items-end gap-3">
          {hidden}
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.start"]}</span>
            <input type="datetime-local" name="startedAt" required className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.endAt"]}</span>
            <input type="datetime-local" name="endedAt" className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.causeLabel"]}</span>
            <select name="cause" defaultValue="hotel" className={input}>
              {(["hotel", "ours", "unknown"] as const).map((c) => (
                <option key={c} value={c}>
                  {m[`catchup.cause.${c}`]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.note"]}</span>
            <input name="note" className={input} />
          </label>
        </ActionForm>
      </section>
      <section className="grid gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
        <h2 className="font-medium">{m["catchup.entry"]}</h2>
        <ActionForm action={catchUpAction} submitLabel={m["catchup.enter"]} className="grid gap-3 sm:grid-cols-2">
          {hidden}
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.what"]}</span>
            <select name="kind" className={input}>
              {CATCH_UP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {m[`catchup.kind.${k}`]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.stay"]}</span>
            <select name="reservationId" className={input}>
              {stays.map((r) => (
                <option key={r.reservationId} value={r.reservationId}>
                  {r.room ?? "–"} · {r.guestLastName}, {r.guestFirstName} · {r.confirmationNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.realAt"]}</span>
            <input type="datetime-local" name="realAt" required className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.tender"]}</span>
            <select name="tender" className={input}>
              {CATCH_UP_TENDERS.map((t) => (
                <option key={t} value={t}>
                  {m[`catchup.tender.${t}`]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.amount"]}</span>
            <input name="amount" inputMode="decimal" className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.reference"]}</span>
            <input name="reference" className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-60">{m["catchup.room"]}</span>
            <select name="roomId" className={input}>
              <option value="">–</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number}
                </option>
              ))}
            </select>
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
