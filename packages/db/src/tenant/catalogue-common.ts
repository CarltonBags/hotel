/** Helpers shared by the catalogue repositories (Tax Codes, Services). */

export function uniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** Short codes are upper-case A-Z, 0-9 and underscore; anything else collapses to an underscore. */
export function normaliseCode(code: string): string {
  const c = code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  if (!c) throw new Error("Code is required");
  return c;
}

/** Strict YYYY-MM-DD: rejects impossible dates such as 2026-02-31 that Date.parse would accept. */
export function checkDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD");
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) throw new Error(`${date} is not a calendar date`);
  return date;
}

/** Preset rates start here: far enough back for any open business, no history before. */
export const PRESET_RATE_START = "2000-01-01";
