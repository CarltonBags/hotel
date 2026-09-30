"use client";
// PROTOTYPE, throwaway. Question: what does the phone-first view for Housekeeper and Maintenance look like, and how does it
// interact with the supervisor's board, changes during the day, languages and poor Wi-Fi? Three task overviews via ?variant=.
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PrototypeSwitcher } from "../PrototypeSwitcher";
import { Board } from "./Board";
import { useHk, pendingCount, type Lang } from "./model";
import { MaintenanceQueue, PhoneHeader, RoomSheet } from "./parts";
import { OverviewA, OverviewB, OverviewC, nameA, nameB, nameC } from "./variants";

const VARIANTS = [{ key: "A", name: nameA }, { key: "B", name: nameB }, { key: "C", name: nameC }];

export function HkPrototype() {
  const q = useSearchParams();
  const raw = q.get("variant") ?? "A";
  const variant = VARIANTS.some((v) => v.key === raw) ? raw : "A";
  const hk = useHk();
  useEffect(() => {
    const p = new URLSearchParams(window.location.search); // PROTOTYPE debug params
    if (p.get("theme") === "dark") document.documentElement.dataset.theme = "dark";
    const l = p.get("lang") as Lang | null; if (l) hk.setLang(l);
    if (p.get("role") === "maintenance") hk.setRole("maintenance");
    if (p.get("offline") === "1") { hk.setOnline(false); setTimeout(() => hk.finish("t204departure"), 60); }
    const s = p.get("sheet"); if (s) hk.setOpen(s);
    if (p.get("early") === "1") hk.earlyDeparture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="flex min-h-dvh items-start justify-center gap-8 bg-canvas p-8 pb-28">
        <Board hk={hk} />
        <div>
          <div className="mb-2 pl-4 text-[12px] font-semibold uppercase tracking-wide text-ink-40">{hk.role === "housekeeper" ? "Housekeeper Ana, phone" : "Maintenance, phone"}</div>
          <div className="h-[820px] w-[400px] rounded-[54px] bg-black p-3 shadow-2xl">
            <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[44px] bg-canvas">
              <PhoneHeader hk={hk} />
              {hk.role === "maintenance" ? <MaintenanceQueue hk={hk} /> : variant === "A" ? <OverviewA hk={hk} /> : variant === "B" ? <OverviewB hk={hk} /> : <OverviewC hk={hk} />}
              <RoomSheet hk={hk} />
            </div>
          </div>
        </div>
      </div>
      <PrototypeSwitcher variants={VARIANTS} current={variant} state={{ variant, role: hk.role, lang: hk.lang, online: hk.online, queued: pendingCount(hk), open: hk.open, myTasks: hk.mine.map((t) => ({ room: t.room, type: t.type, state: t.state, clean: t.clean, pending: !!t.pending, changed: !!t.changed })) }} />
    </>
  );
}
