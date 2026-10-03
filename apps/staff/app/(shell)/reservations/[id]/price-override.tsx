"use client";

import { useState } from "react";
import { formatCurrency, roundMoney, type Language } from "@hoteloftware/domain";
import { fill, type Messages } from "@/i18n/messages";
import { ApprovalPrompt } from "@/components/approval-prompt";
import type { ApprovalMode } from "@/lib/approval";
import { useFormAction } from "../use-form-action";
import { priceOverrideAction } from "../price-actions";

const button = "h-9 rounded-full px-4 text-sm font-medium";
const input = "h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm";

/** Change the price of nights with a reason (ticket 31); below the Price Floor or complimentary needs an Approval. */
export function PriceOverride({
  reservationId,
  nights,
  floor,
  currency,
  m,
}: {
  reservationId: string;
  /** Nights of the stay with their price; invoiced ones cannot change. */
  nights: { date: string; label: string; total: number; invoiced: boolean }[];
  floor: number | null;
  currency: { code: string; language: Language; country: string };
  m: Messages;
}) {
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(nights.map((n) => [n.date, n.total.toFixed(2)])));
  const [reason, setReason] = useState("");
  const [approval, setApproval] = useState<string | null>(null);
  const { pending, run, note } = useFormAction(m);
  const changed = nights
    .filter((n) => !n.invoiced)
    .map((n) => ({ date: n.date, price: roundMoney(Number((prices[n.date] ?? "").replace(",", "."))) }))
    .filter((n) => Number.isFinite(n.price) && n.price !== nights.find((x) => x.date === n.date)!.total);
  const save = (mode?: ApprovalMode) =>
    run(
      async () => {
        const r = await priceOverrideAction(reservationId, changed, reason, mode);
        // a failed attempt to approve (say, a wrong password) keeps the prompt open
        setApproval(r.approval?.summary ?? (r.error && mode ? approval : null));
        return r;
      },
      () => setReason(""),
    );
  return (
    <details className="mt-3 rounded-xl bg-surface p-3">
      <summary className="cursor-pointer font-medium">{m["po.title"]}</summary>
      <div className="mt-2 grid gap-2">
        <p className="text-xs text-ink-60">{fill(m["po.help"], { floor: floor === null ? m["po.noFloor"] : money(floor) })}</p>
        {note}
        <div className="flex flex-wrap gap-2">
          {nights.map((n) => (
            <label key={n.date} data-night={n.date} className="grid gap-1 text-xs text-ink-60">
              {n.label}
              <input
                inputMode="decimal"
                disabled={n.invoiced}
                value={prices[n.date] ?? ""}
                onChange={(e) => setPrices({ ...prices, [n.date]: e.target.value })}
                className={`${input} w-28 text-right ${floor !== null && Number((prices[n.date] ?? "").replace(",", ".")) < floor ? "border-danger" : ""}`}
              />
              {n.invoiced ? <span>{m["po.invoiced"]}</span> : null}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid flex-1 gap-1 text-xs text-ink-60">
            {m["po.reason"]}
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={input} />
          </label>
          <button type="button" disabled={pending || !changed.length || !reason.trim()} onClick={() => save()} className={`${button} bg-accent text-white disabled:opacity-60`}>
            {m["po.save"]}
          </button>
        </div>
        {approval ? (
          <ApprovalPrompt summary={approval} pending={pending} onRequest={() => save({ mode: "request" })} onCredentials={(username, password) => save({ mode: "credentials", username, password })} m={m} />
        ) : null}
      </div>
    </details>
  );
}
