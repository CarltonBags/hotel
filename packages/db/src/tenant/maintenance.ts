import type { Pool, PoolClient } from "pg";
import { ISSUE_PHOTO_DAYS, PROBLEM_PICKS, URGENCIES, addDays, can, type ProblemPick, type Urgency } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { fileIn, setFileRetention, type FileKind, type StoredFile } from "./files";
import { createRoomBlockIn, endRoomBlockIn, type Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * Maintenance Issues (ticket 36): anyone reports one for a room or a public
 * area, with photo and urgency, and may take the room out with a Room Block;
 * Maintenance works the queue (open, in progress, done) with photo and note.
 * Fixing an issue whose block is in force asks whether to end it; ending it
 * leaves the room Dirty. The reporter is told by the caller.
 */
export interface IssueReport {
  propertyId: string;
  roomId: string | null;
  /** A public area when there is no room. */
  place: string;
  pick: ProblemPick;
  urgency: Urgency;
  note: string;
  photoFileId: string | null;
  /** Take the room out from tonight for this many nights. */
  block: { kind: "out_of_order" | "out_of_service"; nights: number } | null;
}

/** The issue rights: who sees and works the queue. */
export function seesIssues(viewer: Viewer, propertyId: string): boolean {
  return can(viewer.actor, "work_maintenance", propertyId) || can(viewer.actor, "assign_housekeeping", propertyId) || can(viewer.actor, "manage_out_of_order", propertyId);
}

/** A file the user just uploaded for this purpose at this property; nobody attaches someone else's file. */
async function ownUpload(tx: PoolClient, fileId: string | null, kind: FileKind, propertyId: string, viewer: Viewer): Promise<string | null> {
  if (!fileId) return null;
  const f = await fileIn(tx, fileId);
  if (!f || f.kind !== kind || f.createdBy !== viewer.userId || (f.propertyId && f.propertyId !== propertyId)) throw new Error("Photo not found");
  // taken up: kept while the issue is worked
  await setFileRetention(tx, [f.id], null);
  return f.id;
}

export async function reportIssueIn(tx: PoolClient, input: IssueReport, viewer: Viewer, at = new Date()): Promise<{ id: string; blockId: string | null }> {
  if (!can(viewer.actor, "report_maintenance_issues", input.propertyId)) throw new Error("Not allowed to report Maintenance Issues here");
  if (!PROBLEM_PICKS.includes(input.pick) || !URGENCIES.includes(input.urgency)) throw new Error("Choose what is wrong and how urgent it is");
  const place = input.place.trim().slice(0, 120);
  if (input.roomId) {
    if (!isUuid(input.roomId) || !(await tx.query("select 1 from rooms where id = $1 and property_id = $2", [input.roomId, input.propertyId])).rows.length) throw new Error("Room not found");
  } else if (!place) throw new Error("Name the room or the place");
  const photo = await ownUpload(tx, input.photoFileId, "issue_photo", input.propertyId, viewer);
  let blockId: string | null = null;
  if (input.block) {
    if (!input.roomId) throw new Error("A Room Block needs a room");
    if (!Number.isInteger(input.block.nights) || input.block.nights < 1 || input.block.nights > 90) throw new Error("Block for 1 to 90 nights");
    const bd = (await tx.query<{ d: string }>("select to_char(business_date, 'YYYY-MM-DD') as d from properties where id = $1", [input.propertyId])).rows[0]!.d;
    blockId = (await createRoomBlockIn(tx, { roomId: input.roomId, kind: input.block.kind, from: bd, to: addDays(bd, input.block.nights), reason: `Maintenance: ${input.pick}${input.note ? ` – ${input.note}` : ""}` }, viewer)).id;
  }
  const { rows } = await tx.query<{ id: string }>(
    `insert into maintenance_issues (property_id, room_id, place, pick, urgency, note, photo_file_id, block_id, reported_at, reported_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [input.propertyId, input.roomId, input.roomId ? "" : place, input.pick, input.urgency, input.note.trim().slice(0, 1000), photo, blockId, at, viewer.userId],
  );
  return { id: rows[0]!.id, blockId };
}

export async function reportIssue(pool: Pool, schema: string, input: IssueReport, viewer: Viewer): Promise<{ id: string; blockId: string | null }> {
  return withTenant(pool, schema, (tx) => reportIssueIn(tx, input, viewer));
}

async function lockedIssue(tx: PoolClient, propertyId: string, issueId: string, viewer: Viewer) {
  if (!can(viewer.actor, "work_maintenance", propertyId)) throw new Error("Not allowed");
  if (!isUuid(issueId)) throw new Error("Issue not found");
  const issue = (await tx.query<{ status: string; block_id: string | null; photo_file_id: string | null }>("select status, block_id, photo_file_id from maintenance_issues where id = $1 and property_id = $2 for update", [issueId, propertyId])).rows[0];
  if (!issue) throw new Error("Issue not found");
  if (issue.status === "done") throw new Error("Already fixed");
  return issue;
}

export async function takeIssueIn(tx: PoolClient, propertyId: string, issueId: string, viewer: Viewer, at = new Date()): Promise<void> {
  await lockedIssue(tx, propertyId, issueId, viewer);
  await tx.query("update maintenance_issues set status = 'in_progress', taken_at = $2, taken_by = $3 where id = $1", [issueId, at, viewer.userId]);
}

export interface FixedIssue {
  issueId: string;
  reportedBy: string;
  what: string;
}

/**
 * Mark fixed, with note and photo. With a Room Block in force the fixer
 * decides: end it (the room turns Dirty) or keep it. Photos are kept a year.
 */
export async function fixIssueIn(tx: PoolClient, propertyId: string, issueId: string, input: { note: string; photoFileId: string | null; endBlock: boolean }, viewer: Viewer, at = new Date()): Promise<FixedIssue> {
  const issue = await lockedIssue(tx, propertyId, issueId, viewer);
  const photo = await ownUpload(tx, input.photoFileId, "fix_photo", propertyId, viewer);
  let decision: "ended" | "kept" | null = null;
  if (issue.block_id) {
    const inForce = (
      await tx.query("select 1 from room_blocks b join properties p on p.id = b.property_id where b.id = $1 and b.to_date > p.business_date and b.to_date > b.from_date", [issue.block_id])
    ).rows.length;
    if (inForce) {
      if (input.endBlock) await endRoomBlockIn(tx, issue.block_id, viewer);
      decision = input.endBlock ? "ended" : "kept";
    }
  }
  const { rows } = await tx.query<{ reported_by: string; what: string; d: string }>(
    `update maintenance_issues i set status = 'done', fixed_at = $2, fixed_by = $3, fix_note = $4, fix_photo_file_id = $5, block_decision = $6,
            taken_by = coalesce(taken_by, $3), taken_at = coalesce(taken_at, $2)
     where id = $1
     returning reported_by, coalesce((select 'Room ' || r.number from rooms r where r.id = i.room_id), i.place) || ' · ' || i.pick as what,
               to_char((select business_date from properties where id = i.property_id), 'YYYY-MM-DD') as d`,
    [issueId, at, viewer.userId, input.note.trim().slice(0, 1000), photo, decision],
  );
  const r = rows[0]!;
  await setFileRetention(tx, [issue.photo_file_id, photo], addDays(r.d, ISSUE_PHOTO_DAYS));
  return { issueId, reportedBy: r.reported_by, what: r.what };
}

export async function takeIssue(pool: Pool, schema: string, propertyId: string, issueId: string, viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, (tx) => takeIssueIn(tx, propertyId, issueId, viewer));
}

export async function fixIssue(pool: Pool, schema: string, propertyId: string, issueId: string, input: { note: string; photoFileId: string | null; endBlock: boolean }, viewer: Viewer): Promise<FixedIssue> {
  return withTenant(pool, schema, (tx) => fixIssueIn(tx, propertyId, issueId, input, viewer));
}

export interface IssueRow {
  id: string;
  roomId: string | null;
  roomNumber: string | null;
  place: string;
  pick: ProblemPick;
  urgency: Urgency;
  note: string;
  status: "open" | "in_progress" | "done";
  reportedBy: string;
  reportedAt: Date;
  takenBy: string | null;
  fixedBy: string | null;
  fixedAt: Date | null;
  fixNote: string;
  photoFileId: string | null;
  fixPhotoFileId: string | null;
  /** An old photo kept in the database (before file storage). */
  legacyPhoto: boolean;
  block: { id: string; kind: "out_of_order" | "out_of_service"; until: string; inForce: boolean } | null;
  blockDecision: "ended" | "kept" | null;
}

/** The queue of a property: open and in progress by urgency, or the last 100 done. */
export async function listIssues(pool: Pool, schema: string, propertyId: string, which: "open" | "done", viewer: Viewer): Promise<IssueRow[]> {
  if (!seesIssues(viewer, propertyId)) throw new Error("Not allowed");
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `select i.id, i.room_id, m.number, i.place, i.pick, i.urgency, i.note, i.status, i.reported_by, i.reported_at, i.taken_by, i.fixed_by, i.fixed_at, i.fix_note,
              i.photo_file_id, i.fix_photo_file_id, i.photo is not null as legacy_photo, i.block_decision,
              b.id as block_id, b.kind as block_kind, to_char(b.to_date, 'YYYY-MM-DD') as block_until, (b.to_date > p.business_date and b.to_date > b.from_date) as block_in_force
       from maintenance_issues i join properties p on p.id = i.property_id left join rooms m on m.id = i.room_id left join room_blocks b on b.id = i.block_id
       where i.property_id = $1 and ${which === "open" ? "i.status <> 'done'" : "i.status = 'done'"}
       order by ${which === "open" ? "case i.urgency when 'now' then 0 when 'today' then 1 else 2 end, i.reported_at" : "i.fixed_at desc"}
       limit 100`,
      [propertyId],
    );
    return rows.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      roomNumber: r.number,
      place: r.place,
      pick: r.pick,
      urgency: r.urgency,
      note: r.note,
      status: r.status,
      reportedBy: r.reported_by,
      reportedAt: r.reported_at,
      takenBy: r.taken_by,
      fixedBy: r.fixed_by,
      fixedAt: r.fixed_at,
      fixNote: r.fix_note,
      photoFileId: r.photo_file_id,
      fixPhotoFileId: r.fix_photo_file_id,
      legacyPhoto: r.legacy_photo,
      block: r.block_id ? { id: r.block_id, kind: r.block_kind, until: r.block_until, inForce: r.block_in_force } : null,
      blockDecision: r.block_decision,
    }));
  });
}

/** Whether the viewer may see a stored file: the uploader, or whoever sees the issue it belongs to. */
export async function maySeeFile(tx: PoolClient, fileId: string, viewer: Viewer): Promise<boolean> {
  const f = await fileIn(tx, fileId);
  if (!f) return false;
  if (f.createdBy === viewer.userId) return true;
  const { rows } = await tx.query<{ property_id: string }>("select property_id from maintenance_issues where photo_file_id = $1 or fix_photo_file_id = $1", [fileId]);
  return rows.some((r) => seesIssues(viewer, r.property_id));
}

/** A stored file of this tenant the viewer may see; null otherwise (another tenant's id is simply not found). */
export async function visibleFile(pool: Pool, schema: string, fileId: string, viewer: Viewer): Promise<StoredFile | null> {
  if (!isUuid(fileId)) return null;
  return withTenant(pool, schema, async (tx) => ((await maySeeFile(tx, fileId, viewer)) ? fileIn(tx, fileId) : null));
}
