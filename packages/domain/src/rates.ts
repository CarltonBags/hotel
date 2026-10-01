/**
 * Rate rules from "Rates and restrictions model" and ADR 0012: a Rate Plan
 * spans room types; derived plans follow a base by amount or percentage and
 * their daily values are stored; per-occupancy prices come from Supplements.
 * Pure functions; money is gross in the property currency (ADR 0010).
 */

import { roundMoney as round2 } from "./money";

export const DERIVATION_KINDS = ["amount", "percent"] as const;
export type DerivationKind = (typeof DERIVATION_KINDS)[number];
export interface Derivation {
  kind: DerivationKind;
  /** Signed: -10 means ten (euros or percent) below the base. */
  value: number;
}

/** A derived plan's price for one base price; never below zero. */
export function derivedPrice(base: number, d: Derivation): number {
  const raw = d.kind === "amount" ? base + d.value : base * (1 + d.value / 100);
  return Math.max(0, round2(raw));
}

export const SUPPLEMENT_KINDS = ["single", "extra_adult", "child"] as const;
export type SupplementKind = (typeof SUPPLEMENT_KINDS)[number];
export interface Supplement {
  kind: SupplementKind;
  /** Only for kind "child". */
  ageBandId?: string | undefined;
  /** Signed amount per night; a single-use reduction is negative. */
  amount: number;
}

export interface AgeBandRef {
  id: string;
  minAge: number;
  maxAge: number | null;
}

export interface Occupancy {
  adults: number;
  childAges: number[];
}

export interface PricedPlan {
  /** Rate at base occupancy. */
  rate: number;
  baseOccupancy: number;
  supplements: Supplement[];
}

/**
 * Price for one night at an occupancy: the rate, a single-use supplement when
 * one adult sleeps in a room priced for two or more, an extra-adult supplement
 * for each adult above base occupancy, and the child supplement of each
 * child's Age Band. A child whose age fits no band counts as an adult.
 */
export function occupancyPrice(plan: PricedPlan, occupancy: Occupancy, bands: AgeBandRef[]): number {
  const by = (kind: SupplementKind, ageBandId?: string) => plan.supplements.find((s) => s.kind === kind && (kind !== "child" || s.ageBandId === ageBandId))?.amount ?? 0;
  let adults = occupancy.adults;
  let total = plan.rate;
  for (const age of occupancy.childAges) {
    const band = bands.find((b) => age >= b.minAge && (b.maxAge === null || age <= b.maxAge));
    if (band) total += by("child", band.id);
    else adults += 1;
  }
  if (adults === 1 && plan.baseOccupancy >= 2) total += by("single");
  if (adults > plan.baseOccupancy) total += (adults - plan.baseOccupancy) * by("extra_adult");
  return Math.max(0, round2(total));
}

/** Adult-only prices from one up to a room type's max adults, as channels want them. */
export function occupancyPrices(plan: PricedPlan, maxAdults: number): { adults: number; price: number }[] {
  const out: { adults: number; price: number }[] = [];
  for (let adults = 1; adults <= maxAdults; adults++) out.push({ adults, price: occupancyPrice(plan, { adults, childAges: [] }, []) });
  return out;
}

export const RESTRICTION_FIELDS = ["stopSell", "closedToArrival", "closedToDeparture", "minStayArrival", "minStayThrough", "maxStay"] as const;
export type RestrictionField = (typeof RESTRICTION_FIELDS)[number];
export interface Restriction {
  stopSell: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minStayArrival: number | null;
  minStayThrough: number | null;
  maxStay: number | null;
}
export const OPEN_RESTRICTION: Restriction = { stopSell: false, closedToArrival: false, closedToDeparture: false, minStayArrival: null, minStayThrough: null, maxStay: null };

/** Which restriction fields a derived plan takes from its base. */
export type RestrictionInheritance = Record<RestrictionField, boolean>;
export const INHERIT_ALL: RestrictionInheritance = { stopSell: true, closedToArrival: true, closedToDeparture: true, minStayArrival: true, minStayThrough: true, maxStay: true };

export function effectiveRestriction(own: Restriction, base: Restriction, inherits: RestrictionInheritance): Restriction {
  const out = { ...own };
  for (const f of RESTRICTION_FIELDS) if (inherits[f]) (out as Record<RestrictionField, boolean | number | null>)[f] = base[f];
  return out;
}

export const MEAL_PLANS = ["none", "breakfast", "half_board", "full_board"] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];

export const PAYMENT_KINDS = ["full", "deposit_percent", "deposit_first_night", "card_guarantee", "none"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const FEE_KINDS = ["none", "first_night", "percent", "full_stay"] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

/** Limits of the chosen channel manager per property ("Channel manager selection"). */
export const CHANNEL_LIMITS = { roomTypes: 20, projectedRatePlans: 200 } as const;

/** Projected rate plans are rate plans times the room types each spans. Returns the problem or null. */
export function checkPlanLimits(counts: { roomTypes: number; projectedRatePlans: number }): string | null {
  if (counts.roomTypes > CHANNEL_LIMITS.roomTypes) return `At most ${CHANNEL_LIMITS.roomTypes} room types per property`;
  if (counts.projectedRatePlans > CHANNEL_LIMITS.projectedRatePlans) return `At most ${CHANNEL_LIMITS.projectedRatePlans} projected rate plans (rate plans × room types) per property`;
  return null;
}

export function isOneOf<T extends readonly string[]>(list: T, value: string): value is T[number] {
  return (list as readonly string[]).includes(value);
}
