"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RoomChargeGuest } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import type { ApprovalMode, ApprovalState } from "@/lib/approval";
import { cancelCardAction, invoiceBillAction, payCashAction, payVoucherAction, pollCardAction, refundOutletAction, roomChargeAction, roomGuestsAction, simulateCardAction, startCardAction } from "../../../actions";

type Tab = "cash" | "card" | "voucher" | "room" | "account";

interface Props {
  outletId: string;
  billId: string;
  due: number;
  /** A card payment still waiting at the device (after a reload). */
  pendingPaymentId: string | null;
  readers: { readerId: string; label: string; kind: "reader" | "phone" }[];
  companies: { id: string; name: string }[];
  testMode: boolean;
  rights: { serve: boolean };
  money: (n: number) => string;
  m: Messages;
}

/** An action an Outlet Manager may have to approve: approved here with their credentials, or asked for remotely. */
export function ApprovalPrompt({ summary, onApprove, m }: { summary: string; onApprove: (mode: ApprovalMode) => void; m: Messages }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const input = "h-10 rounded-lg border border-ink-10 bg-surface px-2";
  return (
    <div className="grid gap-2 rounded-xl bg-warning/15 p-3 text-sm" data-approval>
      <p>{summary}</p>
      <span className="text-ink-80">{m["outlet.approveHere"]}</span>
      <div className="flex flex-wrap gap-2">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={m["outlet.username"]} aria-label={m["outlet.username"]} autoComplete="off" className={input} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={m["outlet.password"]} aria-label={m["outlet.password"]} autoComplete="off" className={input} />
        <button type="button" onClick={() => onApprove({ mode: "credentials", username, password })} className="h-10 rounded-full bg-accent px-4 font-medium text-white" data-approve>
          {m["outlet.approve"]}
        </button>
        <button type="button" onClick={() => onApprove({ mode: "request" })} className="h-10 rounded-full border border-ink-10 px-4">
          {m["outlet.askRemote"]}
        </button>
      </div>
    </div>
  );
}

/** Close a bill: cash, card on a reader or tap to pay, Voucher, Room Charge, or on account to a Company (ticket 61). */
export function PayPanel({ outletId, billId, due, pendingPaymentId, readers, companies, testMode, rights, money, m }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(pendingPaymentId ? "card" : "cash");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [customer, setCustomer] = useState("");
  const [reader, setReader] = useState(readers[0]?.readerId ?? "");
  const [tip, setTip] = useState("");
  const [waiting, setWaiting] = useState<string | null>(pendingPaymentId);
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState<RoomChargeGuest[]>([]);
  const [guest, setGuest] = useState<RoomChargeGuest | null>(null);
  const [company, setCompany] = useState("");
  const [approval, setApproval] = useState<{ summary: string; retry: (mode: ApprovalMode) => void } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const phone = readers.find((r) => r.readerId === reader)?.kind === "phone";
  const done = (r: { error?: string; message?: string }) => {
    setNote(r.error ? { error: true, text: r.error } : r.message ? { error: false, text: r.message } : null);
    router.refresh();
  };
  const withApproval = (run: (mode?: ApprovalMode) => Promise<ApprovalState>) =>
    start(async () => {
      const r = await run();
      if (r.approval) setApproval({ summary: r.approval.summary, retry: (mode) => start(async () => (setApproval(null), done(await run(mode)))) });
      else done(r);
    });

  // the payment waits at the reader or phone: polled until it settles
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      const r = await pollCardAction(outletId, billId, waiting);
      if (r.status !== "pending") {
        setWaiting(null);
        done(r.status === "succeeded" ? {} : { error: r.error ?? "The card did not go through" });
      }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, outletId, billId]);

  // the guest's signature on the device: strokes between the points, in the canvas's own pixels whatever its size on screen
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons !== 1 || !canvas.current) return (last.current = null);
    const c = canvas.current.getContext("2d")!;
    const r = canvas.current.getBoundingClientRect();
    const at = { x: ((e.clientX - r.left) * canvas.current.width) / r.width, y: ((e.clientY - r.top) * canvas.current.height) / r.height };
    c.strokeStyle = "#111";
    c.lineWidth = 2;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(last.current?.x ?? at.x, last.current?.y ?? at.y);
    c.lineTo(at.x, at.y);
    c.stroke();
    last.current = at;
    drawn.current = true;
  };

  const tabs: [Tab, string][] = [
    ["cash", m["outlet.cash"]],
    ["card", m["outlet.card"]],
    ["voucher", m["outlet.voucher"]],
    ["room", m["outlet.room"]],
    ...(rights.serve ? ([["account", m["outlet.account"]]] as [Tab, string][]) : []),
  ];
  const button = "h-11 rounded-full px-4 text-sm font-medium disabled:opacity-50";
  const input = "h-11 rounded-full border border-ink-10 bg-surface px-3";
  return (
    <div className="grid gap-3 border-t border-ink-10 pt-3" data-pay-panel>
      <p className="flex justify-between font-medium" data-due={due}>
        <span>{m["outlet.due"]}</span>
        <span>{money(due)}</span>
      </p>
      <div className="flex flex-wrap gap-1" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-9 rounded-full px-3 text-sm ${tab === id ? "bg-ink-90 text-surface" : "bg-surface"}`} data-pay-tab={id}>
            {label}
          </button>
        ))}
      </div>
      {note ? (
        <p role={note.error ? "alert" : "status"} className={note.error ? "text-danger" : "text-ink-60"}>
          {note.text}
        </p>
      ) : null}
      {approval ? <ApprovalPrompt summary={approval.summary} onApprove={approval.retry} m={m} /> : null}
      {tab === "cash" || tab === "voucher" ? (
        <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={m["outlet.customer"]} aria-label={m["outlet.customer"]} className={input} />
      ) : null}
      {tab === "cash" ? (
        <button type="button" disabled={pending || due <= 0} onClick={() => start(async () => done(await payCashAction(outletId, billId, customer)))} className={`${button} bg-success text-white`} data-pay-cash>
          {m["outlet.payCash"]} · {money(due)}
        </button>
      ) : null}
      {tab === "voucher" ? (
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={m["outlet.voucherCode"]} aria-label={m["outlet.voucherCode"]} className={`${input} flex-1`} />
          <button type="button" disabled={pending || !code.trim()} onClick={() => start(async () => done(await payVoucherAction(outletId, billId, code, customer)))} className={`${button} bg-accent text-white`} data-pay-voucher>
            {m["outlet.charge"]}
          </button>
        </div>
      ) : null}
      {tab === "card" ? (
        waiting ? (
          <div className="grid gap-2" data-card-waiting>
            <p>{m["outlet.waiting"]}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => start(async () => (setWaiting(null), done(await cancelCardAction(outletId, billId, waiting))))} className={`${button} border border-ink-10`}>
                {m["outlet.cancelPayment"]}
              </button>
              {testMode
                ? (["visa", "girocard"] as const).map((brand) => (
                    <button key={brand} type="button" onClick={() => start(async () => void (await simulateCardAction(outletId, billId, waiting, { brand, ...(phone ? {} : { tip: 2 }) })))} className={`${button} border border-ink-10`} data-test-card={brand}>
                      {m["outlet.testCard"]} {brand}
                      {phone ? "" : " +2"}
                    </button>
                  ))
                : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <select value={reader} onChange={(e) => setReader(e.target.value)} aria-label={m["outlet.device"]} className={input}>
              {readers.map((r) => (
                <option key={r.readerId} value={r.readerId}>
                  {r.label}
                  {r.kind === "phone" ? ` (${m["outlet.phone"]})` : ""}
                </option>
              ))}
            </select>
            {phone ? <input value={tip} onChange={(e) => setTip(e.target.value)} inputMode="decimal" placeholder={m["outlet.tip"]} aria-label={m["outlet.tip"]} className={input} /> : null}
            <button
              type="button"
              disabled={pending || !reader || due <= 0}
              onClick={() =>
                start(async () => {
                  const r = await startCardAction(outletId, billId, reader, Number(tip.replace(",", ".")) || 0);
                  if (r.paymentId) setWaiting(r.paymentId);
                  else done(r);
                })
              }
              className={`${button} bg-accent text-white`}
              data-pay-card
            >
              {m["outlet.charge"]} · {money(due + (phone ? Number(tip.replace(",", ".")) || 0 : 0))}
            </button>
          </div>
        )
      ) : null}
      {tab === "room" ? (
        <div className="grid gap-2" data-room-charge>
          <input
            value={query}
            onChange={(e) => {
              const q = e.target.value;
              setQuery(q);
              setGuest(null);
              if (q.trim()) start(async () => setGuests(await roomGuestsAction(outletId, q)));
            }}
            placeholder={m["outlet.findGuest"]}
            aria-label={m["outlet.findGuest"]}
            className={input}
          />
          <ul className="grid gap-1">
            {guests.map((g) => (
              <li key={g.reservationId}>
                <button type="button" disabled={!g.allowed} onClick={() => setGuest(g)} className={`flex w-full justify-between rounded-xl px-3 py-2 text-left ${guest?.reservationId === g.reservationId ? "bg-accent/15" : "bg-surface"} disabled:opacity-50`} data-room-guest={g.room ?? ""}>
                  <span>
                    {g.room ?? "–"} · {g.lastName}
                  </span>
                  <span className="text-sm">{g.allowed ? `${money(g.remaining)} ${m["outlet.left"]}` : m["outlet.noRoomCharge"]}</span>
                </button>
              </li>
            ))}
          </ul>
          {guest ? (
            <>
              <span className="text-sm text-ink-60">{m["outlet.sign"]}</span>
              <canvas ref={canvas} width={320} height={110} onPointerMove={draw} onPointerUp={() => (last.current = null)} className="touch-none rounded-xl border border-ink-10 bg-white" aria-label={m["outlet.sign"]} />
              <div className="flex gap-2">
                <button type="button" onClick={() => (canvas.current?.getContext("2d")?.clearRect(0, 0, 320, 110), (drawn.current = false))} className={`${button} border border-ink-10`}>
                  {m["outlet.clear"]}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const signature = drawn.current ? (canvas.current?.toDataURL("image/png") ?? null) : null;
                    withApproval((mode) => roomChargeAction(outletId, billId, guest.reservationId, signature, mode));
                  }}
                  className={`${button} flex-1 bg-accent text-white`}
                  data-charge-room
                >
                  {m["outlet.chargeRoom"]} · {money(due)}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {tab === "account" ? (
        <div className="flex gap-2">
          <select value={company} onChange={(e) => setCompany(e.target.value)} aria-label={m["outlet.company"]} className={`${input} flex-1`}>
            <option value="">{m["outlet.company"]}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={pending || !company} onClick={() => start(async () => done(await invoiceBillAction(outletId, billId, company)))} className={`${button} border border-ink-10`} data-invoice>
            {m["outlet.invoiceCompany"]}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Money back on a paid bill: by its own tender, with a reason; Service and Spa Staff need an Outlet Manager's Approval (ticket 61). */
export function RefundPanel({ outletId, billId, payments, money, m }: { outletId: string; billId: string; payments: { id: string; tender: string; amount: number; refunded: number }[]; money: (n: number) => string; m: Messages }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [payment, setPayment] = useState(payments[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [approval, setApproval] = useState<{ summary: string; retry: (mode: ApprovalMode) => void } | null>(null);
  const run = (mode?: ApprovalMode) =>
    start(async () => {
      const r = await refundOutletAction(outletId, billId, payment, Number(amount.replace(",", ".")), reason, mode);
      if (r.approval) setApproval({ summary: r.approval.summary, retry: (md) => (setApproval(null), run(md)) });
      else {
        setNote(r.error ? { error: true, text: r.error } : { error: false, text: r.message ?? "" });
        if (!r.error) router.refresh();
      }
    });
  const input = "h-10 rounded-full border border-ink-10 bg-surface px-3";
  if (!payments.length) return null;
  return (
    <div className="grid gap-2 border-t border-ink-10 pt-3" data-refund-panel>
      <select value={payment} onChange={(e) => setPayment(e.target.value)} aria-label={m["outlet.refund"]} className={input}>
        {payments.map((p) => (
          <option key={p.id} value={p.id}>
            {p.tender} · {money(p.amount)}
            {p.refunded ? ` (−${money(p.refunded)})` : ""}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={m["outlet.price"]} aria-label={m["outlet.price"]} className={`${input} w-28`} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={m["outlet.voidReason"]} aria-label={m["outlet.voidReason"]} className={`${input} flex-1`} />
        <button type="button" disabled={pending || !amount || !reason.trim()} onClick={() => run()} className="h-10 rounded-full border border-ink-10 px-4 text-sm font-medium" data-refund>
          {m["outlet.refund"]}
        </button>
      </div>
      {approval ? <ApprovalPrompt summary={approval.summary} onApprove={approval.retry} m={m} /> : null}
      {note ? <p role={note.error ? "alert" : "status"} className={note.error ? "text-danger" : "text-ink-60"}>{note.text}</p> : null}
    </div>
  );
}
