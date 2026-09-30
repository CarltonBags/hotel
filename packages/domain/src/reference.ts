/**
 * Reference lists for property setup. EU-wide, DACH first (map Notes).
 * Codes are ISO 3166-1 alpha-2 and ISO 4217.
 */
export const COUNTRIES = [
  "DE",
  "AT",
  "CH",
  "IT",
  "FR",
  "NL",
  "BE",
  "LU",
  "DK",
  "SE",
  "NO",
  "FI",
  "PL",
  "CZ",
  "SK",
  "HU",
  "SI",
  "HR",
  "ES",
  "PT",
  "IE",
  "GR",
  "RO",
  "BG",
  "EE",
  "LV",
  "LT",
  "MT",
  "CY",
  "LI",
] as const;
export type CountryCode = (typeof COUNTRIES)[number];

export const CURRENCIES = ["EUR", "CHF", "DKK", "SEK", "NOK", "PLN", "CZK", "HUF", "RON", "BGN"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/** Default currency per country; the property may still choose another. */
export const DEFAULT_CURRENCY: Record<CountryCode, CurrencyCode> = {
  DE: "EUR",
  AT: "EUR",
  CH: "CHF",
  IT: "EUR",
  FR: "EUR",
  NL: "EUR",
  BE: "EUR",
  LU: "EUR",
  DK: "DKK",
  SE: "SEK",
  NO: "NOK",
  FI: "EUR",
  PL: "PLN",
  CZ: "CZK",
  SK: "EUR",
  HU: "HUF",
  SI: "EUR",
  HR: "EUR",
  ES: "EUR",
  PT: "EUR",
  IE: "EUR",
  GR: "EUR",
  RO: "RON",
  BG: "BGN",
  EE: "EUR",
  LV: "EUR",
  LT: "EUR",
  MT: "EUR",
  CY: "EUR",
  LI: "CHF",
};

export function isCountryCode(value: string): value is CountryCode {
  return (COUNTRIES as readonly string[]).includes(value);
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** IANA time zone names known to the runtime; validated against Intl so typos never reach the database. */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A moment shown in the property's local time, named as such (decided in "Staff app languages and time zones"). */
export function formatInPropertyTime(moment: Date, timeZone: string, locale: "de" | "en" = "en"): string {
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(moment);
}
