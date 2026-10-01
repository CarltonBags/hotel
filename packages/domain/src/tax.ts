/**
 * Tax Codes (decided in "Folio, billing and invoicing domain model", ADR 0010):
 * gross is the stored truth, net and VAT are derived per Tax Code; a Tax
 * Code's rate is dated so an invoice re-renders identically later.
 */
export interface DatedRate {
  /** YYYY-MM-DD, first day the rate applies */
  validFrom: string;
  /** percent, e.g. 7 or 19 */
  rate: number;
}

/** The rate in force on a date (YYYY-MM-DD), or null before the first rate. */
export function taxRateOn(rates: DatedRate[], date: string): number | null {
  let best: DatedRate | null = null;
  for (const r of rates) {
    if (r.validFrom <= date && (!best || r.validFrom > best.validFrom)) best = r;
  }
  return best ? best.rate : null;
}

export interface GrossSplit {
  gross: number;
  net: number;
  vat: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Net and VAT from a gross amount at a percent rate; VAT is the rounded difference so the parts always sum to gross. */
export function splitGross(gross: number, ratePercent: number): GrossSplit {
  const g = round2(gross);
  const net = round2(g / (1 + ratePercent / 100));
  return { gross: g, net, vat: round2(g - net) };
}

export interface TaxPreset {
  code: string;
  name: string;
  /** Rate in force today. */
  rate: number;
  /** Full history when the rate changed within memory; defaults to the rate from 2000-01-01. */
  rates?: DatedRate[];
}

/**
 * Starting points per country (research "DACH legal and fiscal requirements"
 * and the outlet research). Labelled "verify with your tax advisor"; the
 * advisor's answers (gate 03) replace them.
 */
export const TAX_PRESETS: Record<"DE" | "AT" | "CH", TaxPreset[]> = {
  DE: [
    { code: "ACC", name: "Accommodation 7 %", rate: 7 },
    {
      code: "FOOD",
      name: "Food 7 %",
      rate: 7,
      rates: [
        { validFrom: "2000-01-01", rate: 19 },
        { validFrom: "2026-01-01", rate: 7 },
      ],
    },
    { code: "STD", name: "Standard 19 % (drinks, services)", rate: 19 },
    { code: "ZERO", name: "Exempt 0 %", rate: 0 },
  ],
  AT: [
    { code: "ACC", name: "Accommodation 10 %", rate: 10 },
    { code: "FOOD", name: "Food 10 %", rate: 10 },
    { code: "SPA", name: "Pool and thermal bath 13 %", rate: 13 },
    { code: "STD", name: "Standard 20 % (drinks, treatments)", rate: 20 },
    { code: "ZERO", name: "Exempt 0 %", rate: 0 },
  ],
  CH: [
    { code: "ACC", name: "Accommodation 3.8 %", rate: 3.8 },
    { code: "RED", name: "Reduced 2.6 % (food to take away)", rate: 2.6 },
    { code: "STD", name: "Standard 8.1 %", rate: 8.1 },
    { code: "ZERO", name: "Exempt 0 %", rate: 0 },
  ],
};

export function isTaxPresetCountry(value: string): value is keyof typeof TAX_PRESETS {
  return value in TAX_PRESETS;
}

export const POSTING_RHYTHMS = ["once", "per_night", "per_person_night"] as const;
export type PostingRhythm = (typeof POSTING_RHYTHMS)[number];

export function isPostingRhythm(value: string): value is PostingRhythm {
  return (POSTING_RHYTHMS as readonly string[]).includes(value);
}

/** Today's date (YYYY-MM-DD) in a time zone, the basis for "rate in force now" at a property. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
