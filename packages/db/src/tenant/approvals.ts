import type { Pool, PoolClient } from "pg";
import { APPROVAL_TTL_HOURS, approvalStatus, type ApprovalKind, type ApprovalStatus } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * Approvals (ticket 31): a Property Manager's recorded consent that lets
 * another user complete an action beyond their role's limit. The action
 * refuses with ApprovalRequired, naming exactly what needs consent; the
 * requester asks (the Property Manager approves remotely, the request
 * expires after 24 hours) or the Property Manager approves on the same
 * screen with their credentials. A consent is used once, by the action it
 * names, in the action's own transaction.
 */

/** Exactly what an action needs consent for: its kind, its own key (the same action asks with the same key) and a readable summary. */
export interface ApprovalSubject {
  kind: ApprovalKind;
  propertyId: string;
  key: string;
  summary: string;
  /** The record it concerns (payment, reservation), for the audit log. */
  recordId: string | null;
}

/** An action beyond the user's limit, refused until a Property Manager consents. */
export class ApprovalRequired extends Error {
  constructor(readonly subject: ApprovalSubject) {
    super(`${subject.summary} needs a Property Manager's Approval`);
    this.name = "ApprovalRequired";
  }
}

/**
 * Inside the action's transaction, when it exceeds the user's limit: with
 * an approver (credentials checked by the caller, who also checked their
 * right to approve) the consent is recorded as granted and used; otherwise
 * an approved, unexpired request of this user for exactly this action is
 * used. Returns who approved, or throws ApprovalRequired.
 */
export async function useApproval(tx: PoolClient, subject: ApprovalSubject, actor: { userId: string; approverId?: string | null }): Promise<string> {
  if (actor.approverId) {
    if (actor.approverId === actor.userId) throw new Error("An Approval comes from another user");
    await tx.query(
      `insert into approvals (property_id, kind, subject_key, summary, record_id, requested_by, expires_at, status, decided_by, decided_at, in_place, used_at)
       values ($1, $2, $3, $4, $5, $6, clock_timestamp(), 'used', $7, clock_timestamp(), true, clock_timestamp())`,
      [subject.propertyId, subject.kind, subject.key, subject.summary, subject.recordId, actor.userId, actor.approverId],
    );
    return actor.approverId;
  }
  const { rows } = await tx.query<{ id: string; decided_by: string }>(
    `update approvals set status = 'used', used_at = clock_timestamp()
     where id = (select id from approvals where property_id = $1 and kind = $2 and subject_key = $3 and requested_by = $4 and status = 'approved' and expires_at > clock_timestamp()
                 order by decided_at limit 1 for update skip locked)
     returning id, decided_by`,
    [subject.propertyId, subject.kind, subject.key, actor.userId],
  );
  if (!rows[0]) throw new ApprovalRequired(subject);
  return rows[0].decided_by;
}

export interface Approval {
  id: string;
  propertyId: string;
  kind: ApprovalKind;
  summary: string;
  recordId: string | null;
  requestedBy: string;
  requestedAt: Date;
  expiresAt: Date;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string;
  inPlace: boolean;
}

interface Row {
  id: string;
  property_id: string;
  kind: ApprovalKind;
  summary: string;
  record_id: string | null;
  requested_by: string;
  requested_at: Date;
  expires_at: Date;
  status: Exclude<ApprovalStatus, "expired">;
  decided_by: string | null;
  decided_at: Date | null;
  note: string;
  in_place: boolean;
}
const COLUMNS = "id, property_id, kind, summary, record_id, requested_by, requested_at, expires_at, status, decided_by, decided_at, note, in_place";
const toApproval = (r: Row, now: Date): Approval => ({
  id: r.id,
  propertyId: r.property_id,
  kind: r.kind,
  summary: r.summary,
  recordId: r.record_id,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  expiresAt: r.expires_at,
  status: approvalStatus(r.status, r.expires_at, now),
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  note: r.note,
  inPlace: r.in_place,
});

/** Ask for a Property Manager's consent; asking again for the same action while one is open returns that one. */
export async function requestApproval(pool: Pool, schema: string, subject: ApprovalSubject, requestedBy: string): Promise<Approval & { created: boolean }> {
  return withTenant(pool, schema, async (tx) => {
    const open = (await tx.query<Row>(
      `select ${COLUMNS} from approvals where property_id = $1 and kind = $2 and subject_key = $3 and requested_by = $4 and status in ('pending', 'approved') and expires_at > clock_timestamp() limit 1`,
      [subject.propertyId, subject.kind, subject.key, requestedBy],
    )).rows[0];
    if (open) return { ...toApproval(open, new Date()), created: false };
    const { rows } = await tx.query<Row>(
      `insert into approvals (property_id, kind, subject_key, summary, record_id, requested_by, expires_at)
       values ($1, $2, $3, $4, $5, $6, clock_timestamp() + make_interval(hours => $7)) returning ${COLUMNS}`,
      [subject.propertyId, subject.kind, subject.key, subject.summary, subject.recordId, requestedBy, APPROVAL_TTL_HOURS],
    );
    return { ...toApproval(rows[0]!, new Date()), created: true };
  });
}

/** Approve or reject a pending request (the caller checked the approver's right at its property). */
export async function decideApproval(pool: Pool, schema: string, approvalId: string, decision: { approve: boolean; note: string }, approverId: string): Promise<Approval> {
  if (!isUuid(approvalId)) throw new Error("Approval request not found");
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<Row>(`select ${COLUMNS} from approvals where id = $1 for update`, [approvalId])).rows[0];
    if (!r) throw new Error("Approval request not found");
    const status = approvalStatus(r.status, r.expires_at, new Date());
    if (status === "expired") throw new Error("The request has expired; the user asks again");
    if (status !== "pending") throw new Error("The request is already decided");
    if (r.requested_by === approverId) throw new Error("An Approval comes from another user");
    const { rows } = await tx.query<Row>(
      `update approvals set status = $2, decided_by = $3, decided_at = clock_timestamp(), note = $4 where id = $1 returning ${COLUMNS}`,
      [approvalId, decision.approve ? "approved" : "rejected", approverId, decision.note.trim().slice(0, 300)],
    );
    return toApproval(rows[0]!, new Date());
  });
}

/** A property's requests, newest first (the last 30 days and everything still open). */
export async function listApprovals(pool: Pool, schema: string, propertyId: string): Promise<Approval[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const now = new Date();
    return (await tx.query<Row>(
      `select ${COLUMNS} from approvals where property_id = $1 and (requested_at > now() - interval '30 days' or status = 'pending') order by requested_at desc limit 300`,
      [propertyId],
    )).rows.map((r) => toApproval(r, now));
  });
}

export async function findApproval(pool: Pool, schema: string, approvalId: string): Promise<Approval | null> {
  if (!isUuid(approvalId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<Row>(`select ${COLUMNS} from approvals where id = $1`, [approvalId])).rows[0];
    return r ? toApproval(r, new Date()) : null;
  });
}
