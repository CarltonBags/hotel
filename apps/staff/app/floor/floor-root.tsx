"use client";

import { useEffect, useState } from "react";
import type { FloorBoot } from "@/app/api/floor/boot/route";
import { floorMessages } from "@/i18n/floor";
import { IdleLock } from "@/app/device/idle-lock";
import { FloorApp } from "./floor-app";
import { load, save } from "./store";

/** Loads the phone view: from the server when online, else as last kept on the phone. */
export function FloorRoot() {
  const [boot, setBoot] = useState<FloorBoot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/floor/boot", { cache: "no-store" });
        if (res.status === 401) {
          location.href = "/device";
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const fresh = (await res.json()) as FloorBoot;
        await save("boot", fresh);
        setBoot(fresh);
      } catch {
        const kept = await load<FloorBoot>("boot");
        if (kept) setBoot(kept);
        else setFailed(true);
      }
    })();
  }, []);
  if (!boot) return <p className="p-6 text-center text-ink-60">{failed ? "Offline" : "…"}</p>;
  return (
    <>
      {boot.idleMinutes ? <IdleLock minutes={boot.idleMinutes} /> : null}
      <FloorApp
        key={boot.me.id}
        userId={boot.me.id}
        userName={boot.me.name}
        initial={boot.day}
        changeKey={boot.changeKey}
        language={boot.language}
        m={floorMessages(boot.language)}
        names={boot.names}
        onDevice={boot.onDevice}
        boardHref={boot.boardHref}
      />
    </>
  );
}
