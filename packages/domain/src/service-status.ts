/**
 * Support and service levels (ticket 93, decided in "Support and service
 * levels"): 99.95 % availability per month, measured from our own incident
 * record and published on the status page; planned maintenance announced 7
 * days ahead between 02:00 and 05:00 property time; support access to a
 * customer's tenant always with a reason.
 */

export const AVAILABILITY_TARGET = 99.95;
export const MAINTENANCE_NOTICE_DAYS = 7;

export type IncidentImpact = "minor" | "major";
export const INCIDENT_STATES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];
export type ServiceState = "operational" | "degraded" | "outage";

/**
 * The month's availability: minutes of major incidents (an outage) within the
 * month, up to now for the current month, against all minutes of the month
 * (the promise is per month: about 22 minutes).
 */
export function monthlyAvailability(month: string, incidents: { impact: IncidentImpact; startedAt: string; resolvedAt: string | null }[], now: Date): { downMinutes: number; percent: number; met: boolean } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = Date.UTC(y, m - 1, 1);
  const monthEnd = Date.UTC(y, m, 1);
  const end = Math.min(monthEnd, now.getTime());
  const minutes = (monthEnd - start) / 60_000;
  let down = 0;
  for (const i of incidents) {
    if (i.impact !== "major") continue;
    const from = Math.max(Date.parse(i.startedAt), start);
    const to = Math.min(i.resolvedAt ? Date.parse(i.resolvedAt) : now.getTime(), end);
    if (to > from) down += (to - from) / 60_000;
  }
  const downMinutes = Math.round(down);
  const percent = Math.floor((1 - down / minutes) * 100_000) / 1000;
  return { downMinutes, percent, met: percent >= AVAILABILITY_TARGET };
}

/** The state shown on the status page: the worst open incident. */
export function serviceState(incidents: { impact: IncidentImpact; resolvedAt: string | null }[]): ServiceState {
  const open = incidents.filter((i) => !i.resolvedAt);
  if (open.some((i) => i.impact === "major")) return "outage";
  return open.length ? "degraded" : "operational";
}

/** Hour and minute of an instant in a time zone. */
function localTime(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return get("hour") * 60 + get("minute");
}

/** Why a planned maintenance window is not allowed, or null: announced 7 days ahead, within 02:00 to 05:00 property time. */
export function maintenanceProblem(window: { startsAt: string; endsAt: string }, announcedAt: Date, timeZone: string): "ends_before_start" | "too_soon" | "outside_window" | null {
  const starts = new Date(window.startsAt);
  const ends = new Date(window.endsAt);
  if (!(ends > starts)) return "ends_before_start";
  if (starts.getTime() - announcedAt.getTime() < MAINTENANCE_NOTICE_DAYS * 86_400_000) return "too_soon";
  const a = localTime(starts, timeZone);
  const b = localTime(ends, timeZone);
  if (ends.getTime() - starts.getTime() > 3 * 3_600_000 || a < 120 || b > 300 || b < a) return "outside_window";
  return null;
}

/** A support access always says why. */
export function supportReasonProblem(reason: string): "missing" | "too_short" | null {
  const r = reason.trim();
  if (!r) return "missing";
  return r.length < 10 ? "too_short" : null;
}
