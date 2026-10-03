/**
 * City Tax (ticket 30, decided in "City tax rule configuration"): one dated
 * City Tax Rule per property, computed per guest-night on the base (the room
 * part without VAT and included Services, plus Services the property marks).
 * Three kinds: a percentage of the base with an optional cap on taxed nights,
 * a step table per person-night chosen by the band the price falls into, or a
 * flat amount per person-night by season and age. Rounded per night.
 */
import { roundMoney } from "./money";

export const CITY_TAX_KINDS = ["percentage", "step_table", "flat"] as const;
export type CityTaxKind = (typeof CITY_TAX_KINDS)[number];

/** Reasons a guest owes no City Tax; "age" and "long_stay" apply automatically from their setting. */
export const CITY_TAX_EXEMPTION_REASONS = ["age", "business_travel", "resident", "disability", "long_stay", "student", "other"] as const;
export type CityTaxExemptionReason = (typeof CITY_TAX_EXEMPTION_REASONS)[number];
/** Reasons Front Desk sets per guest; the others follow from the stay. */
export const MANUAL_EXEMPTION_REASONS: readonly CityTaxExemptionReason[] = ["business_travel", "resident", "disability", "student", "other"];

export const CITY_TAX_EVIDENCE = ["none", "note", "document"] as const;
export type CityTaxEvidence = (typeof CITY_TAX_EVIDENCE)[number];

export const CITY_TAX_PASS_ON = ["on_top", "absorbed"] as const;
export type CityTaxPassOn = (typeof CITY_TAX_PASS_ON)[number];

export interface CityTaxStep {
  /** Upper bound of the band (inclusive); null = no bound. */
  upTo: number | null;
  /** Per person-night. */
  amount: number;
}

export interface CityTaxFlat {
  /** Season as MM-DD, inclusive; may wrap the year end. null = all year. */
  from: string | null;
  to: string | null;
  /** Age range, inclusive; an adult without a known age matches an open maxAge. */
  minAge: number | null;
  maxAge: number | null;
  amount: number;
}

export interface CityTaxVersion {
  id?: string;
  /** Valid for nights from this date. */
  validFrom: string;
  /** Only for bookings made from this date (earlier bookings keep the previous version). */
  bookedFrom: string | null;
  kind: CityTaxKind;
  /** percentage: rate in % of the base, and the number of consecutive nights taxed at most. */
  percent: number | null;
  nightCap: number | null;
  /** step_table: the band is chosen by the price per person or per room. */
  stepBasis: "per_person" | "per_room";
  steps: CityTaxStep[];
  /** step_table: beyond the last bounded band, this amount for each further started `beyondEvery`. */
  beyondEvery: number | null;
  beyondAmount: number | null;
  /** flat: amount per person-night by season and age; the first matching entry counts. */
  flat: CityTaxFlat[];
}

export interface CityTaxReasonSetting {
  reason: CityTaxExemptionReason;
  evidence: CityTaxEvidence;
  /** age: exempt under this age; long_stay: exempt after this many nights. */
  param: number | null;
}

export interface CityTaxRuleSpec {
  versions: CityTaxVersion[];
  /** The exemption reasons the property enables. */
  reasons: CityTaxReasonSetting[];
}

export interface CityTaxStay {
  /** The day the booking was made (property date). */
  bookedOn: string;
  /** Each night of the stay with its base (net). */
  nights: { date: string; base: number }[];
  /** Everyone staying: adults with age null, children with their age; an exemption set by Front Desk. */
  persons: { age: number | null; exemption?: CityTaxExemptionReason | null }[];
}

export type CityTaxExemptKey = CityTaxExemptionReason | "night_cap";

export interface CityTaxNight {
  date: string;
  /** The version applied; null when no version is in force (no tax). */
  versionId: string | null;
  persons: number;
  taxable: number;
  base: number;
  tax: number;
  /** Persons not taxed this night, by reason. */
  exempt: Partial<Record<CityTaxExemptKey, number>>;
}

/** The version in force for a night of a booking made on `bookedOn`. */
export function versionFor<V extends CityTaxVersion>(versions: V[], date: string, bookedOn: string): V | undefined {
  return versions
    .filter((v) => v.validFrom <= date && (v.bookedFrom === null || bookedOn >= v.bookedFrom))
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0))[0];
}

/** Step table: the amount per person-night for a price. */
export function stepAmount(v: Pick<CityTaxVersion, "steps" | "beyondEvery" | "beyondAmount">, price: number): number {
  const steps = [...v.steps].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const band = steps.find((s) => s.upTo === null || price <= s.upTo);
  if (band) return band.amount;
  const last = steps.at(-1);
  if (!last || last.upTo === null || !v.beyondEvery || !v.beyondAmount) return last?.amount ?? 0;
  return roundMoney(last.amount + Math.ceil(roundMoney(price - last.upTo) / v.beyondEvery) * v.beyondAmount);
}

const inSeason = (f: CityTaxFlat, date: string) => {
  if (!f.from || !f.to) return true;
  const md = date.slice(5);
  return f.from <= f.to ? md >= f.from && md <= f.to : md >= f.from || md <= f.to;
};
const ofAge = (f: CityTaxFlat, age: number | null) => (age === null ? f.maxAge === null : (f.minAge ?? 0) <= age && (f.maxAge === null || age <= f.maxAge));

/** The City Tax of each night of a stay. */
export function cityTax(rule: CityTaxRuleSpec, stay: CityTaxStay): CityTaxNight[] {
  const setting = (r: CityTaxExemptionReason) => rule.reasons.find((x) => x.reason === r);
  const age = setting("age");
  const longStay = setting("long_stay");
  const nights = [...stay.nights].sort((a, b) => (a.date < b.date ? -1 : 1));
  return nights.map((n, i) => {
    const v = versionFor(rule.versions, n.date, stay.bookedOn);
    const persons = stay.persons.length;
    const base = roundMoney(n.base);
    if (!v) return { date: n.date, versionId: null, persons, taxable: 0, base, tax: 0, exempt: {} };
    const exempt: CityTaxNight["exempt"] = {};
    const whole: CityTaxExemptKey | null =
      v.kind === "percentage" && v.nightCap !== null && i + 1 > v.nightCap ? "night_cap" : longStay?.param != null && i + 1 > longStay.param ? "long_stay" : null;
    const taxed = stay.persons.filter((p) => {
      const reason: CityTaxExemptKey | null =
        whole ?? (age?.param != null && p.age !== null && p.age < age.param ? "age" : p.exemption && MANUAL_EXEMPTION_REASONS.includes(p.exemption) && setting(p.exemption) ? p.exemption : null);
      if (reason) exempt[reason] = (exempt[reason] ?? 0) + 1;
      return !reason;
    });
    let tax = 0;
    if (taxed.length && persons) {
      if (v.kind === "percentage") tax = roundMoney((base * (v.percent ?? 0) * taxed.length) / persons / 100);
      else if (v.kind === "step_table") tax = roundMoney(stepAmount(v, v.stepBasis === "per_person" ? base / persons : base) * taxed.length);
      else tax = roundMoney(taxed.reduce((s, p) => s + (v.flat.find((f) => inSeason(f, n.date) && ofAge(f, p.age))?.amount ?? 0), 0));
    }
    return { date: n.date, versionId: v.id ?? null, persons, taxable: taxed.length, base, tax, exempt };
  });
}

const version = (v: Partial<CityTaxVersion> & Pick<CityTaxVersion, "validFrom" | "kind">): CityTaxVersion => ({
  bookedFrom: null,
  percent: null,
  nightCap: null,
  stepBasis: "per_person",
  steps: [],
  beyondEvery: null,
  beyondAmount: null,
  flat: [],
  ...v,
});

export type CityTaxPreset = "berlin" | "hamburg" | "wien";

/**
 * Presets from the DACH research (docs/research/dach-compliance.md §2), to be
 * copied and adjusted by the property: verify with your municipality.
 */
export const CITY_TAX_PRESETS: Record<CityTaxPreset, CityTaxRuleSpec & { name: string }> = {
  // Übernachtungsteuer: 7.5 % of the net price of the stay, first 21 consecutive nights (§ 1 (3) ÜnStG)
  berlin: { name: "Berlin Übernachtungsteuer", versions: [version({ validFrom: "2025-01-01", kind: "percentage", percent: 7.5, nightCap: 21 })], reasons: [] },
  // Kultur- und Tourismustaxe: step table per person-night on the net price (bookings from 1 Jan 2025), no exemptions
  hamburg: {
    name: "Hamburg Kultur- und Tourismustaxe",
    versions: [
      version({
        validFrom: "2025-01-01",
        bookedFrom: "2025-01-01",
        kind: "step_table",
        stepBasis: "per_person",
        steps: [
          { upTo: 10, amount: 0 },
          { upTo: 25, amount: 0.6 },
          { upTo: 50, amount: 1.2 },
          { upTo: 100, amount: 2.4 },
          { upTo: 150, amount: 3.6 },
          { upTo: 200, amount: 4.8 },
        ],
        beyondEvery: 50,
        beyondAmount: 1.2,
      }),
    ],
    reasons: [],
  },
  // Ortstaxe (WTFG § 14): 3.2 %, 5 % from 1 Jul 2026, 8 % from 1 Jul 2027; students and stays over three months exempt
  wien: {
    name: "Wien Ortstaxe",
    versions: [
      version({ validFrom: "2024-01-01", kind: "percentage", percent: 3.2 }),
      version({ validFrom: "2026-07-01", kind: "percentage", percent: 5 }),
      version({ validFrom: "2027-07-01", kind: "percentage", percent: 8 }),
    ],
    reasons: [
      { reason: "student", evidence: "document", param: null },
      { reason: "long_stay", evidence: "none", param: 90 },
    ],
  },
};

// ── tables as text, for the settings form ──

const amountOf = (s: string) => {
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || roundMoney(n) !== n) throw new Error(`"${s}" is not an amount in cents`);
  return n;
};

/** Step table, one band per line: "up to" and amount ("25 0.60"); "* 4.80" for the open last band. */
export function parseCityTaxSteps(text: string): CityTaxStep[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [upTo, amount, extra] = l.split(/\s+/);
      if (!upTo || !amount || extra) throw new Error(`Band "${l}": write the upper bound and the amount, as "25 0.60"`);
      return { upTo: upTo === "*" ? null : amountOf(upTo), amount: amountOf(amount) };
    });
}

export function formatCityTaxSteps(steps: CityTaxStep[]): string {
  return steps.map((s) => `${s.upTo === null ? "*" : s.upTo.toFixed(2)} ${s.amount.toFixed(2)}`).join("\n");
}

/** Flat amounts, one per line: season ("06-01..09-30" or "*"), ages ("16+", "6-15" or "*") and amount: "06-01..09-30 16+ 3.00". */
export function parseCityTaxFlat(text: string): CityTaxFlat[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [season, ages, amount, extra] = l.split(/\s+/);
      const bad = () => new Error(`Line "${l}": write season, ages and amount, as "06-01..09-30 16+ 3.00" or "* * 2.00"`);
      if (!season || !ages || !amount || extra) throw bad();
      let from: string | null = null;
      let to: string | null = null;
      if (season !== "*") {
        const m = /^(\d{2}-\d{2})\.\.(\d{2}-\d{2})$/.exec(season);
        if (!m) throw bad();
        [from, to] = [m[1]!, m[2]!];
      }
      let minAge: number | null = null;
      let maxAge: number | null = null;
      if (ages !== "*") {
        const m = /^(\d+)(\+|-(\d+))$/.exec(ages);
        if (!m) throw bad();
        minAge = Number(m[1]);
        maxAge = m[3] === undefined ? null : Number(m[3]);
      }
      return { from, to, minAge, maxAge, amount: amountOf(amount) };
    });
}

export function formatCityTaxFlat(flat: CityTaxFlat[]): string {
  return flat
    .map((f) => {
      const season = f.from && f.to ? `${f.from}..${f.to}` : "*";
      const ages = f.minAge === null && f.maxAge === null ? "*" : f.maxAge === null ? `${f.minAge ?? 0}+` : `${f.minAge ?? 0}-${f.maxAge}`;
      return `${season} ${ages} ${f.amount.toFixed(2)}`;
    })
    .join("\n");
}
