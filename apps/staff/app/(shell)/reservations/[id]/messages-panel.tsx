import { can, type Actor } from "@hoteloftware/domain";
import { reservationMessages } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { ActionForm } from "@/components/form-fields";
import { sendGuestMessageAction } from "./messages-actions";

/** The guest messages of the reservation with their delivery state (ticket 39); the desk sends a card or balance request, or the confirmation again. */
export async function MessagesPanel({ schema, reservationId, propertyId, actor, language, timeZone, m }: { schema: string; reservationId: string; propertyId: string; actor: Actor; language: "de" | "en"; timeZone: string; m: Messages }) {
  if (!can(actor, "view_reservations", propertyId)) return null;
  const rows = await reservationMessages(pool(), schema, reservationId);
  const canSend = can(actor, "manage_reservations", propertyId);
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone }).format(d);
  const tone: Record<string, string> = { delivered: "text-green-700", sent: "text-ink-80", queued: "text-ink-60", sending: "text-ink-60", failed: "text-red-700", suppressed: "text-amber-700" };
  return (
    <details className="rounded-2xl bg-surface-2 p-5 text-sm" data-messages-panel open={rows.some((r) => r.status === "failed")}>
      <summary className="cursor-pointer font-medium">{fill(m["messages.panel"], { n: String(rows.length) })}</summary>
      {rows.length ? (
        <ul className="mt-3 grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-0.5 rounded-xl bg-surface p-3" data-message-type={r.type} data-status={r.status}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m[`messages.type.${r.type}`]}</span>
                <span className="text-xs text-ink-60">{r.language.toUpperCase()}{r.manual ? ` · ${m["messages.manual"]}` : ""}</span>
                <span className={`ml-auto text-xs ${tone[r.status] ?? ""}`}>
                  {m[`messages.status.${r.status}`]}
                  {r.status === "queued" ? ` · ${fill(m["messages.after"], { at: when(r.sendAfter) })}` : r.deliveredAt ? ` · ${when(r.deliveredAt)}` : r.sentAt ? ` · ${when(r.sentAt)}` : ""}
                </span>
              </div>
              <div className="text-xs text-ink-60">
                {r.subject} · {r.toEmail ?? m["messages.noAddress"]}
              </div>
              {r.reason && r.status !== "sent" && r.status !== "delivered" ? <div className="text-xs text-red-700">{m[`messages.reason.${r.reason}` as keyof Messages] ?? r.reason}</div> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-ink-60">{m["messages.none"]}</p>
      )}
      {canSend ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(["card_request", "balance_request", "confirmation"] as const).map((type) => (
            <ActionForm key={type} action={sendGuestMessageAction} submitLabel={m[`messages.send.${type}`]} pendingLabel={m["action.saving"]} className="contents">
              <input type="hidden" name="reservationId" value={reservationId} />
              <input type="hidden" name="type" value={type} />
            </ActionForm>
          ))}
        </div>
      ) : null}
    </details>
  );
}
