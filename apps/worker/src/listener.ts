import { Client } from "pg";
import { EVENTS_CHANNEL, parseEventHint, type EventHint } from "@hoteloftware/events";

export type HintSubscriber = (hint: EventHint) => void;

/**
 * One direct connection that LISTENs on the events channel and fans hints out
 * to subscribers. Notifications are hints only (LISTEN/NOTIFY is lost on a
 * compute restart); subscribers read the rows themselves.
 */
export class EventsListener {
  #client: Client | null = null;
  #subscribers = new Set<HintSubscriber>();
  #connected = false;
  #stopped = false;
  #retryMs = 1000;
  #timer: NodeJS.Timeout | null = null;
  /** Called after every (re)connect, so streams can catch up on what a gap may have hidden. */
  onReconnect: (() => void) | null = null;

  constructor(private readonly connectionString: string) {}

  get connected(): boolean {
    return this.#connected;
  }

  /** Connect and LISTEN; on loss, reconnect with backoff and LISTEN again (research constraint 16). */
  async start(): Promise<void> {
    this.#stopped = false;
    await this.#connect();
  }

  async #connect(): Promise<void> {
    const client = new Client({ connectionString: this.connectionString });
    client.on("notification", (n) => {
      if (n.channel !== EVENTS_CHANNEL) return;
      const hint = parseEventHint(n.payload);
      if (hint) for (const s of this.#subscribers) s(hint);
    });
    const lost = () => {
      if (this.#client !== client) return;
      this.#connected = false;
      this.#client = null;
      this.#scheduleReconnect();
    };
    client.on("error", lost);
    client.on("end", lost);
    await client.connect();
    await client.query(`listen ${EVENTS_CHANNEL}`);
    this.#client = client;
    this.#connected = true;
    this.#retryMs = 1000;
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#timer) return;
    this.#timer = setTimeout(async () => {
      this.#timer = null;
      try {
        await this.#connect();
        this.onReconnect?.();
      } catch {
        this.#retryMs = Math.min(this.#retryMs * 2, 30_000);
        this.#scheduleReconnect();
      }
    }, this.#retryMs);
  }

  subscribe(fn: HintSubscriber): () => void {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#connected = false;
    const client = this.#client;
    this.#client = null;
    await client?.end().catch(() => undefined);
  }
}
