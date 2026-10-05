/**
 * Channel bookings (ticket 38): what arrives from booking sites and the
 * hotel's website tool, turned into our prices per channel settings.
 */

/**
 * A channel price that already contains the City Tax, split backwards: the
 * room's gross price and the City Tax, so that together they are exactly the
 * channel price. `taxOf` gives the City Tax of a gross room price (the rule
 * works on the net price). Cents throughout.
 */
export function splitCityTaxIncluded(channelPrice: number, taxOf: (gross: number) => number): { gross: number; cityTax: number } {
  const total = Math.round(channelPrice * 100);
  if (total <= 0) return { gross: 0, cityTax: 0 };
  const cents = (g: number) => g + Math.round(taxOf(g / 100) * 100);
  // the highest gross whose total does not pass the channel price; the tax takes the rest (rounding)
  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cents(mid) <= total) lo = mid;
    else hi = mid - 1;
  }
  return { gross: lo / 100, cityTax: (total - lo) / 100 };
}

/** A channel price without VAT made gross. */
export function addVat(net: number, ratePercent: number): number {
  return Math.round(net * (1 + ratePercent / 100) * 100) / 100;
}

/**
 * A channel's nights in our terms: each night's gross split into the plan's
 * included Services (at their component price per person) and the room, which
 * takes the rest. When the Services would cost more than the night, the room
 * takes it all.
 */
export function channelNights(nights: { date: string; gross: number }[], includedServices: { serviceId: string; componentPrice: number }[], persons: number): { date: string; total: number; components: { kind: "room" | "service"; serviceId: string | null; persons: number | null; unitPrice: number; amount: number }[] }[] {
  const money = (n: number) => Math.round(n * 100) / 100;
  return nights.map((n) => {
    const services = includedServices.map((s) => ({ kind: "service" as const, serviceId: s.serviceId, persons, unitPrice: s.componentPrice, amount: money(s.componentPrice * persons) }));
    const room = money(n.gross - services.reduce((sum, s) => sum + s.amount, 0));
    const parts = room < 0 ? [] : services;
    const roomAmount = room < 0 ? money(n.gross) : room;
    return { date: n.date, total: money(n.gross), components: [{ kind: "room" as const, serviceId: null, persons: null, unitPrice: roomAmount, amount: roomAmount }, ...parts] };
  });
}
