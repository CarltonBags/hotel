"use client";

import { useActionState, useState } from "react";
import { VOUCHER_SALE_TENDERS } from "@hoteloftware/domain";
import type { Messages } from "@/i18n/messages";
import { sellVoucherAction, voucherLookupAction } from "./actions";

/** Sell a Voucher and look a code up (ticket 53). */
export function VoucherDesk({ propertyId, currency, m }: { propertyId: string; currency: string; m: Messages }) {
  const [state, action, pending] = useActionState(sellVoucherAction, {});
  const [tender, setTender] = useState<string>("cash");
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Awaited<ReturnType<typeof voucherLookupAction>> | undefined>(undefined);
  const input = "h-10 w-full rounded-xl border border-ink-10 bg-surface px-3";
  return (
    <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <form action={action} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm sm:grid-cols-2" data-sell-voucher>
        <h2 className="font-medium sm:col-span-2">{m["voucher.sell"]}</h2>
        <input type="hidden" name="propertyId" value={propertyId} />
        <label className="grid gap-1">
          <span className="text-ink-80">
            {m["voucher.amount"]} ({currency})
          </span>
          <input name="amount" inputMode="decimal" required className={input} />
        </label>
        <label className="grid gap-1">
          <span className="text-ink-80">{m["voucher.tender"]}</span>
          <select name="tender" value={tender} onChange={(e) => setTender(e.target.value)} className={input}>
            {VOUCHER_SALE_TENDERS.map((t) => (
              <option key={t} value={t}>
                {m[`pay.tender.${t}`]}
              </option>
            ))}
          </select>
        </label>
        {tender !== "cash" ? (
          <label className="grid gap-1 sm:col-span-2">
            <span className="text-ink-80">{m["voucher.reference"]}</span>
            <input name="reference" required maxLength={200} className={input} />
          </label>
        ) : null}
        <label className="grid gap-1">
          <span className="text-ink-80">{m["voucher.recipientName"]}</span>
          <input name="recipientName" maxLength={120} className={input} />
        </label>
        <label className="grid gap-1">
          <span className="text-ink-80">{m["voucher.recipientEmail"]}</span>
          <input name="recipientEmail" type="email" required className={input} />
        </label>
        <label className="grid gap-1">
          <span className="text-ink-80">{m["voucher.buyerName"]}</span>
          <input name="buyerName" maxLength={120} className={input} />
        </label>
        <label className="grid gap-1">
          <span className="text-ink-80">{m["voucher.buyerEmail"]}</span>
          <input name="buyerEmail" type="email" className={input} />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-ink-80">{m["voucher.message"]}</span>
          <textarea name="message" maxLength={1000} rows={2} className="w-full rounded-xl border border-ink-10 bg-surface p-3" />
        </label>
        {state.error ? (
          <p role="alert" className="text-danger sm:col-span-2">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p className="sm:col-span-2" data-sold>
            {state.message}{" "}
            {state.receipt ? (
              <a href={`/receipt/${state.receipt}`} target="_blank" className="text-accent underline" data-voucher-receipt>
                {m["voucher.receipt"]}
              </a>
            ) : null}
          </p>
        ) : null}
        <button type="submit" disabled={pending} className="h-10 justify-self-start rounded-full bg-accent px-5 font-medium text-white shadow-pill disabled:opacity-60">
          {pending ? m["action.saving"] : m["voucher.sell"]}
        </button>
      </form>
      <form
        className="grid content-start gap-3 rounded-2xl bg-surface-2 p-5 text-sm"
        data-voucher-lookup
        onSubmit={async (e) => {
          e.preventDefault();
          setFound(await voucherLookupAction(propertyId, code));
        }}
      >
        <h2 className="font-medium">{m["voucher.lookup"]}</h2>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" className={`${input} font-mono uppercase`} />
        <button type="submit" className="h-10 justify-self-start rounded-full bg-ink-10 px-5">
          {m["voucher.lookup"]}
        </button>
        {found === null ? <p className="text-danger">{m["voucher.notFound"]}</p> : null}
        {found ? (
          <p data-lookup-result>
            {found.code} · {m["voucher.left"]}: <strong>{found.balance.toFixed(2)} {found.currency}</strong>
            {found.redeemableHere ? "" : ` · ${m["voucher.elsewhere"]}`}
          </p>
        ) : null}
      </form>
    </div>
  );
}
