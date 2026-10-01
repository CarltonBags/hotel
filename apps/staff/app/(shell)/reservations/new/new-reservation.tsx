"use client";

import { useEffect, useState, useTransition } from "react";
import { formatCurrency, nightsOf, type Language, type QuoteReason } from "@hoteloftware/domain";
import type { StayQuotes } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { createBookingAction, findCompanies, findGuests, quickGuest, type Picked } from "../actions";

interface Props {
  property: { id: string; name: string; currency: string; country: string };
  search: { arrival: string; departure: string; adults: number; children: string; rateCode: string };
  childAges: number[];
  quotes: StayQuotes | null;
  error: string | null;
  today: string;
  canCreateGuests: boolean;
  language: Language;
  m: Messages;
}

/** One room of the booking with its own stay and occupancy, as quoted when it was added. */
interface CartRoom {
  key: number;
  roomTypeId: string;
  ratePlanId: string;
  label: string;
  total: number;
  arrival: string;
  departure: string;
  adults: number;
  childAges: number[];
  /** Set when the plan is hidden behind a Rate Code. */
  rateCode: string | null;
  guest: Picked | null;
}

const input = "h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm";

export function NewReservation({ property, search, childAges, quotes, error, today, canCreateGuests, language, m }: Props) {
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  // the cart survives a new availability search (a page load), so rooms of different sizes or dates can be combined
  const cartKey = `hs:cart:${property.id}`;
  const [cart, setCart] = useState<CartRoom[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(cartKey);
      if (raw) setCart(JSON.parse(raw) as CartRoom[]);
    } catch {
      /* no storage */
    }
    setLoaded(true);
  }, [cartKey]);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.sessionStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      /* no storage */
    }
  }, [cart, loaded, cartKey]);
  const [bookerKind, setBookerKind] = useState<"guest" | "person" | "company">(quotes?.rateCode?.companyId ? "company" : "guest");
  const [bookerPerson, setBookerPerson] = useState<Picked | null>(null);
  const [company, setCompany] = useState<Picked | null>(quotes?.rateCode?.companyId ? { id: quotes.rateCode.companyId, label: quotes.rateCode.companyName ?? "" } : null);
  const [walkIn, setWalkIn] = useState(false);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nights = quotes ? nightsOf(search.arrival, search.departure).length : 0;

  // rooms already in the cart that overlap the searched stay
  const inCart = (roomTypeId: string) => cart.filter((c) => c.roomTypeId === roomTypeId && c.arrival < search.departure && c.departure > search.arrival).length;
  const add = (roomTypeId: string, ratePlanId: string, label: string, total: number, hidden: boolean) => {
    setCart((c) => [
      ...c,
      {
        key: Math.max(0, ...c.map((x) => x.key)) + 1,
        roomTypeId,
        ratePlanId,
        label,
        total,
        arrival: search.arrival,
        departure: search.departure,
        adults: search.adults,
        childAges,
        rateCode: hidden ? search.rateCode : null,
        guest: null,
      },
    ]);
  };
  const reasons = (list: QuoteReason[]) => list.map((r) => m[`res.reason.${r}`]).join(", ");

  const submit = () => {
    setMessage(null);
    if (cart.some((c) => !c.guest)) return setMessage(m["res.needGuests"]);
    const booker =
      bookerKind === "company" ? (company ? { companyId: company.id } : null) : bookerKind === "person" ? (bookerPerson ? { guestId: bookerPerson.id } : null) : { guestId: cart[0]!.guest!.id };
    if (!booker) return setMessage(m["res.needBooker"]);
    const codes = [...new Set(cart.map((c) => c.rateCode).filter((c): c is string => !!c).map((c) => c.toUpperCase()))];
    if (codes.length > 1) return setMessage(m["res.oneRateCode"]);
    // success redirects to the reservation, so the stored cart is cleared first and put back on an error
    try {
      window.sessionStorage.removeItem(cartKey);
    } catch {
      /* no storage */
    }
    startTransition(async () => {
      const r = await createBookingAction(property.id, {
        booker,
        walkIn,
        notes,
        rateCode: codes[0],
        reservations: cart.map((c) => ({
          arrival: c.arrival,
          departure: c.departure,
          adults: c.adults,
          childAges: c.childAges,
          roomTypeId: c.roomTypeId,
          ratePlanId: c.ratePlanId,
          primaryGuestId: c.guest!.id,
          expectedTotal: c.total,
        })),
      });
      if (r.error) {
        setMessage(r.error);
        try {
          window.sessionStorage.setItem(cartKey, JSON.stringify(cart));
        } catch {
          /* no storage */
        }
      }
    });
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-6">
      <h1 className="text-xl font-medium">
        {m["module.new_reservation"]} <span className="text-ink-60">· {property.name}</span>
      </h1>

      <form method="get" className="grid gap-3 rounded-2xl bg-surface-2 p-5 md:grid-cols-6" aria-label={m["res.stay"]}>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["res.arrival"]}</span>
          <input type="date" name="arrival" min={today} defaultValue={search.arrival} required className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["res.departure"]}</span>
          <input type="date" name="departure" defaultValue={search.departure} required className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["res.adults"]}</span>
          <input type="number" name="adults" min={1} max={20} defaultValue={search.adults} required className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["res.childAges"]}</span>
          <input name="children" defaultValue={search.children} placeholder="7, 3" className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["rates.rateCode"]}</span>
          <input name="rateCode" defaultValue={search.rateCode} className={input} />
        </label>
        <button type="submit" className="h-10 self-end rounded-full bg-accent px-5 text-sm font-medium text-white">
          {m["res.showAvailability"]}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {quotes ? (
        <section aria-label={m["res.availability"]} className="grid gap-3">
          <h2 className="font-medium">{fill(m["res.availabilityFor"], { nights: String(nights) })}</h2>
          {quotes.rateCode ? <p className="text-sm text-ink-60">{fill(m["res.codeMatched"], { code: quotes.rateCode.code, company: quotes.rateCode.companyName ?? "–" })}</p> : null}
          {search.rateCode && !quotes.rateCode ? <p className="text-sm text-warning">{m["res.codeUnknown"]}</p> : null}
          {quotes.roomTypes.map((t) => {
            const left = t.available - inCart(t.roomTypeId);
            return (
              <div key={t.roomTypeId} data-room-type={t.code} className="rounded-2xl bg-surface-2 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">
                    {t.code} · {t.name}
                  </span>
                  <span className={`text-sm ${left > 0 ? "text-ink-60" : "text-danger"}`}>{fill(m["res.free"], { n: String(Math.max(0, left)), of: String(t.rooms) })}</span>
                </div>
                {t.plans.length === 0 ? <p className="mt-1 text-sm text-ink-60">{m["res.noPlans"]}</p> : null}
                <ul className="mt-2 grid gap-1">
                  {t.plans.map((p) => (
                    <li key={p.ratePlanId} className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="min-w-48">
                        {p.name} <span className="text-ink-60">· {m[`rates.mealPlan.${p.mealPlan}`]}</span>
                        {p.hidden ? <span className="ml-1 rounded-full bg-accent/15 px-2 text-xs text-accent">{m["rates.rateCode"]}</span> : null}
                      </span>
                      {p.quote.nights.length === nights ? (
                        <span>
                          <strong>{money(p.quote.total)}</strong> <span className="text-ink-60">({fill(m["res.perNight"], { price: money(p.quote.total / nights) })})</span>
                        </span>
                      ) : null}
                      {p.quote.bookable && left > 0 ? (
                        <button type="button" onClick={() => add(t.roomTypeId, p.ratePlanId, `${t.code} · ${p.name}`, p.quote.total, p.hidden)} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white">
                          {m["res.addRoom"]}
                        </button>
                      ) : (
                        <span className="text-xs text-danger">{reasons(left <= 0 && p.quote.bookable ? ["sold_out"] : p.quote.reasons)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : null}

      {cart.length ? (
        <section aria-label={m["res.booking"]} className="grid gap-4 rounded-2xl bg-surface-2 p-5">
          <h2 className="font-medium">{m["res.booking"]}</h2>
          <ol className="grid gap-3">
            {cart.map((c, i) => (
              <li key={c.key} className="grid gap-2 rounded-xl bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fill(m["res.room"], { n: String(i + 1) })}</span>
                  <span>{c.label}</span>
                  <span className="text-ink-60">
                    {c.arrival} – {c.departure} · {fill(m["res.occupancy"], { adults: String(c.adults) })}
                    {c.childAges.length ? ` · ${fill(m["res.children"], { ages: c.childAges.join(", ") })}` : ""} · {money(c.total)}
                  </span>
                  <button type="button" onClick={() => setCart((x) => x.filter((y) => y.key !== c.key))} className="ml-auto text-xs underline">
                    {m["action.delete"]}
                  </button>
                </div>
                <GuestPicker
                  value={c.guest}
                  onPick={(g) => setCart((x) => x.map((y) => (y.key === c.key ? { ...y, guest: g } : y)))}
                  canCreate={canCreateGuests}
                  m={m}
                />
              </li>
            ))}
          </ol>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{m["res.booker"]}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" name="bookerKind" checked={bookerKind === "guest"} onChange={() => setBookerKind("guest")} />
                {m["res.bookerGuest"]}
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="bookerKind" checked={bookerKind === "person"} onChange={() => setBookerKind("person")} />
                {m["res.bookerPerson"]}
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="bookerKind" checked={bookerKind === "company"} onChange={() => setBookerKind("company")} />
                {m["res.bookerCompany"]}
              </label>
            </div>
            {bookerKind === "person" ? <Picker value={bookerPerson} onPick={setBookerPerson} search={findGuests} label={m["guests.searchHint"]} m={m} /> : null}
            {bookerKind === "company" ? <Picker value={company} onPick={setCompany} search={findCompanies} label={m["module.companies"]} m={m} /> : null}
          </fieldset>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>
              {m["res.source"]}: {m["res.source.direct"]}
            </span>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} />
              {m["res.walkIn"]}
            </label>
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={m["res.notes"]} aria-label={m["res.notes"]} className="w-full rounded-xl border border-ink-10 bg-surface p-3 text-sm" />
          {message ? (
            <p role="alert" className="text-sm text-danger">
              {message}
            </p>
          ) : null}
          <button type="button" onClick={submit} disabled={pending} className="h-10 justify-self-start rounded-full bg-accent px-5 text-sm font-medium text-white shadow-pill disabled:opacity-60">
            {pending ? m["action.saving"] : fill(m["res.confirm"], { n: String(cart.length), total: money(cart.reduce((sum, c) => sum + c.total, 0)) })}
          </button>
        </section>
      ) : null}
    </div>
  );
}

/** Pick an existing record by typing; results come from a server action. */
function Picker({ value, onPick, search, label, m }: { value: Picked | null; onPick: (p: Picked | null) => void; search: (q: string) => Promise<Picked[]>; label: string; m: Messages }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Picked[]>([]);
  const [pending, startTransition] = useTransition();
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{value.label}</span>
        <button type="button" onClick={() => onPick(null)} className="text-xs underline">
          {m["res.change"]}
        </button>
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              startTransition(async () => setHits(await search(q)));
            }
          }}
          placeholder={label}
          aria-label={label}
          className="h-9 flex-1 rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm"
        />
        <button type="button" onClick={() => startTransition(async () => setHits(await search(q)))} className="h-9 rounded-full px-3 text-sm hover:bg-ink-5">
          {pending ? "…" : m["guests.search"]}
        </button>
      </div>
      {hits.length ? (
        <ul className="grid gap-1">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h)} className="text-left text-sm hover:underline">
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GuestPicker({ value, onPick, canCreate, m }: { value: Picked | null; onPick: (p: Picked | null) => void; canCreate: boolean; m: Messages }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-2">
      <span className="text-xs text-ink-60">{m["res.primaryGuest"]}</span>
      <Picker value={value} onPick={onPick} search={findGuests} label={m["guests.searchHint"]} m={m} />
      {!value && canCreate ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder={m["guests.firstName"]} aria-label={m["guests.firstName"]} className="h-9 rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm" />
          <input value={last} onChange={(e) => setLast(e.target.value)} placeholder={m["guests.lastName"]} aria-label={m["guests.lastName"]} className="h-9 rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm" />
          <button
            type="button"
            disabled={pending || !last.trim()}
            onClick={() =>
              startTransition(async () => {
                const r = await quickGuest({ firstName: first, lastName: last });
                if ("error" in r) setError(r.error);
                else onPick(r);
              })
            }
            className="h-9 rounded-full px-3 text-sm hover:bg-ink-5 disabled:opacity-40"
          >
            {m["res.newGuest"]}
          </button>
          {error ? <span className="text-xs text-danger">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
