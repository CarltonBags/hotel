import { addDays } from "@hoteloftware/domain";

/** Reporting periods around a date: this month, this quarter, last quarter, this year. */
export function periodsAround(today: string): Record<"month" | "quarter" | "lastQuarter" | "year", { from: string; to: string }> {
  const y = Number(today.slice(0, 4));
  const mo = Number(today.slice(5, 7));
  const start = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const endOf = (yy: number, mm: number) => addDays(mm === 12 ? start(yy + 1, 1) : start(yy, mm + 1), -1);
  const q = Math.floor((mo - 1) / 3);
  const lastQ = q === 0 ? { yy: y - 1, m: 10 } : { yy: y, m: (q - 1) * 3 + 1 };
  return {
    month: { from: start(y, mo), to: endOf(y, mo) },
    quarter: { from: start(y, q * 3 + 1), to: endOf(y, q * 3 + 3) },
    lastQuarter: { from: start(lastQ.yy, lastQ.m), to: endOf(lastQ.yy, lastQ.m + 2) },
    year: { from: start(y, 1), to: endOf(y, 12) },
  };
}

export const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
