"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTING_CATEGORIES, formatCurrency, formatDate, splitGross, type Language } from "@hoteloftware/domain";
import type { Charge, Folio, FolioView } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { findCompanies, type Picked } from "../actions";
import { addFolioAction, moveChargeAction, postFreeTextAction, postServiceAction, routingAction, voidChargeAction } from "../folio-actions";

interface Props {
  reservationId: string;
  view: FolioView;
  services: { id: string; label: string }[];
  taxCodes: { id: string; label: string }[];
  /** Bill-to choices for a new folio: the Primary Guest and the booking's Companies. */
  parties: { kind: "guest" | "company"; id: string; label: string }[];
  log: { at: string; user: string; action: "post" | "void" | "move"; description: string; reason: string | null }[];
  today: string;
  rights: { post: boolean; freeText: boolean; manage: boolean; companies: boolean };
  currency: { code: string; language: Language; country: string };
  m: Messages;
}

const input = "h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm";
const button = "h-9 rounded-full px-4 text-sm font-medium";

/** Folios of the reservation: Charges with Service Date and Tax Code, totals per Tax Code, posting, voiding, moving and Routing Rules. */
export function FolioPanel({ reservationId, view, services, taxCodes, parties, log, today, rights, currency, m }: Props) {
  const { folios, routing } = view;
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  // calendar dates: noon UTC so no zone shifts the day
  const day = (d: string) => formatDate(new Date(`${d}T12:00:00Z`), currency.language, currency.country, "UTC");
  // the stay sync's own voids and fee are stored in English; show them in the user's language
  const description = (c: Charge) => (c.origin === "fee" ? m["folio.earlyDepartureFee"] : c.description);
  const voidReason = (c: Charge) => (c.autoVoid ? m[`folio.autoVoid.${c.autoVoid}`] : (c.voidReason ?? ""));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const run = (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.error ? { kind: "error", text: res.error } : { kind: "ok", text: res.message ?? m["grid.saved"] });
      if (!res.error) {
        after?.();
        router.refresh();
      }
    });

  // posting
  const [serviceId, setServiceId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [serviceDate, setServiceDate] = useState(today);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [textDate, setTextDate] = useState(today);
  // voiding: the charge being voided and its reason
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // new folio
  const [billTo, setBillTo] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyHits, setCompanyHits] = useState<Picked[]>([]);

  const folioLabel = (f: Folio) => fill(m["folio.label"], { n: String(f.number), name: f.billToName });

  return (
    <section aria-label={m["res.folio"]} className="grid gap-4 rounded-2xl bg-surface-2 p-5 text-sm">
      <h2 className="font-medium">{m["res.folio"]}</h2>
      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-danger" : "text-ink-60"}>
          {message.text}
        </p>
      ) : null}
      {folios.length === 0 ? <p className="text-ink-60">{m["folio.none"]}</p> : null}

      {folios.map((f) => (
        <article key={f.id} aria-label={folioLabel(f)} data-folio={f.number} className="grid gap-2 rounded-xl bg-surface p-4">
          <h3 className="font-medium">
            {folioLabel(f)} <span className="font-normal text-ink-60">· {m[`folio.billTo.${f.billTo}`]}</span>
          </h3>
          {f.charges.length === 0 ? <p className="text-ink-60">{m["folio.empty"]}</p> : null}
          {f.charges.length ? (
            <table className="w-full">
              <thead className="text-left text-ink-60">
                <tr>
                  <th className="py-1 font-normal">{m["folio.serviceDate"]}</th>
                  <th className="py-1 font-normal">{m["folio.charge"]}</th>
                  <th className="py-1 font-normal">{m["folio.taxCode"]}</th>
                  {f.billTo === "company" ? <th className="py-1 text-right font-normal">{m["folio.net"]}</th> : null}
                  <th className="py-1 text-right font-normal">{m["folio.amount"]}</th>
                  {rights.manage ? <th className="py-1" /> : null}
                </tr>
              </thead>
              <tbody>
                {f.charges.map((c) => (
                  <tr key={c.id} data-charge={description(c)} className={`border-t border-ink-5 align-top ${c.voided ? "text-ink-60" : ""}`}>
                    <td className="py-1">{day(c.serviceDate)}</td>
                    <td className="py-1">
                      <span className={c.voided ? "line-through" : ""}>
                        {c.quantity !== 1 ? `${c.quantity} × ` : ""}
                        {description(c)}
                      </span>
                      {c.voided ? <div className="text-xs">{fill(m["folio.voidedBecause"], { reason: voidReason(c) })}</div> : null}
                    </td>
                    <td className="py-1">
                      {c.taxCode} {c.taxRate} %
                    </td>
                    {f.billTo === "company" ? <td className={`py-1 text-right ${c.voided ? "line-through" : ""}`}>{money(splitGross(c.amount, c.taxRate).net)}</td> : null}
                    <td className={`py-1 text-right ${c.voided ? "line-through" : ""}`}>{money(c.amount)}</td>
                    {rights.manage ? (
                      <td className="py-1 pl-2 text-right">
                        {!c.voided ? (
                          <div className="flex justify-end gap-1">
                            {folios.length > 1 ? (
                              <select
                                aria-label={fill(m["folio.moveCharge"], { charge: description(c) })}
                                value=""
                                onChange={(e) => e.target.value && run(() => moveChargeAction(reservationId, c.id, e.target.value))}
                                className="h-7 rounded-lg border border-ink-10 bg-surface px-1 text-xs"
                              >
                                <option value="">{m["folio.moveTo"]}</option>
                                {folios
                                  .filter((x) => x.id !== f.id)
                                  .map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {folioLabel(x)}
                                    </option>
                                  ))}
                              </select>
                            ) : null}
                            <button type="button" onClick={() => (setVoiding(c.id), setReason(""))} className="h-7 rounded-full px-2 text-xs hover:bg-ink-5">
                              {m["folio.void"]}
                            </button>
                          </div>
                        ) : null}
                        {voiding === c.id ? (
                          <div role="dialog" aria-label={m["folio.void"]} className="mt-1 grid gap-1 text-left">
                            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={m["folio.voidReason"]} aria-label={m["folio.voidReason"]} className={input} />
                            <div className="flex gap-1">
                              <button
                                type="button"
                                disabled={!reason.trim() || pending}
                                onClick={() => run(() => voidChargeAction(reservationId, c.id, reason), () => setVoiding(null))}
                                className={`${button} bg-danger text-white disabled:opacity-40`}
                              >
                                {m["folio.voidConfirm"]}
                              </button>
                              <button type="button" onClick={() => setVoiding(null)} className={`${button} hover:bg-ink-5`}>
                                {m["res.keepAsIs"]}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {f.totals.byTaxCode.length ? (
            <table aria-label={fill(m["folio.totalsOf"], { folio: folioLabel(f) })} className="ml-auto text-right">
              <thead className="text-ink-60">
                <tr>
                  <th className="px-2 font-normal">{m["folio.taxCode"]}</th>
                  {f.billTo === "company" ? <th className="px-2 font-normal">{m["folio.net"]}</th> : null}
                  <th className="px-2 font-normal">{m["folio.vat"]}</th>
                  <th className="px-2 font-normal">{m["folio.gross"]}</th>
                </tr>
              </thead>
              <tbody>
                {f.totals.byTaxCode.map((t) => (
                  <tr key={`${t.taxCode}${t.rate}`} data-tax={t.taxCode}>
                    <td className="px-2">
                      {t.taxCode} {t.rate} %
                    </td>
                    {f.billTo === "company" ? <td className="px-2">{money(t.net)}</td> : null}
                    <td className="px-2">{money(t.vat)}</td>
                    <td className="px-2">{money(t.gross)}</td>
                  </tr>
                ))}
                <tr className="border-t border-ink-10 font-medium">
                  <td className="px-2" colSpan={f.billTo === "company" ? 3 : 2}>
                    {m["folio.balance"]}
                  </td>
                  <td className="px-2" data-balance>
                    {money(f.totals.gross)}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </article>
      ))}

      {rights.post && services.length ? (
        <div aria-label={m["folio.postService"]} role="group" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-ink-80">{m["folio.postService"]}</span>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={input}>
              <option value="">–</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["folio.quantity"]}</span>
            <input type="number" min={1} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${input} w-20`} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["folio.serviceDate"]}</span>
            <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={input} />
          </label>
          <button
            type="button"
            disabled={!serviceId || pending}
            onClick={() => run(() => postServiceAction(reservationId, { serviceId, quantity: Number(quantity.replace(",", ".")), serviceDate }), () => setServiceId(""))}
            className={`${button} bg-accent text-white disabled:opacity-40`}
          >
            {m["folio.post"]}
          </button>
        </div>
      ) : null}

      {rights.freeText ? (
        <div aria-label={m["folio.postFreeText"]} role="group" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-ink-80">{m["folio.description"]}</span>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["folio.amount"]}</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} w-28`} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["folio.taxCode"]}</span>
            <select value={taxCodeId} onChange={(e) => setTaxCodeId(e.target.value)} className={input}>
              <option value="">–</option>
              {taxCodes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["folio.serviceDate"]}</span>
            <input type="date" value={textDate} onChange={(e) => setTextDate(e.target.value)} className={input} />
          </label>
          <button
            type="button"
            disabled={!text.trim() || !amount || !taxCodeId || pending}
            onClick={() =>
              run(
                () => postFreeTextAction(reservationId, { description: text, amount: Number(amount.replace(",", ".")), taxCodeId, serviceDate: textDate }),
                () => (setText(""), setAmount("")),
              )
            }
            className={`${button} bg-accent text-white disabled:opacity-40`}
          >
            {m["folio.post"]}
          </button>
        </div>
      ) : null}

      {rights.manage && folios.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div aria-label={m["folio.routing"]} role="group" className="grid gap-2">
            <h3 className="font-medium">{m["folio.routing"]}</h3>
            <p className="text-xs text-ink-60">{m["folio.routingHelp"]}</p>
            {ROUTING_CATEGORIES.map((cat) => (
              <label key={cat} className="flex items-center justify-between gap-2">
                <span>{m[`companies.routing.${cat}`]}</span>
                <select
                  value={routing.find((r) => r.category === cat)?.folioId ?? ""}
                  onChange={(e) => run(() => routingAction(reservationId, cat, e.target.value || null))}
                  className={input}
                >
                  <option value="">{folios[0] ? folioLabel(folios[0]) : "–"}</option>
                  {folios.slice(1).map((x) => (
                    <option key={x.id} value={x.id}>
                      {folioLabel(x)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div aria-label={m["folio.add"]} role="group" className="grid content-start gap-2">
            <h3 className="font-medium">{m["folio.add"]}</h3>
            <select value={billTo} onChange={(e) => setBillTo(e.target.value)} aria-label={m["folio.billTo"]} className={input}>
              <option value="">{m["folio.billTo"]}</option>
              {parties.map((p) => (
                <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
                  {p.label}
                </option>
              ))}
              {companyHits
                .filter((h) => !parties.some((p) => p.id === h.id))
                .map((h) => (
                  <option key={`company:${h.id}`} value={`company:${h.id}`}>
                    {h.label}
                  </option>
                ))}
            </select>
            {rights.companies ? (
              <input
                value={companyQuery}
                onChange={(e) => {
                  const q = e.target.value;
                  setCompanyQuery(q);
                  if (q.trim().length >= 2) startTransition(async () => setCompanyHits(await findCompanies(q)));
                }}
                placeholder={m["folio.findCompany"]}
                aria-label={m["folio.findCompany"]}
                className={input}
              />
            ) : null}
            <button
              type="button"
              disabled={!billTo || pending}
              onClick={() => {
                const [kind, id = ""] = billTo.split(":");
                run(() => addFolioAction(reservationId, kind === "company" ? { companyId: id } : { guestId: id }), () => setBillTo(""));
              }}
              className={`${button} justify-self-start bg-accent text-white disabled:opacity-40`}
            >
              {m["folio.addConfirm"]}
            </button>
          </div>
        </div>
      ) : null}

      {log.length ? (
        <details>
          <summary className="cursor-pointer text-ink-80">{m["folio.log"]}</summary>
          <ul aria-label={m["folio.log"]} className="mt-2 grid gap-1">
            {log.map((e, i) => (
              <li key={i}>
                <span className="text-ink-60">{e.at}</span> · {e.user} · <strong>{m[`folio.event.${e.action}`]}</strong> · {e.description}
                {e.reason ? ` · ${e.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
