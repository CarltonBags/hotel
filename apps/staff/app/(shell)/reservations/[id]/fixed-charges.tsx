"use client";

import { useState } from "react";
import { formatCurrency, formatDate, type Language } from "@hoteloftware/domain";
import type { FixedCharge } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { addFixedChargeAction, removeFixedChargeAction } from "../folio-actions";
import { useFormAction } from "../use-form-action";

const input = "h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm";
const button = "h-9 rounded-full px-4 text-sm font-medium";

/** Fixed Charges of a stay: a Service for a range of nights, posted night by night (parking, a dog). */
export function FixedCharges({
  reservationId,
  arrival,
  departure,
  items,
  services,
  rights,
  currency,
  m,
}: {
  reservationId: string;
  arrival: string;
  departure: string;
  items: FixedCharge[];
  services: { id: string; label: string; price: number }[];
  rights: { add: boolean; remove: boolean };
  currency: { code: string; language: Language; country: string };
  m: Messages;
}) {
  const money = (v: number) => formatCurrency(v, currency.code, currency.language, currency.country);
  const day = (d: string) => formatDate(new Date(`${d}T12:00:00Z`), currency.language, currency.country, "UTC");
  const { pending, run, note } = useFormAction(m);
  const [serviceId, setServiceId] = useState("");
  const [from, setFrom] = useState(arrival);
  const [to, setTo] = useState(departure);
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  return (
    <section aria-label={m["fixed.title"]} className="grid gap-3 text-sm">
      <p className="text-xs text-ink-60">{m["fixed.help"]}</p>
      {note}
      {items.length === 0 ? <p className="text-ink-60">{m["fixed.none"]}</p> : null}
      <ul className="grid gap-1">
        {items.map((f) => (
          <li key={f.id} data-fixed={f.serviceName} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2">
            <span>
              <strong>{f.serviceName}</strong> · {f.quantity !== 1 ? `${f.quantity} × ` : ""}
              {money(f.unitPrice)} · {fill(m["fixed.range"], { from: day(f.from), to: day(f.to) })}
            </span>
            {rights.remove ? (
              <button type="button" disabled={pending} onClick={() => run(() => removeFixedChargeAction(reservationId, f.id))} className={`${button} hover:bg-ink-5`}>
                {m["fixed.remove"]}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {rights.add && services.length ? (
        <div role="group" aria-label={m["fixed.add"]} className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-ink-80">{m["fixed.service"]}</span>
            <select
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                const s = services.find((x) => x.id === e.target.value);
                setPrice(s ? String(s.price) : "");
              }}
              className={input}
            >
              <option value="">–</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["fixed.from"]}</span>
            <input type="date" value={from} min={arrival} max={departure} onChange={(e) => setFrom(e.target.value)} className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["fixed.to"]}</span>
            <input type="date" value={to} min={arrival} max={departure} onChange={(e) => setTo(e.target.value)} className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["folio.quantity"]}</span>
            <input type="number" min={1} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${input} w-20`} />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-80">{m["fixed.price"]}</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={`${input} w-24`} />
          </label>
          <button
            type="button"
            disabled={!serviceId || pending}
            onClick={() =>
              run(
                () =>
                  addFixedChargeAction(reservationId, {
                    serviceId,
                    from,
                    to,
                    quantity: Number(quantity.replace(",", ".")),
                    unitPrice: price.trim() ? Number(price.replace(",", ".")) : null,
                  }),
                () => setServiceId(""),
              )
            }
            className={`${button} bg-accent text-white disabled:opacity-40`}
          >
            {m["fixed.addConfirm"]}
          </button>
        </div>
      ) : null}
    </section>
  );
}
