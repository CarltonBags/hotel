"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MenuItem, OutletBillView } from "@hoteloftware/db";
import { formatCurrency } from "@hoteloftware/domain";
import type { Messages } from "@/i18n/messages";
import type { ApprovalMode, ApprovalState } from "@/lib/approval";
import { addItemAction, discountAction, moveAction, removeLineAction, sendRoundAction, splitAction, voidLineAction } from "../../../actions";
import { ApprovalPrompt, PayPanel, RefundPanel } from "./pay-panel";

interface Props {
  bill: OutletBillView;
  menu: MenuItem[];
  tables: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  currency: { code: string; country: string };
  rights: { serve: boolean; cash: boolean };
  readers: { readerId: string; label: string; kind: "reader" | "phone" }[];
  testMode: boolean;
  m: Messages;
}

/** One bill on the outlet device: the menu to tap, the items with their round, and what closes it. */
export function BillScreen({ bill, menu, tables, companies, currency, rights, readers, testMode, m }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [item, setItem] = useState<MenuItem | null>(null);
  const [qty, setQty] = useState(1);
  const [mods, setMods] = useState<string[]>([]);
  const [itemNote, setItemNote] = useState("");
  const [table, setTable] = useState(bill.tableId ?? "");
  const [discount, setDiscount] = useState(String(bill.discountPercent || ""));
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [approval, setApproval] = useState<{ summary: string; retry: (mode: ApprovalMode) => void } | null>(null);
  // an action an Outlet Manager may have to approve
  const approved = (act: (mode?: ApprovalMode) => Promise<ApprovalState>, after?: () => void) =>
    start(async () => {
      const r = await act();
      if (r.approval) setApproval({ summary: r.approval.summary, retry: (mode) => (setApproval(null), approved(() => act(mode), after)) });
      else {
        setNote(r.error ? { error: true, text: r.error } : r.message ? { error: false, text: r.message } : null);
        if (!r.error) (after?.(), router.refresh());
      }
    });
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
              <li key={l.id} className={`flex items-start gap-2${l.voided ? " text-ink-60 line-through" : ""}`} data-line={l.description} data-round={l.round ?? ""} data-voided={l.voided ? "yes" : ""}>
                {open && !l.voided ? <input type="checkbox" aria-label={l.description} checked={picked.includes(l.id)} onChange={(e) => setPicked((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} /> : null}
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
                {open && l.round && !l.voided ? (
                  <button type="button" onClick={() => (setVoiding(l.id), setReason(""))} className="text-xs text-danger" data-void={l.description}>
                    {m["outlet.void"]}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {voiding ? (
            <div className="flex gap-2" data-void-reason>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={m["outlet.voidReason"]} aria-label={m["outlet.voidReason"]} className="h-10 flex-1 rounded-full border border-ink-10 bg-surface px-3" />
              <button type="button" disabled={pending || !reason.trim()} onClick={() => approved((mode) => voidLineAction(outletId, bill.id, voiding, reason, mode), () => setVoiding(null))} className="h-10 rounded-full bg-danger px-4 text-sm font-medium text-white" data-void-confirm>
                {m["outlet.void"]}
              </button>
            </div>
          ) : null}
          {approval ? <ApprovalPrompt summary={approval.summary} onApprove={approval.retry} m={m} /> : null}
          <p className="flex justify-between text-lg font-medium" data-total={bill.total}>
            <span>{m["outlet.total"]}</span>
            <span>{money(bill.total)}</span>
          </p>
          {bill.discount ? (
            <p className="flex justify-between text-sm" data-discount={bill.discount}>
              <span>
                {m["outlet.discount"]} {bill.discountPercent}
              </span>
              <span>−{money(bill.discount)}</span>
            </p>
          ) : null}
          {bill.tip ? (
            <p className="flex justify-between text-sm" data-tip={bill.tip}>
              <span>{m["outlet.tipLine"]}</span>
              <span>{money(bill.tip)}</span>
            </p>
          ) : null}
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
          {open && rights.serve ? (
            <div className="flex gap-2">
              <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder={m["outlet.discount"]} aria-label={m["outlet.discount"]} className="h-11 w-28 rounded-full border border-ink-10 bg-surface px-3" />
              <button type="button" disabled={pending} onClick={() => approved((mode) => discountAction(outletId, bill.id, Number(discount.replace(",", ".")) || 0, mode))} className="h-11 rounded-full border border-ink-10 px-4 text-sm font-medium" data-set-discount>
                {m["outlet.setDiscount"]}
              </button>
            </div>
          ) : null}
          {(open || bill.status === "paying") && rights.cash ? (
            <PayPanel outletId={outletId} billId={bill.id} due={bill.due} pendingPaymentId={bill.pendingPaymentId} readers={readers} companies={companies} testMode={testMode} rights={{ serve: rights.serve }} money={money} m={m} />
          ) : null}
          {bill.status === "paid" && rights.cash ? <RefundPanel outletId={outletId} billId={bill.id} payments={bill.payments} money={money} m={m} /> : null}
          {bill.status === "charged" && bill.roomCharge ? (
            <p data-charged>
              {m["outlet.room"]} · {bill.roomCharge.room ?? "–"} · {bill.roomCharge.guest} ·{" "}
              {/* the slip the guest signs when not on the device */}
              <a href={`/outlet/${outletId}/bill/${bill.id}/slip`} className="text-accent underline" data-slip>
                {m["outlet.slip"]}
              </a>
            </p>
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
