import { occupancyPrices, type Restriction, type Supplement } from "./rates";

/**
 * Pushing rates and availability to the channel manager (ticket 37): the
 * values of a range of days, compressed to runs of equal values, the prices
 * per occupancy from the Supplements, and what the rates grid says about it.
 */

/** Consecutive days with equal values as one range; a gap in the days starts a new one. Days sorted ascending. */
export function compressDays<T>(days: string[], value: (day: string) => T, same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)): { from: string; to: string; value: T }[] {
  const out: { from: string; to: string; value: T }[] = [];
  for (const d of days) {
    const v = value(d);
    const last = out[out.length - 1];
    if (last && same(last.value, v) && nextDay(last.to) === d) last.to = d;
    else out.push({ from: d, to: d, value: v });
  }
  return out;
}

function nextDay(d: string): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export interface ChannelRestrictionValue {
  rates: { occupancy: number; rate: number }[];
  stopSell: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  /** 1: no minimum. */
  minStayArrival: number;
  minStayThrough: number;
  /** 0: no maximum. */
  maxStay: number;
}

/** A date of an external rate plan: the price per adult count from the Supplements, the restrictions; a date without a price is closed. */
export function channelRestriction(price: number | null, r: Restriction, plan: { baseOccupancy: number; supplements: Supplement[] }, maxAdults: number): ChannelRestrictionValue {
  return {
    rates: price === null ? [] : occupancyPrices({ rate: price, baseOccupancy: plan.baseOccupancy, supplements: plan.supplements }, maxAdults).map((p) => ({ occupancy: p.adults, rate: p.price })),
    stopSell: price === null || r.stopSell,
    closedToArrival: r.closedToArrival,
    closedToDeparture: r.closedToDeparture,
    minStayArrival: r.minStayArrival ?? 1,
    minStayThrough: r.minStayThrough ?? 1,
    maxStay: r.maxStay ?? 0,
  };
}

/** Days a full push covers (Channex's certification asks for 500 days in two calls). */
export const FULL_PUSH_DAYS = 500;

export interface ChannelStatus {
  connected: boolean;
  /** Changes waiting to be sent. */
  pending: number;
  failing: boolean;
}

/** The rates grid header: what is waiting for the channels (with the time of the last send when up to date); null when the property has no channel connection. */
export function channelStatusText(s: ChannelStatus, language: "de" | "en", lastSent: string | null = null): string | null {
  if (!s.connected) return null;
  const de = language === "de";
  const changes = (n: number) => (de ? `${n} ${n === 1 ? "Änderung" : "Änderungen"}` : `${n} ${n === 1 ? "change" : "changes"}`);
  if (s.failing) return de ? `Kanäle: Übertragung gestört, ${changes(s.pending)} warten` : `Channels: sending fails, ${changes(s.pending)} waiting`;
  if (s.pending) return de ? `Sende ${changes(s.pending)}` : `Sending ${changes(s.pending)}`;
  const at = lastSent ? ` · ${lastSent}` : "";
  return de ? `Kanäle aktuell${at}` : `Channels up to date${at}`;
}
