import { REPORT_ACCESS, addDays, isReportKind, type Grain, type ReportKind } from "@hoteloftware/domain";
import type { Property, ReportRequest } from "@hoteloftware/db";
import { allowedAmong } from "./authorize";
import { loadShell } from "./shell";

export type ReportParams = Record<string, string | string[] | undefined>;

const one = (p: ReportParams, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The default period of a report, around the property's Business Date. */
function defaultRange(kind: ReportKind, today: string): { from: string; to: string } {
  if (kind === "pickup") return { from: today, to: addDays(today, 89) };
  if (kind === "housekeeping" || kind === "cash") return { from: addDays(today, -7), to: addDays(today, -1) };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/**
 * A report request from the page's query: the properties in the navbar's
 * scope where the user may see this report ("All properties": each one they
 * may), the period, grain, comparisons, room type, currency and stated rates.
 * Page, export and scheduling all go through here.
 */
export async function reportRequestFrom(kindParam: string, p: ReportParams): Promise<{ request: ReportRequest; properties: Property[] } | null> {
  if (!isReportKind(kindParam)) return null;
  const kind = kindParam;
  const shell = await loadShell();
  const language = shell.language === "de" ? "de" : "en";
  const inScope = shell.scope === "all" || !shell.scope ? shell.properties : shell.properties.filter((x) => x.id === shell.scope);
  const properties = await allowedAmong(REPORT_ACCESS[kind], inScope);
  if (!properties.length) return { request: { kind, from: "", to: "", propertyIds: [], grain: "day", compare: { previous: false, lastYear: false }, language }, properties };
  const today = properties[0]!.businessDate;
  const range = defaultRange(kind, today);
  const from = isDate(one(p, "from")) ? one(p, "from") : range.from;
  const to = isDate(one(p, "to")) ? one(p, "to") : range.to;
  const grain = (["day", "week", "month"] as const).find((g) => g === one(p, "grain")) ?? ("day" as Grain);
  const currency = /^[A-Z]{3}$/.test(one(p, "currency")) ? one(p, "currency") : properties[0]!.currency;
  const rates: Record<string, number> = {};
  for (const c of new Set(properties.map((x) => x.currency))) {
    const r = Number(one(p, `rate_${c}`).replace(",", "."));
    if (c !== currency && r > 0) rates[c] = r;
  }
  const roomTypeId = one(p, "roomType");
  return {
    properties,
    request: {
      kind,
      from,
      to,
      propertyIds: properties.map((x) => x.id),
      grain,
      byRoomType: one(p, "by") === "roomType",
      compare: { previous: one(p, "pp") === "on", lastYear: one(p, "ly") === "on", budget: one(p, "bu") === "on", forecast: one(p, "fc") === "on" },
      ...(roomTypeId ? { roomTypeId } : {}),
      ...(isDate(one(p, "since")) ? { pickupSince: one(p, "since") } : {}),
      currency,
      rates,
      language,
    },
  };
}
