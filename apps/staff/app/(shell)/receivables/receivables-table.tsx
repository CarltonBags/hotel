"use client";

import { useState } from "react";
import { formatCurrency, nextReminderLevel, roundMoney, type Language } from "@hoteloftware/domain";
import type { ReceivableRow } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { useFormAction } from "../reservations/use-form-action";
import { issueReminderAction, matchTransferAction } from "./actions";

const button = "h-9 rounded-full px-4 text-sm font-medium";
const secondary = `${button} border border-ink-10 bg-surface hover:bg-ink-5`;
const input = "h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm";

/** Open invoices by Bill-to, with reminders, and one form to match a transfer over any of them. */
export function ReceivablesTable({
  propertyId,
  today,
  rows,
  currency,
  m,
}: {
  propertyId: string;
  today: string;
  rows: ReceivableRow[];
  currency: { code: string; language: Language; country: string };
  m: Messages;
}) {
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const day = (d: string) => new Intl.DateTimeFormat(currency.language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const { pending, run, note } = useFormAction(m);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [receivedOn, setReceivedOn] = useState(today);
  const [reference, setReference] = useState("");
  const parse = (v: string | undefined) => Number((v ?? "").replace(",", ".")) || 0;
  const allocations = rows.map((r) => ({ invoiceId: r.invoiceId, amount: roundMoney(parse(amounts[r.invoiceId])) })).filter((a) => a.amount > 0);
  const total = roundMoney(allocations.reduce((s, a) => s + a.amount, 0));
  const groups = [...new Set(rows.map((r) => r.billToName))].sort((a, b) => a.localeCompare(b));
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await matchTransferAction(propertyId, { receivedOn, reference, allocations });
          if (r.ok) {
            setAmounts({});
            setReference("");
          }
          return r;
        });
      }}
    >
      {note}
      <table className="w-full text-sm">
        <thead className="text-left text-ink-60">
          <tr className="border-b border-ink-10">
            <th className="py-2 pr-3 font-normal">{m["rcv.col.invoice"]}</th>
            <th className="py-2 pr-3 font-normal">{m["rcv.col.issued"]}</th>
            <th className="py-2 pr-3 font-normal">{m["rcv.col.due"]}</th>
            <th className="py-2 pr-3 font-normal">{m["rcv.col.overdue"]}</th>
            <th className="py-2 pr-3 text-right font-normal">{m["rcv.col.open"]}</th>
            <th className="py-2 pr-3 font-normal">{m["rcv.col.reminders"]}</th>
            <th className="py-2 font-normal">{m["rcv.col.match"]}</th>
          </tr>
        </thead>
        {groups.map((g) => {
          const mine = rows.filter((r) => r.billToName === g);
          return (
            <tbody key={g} data-bill-to={g}>
              <tr>
                <th colSpan={4} className="pt-4 pb-1 text-left font-medium">
                  {g}
                </th>
                <td className="pt-4 pb-1 pr-3 text-right font-medium tabular-nums">{money(roundMoney(mine.reduce((s, r) => s + r.open, 0)))}</td>
                <td colSpan={2} />
              </tr>
              {mine.map((r) => {
                const next = nextReminderLevel(r.reminders.map((x) => x.level));
                return (
                  <tr key={r.invoiceId} data-receivable={r.number} className="border-b border-ink-5 align-middle">
                    <td className="py-2 pr-3">
                      <a href={`/invoices/${r.invoiceId}/pdf`} target="_blank" rel="noreferrer" className="underline">
                        {r.number}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-ink-60">{day(r.issueDate)}</td>
                    <td className="py-2 pr-3">{day(r.dueDate)}</td>
                    <td className={`py-2 pr-3 ${r.daysOverdue > 0 ? "text-danger" : "text-ink-60"}`}>{r.daysOverdue > 0 ? fill(m["rcv.days"], { n: String(r.daysOverdue) }) : "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.open)}</td>
                    <td className="py-2 pr-3">
                      <span className="flex flex-wrap items-center gap-1">
                        {r.reminders.map((x) => (
                          <a key={x.id} href={`/reminders/${x.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-full bg-ink-5 px-2 py-0.5 text-xs underline">
                            {fill(m["rcv.reminder"], { level: String(x.level) })}
                          </a>
                        ))}
                        {next && r.daysOverdue > 0 ? (
                          <button type="button" disabled={pending} onClick={() => run(() => issueReminderAction(propertyId, r.invoiceId))} className={`${secondary} h-7 px-3 text-xs`}>
                            {fill(m["rcv.remind"], { level: String(next) })}
                          </button>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2">
                      <input
                        inputMode="decimal"
                        aria-label={`${m["rcv.col.match"]} ${r.number}`}
                        value={amounts[r.invoiceId] ?? ""}
                        onChange={(e) => setAmounts({ ...amounts, [r.invoiceId]: e.target.value })}
                        placeholder={String(r.open)}
                        className={`${input} w-28 text-right`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
      <fieldset className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm">
        <legend className="px-1 font-medium">{m["rcv.matchTitle"]}</legend>
        <p className="text-xs text-ink-60">{m["rcv.matchHelp"]}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-ink-60">
            {m["rcv.receivedOn"]}
            <input type="date" required value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={input} />
          </label>
          <label className="grid flex-1 gap-1 text-xs text-ink-60">
            {m["rcv.reference"]}
            <input required value={reference} onChange={(e) => setReference(e.target.value)} className={input} />
          </label>
          <button type="submit" disabled={pending || total <= 0 || !reference.trim()} className={`${button} bg-accent text-white disabled:opacity-60`}>
            {fill(m["rcv.matchSubmit"], { amount: money(total) })}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
