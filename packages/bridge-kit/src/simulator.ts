import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * A simulated on-premises lock system (the plugin kit): the kind of local
 * server a hotel's lock software runs on its network, with an HTTP API of
 * its own (doors, cards on encoders, keys). Plugins are certified against
 * it before they meet a real vendor's system. Offline locks: a key taken
 * back is only blocked here; the card itself runs to its expiry.
 */
interface SimKey {
  id: string;
  name: string;
  door: string;
  encoder: string | null;
  validUntil: string;
  blocked: boolean;
}

export class OnPremLockSimulator {
  readonly keys = new Map<string, SimKey>();
  private readonly onEncoder = new Map<string, string>();
  private server: Server | null = null;
  readonly encoders = ["ENC-1", "ENC-2"];

  /** Starts on a free local port; the address a plugin is configured with. */
  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://sim");
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const send = (status: number, data?: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(data === undefined ? "" : JSON.stringify(data));
        const input = body ? (JSON.parse(body) as Record<string, string>) : {};
        const [, a, b, c] = url.pathname.split("/");
        if (req.method === "GET" && a === "status") return send(200, { ok: true, doors: 999 });
        if (req.method === "GET" && a === "encoders" && !b) return send(200, this.encoders.map((e) => ({ id: e, name: `Encoder ${e}` })));
        if (req.method === "POST" && a === "keys" && !b) {
          if (!input.door || !input.validUntil) return send(400, { error: "door and validUntil" });
          if (input.encoder && !this.encoders.includes(input.encoder)) return send(404, { error: "no such encoder" });
          const key: SimKey = { id: randomUUID(), name: input.name ?? "", door: input.door, encoder: input.encoder ?? null, validUntil: input.validUntil, blocked: false };
          this.keys.set(key.id, key);
          if (key.encoder) this.onEncoder.set(key.encoder, key.id);
          return send(201, { id: key.id });
        }
        if (req.method === "POST" && a === "keys" && b === "by-name" && c) {
          // url: /keys/by-name/<name>/block
          for (const k of this.keys.values()) if (k.name === decodeURIComponent(c)) k.blocked = true;
          return send(204);
        }
        if (a === "keys" && b) {
          const key = this.keys.get(b);
          if (!key) return send(404, { error: "no such key" });
          if (req.method === "PATCH") {
            key.validUntil = input.validUntil ?? key.validUntil;
            return send(204);
          }
          if (req.method === "POST" && c === "block") {
            key.blocked = true;
            return send(204);
          }
        }
        if (req.method === "GET" && a === "encoders" && b && c === "card") {
          const id = this.onEncoder.get(b);
          const key = id ? this.keys.get(id) : undefined;
          return key ? send(200, { id: key.id, door: key.door, validUntil: key.validUntil }) : send(404, { error: "no card" });
        }
        send(404, { error: "unknown" });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const addr = this.server.address();
    return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }
}
