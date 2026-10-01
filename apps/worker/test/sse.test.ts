import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateControl, provisionTenant, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { publishNotification, signEventsToken } from "@hoteloftware/events";
import { startWorkerServer, type WorkerServer } from "../src/server";

/**
 * Seam: the SSE endpoint. A client presents a signed token, receives live
 * notifications, and after a reconnect with Last-Event-ID receives what it
 * missed, including rows written while the server was down.
 */
const SECRET = "test-secret-with-at-least-32-characters";

async function readEvents(url: string, lastEventId: string | undefined, count: number, timeoutMs = 8000): Promise<{ id: string; data: string }[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (lastEventId) headers["last-event-id"] = lastEventId;
  const res = await fetch(url, { headers, signal: controller.signal });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: { id: string; data: string }[] = [];
  let buffer = "";
  try {
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const id = /^id: (.*)$/m.exec(chunk)?.[1];
        const data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (id && data) events.push({ id, data });
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

describe("SSE endpoint", () => {
  let pool: Pool;
  let alpha: Tenant;
  let server: WorkerServer;
  let base: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ('u1', $1, 'Bob', 'bob@example.com')`, [alpha.id]);
    server = await startWorkerServer({ pool, listenUrl: process.env.TEST_DATABASE_URL!, secret: SECRET, port: 0, queue: null });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  it("health answers", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, listener: true });
  });

  it("refuses the stream without a valid token", async () => {
    expect((await fetch(`${base}/events`)).status).toBe(401);
    expect((await fetch(`${base}/events?token=nope`)).status).toBe(401);
  });

  it("delivers live notifications for the token's user", async () => {
    const token = signEventsToken({ tenantId: alpha.id, userId: "u1" }, SECRET);
    const pending = readEvents(`${base}/events?token=${token}`, undefined, 1);
    await new Promise((r) => setTimeout(r, 300));
    const id = await publishNotification(pool, { tenantId: alpha.id, userId: "u1", kind: "test", title: "live one" });
    const events = await pending;
    expect(events[0]!.id).toBe(String(id));
    expect(JSON.parse(events[0]!.data)).toMatchObject({ title: "live one" });
  });

  it("after a restart a reconnect with Last-Event-ID catches up on what was missed", async () => {
    const token = signEventsToken({ tenantId: alpha.id, userId: "u1" }, SECRET);
    const first = await publishNotification(pool, { tenantId: alpha.id, userId: "u1", kind: "test", title: "before" });
    await server.close();
    const missedA = await publishNotification(pool, { tenantId: alpha.id, userId: "u1", kind: "test", title: "missed A" });
    const missedB = await publishNotification(pool, { tenantId: alpha.id, userId: null, kind: "test", title: "missed B (tenant-wide)" });
    server = await startWorkerServer({ pool, listenUrl: process.env.TEST_DATABASE_URL!, secret: SECRET, port: 0, queue: null });
    base = `http://127.0.0.1:${server.port}`;
    const events = await readEvents(`${base}/events?token=${token}`, String(first), 2);
    expect(events.map((e) => [e.id, (JSON.parse(e.data) as { title: string }).title])).toEqual([
      [String(missedA), "missed A"],
      [String(missedB), "missed B (tenant-wide)"],
    ]);
  });
});
