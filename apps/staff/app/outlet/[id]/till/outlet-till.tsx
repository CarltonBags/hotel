"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { OpResult, OutletOp, OutletSnapshot } from "@hoteloftware/db";
import { eposPrintXml, formatCurrency, roundMoney, ticketsFor, ticketText } from "@hoteloftware/domain";
import type { Messages } from "@/i18n/messages";
import { offlineStore } from "@/lib/offline-store";

const store = offlineStore("hs-outlet");

interface TillLine {
  id: string;
  menuItemId: string;
  description: string;
  quantity: number;
  amount: number;
  printerId: string | null;
  sent: boolean;
}

/** A bill the till worked on since the last sync: one it opened, or an open one of the snapshot it added to. */
interface TillBill {
  id: string;
  /** The bill's number when the server gave it one; a local mark for one opened offline. */
  label: string;
  tableId: string | null;
  /** What was on it at the last sync (an open bill of the snapshot). */
  baseTotal: number;
  lines: TillLine[];
  status: "open" | "paid" | "charged";
  receipt: { at: string; total: number } | null;
}

interface TillState {
  bills: TillBill[];
  ops: OutletOp[];
  problems: { opId: string; error: string }[];
}

const EMPTY: TillState = { bills: [], ops: [], problems: [] };
/** An operation before it gets its id and time (each kind of the union keeps its own fields). */
type OpDraft = OutletOp extends infer O ? (O extends OutletOp ? Omit<O, "opId" | "at"> : never) : never;
const total = (b: TillBill) => roundMoney(b.baseTotal + b.lines.reduce((s, l) => s + l.amount, 0));

/**
 * The till that keeps an outlet selling without a connection (ticket 62):
 * it keeps the last snapshot (menu, tables, printers, open bills, in-house
 * list) and what it did, each step an operation with its own id and time.
 * Offline the round's tickets go straight to the printers on the outlet's
 * network; cash is taken with an offline Receipt; a Room Charge only for a
 * guest on the last list within what was left tonight. Back online the
 * operations are sent in order and the TSE signs afterwards.
 */
export function OutletTill({ outletId, m }: { outletId: string; m: Messages }) {
  const key = (k: string) => `outlet:${outletId}:${k}`;
  const [snap, setSnap] = useState<OutletSnapshot | null>(null);
  const [state, setState] = useState<TillState>(EMPTY);
  const [online, setOnline] = useState(true);
  const [current, setCurrent] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [printed, setPrinted] = useState<{ printer: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const money = (n: number) => (snap ? formatCurrency(n, snap.currency, "de", snap.country) : String(n));

  const change = useCallback(
    async (fn: (s: TillState) => TillState) => {
      const next = await store.update<TillState>(key("state"), (cur) => fn(cur ?? EMPTY));
      setState(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outletId],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/outlet/${outletId}/snapshot`, { cache: "no-store" });
      if (!res.ok) return;
      const s = (await res.json()) as OutletSnapshot;
      await store.save(key("snapshot"), s);
      setSnap(s);
    } catch {
      // offline: the last snapshot stays
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId]);

  // back online: what was done is sent, in order, once
  const sync = useCallback(async () => {
    const s = (await store.load<TillState>(key("state"))) ?? EMPTY;
    if (!s.ops.length || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/outlet/${outletId}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: navigator.userAgent.slice(0, 80), ops: s.ops }) });
      if (!res.ok) return;
      const { results } = (await res.json()) as { results: OpResult[] };
      const done = new Set(results.map((r) => r.opId));
      await change((cur) => ({
        bills: cur.ops.every((o) => done.has(o.opId)) ? [] : cur.bills,
        ops: cur.ops.filter((o) => !done.has(o.opId)),
        problems: [...cur.problems, ...results.filter((r) => !r.ok).map((r) => ({ opId: r.opId, error: r.error ?? "?" }))],
      }));
      await refresh();
    } catch {
      // still offline: tried again when the connection is back
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId, busy, change, refresh]);

  useEffect(() => {
    void (async () => {
      setSnap(await store.load<OutletSnapshot>(key("snapshot")));
      setState((await store.load<TillState>(key("state"))) ?? EMPTY);
      setOnline(navigator.onLine);
      await refresh();
    })();
    const up = () => (setOnline(true), void sync());
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/outlet-sw.js", { scope: "/outlet" }).catch(() => undefined);
    return () => (window.removeEventListener("online", up), window.removeEventListener("offline", down));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId]);

  useEffect(() => {
    if (online && state.ops.length) void sync();
  }, [online, state.ops.length, sync]);

  const op = (o: OpDraft): OutletOp => ({ ...o, opId: crypto.randomUUID(), at: new Date().toISOString() }) as OutletOp;
  const bill = state.bills.find((b) => b.id === current) ?? null;
  const openBills = useMemo(() => {
    const local = state.bills.filter((b) => b.status === "open");
    const fromSnap = (snap?.openBills ?? []).filter((b) => !state.bills.some((x) => x.id === b.id)).map((b) => ({ id: b.id, label: `#${b.number} ${b.label}`, tableId: b.tableId, baseTotal: b.total, lines: [], status: "open" as const, receipt: null }));
    return [...local, ...fromSnap];
  }, [snap, state.bills]);

  if (!snap) return <main className="p-6">{m["outlet.waiting"]}</main>;

  const newBill = (tableId: string | null) =>
    change((s) => {
      const id = crypto.randomUUID();
      setCurrent(id);
      return { ...s, bills: [...s.bills, { id, label: `${m["outlet.offline"]} ${s.bills.length + 1}`, tableId, baseTotal: 0, lines: [], status: "open", receipt: null }], ops: [...s.ops, op({ kind: "open_bill", billId: id, tableId, label: "" })] };
    });
  const take = (b: TillBill) =>
    change((s) => {
      setCurrent(b.id);
      return s.bills.some((x) => x.id === b.id) ? s : { ...s, bills: [...s.bills, b] };
    });
  const add = (itemId: string) =>
    change((s) => {
      const item = snap.menu.find((i) => i.id === itemId)!;
      const line: TillLine = { id: crypto.randomUUID(), menuItemId: item.id, description: item.name, quantity: 1, amount: item.price, printerId: item.printerId, sent: false };
      return { ...s, bills: s.bills.map((b) => (b.id === current ? { ...b, lines: [...b.lines, line] } : b)), ops: [...s.ops, op({ kind: "add_item", billId: current!, lineId: line.id, menuItemId: item.id, quantity: 1, modifiers: [], note: "" })] };
    });
  const send = async () => {
    if (!bill) return;
    const lines = bill.lines.filter((l) => !l.sent);
    if (!lines.length) return;
    const table = snap.tables.find((t) => t.id === bill.tableId)?.name ?? null;
    // the tickets go straight to the printers on the outlet's network
    for (const t of ticketsFor({ outlet: snap.outlet.name, table, bill: 0, round: 0, waiter: "", at: new Date().toISOString() }, lines.map((l) => ({ printerId: l.printerId, description: l.description, quantity: l.quantity, modifiers: [], note: "" })))) {
      const printer = snap.printers.find((p) => p.id === t.printerId);
      const text = ticketText(t);
      if (printer?.address) await fetch(`${printer.address.replace(/\/$/, "")}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=8000`, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8" }, body: eposPrintXml(text), signal: AbortSignal.timeout(10_000) }).catch(() => setPrinted((p) => [...p, { printer: printer.name, text }]));
      else setPrinted((p) => [...p, { printer: printer?.name ?? "", text }]);
    }
    await change((s) => ({
      ...s,
      bills: s.bills.map((b) => (b.id === bill.id ? { ...b, lines: b.lines.map((l) => ({ ...l, sent: true })) } : b)),
      ops: [...s.ops, op({ kind: "send_round", billId: bill.id, roundId: crypto.randomUUID(), lineIds: lines.map((l) => l.id) })],
    }));
  };
  const payCash = () =>
    change((s) => ({
      ...s,
      bills: s.bills.map((b) => (b.id === bill!.id ? { ...b, status: "paid", receipt: { at: new Date().toISOString(), total: total(b) } } : b)),
      ops: [...s.ops, op({ kind: "pay_cash", billId: bill!.id, customerName: "" })],
    }));
  // what the till charged to a stay since the list was taken counts against what was left
  const chargedSince = (reservationId: string) =>
    state.ops.filter((o) => o.kind === "room_charge" && o.reservationId === reservationId).reduce((s, o) => s + total(state.bills.find((b) => b.id === o.billId)!), 0);
  const roomCharge = (reservationId: string) =>
    change((s) => ({ ...s, bills: s.bills.map((b) => (b.id === bill!.id ? { ...b, status: "charged" } : b)), ops: [...s.ops, op({ kind: "room_charge", billId: bill!.id, reservationId, signature: null })] }));

  const button = "h-11 rounded-full px-4 text-sm font-medium disabled:opacity-50";
  const unsent = bill?.lines.some((l) => !l.sent) ?? false;
  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-4" data-till={online ? "online" : "offline"}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-medium">
          {snap.outlet.name} · {m["outlet.till"]}
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <span className={online ? "text-success" : "text-danger"} data-connection>
            {online ? m["outlet.online"] : m["outlet.offline"]}
          </span>
          <span data-pending={state.ops.length}>
            {state.ops.length} {m["outlet.pending"]}
          </span>
          <button type="button" disabled={!online || busy || !state.ops.length} onClick={() => void sync()} className="text-accent underline disabled:opacity-50">
            {m["outlet.syncNow"]}
          </button>
          <span className="text-ink-60">
            {m["outlet.lastSync"]} {snap.syncedAt.slice(11, 16)}
          </span>
          {online ? (
            <Link href={`/outlet/${outletId}`} className="text-accent underline">
              {m["outlet.back"]}
            </Link>
          ) : null}
        </div>
      </header>
      <p className="text-sm text-ink-60">{m["outlet.tillHelp"]}</p>
      {state.problems.length ? (
        <section role="alert" className="rounded-xl bg-danger/10 p-3 text-sm" data-sync-problems>
          <p className="font-medium">{m["outlet.syncProblems"]}</p>
          <ul>
            {state.problems.map((p) => (
              <li key={p.opId}>{p.error}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {printed.length ? (
        <section className="flex flex-wrap gap-2" data-till-printed>
          {printed.map((p, i) => (
            <figure key={i} className="rounded-xl bg-surface-2 p-2 text-xs">
              <figcaption className="text-ink-60">{p.printer}</figcaption>
              <pre className="font-mono">{p.text}</pre>
            </figure>
          ))}
        </section>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
        <section className="grid content-start gap-2" aria-label={m["outlet.tables"]}>
          <button type="button" onClick={() => void newBill(null)} className={`${button} border border-ink-10`} data-till-new>
            + {m["outlet.newBill"]}
          </button>
          {snap.tables.map((t) => (
            <button key={t.id} type="button" onClick={() => void newBill(t.id)} className={`${button} bg-surface-2`}>
              + {t.name}
            </button>
          ))}
          {openBills.map((b) => (
            <button key={b.id} type="button" onClick={() => void take(b)} className={`flex justify-between rounded-xl px-3 py-2 ${b.id === current ? "bg-accent/15" : "bg-surface"}`} data-till-bill={b.label}>
              <span>{b.label}</span>
              <span>{money(total(b))}</span>
            </button>
          ))}
        </section>
        {bill ? (
          <section className="grid content-start gap-3 rounded-2xl bg-surface-2 p-3" data-till-current={bill.status}>
            <h2 className="font-medium">{bill.label}</h2>
            {bill.status === "open" ? (
              <div className="flex flex-wrap gap-2">
                {snap.menu.map((i) => (
                  <button key={i.id} type="button" onClick={() => void add(i.id)} className="min-h-12 rounded-2xl bg-surface px-3 py-1 text-left" data-till-item={i.name}>
                    <span className="block font-medium">{i.name}</span>
                    <span className="text-xs text-ink-60">{money(i.price)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <ul className="grid gap-1 text-sm">
              {bill.lines.map((l) => (
                <li key={l.id} className="flex justify-between" data-till-line={l.description} data-sent={l.sent ? "yes" : ""}>
                  <span>
                    {l.quantity} × {l.description}
                    {l.sent ? "" : ` · ${m["outlet.unsent"]}`}
                  </span>
                  <span>{money(l.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between font-medium">
              <span>{m["outlet.total"]}</span>
              <span>{money(total(bill))}</span>
            </p>
            {bill.status === "open" ? (
              <div className="grid gap-2">
                <button type="button" disabled={!unsent} onClick={() => void send()} className={`${button} bg-accent text-white`} data-till-send>
                  {m["outlet.send"]}
                </button>
                <button type="button" disabled={unsent || total(bill) <= 0} onClick={() => void payCash()} className={`${button} bg-success text-white`} data-till-cash>
                  {m["outlet.payCash"]} · {money(total(bill))}
                </button>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m["outlet.findGuest"]} aria-label={m["outlet.findGuest"]} className="h-11 rounded-full border border-ink-10 bg-surface px-3" />
                {query.trim()
                  ? (() => {
                      const hits = snap.inHouse.filter((g) => g.room === query.trim() || g.lastName.toLowerCase().startsWith(query.trim().toLowerCase()));
                      if (!hits.length) return <p className="text-sm text-danger">{m["outlet.notOnList"]}</p>;
                      return hits.map((g) => {
                        const left = roundMoney(g.remaining - chargedSince(g.reservationId));
                        const ok = !unsent && total(bill) <= left;
                        return (
                          <button key={g.reservationId} type="button" disabled={!ok} onClick={() => void roomCharge(g.reservationId)} className="flex justify-between rounded-xl bg-surface px-3 py-2 disabled:opacity-50" data-till-guest={g.room ?? ""}>
                            <span>
                              {g.room ?? "–"} · {g.lastName}
                            </span>
                            <span className="text-sm">{total(bill) <= left ? `${money(left)} ${m["outlet.left"]}` : m["outlet.overLimit"]}</span>
                          </button>
                        );
                      });
                    })()
                  : null}
              </div>
            ) : null}
            {bill.receipt ? (
              <p className="rounded-xl bg-surface p-3 text-sm" data-till-receipt>
                {m["outlet.offlineReceipt"]} · {money(bill.receipt.total)} · {bill.receipt.at.slice(11, 16)}
              </p>
            ) : null}
            {bill.status === "charged" ? <p data-till-charged>{m["outlet.room"]}</p> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
