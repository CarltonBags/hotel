"use client";

import { useEffect, useState, useTransition } from "react";
import { formatCurrency, nightsOf, type Language, type QuoteReason } from "@hoteloftware/domain";
import type { StayQuotes } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { createBookingAction, findCompanies, findGuests, quickGuest, type Picked } from "../actions";
import { GuestDrawer } from "../guest-drawer";

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
  /** Booked past Availability after the user's explicit confirmation. */
  force: boolean;
  guest: Picked | null;
}

const bar = "h-9 rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm";

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
  // the guest whose full details are open in the side drawer
  const [drawerGuest, setDrawerGuest] = useState<Picked | null>(null);
  const nights = quotes ? nightsOf(search.arrival, search.departure).length : 0;

  // rooms already in the cart that overlap the searched stay
  const inCart = (roomTypeId: string) => cart.filter((c) => c.roomTypeId === roomTypeId && c.arrival < search.departure && c.departure > search.arrival).length;
  const [overbookAsk, setOverbookAsk] = useState<null | { roomTypeId: string; ratePlanId: string; label: string; total: number; hidden: boolean }>(null);
  const add = (roomTypeId: string, ratePlanId: string, label: string, total: number, hidden: boolean, force = false) => {
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
        force,
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
          force: c.force,
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

  // the plans across all room types become the table's columns, in the order they first appear
  const columns = quotes ? [...new Map(quotes.roomTypes.flatMap((t) => t.plans.map((p) => [p.ratePlanId, p] as const))).values()] : [];
  const total = cart.reduce((sum, c) => sum + c.total, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form method="get" aria-label={m["res.stay"]} className="flex shrink-0 flex-wrap items-end gap-2 border-b border-ink-10 px-5 py-3">
        <h1 className="mr-2 self-center text-lg font-medium">
          {m["module.new_reservation"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <label className="grid gap-0.5 text-xs">
          <span className="text-ink-60">{m["res.arrival"]}</span>
          <input type="date" name="arrival" min={today} defaultValue={search.arrival} required className={bar} />
        </label>
        <label className="grid gap-0.5 text-xs">
          <span className="text-ink-60">{m["res.departure"]}</span>
          <input type="date" name="departure" defaultValue={search.departure} required className={bar} />
        </label>
        <label className="grid gap-0.5 text-xs">
          <span className="text-ink-60">{m["res.adults"]}</span>
          <input type="number" name="adults" min={1} max={20} defaultValue={search.adults} required className={`${bar} w-16`} />
        </label>
        <label className="grid gap-0.5 text-xs">
          <span className="text-ink-60">{m["res.childAges"]}</span>
          <input name="children" defaultValue={search.children} placeholder="7, 3" className={`${bar} w-24`} />
        </label>
        <label className="grid gap-0.5 text-xs">
          <span className="text-ink-60">{m["rates.rateCode"]}</span>
          <input name="rateCode" defaultValue={search.rateCode} className={`${bar} w-28`} />
        </label>
        <button type="submit" className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-white">
          {m["res.showAvailability"]}
        </button>
        {error ? (
          <p role="alert" className="basis-full text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <section aria-label={m["res.availability"]} className="min-w-0 flex-1 overflow-auto">
          {quotes ? (
            <div className="grid gap-2">
              <p className="text-sm text-ink-60">
                {fill(m["res.availabilityFor"], { nights: String(nights) })}
                {quotes.rateCode ? ` · ${fill(m["res.codeMatched"], { code: quotes.rateCode.code, company: quotes.rateCode.companyName ?? "–" })}` : ""}
              </p>
              {search.rateCode && !quotes.rateCode ? <p className="text-sm text-warning">{m["res.codeUnknown"]}</p> : null}
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-surface text-left text-xs text-ink-60">
                  <tr>
                    <th className="border-b border-ink-10 py-2 pr-3 font-normal">{m["res.roomType"]}</th>
                    {columns.map((p) => (
                      <th key={p.ratePlanId} className="border-b border-ink-10 px-2 py-2 font-normal">
                        <span className="font-medium text-ink">{p.name}</span>
                        <span className="block">
                          {m[`rates.mealPlan.${p.mealPlan}`]}
                          {p.hidden ? ` · ${m["rates.rateCode"]}` : ""}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quotes.roomTypes.map((t) => {
                    const left = t.available - inCart(t.roomTypeId);
                    return (
                      <tr key={t.roomTypeId} data-room-type={t.code} className="align-top">
                        <td className="border-b border-ink-5 py-2 pr-3">
                          <span className="font-medium">{t.code}</span> <span className="text-ink-60">{t.name}</span>
                          <span className={`block text-xs ${left > 0 ? "text-ink-60" : "text-danger"}`}>{fill(m["res.free"], { n: String(Math.max(0, left)), of: String(t.rooms) })}</span>
                        </td>
                        {columns.map((col) => {
                          const p = t.plans.find((x) => x.ratePlanId === col.ratePlanId);
                          if (!p) return <td key={col.ratePlanId} className="border-b border-ink-5 px-2 py-2 text-ink-40">–</td>;
                          const priced = p.quote.nights.length === nights;
                          const bookable = p.quote.bookable && left > 0;
                          const canOverbook = (left <= 0 || p.quote.reasons.includes("sold_out")) && p.quote.reasons.every((x) => x === "sold_out");
                          const label = `${t.code} · ${p.name}`;
                          return (
                            <td key={col.ratePlanId} data-plan={p.name} className="border-b border-ink-5 px-2 py-2">
                              {priced ? (
                                <span className="block tabular-nums">
                                  <strong>{money(p.quote.total)}</strong> <span className="text-xs text-ink-60">{fill(m["res.perNight"], { price: money(p.quote.total / nights) })}</span>
                                </span>
                              ) : null}
                              {bookable ? (
                                <button type="button" onClick={() => add(t.roomTypeId, p.ratePlanId, label, p.quote.total, p.hidden)} className="mt-1 rounded-full bg-accent px-3 py-0.5 text-xs font-medium text-white">
                                  {m["res.addRoom"]}
                                </button>
                              ) : (
                                <span className="block text-xs text-danger">{reasons(left <= 0 && p.quote.bookable ? ["sold_out"] : p.quote.reasons)}</span>
                              )}
                              {/* only lack of rooms can be overridden, and only after an explicit confirmation */}
                              {!bookable && canOverbook ? (
                                <button
                                  type="button"
                                  onClick={() => setOverbookAsk({ roomTypeId: t.roomTypeId, ratePlanId: p.ratePlanId, label, total: p.quote.total, hidden: p.hidden })}
                                  className="mt-1 rounded-full border border-danger px-3 py-0.5 text-xs font-medium text-danger"
                                >
                                  {m["res.overbook"]}
                                </button>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="grid h-full place-items-center text-sm text-ink-60">{m["res.searchFirst"]}</p>
          )}
        </section>

        <aside aria-label={m["res.booking"]} className="flex w-[400px] shrink-0 flex-col rounded-2xl bg-surface-2">
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <h2 className="font-medium">{m["res.booking"]}</h2>
            {cart.length === 0 ? <p className="mt-2 text-sm text-ink-60">{m["res.cartEmpty"]}</p> : null}
            <ol className="mt-2 grid gap-2">
              {cart.map((c, i) => (
                <li key={c.key} className="grid gap-2 rounded-xl bg-surface p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">
                        {i + 1}. {c.label}
                      </span>
                      {c.force ? <span className="ml-1 rounded-full bg-danger/15 px-2 text-xs text-danger">{m["res.overbooked"]}</span> : null}
                      <span className="block text-xs text-ink-60">
                        {c.arrival} – {c.departure} · {fill(m["res.occupancy"], { adults: String(c.adults) })}
                        {c.childAges.length ? ` · ${fill(m["res.children"], { ages: c.childAges.join(", ") })}` : ""}
                      </span>
                    </span>
                    <span className="tabular-nums">{money(c.total)}</span>
                    <button type="button" aria-label={m["action.delete"]} onClick={() => setCart((x) => x.filter((y) => y.key !== c.key))} className="text-ink-60 hover:text-danger">
                      ×
                    </button>
                  </div>
                  <GuestPicker
                    value={c.guest}
                    onPick={(g) => setCart((x) => x.map((y) => (y.key === c.key ? { ...y, guest: g } : y)))}
                    onDetails={setDrawerGuest}
                    canCreate={canCreateGuests}
                    m={m}
                  />
                </li>
              ))}
            </ol>
            {cart.length ? (
              <div className="mt-3 grid gap-3 text-sm">
                <fieldset className="grid gap-1">
                  <legend className="mb-1 font-medium">{m["res.booker"]}</legend>
                  <div className="flex flex-wrap gap-3 text-xs">
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
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} />
                  {m["res.walkIn"]} · {m["res.source"]}: {m["res.source.direct"]}
                </label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={m["res.notes"]} aria-label={m["res.notes"]} className="w-full rounded-xl border border-ink-10 bg-surface p-2 text-sm" />
              </div>
            ) : null}
          </div>
          {cart.length ? (
            <div className="grid gap-2 border-t border-ink-10 p-4">
              {message ? (
                <p role="alert" className="text-sm text-danger">
                  {message}
                </p>
              ) : null}
              <button type="button" onClick={submit} disabled={pending} className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-white shadow-pill disabled:opacity-60">
                {pending ? m["action.saving"] : fill(m["res.confirm"], { n: String(cart.length), total: money(total) })}
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      {overbookAsk ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4">
          <div role="alertdialog" aria-label={m["res.overbookTitle"]} className="grid max-w-md gap-2 rounded-2xl bg-surface p-5 text-sm shadow-pop">
            <p className="font-medium">{m["res.overbookTitle"]}</p>
            <p>{fill(m["res.overbookNew"], { room: overbookAsk.label })}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  add(overbookAsk.roomTypeId, overbookAsk.ratePlanId, overbookAsk.label, overbookAsk.total, overbookAsk.hidden, true);
                  setOverbookAsk(null);
                }}
                className="h-9 rounded-full bg-danger px-4 text-sm font-medium text-white"
              >
                {m["res.overbookConfirm"]}
              </button>
              <button type="button" onClick={() => setOverbookAsk(null)} className="h-9 rounded-full px-4 text-sm hover:bg-ink-5">
                {m["res.keepAsIs"]}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {drawerGuest ? <GuestDrawer guest={drawerGuest} propertyCountry={property.country} onClose={() => setDrawerGuest(null)} onSaved={(g) => setCart((x) => x.map((y) => (y.guest?.id === g.id ? { ...y, guest: g } : y)))} m={m} /> : null}
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

/**
 * The room's Primary Guest: one box to search by name, email or phone; a
 * typed "Last, First" can be created at once. "Details" opens the full guest
 * form in the side drawer.
 */
function GuestPicker({ value, onPick, onDetails, canCreate, m }: { value: Picked | null; onPick: (p: Picked | null) => void; onDetails: (p: Picked) => void; canCreate: boolean; m: Messages }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Picked[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-ink-60">{m["res.primaryGuest"]}</span>
        <span className="font-medium">{value.label}</span>
        <button type="button" onClick={() => onDetails(value)} className="text-xs underline">
          {m["res.guestDetails"]}
        </button>
        <button type="button" onClick={() => onPick(null)} className="ml-auto text-xs underline">
          {m["res.change"]}
        </button>
      </div>
    );
  }
  // "Tanaka, Aiko" or "Aiko Tanaka": the last word is the last name unless a comma says otherwise
  const typed = (() => {
    const t = q.trim();
    if (t.includes(",")) {
      const [last, first = ""] = t.split(",").map((x) => x.trim());
      return { firstName: first, lastName: last ?? "" };
    }
    const parts = t.split(/\s+/);
    return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
  })();
  const searchNow = () => startTransition(async () => setHits(await findGuests(q)));
  return (
    <div className="grid gap-1">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => (setQ(e.target.value), setHits(null))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              searchNow();
            }
          }}
          placeholder={m["res.guestSearchOrNew"]}
          aria-label={m["res.primaryGuest"]}
          className="h-9 flex-1 rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm"
        />
        <button type="button" disabled={q.trim().length < 2 || pending} onClick={searchNow} className="h-9 rounded-full px-3 text-sm hover:bg-ink-5 disabled:opacity-40">
          {pending ? "…" : m["guests.search"]}
        </button>
      </div>
      {hits ? (
        <ul className="grid gap-0.5 text-sm">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h)} className="w-full rounded-lg px-2 py-1 text-left hover:bg-ink-5">
                {h.label}
              </button>
            </li>
          ))}
          {hits.length === 0 ? <li className="px-2 text-xs text-ink-60">{m["res.noGuestFound"]}</li> : null}
          {canCreate && typed.lastName ? (
            <li>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await quickGuest(typed);
                    if ("error" in r) setError(r.error);
                    else onPick(r);
                  })
                }
                className="w-full rounded-lg px-2 py-1 text-left font-medium text-accent hover:bg-ink-5"
              >
                {fill(m["res.createGuest"], { name: `${typed.lastName}${typed.firstName ? `, ${typed.firstName}` : ""}` })}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
