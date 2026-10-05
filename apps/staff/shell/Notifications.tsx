"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { isDataChange } from "@hoteloftware/domain";
import { WORKER_URL, announceData, openEventStream, type StreamNotification } from "./event-stream";
import { useShell } from "./ShellProvider";

const TOAST_MS = 8000;

/** A short two-note chime, made in the browser (no sound file); one audio context for the page. */
let audio: AudioContext | null = null;
function chime(): void {
  try {
    const ctx = (audio ??= new AudioContext());
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.15 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.15);
      o.stop(ctx.currentTime + i * 0.15 + 0.32);
    });
  } catch {
    // no sound where the browser allows none
  }
}

/** Live updates: each notification of the worker's event stream as a toast; data changes refresh open screens. */
export function Notifications() {
  const { t, tenant, user, inboxSound } = useShell();
  const [toasts, setToasts] = useState<StreamNotification[]>([]);
  const [offline, setOffline] = useState(false);
  const lastId = useRef<string | null>(null);

  useEffect(
    () =>
      openEventStream({
        onNotification: (n) => {
          // data changes refresh open screens and are no toast
          if (isDataChange(n.kind)) {
            announceData(n);
            return;
          }
          // a new guest message rings, for whoever asked for the sound (ticket 42)
          if (n.kind === "inbox.message" && inboxSound) chime();
          setToasts((list) => [...list.filter((x) => x.id !== n.id), n].slice(-4));
          setTimeout(() => setToasts((list) => list.filter((x) => x.id !== n.id)), TOAST_MS);
        },
        onState: (online) => setOffline(!online),
        lastId,
      }),
    [tenant.id, user.id, inboxSound],
  );

  return (
    <div aria-live="polite" aria-label={t("shell.notifications")} className="pointer-events-none fixed print:hidden right-5 top-20 z-50 flex w-80 flex-col gap-2">
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
