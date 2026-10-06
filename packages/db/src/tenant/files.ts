import type { Pool, PoolClient } from "pg";
import { tenantKey, type FileStore, type VirusScanner } from "@hoteloftware/storage";
import { isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * Tenant file storage (ticket 36): uploads are checked (type, size, virus
 * scan), stored under the tenant's prefix, recorded here, handed out through
 * short-lived signed links, and deleted on their retention day.
 */
export type FileKind = "issue_photo" | "fix_photo";

// photos only, for now; documents come with the tickets that store them
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** An upload refused for what it is (type, size, content, virus): saying so is the answer, trying again does not help. */
export class FileRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRefused";
  }
}
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const UNUSED_UPLOAD_DAYS = 2;

export interface StoredFile {
  id: string;
  kind: FileKind;
  key: string;
  contentType: string;
  propertyId: string | null;
  createdBy: string;
}

/** Check, scan and store an upload; the file's id. Refused: other types, too large, infected. */
export async function storeFile(
  pool: Pool,
  schema: string,
  files: { store: FileStore; scanner: VirusScanner },
  input: { tenantId: string; kind: FileKind; bytes: Uint8Array; contentType: string; propertyId: string | null; userId: string },
): Promise<string> {
  if (!TYPES.includes(input.contentType)) throw new FileRefused("Only photos (JPEG, PNG, WebP) can be uploaded");
  if (!input.bytes.length) throw new FileRefused("The file is empty");
  if (input.bytes.length > MAX_FILE_BYTES) throw new FileRefused("The file is larger than 10 MB");
  if (!sniff(input.bytes, input.contentType)) throw new FileRefused("The file is not what its type says");
  const found = await files.scanner.scan(input.bytes);
  if (found) throw new FileRefused(`The file was refused: it carries a virus (${found})`);
  const id = crypto.randomUUID();
  const key = tenantKey(input.tenantId, input.kind, id);
  await files.store.put(key, input.bytes, input.contentType);
  try {
    await withTenant(pool, schema, (tx) =>
      // an upload nothing takes up (a form left half-way) goes after two days
      tx.query("insert into stored_files (id, kind, key, content_type, size, property_id, created_by, delete_after) values ($1, $2, $3, $4, $5, $6, $7, current_date + $8::int)", [id, input.kind, key, input.contentType, input.bytes.length, input.propertyId, input.userId, UNUSED_UPLOAD_DAYS]),
    );
  } catch (err) {
    // not recorded: not kept
    await files.store.delete(key).catch(() => undefined);
    throw err;
  }
  return id;
}

/** The first bytes match the declared type (a renamed file is refused). */
function sniff(b: Uint8Array, type: string): boolean {
  const starts = (...sig: number[]) => sig.every((x, i) => b[i] === x);
  if (type === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (type === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (type === "image/webp") return starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45;
  return false;
}

/** A file of this tenant; a file id of another tenant is simply not found here. */
export async function findFile(pool: Pool, schema: string, id: string): Promise<StoredFile | null> {
  if (!isUuid(id)) return null;
  return withTenant(pool, schema, async (tx) => fileIn(tx, id));
}

export async function fileIn(tx: PoolClient, id: string): Promise<StoredFile | null> {
  const { rows } = await tx.query<{ id: string; kind: FileKind; key: string; content_type: string; property_id: string | null; created_by: string }>(
    "select id, kind, key, content_type, property_id, created_by from stored_files where id = $1",
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, kind: r.kind, key: r.key, contentType: r.content_type, propertyId: r.property_id, createdBy: r.created_by } : null;
}

/** Set the day files go (null: kept). */
export async function setFileRetention(tx: PoolClient, ids: (string | null)[], deleteAfter: string | null): Promise<void> {
  const list = ids.filter((x): x is string => !!x);
  if (list.length) await tx.query("update stored_files set delete_after = $2 where id = any($1)", [list, deleteAfter]);
}

/**
 * The retention job: files past their day are deleted from storage, then
 * their records (references are cleared). Deleting is repeatable: a record
 * left after its file went is removed next time. One failing file does not
 * stop the others.
 */
export async function deleteExpiredFiles(pool: Pool, schema: string, store: FileStore, today: string): Promise<number> {
  const due = await withTenant(pool, schema, async (tx) => (await tx.query<{ id: string; key: string }>("select id, key from stored_files where delete_after <= $1 order by delete_after limit 500", [today])).rows);
  let n = 0;
  for (const f of due) {
    try {
      await store.delete(f.key);
      await withTenant(pool, schema, (tx) => tx.query("delete from stored_files where id = $1", [f.id]));
      n++;
    } catch (err) {
      console.error(`[files] ${f.key} not deleted`, err);
    }
  }
  return n;
}
