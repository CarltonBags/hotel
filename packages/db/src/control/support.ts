import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { maintenanceProblem, monthlyAvailability, serviceState, supportReasonProblem, type IncidentImpact, type ServiceState } from "@hoteloftware/domain";

/**
 * Support access and the status page (ticket 93, decided in "Support and
 * service levels"). Support staff open any customer's tenant without asking
 * each time; every access is logged with person, time and reason and shown to
 * the customer's Owner. The status page shows the service state, incidents,
 * planned maintenance and the measured monthly availability.
 */

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
/** A support access lasts a working session at most. */
const ACCESS_HOURS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function isSupportStaff(pool: Pool, userId: string): Promise<boolean> {
  return (await pool.query("select 1 from control.support_staff where user_id = $1", [userId])).rowCount === 1;
}

/** Make a user of the platform's own tenant support staff (from the command line). */
export async function addSupportStaff(pool: Pool, userId: string, addedBy: string | null): Promise<void> {
  await pool.query("insert into control.support_staff (user_id, added_by) values ($1, $2) on conflict do nothing", [userId, addedBy]);
}

/** Customers' tenants for the support console. */
export async function listTenantsForSupport(pool: Pool): Promise<{ id: string; slug: string; name: string }[]> {
  return (await pool.query<{ id: string; slug: string; name: string }>("select id, slug, name from control.tenants order by name")).rows;
}

/** Open a customer's tenant: logged with person, time and reason; returns a one-session token for the tenant's subdomain. */
export async function startSupportAccess(pool: Pool, input: { staffUserId: string; tenantId: string; reason: string }): Promise<{ accessId: string; token: string; slug: string }> {
  const problem = supportReasonProblem(input.reason);
  if (problem) throw new Error("Give the reason for the access (at least 10 characters), for example the ticket it serves");
  if (!(await isSupportStaff(pool, input.staffUserId))) throw new Error("Only support staff open customers' tenants");
  if (!UUID.test(input.tenantId)) throw new Error("Tenant not found");
  const tenant = (await pool.query<{ slug: string }>("select slug from control.tenants where id = $1", [input.tenantId])).rows[0];
  if (!tenant) throw new Error("Tenant not found");
  const token = randomBytes(32).toString("base64url");
  const { rows } = await pool.query<{ id: string }>(
    "insert into control.support_accesses (staff_user_id, tenant_id, reason, token_hash, expires_at) values ($1, $2, $3, $4, now() + make_interval(hours => $5)) returning id",
    [input.staffUserId, input.tenantId, input.reason.trim().slice(0, 500), hash(token), ACCESS_HOURS],
  );
  return { accessId: rows[0]!.id, token, slug: tenant.slug };
}

export interface SupportSession {
  accessId: string;
  staffUserId: string;
  staffName: string;
  staffEmail: string;
  reason: string;
  expiresAt: Date;
}

/** The support access a token stands for at this tenant, while it lasts. */
export async function supportSessionFor(pool: Pool, token: string | null | undefined, tenantId: string): Promise<SupportSession | null> {
  if (!token) return null;
  const r = (await pool.query<{ id: string; staff_user_id: string; name: string; email: string; reason: string; expires_at: Date }>(
    `select a.id, a.staff_user_id, u.name, u.email, a.reason, a.expires_at from control.support_accesses a join control."user" u on u.id = a.staff_user_id
     join control.support_staff s on s.user_id = a.staff_user_id
     where a.token_hash = $1 and a.tenant_id = $2 and a.ended_at is null and a.expires_at > now()`,
    [hash(token), tenantId],
  )).rows[0];
  return r ? { accessId: r.id, staffUserId: r.staff_user_id, staffName: r.name, staffEmail: r.email, reason: r.reason, expiresAt: r.expires_at } : null;
}

export async function endSupportAccess(pool: Pool, accessId: string): Promise<void> {
  if (!UUID.test(accessId)) return;
  await pool.query("update control.support_accesses set ended_at = now() where id = $1 and ended_at is null", [accessId]);
}

export interface SupportAccessEntry {
  id: string;
  staffName: string;
  reason: string;
  startedAt: Date;
  endedAt: Date | null;
  expiresAt: Date;
}

/** The tenant's support access list, newest first (the Owner's view). */
export async function listSupportAccesses(pool: Pool, tenantId: string): Promise<SupportAccessEntry[]> {
  const { rows } = await pool.query<{ id: string; name: string; reason: string; started_at: Date; ended_at: Date | null; expires_at: Date }>(
    `select a.id, u.name, a.reason, a.started_at, a.ended_at, a.expires_at from control.support_accesses a join control."user" u on u.id = a.staff_user_id
     where a.tenant_id = $1 order by a.started_at desc limit 500`,
    [tenantId],
  );
  return rows.map((r) => ({ id: r.id, staffName: r.name, reason: r.reason, startedAt: r.started_at, endedAt: r.ended_at, expiresAt: r.expires_at }));
}

export interface Incident {
  id: string;
  title: string;
  impact: IncidentImpact;
  startedAt: Date;
  resolvedAt: Date | null;
  updates: { state: string; message: string; at: Date }[];
}

export interface StatusPage {
  state: ServiceState;
  open: Incident[];
  recent: Incident[];
  maintenance: { id: string; title: string; description: string; startsAt: Date; endsAt: Date }[];
  availability: { month: string; downMinutes: number; percent: number; met: boolean }[];
}

/** Everything the public status page shows. */
export async function statusPage(pool: Pool, now = new Date()): Promise<StatusPage> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const incidents = (await pool.query<{ id: string; title: string; impact: IncidentImpact; started_at: Date; resolved_at: Date | null }>(
    "select id, title, impact, started_at, resolved_at from control.status_incidents where resolved_at is null or resolved_at >= $1 order by started_at desc",
    [since],
  )).rows;
  const updates = (await pool.query<{ incident_id: string; state: string; message: string; at: Date }>(
    "select incident_id, state, message, at from control.status_incident_updates where incident_id = any($1::uuid[]) order by at desc",
    [incidents.map((i) => i.id)],
  )).rows;
  const list: Incident[] = incidents.map((i) => ({
    id: i.id,
    title: i.title,
    impact: i.impact,
    startedAt: i.started_at,
    resolvedAt: i.resolved_at,
    updates: updates.filter((u) => u.incident_id === i.id).map((u) => ({ state: u.state, message: u.message, at: u.at })),
  }));
  const maintenance = (await pool.query<{ id: string; title: string; description: string; starts_at: Date; ends_at: Date }>(
    "select id, title, description, starts_at, ends_at from control.maintenance_windows where cancelled_at is null and ends_at > $1 order by starts_at",
    [now],
  )).rows;
  const months = [0, 1, 2].map((k) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const asInput = list.map((i) => ({ impact: i.impact, startedAt: i.startedAt.toISOString(), resolvedAt: i.resolvedAt?.toISOString() ?? null }));
  return {
    state: serviceState(asInput),
    open: list.filter((i) => !i.resolvedAt),
    recent: list.filter((i) => i.resolvedAt).slice(0, 10),
    maintenance: maintenance.map((m) => ({ id: m.id, title: m.title, description: m.description, startsAt: m.starts_at, endsAt: m.ends_at })),
    availability: months.map((month) => ({ month, ...monthlyAvailability(month, asInput, now) })),
  };
}

/** Report an incident (support staff): it shows on the status page at once. */
export async function reportIncident(pool: Pool, input: { title: string; impact: IncidentImpact; message: string; startedAt?: Date }, userId: string): Promise<string> {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new Error("Give the incident a title");
  if (input.impact !== "minor" && input.impact !== "major") throw new Error("Minor or major");
  const startedAt = input.startedAt ?? new Date();
  const { rows } = await pool.query<{ id: string }>("insert into control.status_incidents (title, impact, started_at, created_by) values ($1, $2, $3, $4) returning id", [title, input.impact, startedAt, userId]);
  await pool.query("insert into control.status_incident_updates (incident_id, state, message, at, by_user) values ($1, 'investigating', $2, $3, $4)", [rows[0]!.id, input.message.trim() || title, startedAt, userId]);
  return rows[0]!.id;
}

/** An update to an incident; "resolved" ends it. */
export async function updateIncident(pool: Pool, incidentId: string, input: { state: "investigating" | "identified" | "monitoring" | "resolved"; message: string; at?: Date }, userId: string): Promise<void> {
  if (!UUID.test(incidentId)) throw new Error("Incident not found");
  if (!["investigating", "identified", "monitoring", "resolved"].includes(input.state)) throw new Error("Unknown state");
  const message = input.message.trim().slice(0, 1000);
  if (!message) throw new Error("Write the update");
  const open = await pool.query("select 1 from control.status_incidents where id = $1 and resolved_at is null", [incidentId]);
  if (!open.rowCount) throw new Error("The incident is resolved");
  const at = input.at ?? new Date();
  await pool.query("insert into control.status_incident_updates (incident_id, state, message, at, by_user) values ($1, $2, $3, $4, $5)", [incidentId, input.state, message, at, userId]);
  if (input.state === "resolved") await pool.query("update control.status_incidents set resolved_at = $2 where id = $1", [incidentId, at]);
}

/** Announce planned maintenance: 7 days ahead, between 02:00 and 05:00 property time (Central Europe for all properties of v1). */
export async function scheduleMaintenance(pool: Pool, input: { title: string; description: string; startsAt: Date; endsAt: Date }, userId: string, now = new Date()): Promise<string> {
  const problem = maintenanceProblem({ startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() }, now, "Europe/Berlin");
  if (problem === "too_soon") throw new Error("Planned maintenance is announced at least 7 days ahead");
  if (problem === "outside_window") throw new Error("Planned maintenance lies between 02:00 and 05:00 property time");
  if (problem) throw new Error("The end is before the start");
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new Error("Give the maintenance a title");
  const { rows } = await pool.query<{ id: string }>("insert into control.maintenance_windows (title, description, starts_at, ends_at, created_by, announced_at) values ($1, $2, $3, $4, $5, $6) returning id", [
    title,
    input.description.trim().slice(0, 1000),
    input.startsAt,
    input.endsAt,
    userId,
    now,
  ]);
  return rows[0]!.id;
}
