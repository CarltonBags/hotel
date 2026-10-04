import Link from "next/link";
import type { Messages } from "@/i18n/messages";

/** Rooms / Availability: the Calendar's two views of one property, keeping the dates shown. */
export function ViewToggle({ view, from, range, m }: { view: "rooms" | "availability"; from: string; range: number; m: Messages }) {
  const cls = (on: boolean) => `flex h-8 items-center rounded-full px-3 text-[13px] ${on ? "bg-ink text-canvas" : "text-ink-80 hover:bg-ink-5"}`;
  return (
    <nav className="flex gap-1 rounded-full bg-surface-2 p-1" aria-label={m["cal.view"]}>
      <Link href={`/calendar?from=${from}&range=${range}`} aria-current={view === "rooms" ? "page" : undefined} className={cls(view === "rooms")}>
        {m["cal.view.rooms"]}
      </Link>
      <Link href={`/calendar?from=${from}&range=${range}&view=availability`} aria-current={view === "availability" ? "page" : undefined} className={cls(view === "availability")}>
        {m["cal.view.availability"]}
      </Link>
    </nav>
  );
}
