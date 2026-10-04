"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { CalendarData, EventMarker } from "@hoteloftware/db";
import type { Language } from "@hoteloftware/domain";
import type { Messages } from "@/i18n/messages";
import { setPropertyScope } from "../actions";
import { AvailabilityMatrix } from "./calendar-availability";

/** "All properties" selected: the Availability view with one block per hotel; a block opens that hotel's Calendar. */
export function AllPropertiesCalendar(props: {
  blocks: { property: { id: string; name: string; currency: string; country: string }; data: CalendarData; markers: EventMarker[]; today: string }[];
  range: number;
  language: Language;
  m: Messages;
}) {
  const { m } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = (id: string) =>
    startTransition(async () => {
      await setPropertyScope(id);
      router.push("/calendar");
    });
  return (
    <div className="grid gap-5 p-5">
      <h1 className="text-xl font-medium">
        {m["module.calendar"]} <span className="text-ink-60">· {m["cal.allProperties"]}</span>
      </h1>
      {props.blocks.length === 0 ? <p className="text-ink-60">{m["cal.pickProperty"]}</p> : null}
      {props.blocks.map((b) => (
        <section key={b.property.id} aria-label={b.property.name} data-block={b.property.name} className="overflow-hidden rounded-2xl bg-surface shadow-card">
          <button type="button" disabled={pending} onClick={() => open(b.property.id)} className="flex w-full items-center justify-between border-b border-ink-10 px-5 py-3 text-left hover:bg-ink-5">
            <span className="font-medium">{b.property.name}</span>
            <span className="flex items-center gap-1 text-[13px] text-accent">
              {m["cal.openHotel"]} <ArrowRight size={14} />
            </span>
          </button>
          <div onClick={() => open(b.property.id)} className="flex cursor-pointer">
            <AvailabilityMatrix property={b.property} data={b.data} today={b.today} range={props.range} markers={b.markers} language={props.language} m={m} compact />
          </div>
        </section>
      ))}
    </div>
  );
}
