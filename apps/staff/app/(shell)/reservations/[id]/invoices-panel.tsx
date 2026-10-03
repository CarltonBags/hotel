"use client";

import { useState } from "react";
import { FileDown, FileCode } from "lucide-react";
import { formatCurrency, type Language } from "@hoteloftware/domain";
import type { IssuedInvoice } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { useFormAction } from "../use-form-action";
import { cancelInvoiceAction, checkOutAction, issueInvoiceAction, type CheckOutState } from "../invoice-actions";

const button = "h-9 rounded-full px-4 text-sm font-medium";
const secondary = `${button} border border-ink-10 bg-surface hover:bg-ink-5`;

/** The reservation's invoices (ZUGFeRD PDF, XRechnung XML), issuing a folio's open Charges, and correcting by a Cancellation Invoice. */
export function InvoicesPanel({
  reservationId,
  invoices,
  openFolios,
  canIssue,
  canCorrect,
  currency,
  m,
}: {
  reservationId: string;
  invoices: IssuedInvoice[];
  /** Folios with Charges not yet invoiced. */
  openFolios: { id: string; label: string }[];
  canIssue: boolean;
  canCorrect: boolean;
  currency: { code: string; language: Language; country: string };
  m: Messages;
}) {
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const day = (d: string) => new Intl.DateTimeFormat(currency.language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const { pending, run, note } = useFormAction(m);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <section aria-label={m["inv.title"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
      <h2 className="font-medium">{m["inv.title"]}</h2>
      {note}
      {invoices.length === 0 ? <p className="text-ink-60">{m["inv.none"]}</p> : null}
      <ul className="grid gap-1">
        {invoices.map((i) => (
          <li key={i.id} data-invoice={i.number} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2">
            <span className={`min-w-0 flex-1 ${i.cancelledBy ? "text-ink-60" : ""}`}>
              <strong className={i.cancelledBy ? "line-through" : ""}>{i.number}</strong> · {m[`inv.type.${i.kind}`]} · {i.billToName} · {day(i.issueDate)}
              {i.due > 0 && !i.cancelledBy ? ` · ${fill(m["inv.due"], { amount: money(i.due) })}` : ""}
              {i.receivable ? ` · ${m["inv.receivable"]}` : ""}
              {i.cancelledBy ? ` · ${m["inv.cancelled"]}` : ""}
            </span>
            <span className="tabular-nums">{money(i.gross)}</span>
            {canCorrect && i.kind !== "cancellation" && !i.cancelledBy ? (
              <button type="button" onClick={() => {
                  setCancelling(cancelling === i.id ? null : i.id);
                  setReason("");
                }} className={secondary} aria-expanded={cancelling === i.id}>
                {m["inv.cancel"]}
              </button>
            ) : null}
            <a href={`/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" className={`${secondary} inline-flex items-center gap-1`} aria-label={`${i.number} PDF`}>
              <FileDown size={15} /> PDF
            </a>
            <a href={`/invoices/${i.id}/xml`} className={`${secondary} inline-flex items-center gap-1`} aria-label={`${i.number} XRechnung`}>
              <FileCode size={15} /> XRechnung
            </a>
            {cancelling === i.id ? (
              <form
                className="flex w-full flex-wrap items-end gap-2 border-t border-ink-5 pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const r = await cancelInvoiceAction(reservationId, i.id, reason);
                    if (r.ok) setCancelling(null);
                    return r;
                  });
                }}
              >
                <p className="w-full text-xs text-ink-60">{m["inv.cancelHelp"]}</p>
                <label className="grid flex-1 gap-1 text-xs text-ink-60">
                  {m["inv.cancelReason"]}
                  <input required value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm text-ink" />
                </label>
                <button type="submit" disabled={pending || !reason.trim()} className={`${button} bg-danger text-white disabled:opacity-60`}>
                  {m["inv.cancelSubmit"]}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {canIssue && openFolios.length ? (
        <div className="grid gap-1">
          <p className="text-xs text-ink-60">{m["inv.issueHelp"]}</p>
          <div className="flex flex-wrap gap-2">
            {openFolios.map((f) => (
              <button key={f.id} type="button" disabled={pending} onClick={() => run(() => issueInvoiceAction(reservationId, f.id))} className={secondary}>
                {fill(m["inv.issueFor"], { folio: f.label })}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Check-out: issues the open folios; refused while a guest folio is open (a Manager may override). */
export function CheckOutPanel({ reservationId, canOverride, currency, m }: { reservationId: string; canOverride: boolean; currency: { code: string; language: Language; country: string }; m: Messages }) {
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const [open, setOpen] = useState<CheckOutState["open"]>(undefined);
  const { pending, run, note } = useFormAction(m);
  const go = (override: boolean) =>
    run(async () => {
      const r = await checkOutAction(reservationId, override);
      setOpen(r.open);
      return r;
    });
  return (
    <section aria-label={m["co.title"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
      <h2 className="font-medium">{m["co.title"]}</h2>
      <p className="text-xs text-ink-60">{m["co.help"]}</p>
      {/* a refusal shows as the list of open folios, not as a second message */}
      {open?.length ? null : note}
      {open?.length ? (
        <div role="alert" className="grid gap-1 rounded-xl border border-danger/40 bg-danger/5 p-3">
          <p className="font-medium">{m["co.blocked"]}</p>
          <ul>
            {open.map((o) => (
              <li key={o.folioNumber}>
                {fill(m["folio.label"], { n: String(o.folioNumber), name: o.billToName })}: {money(o.balance)}
              </li>
            ))}
          </ul>
          {canOverride ? (
            <button type="button" disabled={pending} onClick={() => go(true)} className={`${button} justify-self-start bg-danger text-white`}>
              {m["co.override"]}
            </button>
          ) : null}
        </div>
      ) : null}
      <button type="button" disabled={pending} onClick={() => go(false)} className={`${button} justify-self-start bg-accent text-white disabled:opacity-60`}>
        {m["co.submit"]}
      </button>
    </section>
  );
}
