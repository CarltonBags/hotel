import { DATA_EVENT } from "./LiveRefresh";

export const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "";

export interface StreamNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  href: string | null;
}

/** A data change to the open screens (LiveRefresh): kind, and the property id the body carries. */
export function announceData(n: StreamNotification): void {
  window.dispatchEvent(new CustomEvent(DATA_EVENT, { detail: { kind: n.kind, propertyId: n.body, title: n.title } }));
}

/**
 * Opens the worker's event stream with a short-lived token. The browser's
 * EventSource reconnects on its own and sends Last-Event-ID; when the token
 * has expired we fetch a new one and reopen with the last id, so nothing is
 * missed across a restart. The caller keeps the last id (a ref), so a
 * reopened stream also resumes where the closed one stopped. Returns the
 * function that closes it.
 */
export function openEventStream(on: { onNotification: (n: StreamNotification) => void; onState?: (online: boolean) => void; lastId: { current: string | null } }): () => void {
  if (!WORKER_URL) return () => undefined;
  let source: EventSource | null = null;
  let stopped = false;
  let retry = 1000;
  const again = () => {
    on.onState?.(false);
    if (!stopped) setTimeout(open, retry);
    retry = Math.min(retry * 2, 30_000);
  };
  const open = async () => {
    if (stopped) return;
    try {
      const res = await fetch("/api/events/token", { cache: "no-store" });
      if (!res.ok) throw new Error(`token ${res.status}`);
      const { token } = (await res.json()) as { token: string };
      const url = new URL("/events", WORKER_URL);
      url.searchParams.set("token", token);
      if (on.lastId.current) url.searchParams.set("lastEventId", on.lastId.current);
      source = new EventSource(url.toString());
      source.addEventListener("notification", (e) => {
        const msg = e as MessageEvent<string>;
        on.lastId.current = msg.lastEventId;
        on.onNotification(JSON.parse(msg.data) as StreamNotification);
      });
      source.onopen = () => {
        on.onState?.(true);
        retry = 1000;
      };
      source.onerror = () => {
        // The token may have expired or the worker restarted: reopen with a fresh token.
        source?.close();
        source = null;
        again();
      };
    } catch {
      again();
    }
  };
  void open();
  return () => {
    stopped = true;
    source?.close();
  };
}
