import Link from "next/link";
import { findProperty, tillPostings } from "@hoteloftware/db";
import { formatCurrency, formatDateTime } from "@hoteloftware/domain";
import { ActionForm, Field } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { reconcileTillAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Till postings (ticket 65): what external tills posted to rooms, and the
 * refused ones to reconcile. Tills do not send a refused posting again, so
 * the desk posts it by hand (or notes why not) and marks it reconciled.
 */
export default async function TillPostingsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-medium">{m["module.till_postings"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = await requireAllowed("post_charges", property.id);
  const all = (await searchParams).all === "1";
  const [rows, p] = await Promise.all([tillPostings(pool(), tenant.schemaName, property.id, { open: !all }, { userId: session.user.id, actor }), findProperty(pool(), tenant.schemaName, property.id)]);
  const money = (n: number) => formatCurrency(n, p?.currency ?? "EUR", language, p?.country ?? "DE");
  const when = (iso: string) => formatDateTime(new Date(iso), language, p?.country ?? "DE", p?.timeZone ?? "Europe/Berlin");
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-medium">
          {m["module.till_postings"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <Link href={all ? "/till-postings" : "/till-postings?all=1"} className="text-sm text-accent underline">
          {all ? m["till.openOnly"] : m["till.showAll"]}
        </Link>
      </header>
      <p className="text-sm text-ink-60">{m["till.postingsHelp"]}</p>
      {rows.length ? null : <p className="text-ink-60">{all ? m["till.none"] : m["till.nothingOpen"]}</p>}
      {rows.map((r) => (
        <section key={r.id} className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm" data-till-posting={r.receiptNumber} data-status={r.status}>
          <p className="flex flex-wrap justify-between gap-2">
            <span className="font-medium">
              {r.till} · {r.kind === "reversal" ? m["till.reversal"] : m["till.bill"]} {r.receiptNumber || "–"} · {money(r.total)}
              {r.tip ? ` + ${money(r.tip)} ${m["till.tip"]}` : ""}
            </span>
            <span className="text-ink-60">{when(r.receivedAt)}</span>
          </p>
          <p>
            {r.reservationId ? (
              <Link href={`/reservations/${r.reservationId}`} className="text-accent underline">
                {[r.room, r.guest].filter(Boolean).join(" · ") || m["till.reservation"]}
              </Link>
            ) : (
              <span className="text-ink-60">{m["till.noReservation"]}</span>
            )}
            {r.status === "rejected" ? <span className="ml-2 text-danger">· {r.error}</span> : null}
          </p>
          {r.status === "rejected" && !r.reconciledAt ? (
            <ActionForm action={reconcileTillAction} submitLabel={m["till.reconcile"]} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="propertyId" value={property.id} />
              <input type="hidden" name="id" value={r.id} />
              <Field label={m["till.note"]} name="note" required />
            </ActionForm>
          ) : r.reconciledAt ? (
            <p className="text-ink-60">
              {m["till.reconciled"]} {when(r.reconciledAt)} · {r.reconcileNote}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
