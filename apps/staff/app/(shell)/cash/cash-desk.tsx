"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Lock, Unlock } from "lucide-react";
import { formatCurrency, type CashCount, type CashMovementKind, type Language } from "@hoteloftware/domain";
import type { CloseResult } from "@hoteloftware/db";
import { ApprovalPrompt } from "@/components/approval-prompt";
import { fill, type Messages } from "@/i18n/messages";
import type { ApprovalMode } from "@/lib/approval";
import type { FormState } from "@/lib/form";
import { closeCountAction, closeWithReasonAction, openShiftAction, registerMovementAction, shiftMovementAction } from "./actions";

interface Props {
  property: { id: string; name: string; currency: string; country: string; timeZone: string };
  denominations: number[];
  paidOutLimit: number;
  rights: { handle: boolean; paidOut: boolean; manage: boolean };
  shift: { id: string; registerId: string; registerName: string; openedAt: string; openingFloat: number; count: { counted: number; expected: number; difference: number } | null } | null;
  registers: { id: string; name: string; active: boolean; balance: number; openBy: string | null }[];
  book: {
    registerId: string;
    name: string;
    balance: number;
    ownShiftOnly: boolean;
    rows: { id: string; at: string; kind: CashMovementKind; amount: number; balance: number; reason: string; account: string; byUser: string; approvedBy: string | null; confirmationNumber: string | null; hasPhoto: boolean }[];
  } | null;
  language: Language;
  m: Messages;
}

const box = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
const input = "h-10 rounded-xl border border-ink-10 bg-surface px-3 text-sm";
const primary = "h-10 rounded-full bg-accent px-5 text-sm font-medium text-white disabled:opacity-50";

/** Notes and coins counted one by one; the total adds up as you type. */
function CountGrid({ denominations, count, setCount, money, m }: { denominations: number[]; count: CashCount; setCount: (c: CashCount) => void; money: (n: number) => string; m: Messages }) {
  const total = denominations.reduce((s, d) => s + Math.round(d * 100) * (count[String(d)] ?? 0), 0) / 100;
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {denominations.map((d) => (
          <label key={d} className="grid gap-1 text-xs">
            <span className="text-ink-60">{money(d)}</span>
            <input
              inputMode="numeric"
              aria-label={`${m["cash.pieces"]} ${money(d)}`}
              data-denomination={d}
              value={count[String(d)] ?? ""}
              onChange={(e) => {
                const n = e.target.value.replace(/\D/g, "");
                const next = { ...count };
                if (n === "") delete next[String(d)];
                else next[String(d)] = Number(n);
                setCount(next);
              }}
              className={`${input} w-full`}
            />
          </label>
        ))}
      </div>
      <p className="font-medium" data-count-total={total}>
        {m["cash.counted"]}: {money(total)}
      </p>
    </div>
  );
}

/** A photo of the paper receipt, made smaller in the browser. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
}

export function CashDesk({ property, denominations, paidOutLimit, rights, shift, registers, book, language, m }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<FormState | null>(null);
  const money = (n: number) => formatCurrency(n, property.currency, language, property.country);
  const when = (iso: string) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone }).format(new Date(iso));
  const run = (fn: () => Promise<FormState>, after?: (r: FormState) => void) =>
    startTransition(async () => {
      const r = await fn();
      setNote(r);
      after?.(r);
      router.refresh();
    });

  // opening
  const free = registers.filter((r) => r.active && !r.openBy);
  const [registerId, setRegisterId] = useState(free[0]?.id ?? "");
  const [openCount, setOpenCount] = useState<CashCount>({});
  // closing: the count first, the expected amount only after it
  const [closeCount, setCloseCount] = useState<CashCount>({});
  const [result, setResult] = useState<CloseResult | null>(shift?.count ? { ...shift.count, needsReason: true, closed: false } : null);
  const [reason, setReason] = useState("");
  // movements from the Shift
  const [tab, setTab] = useState<"paid_out" | "tip_out" | "close" | null>(null);
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState("");
  const [account, setAccount] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [approval, setApproval] = useState<string | null>(null);
  const resetMovement = () => (setAmount(""), setWhy(""), setAccount(""), setPhoto(null), setApproval(null));
  const movement = (mode?: ApprovalMode) =>
    startTransition(async () => {
      const kind = tab === "tip_out" ? "tip_out" : "paid_out";
      const r = await shiftMovementAction(
        property.id,
        kind === "paid_out" ? { kind, registerId: shift!.registerId, amount: Number(amount.replace(",", ".")), reason: why, account, photo } : { kind, registerId: shift!.registerId, amount: Number(amount.replace(",", ".")), reason: why },
        mode,
      );
      setNote(r);
      setApproval(r.approval?.summary ?? null);
      if (r.ok) {
        resetMovement();
        setTab(null);
      }
      router.refresh();
    });

  // register movements (Property Manager, Accounting)
  const [regKind, setRegKind] = useState<"deposit" | "change_in" | "transfer">("deposit");
  const [regAmount, setRegAmount] = useState("");
  const [regReason, setRegReason] = useState("");
  const [toRegister, setToRegister] = useState("");

  const label = (k: CashMovementKind) => m[`cash.kind.${k}`];

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.cash_book"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
      </div>
      {note?.error ? (
        <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
          {note.error}
        </p>
      ) : note?.message ? (
        <p role="status" className="rounded-xl bg-surface-2 p-3 text-sm">
          {note.message}
        </p>
      ) : null}

      {rights.handle ? (
        <section aria-label={m["cash.myShift"]} className={box}>
          <h2 className="flex items-center gap-2 font-medium">
            {shift ? <Unlock size={16} /> : <Lock size={16} />}
            {shift ? fill(m["cash.shiftOn"], { register: shift.registerName, since: when(shift.openedAt) }) : m["cash.noShift"]}
          </h2>
          {!shift ? (
            free.length === 0 ? (
              <p className="text-ink-60">{m["cash.noFreeRegister"]}</p>
            ) : (
              <>
                <label className="grid max-w-xs gap-1">
                  <span className="text-ink-80">{m["cash.register"]}</span>
                  <select value={registerId} onChange={(e) => setRegisterId(e.target.value)} className={input}>
                    {free.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-ink-60">{m["cash.countFloat"]}</p>
                <CountGrid denominations={denominations} count={openCount} setCount={setOpenCount} money={money} m={m} />
                <button type="button" disabled={pending || !registerId} onClick={() => run(() => openShiftAction(property.id, registerId, openCount), (r) => r.ok && setOpenCount({}))} className={`${primary} justify-self-start`}>
                  {m["cash.openShift"]}
                </button>
              </>
            )
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {!result ? (
                  <>
                    {rights.paidOut ? (
                      <button type="button" aria-pressed={tab === "paid_out"} onClick={() => (resetMovement(), setTab(tab === "paid_out" ? null : "paid_out"))} className="h-9 rounded-full bg-surface px-4">
                        {m["cash.kind.paid_out"]}
                      </button>
                    ) : null}
                    <button type="button" aria-pressed={tab === "tip_out"} onClick={() => (resetMovement(), setTab(tab === "tip_out" ? null : "tip_out"))} className="h-9 rounded-full bg-surface px-4">
                      {m["cash.kind.tip_out"]}
                    </button>
                  </>
                ) : null}
                {!result ? (
                  <button type="button" aria-pressed={tab === "close"} onClick={() => setTab(tab === "close" ? null : "close")} className="h-9 rounded-full bg-ink px-4 text-canvas">
                    {m["cash.closeShift"]}
                  </button>
                ) : null}
              </div>

              {tab === "paid_out" || tab === "tip_out" ? (
                <div className="grid gap-2 rounded-xl bg-surface p-3">
                  <div className="flex flex-wrap gap-2">
                    <input aria-label={m["cash.amount"]} placeholder={m["cash.amount"]} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))} className={`${input} w-32`} />
                    <input aria-label={m["cash.reason"]} placeholder={tab === "tip_out" ? m["cash.tipTo"] : m["cash.reason"]} value={why} onChange={(e) => setWhy(e.target.value)} className={`${input} min-w-48 flex-1`} />
                    {tab === "paid_out" ? <input aria-label={m["cash.account"]} placeholder={m["cash.account"]} value={account} onChange={(e) => setAccount(e.target.value)} className={`${input} w-32`} /> : null}
                  </div>
                  {tab === "paid_out" ? (
                    <>
                      <label className="flex cursor-pointer items-center gap-2 text-accent">
                        <Camera size={16} /> {photo ? m["cash.photoTaken"] : m["cash.photo"]}
                        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && void shrink(e.target.files[0]).then(setPhoto)} />
                      </label>
                      <p className="text-xs text-ink-60">{fill(m["cash.limitHint"], { limit: money(paidOutLimit) })}</p>
                    </>
                  ) : null}
                  {approval ? (
                    <ApprovalPrompt summary={approval} pending={pending} onRequest={() => movement({ mode: "request" })} onCredentials={(username, password) => movement({ mode: "credentials", username, password })} m={m} />
                  ) : null}
                  <button type="button" disabled={pending || !amount || !why.trim() || (tab === "paid_out" && !account.trim())} onClick={() => movement()} className={`${primary} justify-self-start`}>
                    {m["cash.book"]}
                  </button>
                </div>
              ) : null}

              {tab === "close" || result ? (
                <div className="grid gap-2 rounded-xl bg-surface p-3">
                  {!result ? (
                    <>
                      <p className="text-ink-60">{m["cash.blindHint"]}</p>
                      <CountGrid denominations={denominations} count={closeCount} setCount={setCloseCount} money={money} m={m} />
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const r = await closeCountAction(property.id, shift.id, closeCount);
                            setNote(r.error ? r : r.result?.closed ? { ok: true, message: m["cash.closed"] } : null);
                            if (r.result) setResult(r.result);
                            router.refresh();
                          })
                        }
                        className={`${primary} justify-self-start`}
                      >
                        {m["cash.enterCount"]}
                      </button>
                    </>
                  ) : (
                    <>
                      <dl data-testid="count-result" className="grid grid-cols-3 gap-2">
                        <div>
                          <dt className="text-xs text-ink-60">{m["cash.counted"]}</dt>
                          <dd className="font-medium">{money(result.counted)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-ink-60">{m["cash.expected"]}</dt>
                          <dd className="font-medium">{money(result.expected)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-ink-60">{m["cash.difference"]}</dt>
                          <dd className={`font-medium ${result.needsReason ? "text-danger" : ""}`}>{money(result.difference)}</dd>
                        </div>
                      </dl>
                      {!result.closed ? (
                        <>
                          <p className="text-danger">{m["cash.reasonNeeded"]}</p>
                          <input aria-label={m["cash.differenceReason"]} placeholder={m["cash.differenceReason"]} value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
                          <button
                            type="button"
                            disabled={pending || !reason.trim()}
                            onClick={() => run(() => closeWithReasonAction(property.id, shift.id, reason), (r) => r.ok && (setResult(null), setTab(null), setReason("")))}
                            className={`${primary} justify-self-start`}
                          >
                            {m["cash.closeWithReason"]}
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {rights.manage ? (
        <section aria-label={m["cash.registers"]} className={box}>
          <h2 className="font-medium">{m["cash.registers"]}</h2>
          <ul className="grid gap-1 sm:grid-cols-2">
            {registers.map((r) => (
              <li key={r.id}>
                <Link href={`/cash?register=${r.id}`} data-register={r.name} aria-current={book?.registerId === r.id ? "page" : undefined} className={`flex justify-between rounded-xl px-3 py-2 ${book?.registerId === r.id ? "bg-surface font-medium" : "hover:bg-surface"}`}>
                  <span>
                    {r.name}
                    {r.openBy ? <span className="text-xs text-ink-60"> · {fill(m["cash.openByName"], { name: r.openBy })}</span> : null}
                  </span>
                  <span className="tabular-nums">{money(r.balance)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {book ? (
            <div className="flex flex-wrap items-end gap-2 rounded-xl bg-surface p-3">
              <select aria-label={m["cash.movement"]} value={regKind} onChange={(e) => setRegKind(e.target.value as typeof regKind)} className={input}>
                {(["deposit", "change_in", "transfer"] as const).map((k) => (
                  <option key={k} value={k}>
                    {m[`cash.reg.${k}`]}
                  </option>
                ))}
              </select>
              {regKind === "transfer" ? (
                <select aria-label={m["cash.to"]} value={toRegister} onChange={(e) => setToRegister(e.target.value)} className={input}>
                  <option value="">{m["cash.to"]}</option>
                  {registers
                    .filter((r) => r.id !== book.registerId && r.active)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              ) : null}
              <input aria-label={m["cash.amount"]} placeholder={m["cash.amount"]} inputMode="decimal" value={regAmount} onChange={(e) => setRegAmount(e.target.value.replace(/[^0-9.,]/g, ""))} className={`${input} w-28`} />
              <input aria-label={m["cash.reason"]} placeholder={m["cash.reason"]} value={regReason} onChange={(e) => setRegReason(e.target.value)} className={`${input} min-w-40 flex-1`} />
              <button
                type="button"
                disabled={pending || !regAmount || !regReason.trim() || (regKind === "transfer" && !toRegister)}
                onClick={() =>
                  run(
                    () =>
                      registerMovementAction(
                        property.id,
                        regKind === "transfer"
                          ? { kind: "transfer", registerId: book.registerId, toRegisterId: toRegister, amount: Number(regAmount.replace(",", ".")), reason: regReason }
                          : { kind: regKind, registerId: book.registerId, amount: Number(regAmount.replace(",", ".")), reason: regReason },
                      ),
                    (r) => r.ok && (setRegAmount(""), setRegReason("")),
                  )
                }
                className={primary}
              >
                {m["cash.book"]}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {book ? (
        <section aria-label={m["module.cash_book"]} className={box}>
          <h2 className="flex justify-between font-medium">
            <span>{book.ownShiftOnly ? fill(m["cash.bookOfShift"], { register: book.name }) : fill(m["cash.bookOf"], { register: book.name })}</span>
            <span data-book-balance={book.balance}>{money(book.balance)}</span>
          </h2>
          <table className="w-full text-left">
            <thead className="text-xs text-ink-60">
              <tr>
                <th className="py-1">{m["cash.when"]}</th>
                <th>{m["cash.movement"]}</th>
                <th>{m["cash.reason"]}</th>
                <th>{m["cash.by"]}</th>
                <th className="text-right">{m["cash.amount"]}</th>
                <th className="text-right">{m["cash.balance"]}</th>
              </tr>
            </thead>
            <tbody>
              {book.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-2 text-ink-60">
                    {m["cash.empty"]}
                  </td>
                </tr>
              ) : null}
              {book.rows.map((r) => (
                <tr key={r.id} data-movement={r.kind} className="border-t border-ink-5">
                  <td className="py-1 whitespace-nowrap">{when(r.at)}</td>
                  <td>{label(r.kind)}</td>
                  <td>
                    {r.confirmationNumber ? `${r.confirmationNumber} ` : ""}
                    {r.reason}
                    {r.account ? ` · ${r.account}` : ""}
                    {r.approvedBy ? ` · ${m["cash.approved"]}` : ""}
                    {r.hasPhoto ? (
                      <a href={`/cash-photo/${r.id}`} target="_blank" rel="noreferrer" className="ml-1 text-accent underline">
                        {m["cash.receiptPhoto"]}
                      </a>
                    ) : null}
                  </td>
                  <td>{r.byUser}</td>
                  <td className={`text-right tabular-nums ${r.amount < 0 ? "text-danger" : ""}`}>{money(r.amount)}</td>
                  <td className="text-right tabular-nums">{money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
