import { can, type Actor } from "@hoteloftware/domain";
import { portalSummary } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { portalBaseUrl } from "@/lib/env";
import { fileLink } from "@/lib/files";
import { ActionForm } from "@/components/form-fields";
import { revokePortalLinkAction } from "./portal-actions";

/** The Guest Portal on the reservation (ticket 40): the links to hand out, Pre-check-in as the guest entered it, revoking. */
export async function PortalPanel({ schema, tenant, userId, reservationId, propertyId, actor, language, timeZone, m }: { schema: string; tenant: { id: string; slug: string }; userId: string; reservationId: string; propertyId: string; actor: Actor; language: "de" | "en"; timeZone: string; m: Messages }) {
  if (!can(actor, "view_reservations", propertyId)) return null;
  const p = await portalSummary(pool(), schema, reservationId);
  if (!p) return null;
  const base = portalBaseUrl(tenant.slug);
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
  const manage = can(actor, "manage_reservations", propertyId);
  const seesDocuments = can(actor, "check_in", propertyId);
  return (
    <details className="rounded-2xl bg-surface-2 p-5 text-sm" data-portal-panel open={p.precheckinAt !== null}>
      <summary className="cursor-pointer font-medium">
        {m["portal.panel"]} · {p.precheckinAt ? fill(m["portal.precheckinAt"], { at: when(p.precheckinAt) }) : m["portal.notYet"]}
        {p.arrivalTime ? ` · ${fill(m["portal.arrivalTime"], { time: p.arrivalTime })}` : ""}
      </summary>
      <div className="mt-3 grid gap-2">
        {manage ? (
          <>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["portal.stayLink"]}</span>
              <input readOnly value={`${base}/g/${p.keys.reservation}`} className="h-9 rounded-xl border border-ink-10 bg-surface px-2 font-mono text-xs" data-stay-link />
            </label>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["portal.bookingLink"]}</span>
              <input readOnly value={`${base}/g/${p.keys.booking}`} className="h-9 rounded-xl border border-ink-10 bg-surface px-2 font-mono text-xs" />
            </label>
          </>
        ) : null}
        {p.companions.length ? (
          <p>
            {m["portal.companions"]}: {p.companions.map((c) => [c.firstName, c.lastName].filter(Boolean).join(" ") + (c.nationality ? ` (${c.nationality})` : "") + (c.dateOfBirth ? ` ${c.dateOfBirth}` : "")).join(", ")}
          </p>
        ) : null}
        {p.emailConsent ? <p className="text-ink-60">{fill(m["portal.consent"], { state: p.emailConsent.granted ? m["portal.consentYes"] : m["portal.consentNo"], at: when(p.emailConsent.at) })}</p> : null}
        {seesDocuments && p.documents.length ? (
          <div className="flex gap-2" data-documents>
            <span className="text-ink-60">{m["portal.documents"]}:</span>
            {p.documents.map((id) => (
              <a key={id} href={fileLink(tenant.id, userId, id)} target="_blank" rel="noreferrer" className="text-accent underline">
                ↗
              </a>
            ))}
          </div>
        ) : null}
        {manage ? (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={revokePortalLinkAction} submitLabel={m["portal.revoke"]} pendingLabel={m["action.saving"]} className="contents">
              <input type="hidden" name="reservationId" value={reservationId} />
              <input type="hidden" name="which" value="stay" />
            </ActionForm>
            <ActionForm action={revokePortalLinkAction} submitLabel={m["portal.revokeBooking"]} pendingLabel={m["action.saving"]} className="contents">
              <input type="hidden" name="reservationId" value={reservationId} />
              <input type="hidden" name="which" value="booking" />
            </ActionForm>
          </div>
        ) : null}
      </div>
    </details>
  );
}
