"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { useShell } from "./ShellProvider";

interface Toast {
  id: number;
  kind: string;
  title: string;
  body: string;
  href: string | null;
}

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "";
const TOAST_MS = 8000;

/**
 * Live updates: opens the worker's event stream with a short-lived token and
 * shows each notification as a toast. The browser's EventSource reconnects on
 * its own and sends Last-Event-ID; when the token has expired we fetch a new
 * one and reopen with the last id, so nothing is missed across a restart.
 */
export function Notifications() {
  const { t, tenant, user } = useShell();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [offline, setOffline] = useState(false);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!WORKER_URL) return;
    let source: EventSource | null = null;
    let stopped = false;
    let retry = 1000;

    const open = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/events/token", { cache: "no-store" });
        if (!res.ok) throw new Error(`token ${res.status}`);
        const { token } = (await res.json()) as { token: string };
        const url = new URL("/events", WORKER_URL);
        url.searchParams.set("token", token);
        if (lastId.current) url.searchParams.set("lastEventId", lastId.current);
        source = new EventSource(url.toString());
        source.addEventListener("notification", (e) => {
          const msg = e as MessageEvent<string>;
          lastId.current = msg.lastEventId;
          const n = JSON.parse(msg.data) as Toast;
          setToasts((list) => [...list.filter((x) => x.id !== n.id), n].slice(-4));
          setTimeout(() => setToasts((list) => list.filter((x) => x.id !== n.id)), TOAST_MS);
        });
        source.onopen = () => {
          setOffline(false);
          retry = 1000;
        };
        source.onerror = () => {
          // The token may have expired or the worker restarted: reopen with a fresh token.
          setOffline(true);
          source?.close();
          source = null;
          if (!stopped) setTimeout(open, retry);
          retry = Math.min(retry * 2, 30_000);
        };
      } catch {
        setOffline(true);
        if (!stopped) setTimeout(open, retry);
        retry = Math.min(retry * 2, 30_000);
      }
    };
    void open();
    return () => {
      stopped = true;
      source?.close();
    };
  }, [tenant.id, user.id]);

  return (
    <div aria-live="polite" aria-label={t("shell.notifications")} className="pointer-events-none fixed right-5 top-20 z-50 flex w-80 flex-col gap-2">
      {offline && WORKER_URL ? <div className="pointer-events-auto rounded-xl bg-surface px-3 py-2 text-[12px] text-ink-60 shadow-pill">{t("shell.liveUpdatesOff")}</div> : null}
      {toasts.map((n) => (
        <div key={n.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-surface p-3 shadow-pop">
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-accent/15 text-accent">
            <Bell size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">{n.href ? <a href={n.href}>{n.title}</a> : n.title}</div>
            {n.body ? <div className="text-[12px] text-ink-60">{n.body}</div> : null}
          </div>
          <button type="button" aria-label={t("shell.close")} onClick={() => setToasts((list) => list.filter((x) => x.id !== n.id))} className="grid size-7 place-items-center rounded-full text-ink-60 hover:bg-ink-10">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
