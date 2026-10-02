/**
 * Display formats (decided in "Staff app languages and time zones"): dates,
 * numbers and currency follow the user's language; Swiss properties use the
 * Swiss number format; the week starts on Monday everywhere.
 */
export type Language = "de" | "en";
export const LANGUAGES: readonly Language[] = ["de", "en"];

export function isLanguage(value: string): value is Language {
  return value === "de" || value === "en";
}

/** BCP 47 locale for a language at a property in the given country. */
export function localeFor(language: Language, country: string): string {
  const c = country.toUpperCase();
  if (language === "de") return c === "AT" ? "de-AT" : c === "CH" || c === "LI" ? "de-CH" : "de-DE";
  return c === "CH" || c === "LI" ? "en-CH" : "en-GB";
}

export function formatNumber(value: number, language: Language, country: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeFor(language, country), { maximumFractionDigits: 3, ...options }).format(value);
}

export function formatCurrency(value: number, currency: string, language: Language, country: string): string {
  return new Intl.NumberFormat(localeFor(language, country), { style: "currency", currency }).format(value);
}

export function formatDate(moment: Date, language: Language, country: string, timeZone: string): string {
  return new Intl.DateTimeFormat(localeFor(language, country), { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(moment);
}

export function formatDateTime(moment: Date, language: Language, country: string, timeZone: string): string {
  return new Intl.DateTimeFormat(localeFor(language, country), { dateStyle: "medium", timeStyle: "short", timeZone }).format(moment);
}

/** 1 = Monday, as in Intl's getWeekInfo. Fixed for every language and property. */
export function weekStartsOn(): 1 {
  return 1;
}

/** A real calendar date as YYYY-MM-DD (rejects 2026-02-31); for dates arriving in URLs and forms. */
export function isCalendarDate(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
