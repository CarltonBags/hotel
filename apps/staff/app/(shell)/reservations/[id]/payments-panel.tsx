"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DESK_TENDERS, captureAmount, formatCurrency, type Language } from "@hoteloftware/domain";
import type { CardHold, Payment } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { useFormAction } from "../use-form-action";
import { ApprovalPrompt } from "@/components/approval-prompt";
import type { ApprovalMode } from "@/lib/approval";
import {
  cancelPaymentAction,
  captureHoldAction,
  coverBalanceAction,
  holdStatusAction,
  incrementHoldAction,
  paymentStatusAction,
  placeHoldAction,
  refundAction,
  releaseHoldAction,
  simulateCardAction,
  takePaymentAction,
} from "../payment-actions";

const input = "h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm";
const button = "h-9 rounded-full px-4 text-sm font-medium";
const secondary = `${button} border border-ink-10 bg-surface hover:bg-ink-5`;

interface Common {
  reservationId: string;
  propertyId: string;
  readers: { readerId: string; label: string }[];
  testMode: boolean;
  currency: { code: string; language: Language; country: string };
  m: Messages;
}

/** The reader this workstation uses, remembered in this browser per property. */
function useWorkstationReader(propertyId: string, readers: { readerId: string }[]): [string, (id: string) => void] {
  const key = `hs:reader:${propertyId}`;
  const [reader, setReader] = useState("");
  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(key) ?? "";
    } catch {
      // storage blocked: the first reader serves
    }
    setReader(readers.some((r) => r.readerId === saved) ? saved : (readers[0]?.readerId ?? ""));
  }, [key, readers]);
  const choose = (id: string) => {
    setReader(id);
    try {
      localStorage.setItem(key, id);
    } catch {
      // storage blocked: the choice holds for this page
    }
  };
  return [reader, choose];
}

/** Poll the provider for what waits at the reader, until it settles; then refresh the page. */
function usePolling(ids: string[], poll: (id: string) => Promise<{ status: string } | { failure: string }>) {
  const router = useRouter();
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const timer = setInterval(async () => {
      for (const id of key.split(",")) {
        const r = await poll(id);
        if (stop) return;
        if ("failure" in r || r.status !== "pending") router.refresh();
      }
    }, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
    // the poll function is a server action and stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, router]);
}

function ReaderSelect({ readers, value, onChange, m }: { readers: { readerId: string; label: string }[]; value: string; onChange: (id: string) => void; m: Messages }) {
  return (
    <label className="grid gap-1">
      <span className="text-ink-80">{m["pay.reader"]}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
        {readers.map((r) => (
          <option key={r.readerId} value={r.readerId}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Payments on the reservation's folios: each folio's payments and refunds with
 * its balance after payments; taking a payment by Tender; refunds. A payment
 * at the card reader shows as waiting until the card is presented.
 */
export function PaymentsPanel({
  folios,
  rights,
  ...c
}: Common & {
  folios: { id: string; number: number; billToName: string; gross: number; balance: number; payments: Payment[] }[];
  rights: { take: boolean; refund: boolean };
}) {
  const { reservationId, propertyId, readers, testMode, currency, m } = c;
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const { pending, run, note } = useFormAction(m);
  const [reader, setReader] = useWorkstationReader(propertyId, readers);
  const [folioId, setFolioId] = useState(folios[0]?.id ?? "");
  const folio = folios.find((f) => f.id === folioId) ?? folios[0];
  const [tender, setTender] = useState<string>("card_terminal");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [refunding, setRefunding] = useState<string | null>(null);
  // the Approval a refund above the limit needs, once refused
  const [approval, setApproval] = useState<string | null>(null);
  const refund = (paymentId: string, mode?: ApprovalMode) =>
    run(
      async () => {
        const r = await refundAction(reservationId, paymentId, Number(refundAmount.replace(",", ".")), reason, mode);
        // a failed attempt to approve (say, a wrong password) keeps the prompt open
        setApproval(r.approval?.summary ?? (r.error && mode ? approval : null));
        return r;
      },
      () => setRefunding(null),
    );
  const [refundAmount, setRefundAmount] = useState("");
  const [reason, setReason] = useState("");
  const waiting = folios.flatMap((f) => f.payments).filter((p) => p.status === "pending" && !p.refundOf);
  usePolling(
    waiting.map((p) => p.id),
    (id) => paymentStatusAction(reservationId, id),
  );
  const viaReader = tender === "card_terminal" || tender === "ota_virtual_card";
  const amountValue = amount.trim() ? Number(amount.replace(",", ".")) : (folio?.balance ?? 0);

  return (
    <section aria-label={m["pay.title"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
      <h2 className="font-medium">{m["pay.title"]}</h2>
      {testMode ? <p className="text-xs text-ink-60">{m["pay.testMode"]}</p> : null}
      {note}
      {folios.map((f) => (
        <div key={f.id} data-pay-folio={f.number} className="grid gap-1 rounded-xl bg-surface p-3">
          <div className="flex justify-between font-medium">
            <span>{fill(m["folio.label"], { n: String(f.number), name: f.billToName })}</span>
            <span data-balance-after>
              {m["pay.balance"]}: {money(f.balance)}
            </span>
          </div>
          {f.payments.length === 0 ? <p className="text-ink-60">{m["pay.none"]}</p> : null}
          <ul className="grid gap-1">
            {f.payments.map((p) => (
              <li key={p.id} data-payment={p.tender} className={`flex flex-wrap items-center gap-2 ${p.status === "failed" ? "text-ink-60" : ""}`}>
                <span className="min-w-0 flex-1">
                  {p.refundOf ? `${m["pay.refundLabel"]} · ` : ""}
                  {m[`pay.tender.${p.tender}`]}
                  {p.cardBrand ? ` · ${p.cardBrand.toUpperCase()} •••• ${p.cardLast4}` : ""}
                  {p.reference ? ` · ${p.reference}` : ""} · <span className={p.status === "succeeded" ? "" : "font-medium"}>{m[`pay.status.${p.status}`]}</span>
                  {p.error ? ` · ${p.error}` : ""}
                </span>
                <span className={`tabular-nums ${p.status === "failed" ? "line-through" : ""}`}>{money(p.amount)}</span>
                {p.status === "pending" && !p.refundOf ? (
                  <span className="flex gap-1">
                    {testMode ? (
                      <button type="button" disabled={pending} onClick={() => run(() => simulateCardAction(reservationId, { paymentId: p.id }))} className={`${button} bg-accent text-white`}>
                        {m["pay.simulate"]}
                      </button>
                    ) : null}
                    <button type="button" disabled={pending} onClick={() => run(() => cancelPaymentAction(reservationId, p.id))} className={secondary}>
                      {m["pay.cancel"]}
                    </button>
                  </span>
                ) : null}
                {rights.refund && p.status === "succeeded" && !p.refundOf ? (
                  <button type="button" onClick={() => (setRefunding(p.id), setRefundAmount(String(p.amount)), setReason(""))} className={secondary}>
                    {m["pay.refund"]}
                  </button>
                ) : null}
                {refunding === p.id ? (
                  <div role="dialog" aria-label={m["pay.refund"]} className="flex w-full flex-wrap items-end gap-2 rounded-lg bg-surface-2 p-2">
                    <label className="grid gap-1">
                      <span className="text-ink-80">{m["pay.refundAmount"]}</span>
                      <input inputMode="decimal" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className={`${input} w-28`} />
                    </label>
                    <label className="grid flex-1 gap-1">
                      <span className="text-ink-80">{m["pay.refundReason"]}</span>
                      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={input} />
                    </label>
                    <button
                      type="button"
                      disabled={!reason.trim() || pending}
                      onClick={() => refund(p.id)}
                      className={`${button} bg-danger text-white disabled:opacity-40`}
                    >
                      {m["pay.refundConfirm"]}
                    </button>
                    <button type="button" onClick={() => (setRefunding(null), setApproval(null))} className={secondary}>
                      {m["res.keepAsIs"]}
                    </button>
                    {approval ? (
                      <ApprovalPrompt
                        summary={approval}
                        pending={pending}
                        onRequest={() => refund(p.id, { mode: "request" })}
                        onCredentials={(username, password) => refund(p.id, { mode: "credentials", username, password })}
                        m={m}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {rights.take && folios.length ? (
        <div role="group" aria-label={m["pay.take"]} className="flex flex-wrap items-end gap-2">
          {folios.length > 1 ? (
            <label className="grid gap-1">
              <span className="text-ink-80">{m["pay.folio"]}</span>
              <select value={folioId} onChange={(e) => setFolioId(e.target.value)} className={input}>
                {folios.map((f) => (
                  <option key={f.id} value={f.id}>
                    {fill(m["folio.label"], { n: String(f.number), name: f.billToName })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1">
            <span className="text-ink-80">{m["pay.tender"]}</span>
            <select value={tender} onChange={(e) => setTender(e.target.value)} className={input}>
              {DESK_TENDERS.map((t) => (
                <option key={t} value={t}>
                  {m[`pay.tender.${t}`]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["pay.amount"]}</span>
            <input inputMode="decimal" value={amount} placeholder={folio ? String(Math.max(0, folio.balance)) : ""} onChange={(e) => setAmount(e.target.value)} className={`${input} w-28`} />
          </label>
          {viaReader ? (
            readers.length ? (
              <ReaderSelect readers={readers} value={reader} onChange={setReader} m={m} />
            ) : (
              <span className="text-xs text-danger">{m["pay.noReader"]}</span>
            )
          ) : (
            <label className="grid gap-1">
              <span className="text-ink-80">{m["pay.reference"]}</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} className={input} />
            </label>
          )}
          <button
            type="button"
            disabled={pending || !(amountValue > 0) || (viaReader && !reader)}
            onClick={() => run(() => takePaymentAction(reservationId, { folioId: folio?.id ?? "", tender, amount: amountValue, readerId: reader, reference }), () => (setAmount(""), setReference("")))}
            className={`${button} bg-accent text-white disabled:opacity-40`}
          >
            {m["pay.submit"]}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Card Holds of the stay: pre-authorise on the reader, raise for incidentals, capture at checkout, release. */
export function CardHoldsPanel({ holds, balance, canTake, ...c }: Common & { holds: CardHold[]; balance: number; canTake: boolean }) {
  const { reservationId, propertyId, readers, testMode, currency, m } = c;
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const when = (iso: string) => new Intl.DateTimeFormat(currency.language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const { pending, run, note } = useFormAction(m);
  const [reader, setReader] = useWorkstationReader(propertyId, readers);
  const [amount, setAmount] = useState("");
  const [raise, setRaise] = useState<Record<string, string>>({});
  const [capture, setCapture] = useState<Record<string, string>>({});
  usePolling(
    holds.filter((h) => h.status === "pending").map((h) => h.id),
    (id) => holdStatusAction(reservationId, id),
  );
  return (
    <section aria-label={m["hold.title"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
      <h2 className="font-medium">{m["hold.title"]}</h2>
      <p className="text-xs text-ink-60">{m["hold.help"]}</p>
      {note}
      {holds.length === 0 ? <p className="text-ink-60">{m["hold.none"]}</p> : null}
      <ul className="grid gap-2">
        {holds.map((h) => (
          <li key={h.id} data-hold={h.status} className="grid gap-2 rounded-xl bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                <strong className="tabular-nums">{money(h.amount)}</strong> · {m[`hold.status.${h.status}`]}
                {h.cardBrand ? ` · ${h.cardBrand.toUpperCase()} •••• ${h.cardLast4}` : ""}
                {h.status === "active" && h.expiresAt ? ` · ${fill(m["hold.expires"], { date: when(h.expiresAt) })}` : ""}
                {h.renewedFrom ? ` · ${m["hold.renewed"]}` : ""}
                {h.capturedAmount !== null ? ` · ${money(h.capturedAmount)}` : ""}
                {h.error ? ` · ${h.error}` : ""}
              </span>
              {h.status === "pending" && canTake ? (
                <span className="flex gap-1">
                  {testMode ? (
                    <button type="button" disabled={pending} onClick={() => run(() => simulateCardAction(reservationId, { holdId: h.id }))} className={`${button} bg-accent text-white`}>
                      {m["pay.simulate"]}
                    </button>
                  ) : null}
                  <button type="button" disabled={pending} onClick={() => run(() => releaseHoldAction(reservationId, h.id))} className={secondary}>
                    {m["pay.cancel"]}
                  </button>
                </span>
              ) : null}
            </div>
            {h.status === "active" && canTake ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1">
                  <span className="text-ink-80">{m["hold.raise"]}</span>
                  <input inputMode="decimal" value={raise[h.id] ?? ""} onChange={(e) => setRaise({ ...raise, [h.id]: e.target.value })} className={`${input} w-24`} />
                </label>
                <button
                  type="button"
                  disabled={pending || !raise[h.id]}
                  onClick={() => run(() => incrementHoldAction(reservationId, h.id, Number((raise[h.id] ?? "").replace(",", "."))), () => setRaise({ ...raise, [h.id]: "" }))}
                  className={secondary}
                >
                  {m["hold.raiseConfirm"]}
                </button>
                <label className="grid gap-1">
                  <span className="text-ink-80">{m["hold.capture"]}</span>
                  <input
                    inputMode="decimal"
                    value={capture[h.id] ?? ""}
                    placeholder={String(captureAmount(h.amount, balance).capture)}
                    onChange={(e) => setCapture({ ...capture, [h.id]: e.target.value })}
                    className={`${input} w-24`}
                  />
                </label>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => captureHoldAction(reservationId, h.id, capture[h.id] ? Number(capture[h.id]!.replace(",", ".")) : null))}
                  className={`${button} bg-accent text-white`}
                >
                  {m["hold.capture"]}
                </button>
                <button type="button" disabled={pending} onClick={() => run(() => coverBalanceAction(reservationId, h.id))} className={secondary} title={m["hold.coverHelp"]}>
                  {m["hold.cover"]}
                </button>
                <button type="button" disabled={pending} onClick={() => run(() => releaseHoldAction(reservationId, h.id))} className={secondary}>
                  {m["hold.release"]}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canTake ? (
        readers.length ? (
          <div role="group" aria-label={m["hold.place"]} className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="text-ink-80">{m["pay.amount"]}</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} w-28`} />
            </label>
            <ReaderSelect readers={readers} value={reader} onChange={setReader} m={m} />
            <button
              type="button"
              disabled={pending || !amount.trim() || !reader}
              onClick={() => run(() => placeHoldAction(reservationId, Number(amount.replace(",", ".")), reader), () => setAmount(""))}
              className={`${button} bg-accent text-white disabled:opacity-40`}
            >
              {m["hold.place"]}
            </button>
          </div>
        ) : (
          <p className="text-xs text-danger">{m["pay.noReader"]}</p>
        )
      ) : null}
    </section>
  );
}
