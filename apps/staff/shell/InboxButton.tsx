"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { DATA_KINDS } from "@hoteloftware/domain";
import { DATA_EVENT } from "./LiveRefresh";
import { useShell } from "./ShellProvider";

/** The Guest Inbox in the navbar with its unread count (ticket 42), kept current by the live updates. */
export function InboxButton() {
  const { t, scope, openModule, propertyActions, activeModules } = useShell();
  const [unread, setUnread] = useState(0);
  const shown = propertyActions.includes("use_guest_inbox") && activeModules.includes("guest_portal");
  useEffect(() => {
    if (!shown) return;
    let current = true;
    const load = () =>
      void fetch(`/api/inbox/unread?scope=${encodeURIComponent(scope)}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ unread: number }>) : null))
        .then((x) => current && x && setUnread(x.unread))
        .catch(() => undefined);
    load();
    const onData = (e: Event) => {
      const d = (e as CustomEvent<{ kind: string; propertyId: string }>).detail;
      // a change at a property in view: with "All properties" any
      if (d.kind === DATA_KINDS.conversations && (!scope || scope === "all" || d.propertyId === scope)) load();
    };
    window.addEventListener(DATA_EVENT, onData);
    return () => {
      current = false;
      window.removeEventListener(DATA_EVENT, onData);
    };
  }, [shown, scope]);
  if (!shown) return null;
  return (
    <button type="button" onClick={() => openModule("guest_inbox")} aria-label={t("module.guest_inbox")} data-inbox-button className="relative grid size-12 shrink-0 place-items-center rounded-[16px] bg-surface text-ink-80 shadow-pill hover:bg-ink-5">
      <MessageCircle size={19} />
      {unread > 0 ? (
        <span data-unread-count className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </button>
  );
}
