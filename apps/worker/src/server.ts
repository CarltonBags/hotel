import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import { latestNotificationId, notificationsAfter, verifyEventsToken, type Notification } from "@hoteloftware/events";
import { EventsListener } from "./listener";
import { receiveWebhook, testSource, type QueueLike, type WebhookSource } from "./webhooks";

export interface WorkerServerOptions {
  pool: Pool;
  /** Direct connection for LISTEN (never the pooler). */
  listenUrl: string;
  secret: string;
  port: number;
  queue: QueueLike | null;
  sources?: WebhookSource[];
  /** Shared secret that enables the "test" webhook source (smoke tests); unset in production. */
  testWebhookSecret?: string | undefined;
  /** Origin pattern allowed to open the stream, e.g. https://*.app.example; "*" only in development. */
  allowOrigin?: string | undefined;
  /** Keep-alive comment interval for proxies. */
  heartbeatMs?: number;
}

export interface WorkerServer {
  port: number;
  close: () => Promise<void>;
  listener: EventsListener;
}

function headersOf(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") out[k.toLowerCase()] = v;
  return out;
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** `*`, an exact origin, or a pattern like https://*.app.example (one wildcard label). */
export function originAllowed(origin: string, pattern: string | undefined): boolean {
  if (!pattern) return false;
  if (pattern === "*" || pattern === origin) return true;
  if (!pattern.includes("*")) return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("\\*", "[a-z0-9-]+").replace("*", "[a-z0-9-]+");
  return new RegExp(`^${escaped}$`, "i").test(origin);
}

function sseFrame(n: Notification): string {
  const data = JSON.stringify({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, createdAt: n.createdAt });
  return `id: ${n.id}\nevent: notification\ndata: ${data}\n\n`;
}

/**
 * The worker's HTTP face: /health, /events (SSE) and /webhooks/<source>.
 * Everything else the worker does (jobs, schedules) runs beside it.
 */
export async function startWorkerServer(options: WorkerServerOptions): Promise<WorkerServer> {
  const listener = new EventsListener(options.listenUrl);
  await listener.start();
  const sources = new Map((options.sources ?? []).map((s) => [s.name, s] as const));
  if (!sources.has("test") && options.testWebhookSecret) sources.set("test", testSource(options.testWebhookSecret));
  const heartbeatMs = options.heartbeatMs ?? 25_000;
  const streams = new Set<ServerResponse>();
  // After the LISTEN connection reconnects, every open stream re-reads from its cursor.
  const reconnectHooks = new Set<() => void>();
  listener.onReconnect = () => {
    for (const hook of reconnectHooks) hook();
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        const queueOk = options.queue ? await (options.queue.healthy?.() ?? Promise.resolve(true)) : false;
        const ok = listener.connected && (options.queue === null || queueOk);
        res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ok, listener: listener.connected, queue: queueOk, streams: streams.size }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/events") {
        const token = url.searchParams.get("token") ?? "";
        const claims = verifyEventsToken(token, options.secret);
        if (!claims) {
          res.writeHead(401).end();
          return;
        }
        const origin = req.headers.origin;
        const allowed = origin && originAllowed(origin, options.allowOrigin);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
          ...(allowed ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
        });
        streams.add(res);
        res.write(": connected\n\n");

        // Subscribe first, then catch up: nothing committed in between can be lost.
        // A first connection starts at the newest id: only what happens from now on, no history.
        let cursor = Number(req.headers["last-event-id"] ?? url.searchParams.get("lastEventId") ?? 0) || 0;
        if (!cursor) cursor = await latestNotificationId(options.pool);
        const send = (n: Notification) => {
          if (n.id <= cursor) return;
          cursor = n.id;
          res.write(sseFrame(n));
        };
        const catchUp = async () => {
          for (;;) {
            const rows = await notificationsAfter(options.pool, { tenantId: claims.tenantId, userId: claims.userId, afterId: cursor, limit: 100 });
            for (const n of rows) send(n);
            if (rows.length < 100) return;
          }
        };
        let busy: Promise<void> = Promise.resolve();
        const schedule = () => {
          busy = busy.then(catchUp).catch(() => undefined);
        };
        const unsubscribe = listener.subscribe((hint) => {
          if (hint.tenantId !== claims.tenantId) return;
          if (hint.userId !== null && hint.userId !== claims.userId) return;
          // Hints are not data: read the rows, which also covers bursts and ordering.
          schedule();
        });
        reconnectHooks.add(schedule);
        schedule();
        const heartbeat = setInterval(() => res.write(": ping\n\n"), heartbeatMs);
        // The stream ends with the token; the browser reconnects with a fresh one.
        const expiry = setTimeout(() => res.end(), Math.max(0, claims.exp * 1000 - Date.now()));
        req.on("close", () => {
          clearInterval(heartbeat);
          clearTimeout(expiry);
          unsubscribe();
          reconnectHooks.delete(schedule);
          streams.delete(res);
        });
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/webhooks/")) {
        const name = url.pathname.slice("/webhooks/".length);
        const source = sources.get(name);
        if (!source || !options.queue) {
          res.writeHead(404).end();
          return;
        }
        const rawBody = await readBody(req);
        const result = await receiveWebhook(options.pool, options.queue, source, { headers: headersOf(req), rawBody });
        res.writeHead(result.status, { "content-type": "application/json" }).end(JSON.stringify({ ok: result.status < 400, duplicate: result.duplicate }));
        return;
      }
      res.writeHead(404).end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port, "0.0.0.0", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    port,
    listener,
    close: async () => {
      for (const s of streams) s.end();
      streams.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await listener.stop();
    },
  };
}
