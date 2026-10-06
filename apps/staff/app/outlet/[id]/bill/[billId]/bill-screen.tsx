"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MenuItem, OutletBillView } from "@hoteloftware/db";
import { formatCurrency } from "@hoteloftware/domain";
import type { Messages } from "@/i18n/messages";
import { addItemAction, invoiceBillAction, moveAction, payCashAction, removeLineAction, sendRoundAction, splitAction } from "../../../actions";

interface Props {
  bill: OutletBillView;
  menu: MenuItem[];
  tables: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  currency: { code: string; country: string };
  rights: { serve: boolean; cash: boolean };
  m: Messages;
}

/** One bill on the outlet device: the menu to tap, the items with their round, and what closes it. */
export function BillScreen({ bill, menu, tables, companies, currency, rights, m }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [item, setItem] = useState<MenuItem | null>(null);
  const [qty, setQty] = useState(1);
  const [mods, setMods] = useState<string[]>([]);
  const [itemNote, setItemNote] = useState("");
  const [customer, setCustomer] = useState("");
  const [company, setCompany] = useState("");
  const [table, setTable] = useState(bill.tableId ?? "");
  const money = (n: number) => formatCurrency(n, currency.code, "de", currency.country);
  const open = bill.status === "open";
  const outletId = bill.outlet.id;
  const run = (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ? { error: true, text: r.error } : r.message ? { error: false, text: r.message } : null);
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });
  const add = (i: MenuItem, chosen: string[], q: number, n: string) => run(() => addItemAction(outletId, bill.id, { menuItemId: i.id, quantity: q, modifiers: chosen, note: n }), () => (setItem(null), setQty(1), setMods([]), setItemNote("")));
  const categories = [...new Set(menu.map((i) => i.category))];
  const button = "h-11 rounded-full px-4 text-sm font-medium disabled:opacity-50";
  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-4" data-bill={bill.number} data-bill-status={bill.status}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-medium">
          {bill.outlet.name} · {m["outlet.bill"]} #{bill.number}
          {bill.table ? ` · ${bill.table}` : ""}
          {bill.label ? ` · ${bill.label}` : ""}
        </h1>
        <Link href={`/outlet/${outletId}`} className="text-sm text-accent underline">
          {m["outlet.back"]}
        </Link>
      </header>
      {note ? (
        <p role={note.error ? "alert" : "status"} className={note.error ? "text-danger" : "text-ink-60"}>
          {note.text}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        {open && rights.serve ? (
          <section className="grid content-start gap-3" aria-label={m["outlet.menu"]}>
            {categories.map((c) => (
              <div key={c} className="grid gap-2">
                {c ? <h2 className="text-sm text-ink-60">{c}</h2> : null}
                <div className="flex flex-wrap gap-2">
                  {menu
                    .filter((i) => i.category === c)
                    .map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        disabled={pending}
                        data-menu-item={i.name}
                        onClick={() => (i.modifiers.length ? (setItem(i), setMods([]), setQty(1)) : add(i, [], 1, ""))}
                        className="min-h-14 rounded-2xl bg-surface-2 px-4 py-2 text-left"
                      >
                        <span className="block font-medium">{i.name}</span>
                        <span className="text-xs text-ink-60">{money(i.price)}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
            {item ? (
              <div className="grid gap-2 rounded-2xl bg-surface-2 p-3" data-modifiers={item.name}>
                <p className="font-medium">{item.name}</p>
                <div className="flex flex-wrap gap-3">
                  {item.modifiers.map((x) => (
                    <label key={x.name} className="flex items-center gap-1">
                      <input type="checkbox" value={x.name} checked={mods.includes(x.name)} onChange={(e) => setMods((s) => (e.target.checked ? [...s, x.name] : s.filter((y) => y !== x.name)))} />
                      {x.name}
                      {x.price ? ` +${money(x.price)}` : ""}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min={1} max={99} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} aria-label={m["outlet.quantity"]} className="h-10 w-20 rounded-lg border border-ink-10 bg-surface px-2" />
                  <input value={itemNote} onChange={(e) => setItemNote(e.target.value)} placeholder={m["outlet.note"]} aria-label={m["outlet.note"]} className="h-10 flex-1 rounded-lg border border-ink-10 bg-surface px-2" />
                  <button type="button" disabled={pending} onClick={() => add(item, mods, qty, itemNote)} className={`${button} bg-accent text-white`} data-add-item>
                    {m["outlet.add"]}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        <section className="grid content-start gap-3 rounded-2xl bg-surface-2 p-3" aria-label={m["outlet.bill"]}>
          <ul className="grid gap-1">
            {bill.lines.map((l) => (
              <li key={l.id} className="flex items-start gap-2" data-line={l.description} data-round={l.round ?? ""}>
                {open ? <input type="checkbox" aria-label={l.description} checked={picked.includes(l.id)} onChange={(e) => setPicked((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} /> : null}
                <span className="flex-1">
                  {l.quantity} × {l.description}
                  {l.modifiers.length ? <span className="block text-xs text-ink-60">{l.modifiers.map((x) => x.name).join(", ")}</span> : null}
                  {l.note ? <span className="block text-xs text-ink-60">! {l.note}</span> : null}
                  <span className="block text-xs text-ink-60">{l.round ? `${m["outlet.round"]} ${l.round}` : l.printerId ? m["outlet.unsent"] : ""}</span>
                </span>
                <span>{money(l.amount)}</span>
                {open && !l.round ? (
                  <button type="button" onClick={() => run(() => removeLineAction(outletId, bill.id, l.id))} className="text-xs text-danger" aria-label={m["outlet.remove"]}>
                    ✕
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="flex justify-between text-lg font-medium" data-total={bill.total}>
            <span>{m["outlet.total"]}</span>
            <span>{money(bill.total)}</span>
          </p>
          {open && rights.serve ? (
            <div className="grid gap-2">
              <button type="button" disabled={pending} onClick={() => run(() => sendRoundAction(outletId, bill.id))} className={`${button} bg-accent text-white`} data-send>
                {m["outlet.send"]}
              </button>
              <button
                type="button"
                disabled={pending || !picked.length}
                onClick={() =>
                  start(async () => {
                    const r = await splitAction(outletId, bill.id, picked);
                    if (r.billId) router.push(`/outlet/${outletId}/bill/${r.billId}`);
                    else setNote({ error: true, text: r.error ?? "" });
                  })
                }
                className={`${button} border border-ink-10`}
                data-split
              >
                {m["outlet.split"]}
              </button>
              <div className="flex gap-2">
                <select value={table} onChange={(e) => setTable(e.target.value)} aria-label={m["outlet.move"]} className="h-11 flex-1 rounded-full border border-ink-10 bg-surface px-3">
                  <option value="">{m["outlet.walkIn"]}</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={pending || table === (bill.tableId ?? "")} onClick={() => run(() => moveAction(outletId, bill.id, table || null))} className={`${button} border border-ink-10`} data-move>
                  {m["outlet.move"]}
                </button>
              </div>
            </div>
          ) : null}
          {open && rights.cash ? (
            <div className="grid gap-2 border-t border-ink-10 pt-3">
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={m["outlet.customer"]} aria-label={m["outlet.customer"]} className="h-11 rounded-full border border-ink-10 bg-surface px-3" />
              <button
                type="button"
                disabled={pending || !bill.lines.length}
                onClick={() =>
                  start(async () => {
                    const r = await payCashAction(outletId, bill.id, customer);
                    if (r.error) setNote({ error: true, text: r.error });
                    router.refresh();
                  })
                }
                className={`${button} bg-success text-white`}
                data-pay-cash
              >
                {m["outlet.payCash"]} · {money(bill.total)}
              </button>
              {rights.serve ? (
                <div className="flex gap-2">
                  <select value={company} onChange={(e) => setCompany(e.target.value)} aria-label={m["outlet.company"]} className="h-11 flex-1 rounded-full border border-ink-10 bg-surface px-3">
                    <option value="">{m["outlet.company"]}</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={pending || !company || !bill.lines.length} onClick={() => run(() => invoiceBillAction(outletId, bill.id, company))} className={`${button} border border-ink-10`} data-invoice>
                    {m["outlet.invoiceCompany"]}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {bill.status === "paid" ? (
            <p data-paid>
              {m["outlet.paid"]}
              {bill.receiptToken ? (
                <>
                  {" · "}
                  <a href={`/receipt/${bill.receiptToken}`} className="text-accent underline" data-receipt>
                    {m["outlet.receipt"]}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {bill.status === "invoiced" ? (
            <p data-invoiced>
              {m["outlet.invoiced"]}
              {bill.invoiceId ? (
                <>
                  {" · "}
                  <a href={`/invoices/${bill.invoiceId}/pdf`} className="text-accent underline">
                    PDF
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
