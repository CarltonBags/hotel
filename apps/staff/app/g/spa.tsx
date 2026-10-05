"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PortalSpa } from "@hoteloftware/db";
import type { PortalLanguage } from "@hoteloftware/domain";
import { portalText, type PortalKey } from "@/i18n/portal";
import type { FormState } from "@/lib/form";
import { guestButton, guestInput } from "./glass";
import { spaBookAction, spaCancelAction } from "./spa-actions";

/** The spa in the Guest Portal (ticket 64): a day of the stay, a treatment, a free time; the stay's appointments with their cancellation rule. */
export function SpaPanel({ portalKey, language, spa, timeZone, prices }: { portalKey: string; language: PortalLanguage; spa: PortalSpa; timeZone: string; prices: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  const treatments = spa.spas.flatMap((s) => s.treatments.map((t) => ({ ...t, outletId: s.id, spa: s.name })));
  const [treatment, setTreatment] = useState(treatments[0]?.id ?? "");
  const t = (k: PortalKey, v?: Record<string, string | number>) => portalText(language, k, v);
  const locale = language === "de" ? "de-DE" : "en-GB";
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone });
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const chosen = treatments.find((x) => x.id === treatment);
  const slots = spa.slots.filter((s) => s.treatmentId === treatment);
  const run = (fn: () => Promise<FormState>) =>
    start(async () => {
      const r = await fn();
      setState(r);
      router.refresh();
    });
  const note = state.error ? (
    <p className="text-sm text-red-300" role="alert">
      {state.error}
    </p>
  ) : state.ok && state.message ? (
    <p className="text-sm text-emerald-300" role="status">
      {t(state.message as PortalKey)}
    </p>
  ) : null;
  return (
    <div className="grid gap-3">
      {note}
      <nav className="flex flex-wrap gap-2" aria-label={t("spa")}>
        {spa.days.map((d) => (
          <Link key={d} href={`/g/${portalKey}?lang=${language}&spa=${d}#spa`} scroll={false} className={`rounded-full px-3 py-1 text-sm ${d === spa.date ? "bg-white text-black" : "bg-white/10"}`} data-spa-day={d}>
            {dayLabel(d)}
          </Link>
        ))}
      </nav>
      <select value={treatment} onChange={(e) => setTreatment(e.target.value)} aria-label={t("spaTreatment")} className={guestInput}>
        {treatments.map((x) => (
          <option key={x.id} value={x.id} className="text-black">
            {spa.spas.length > 1 ? `${x.spa} · ` : ""}
            {x.name} · {t("spaMinutes", { n: x.minutes })} · {prices[x.id]}
          </option>
        ))}
      </select>
      {slots.length ? (
        <div className="flex flex-wrap gap-2" data-spa-slots>
          {slots.map((s) => (
            <button
              key={s.startsAt}
              type="button"
              disabled={pending || !chosen}
              onClick={() => run(() => spaBookAction(portalKey, language, { outletId: s.outletId, treatmentId: s.treatmentId, startsAt: s.startsAt }))}
              className="h-10 rounded-full border border-white/30 px-4 text-sm disabled:opacity-50"
              data-spa-slot={clock(s.startsAt)}
            >
              {clock(s.startsAt)}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-white/70">{t("spaNoSlots")}</p>
      )}
      {spa.appointments.length ? (
        <div className="grid gap-2" data-spa-appointments>
          <h3 className="font-medium">{t("spaYours")}</h3>
          {spa.appointments.map((a) => (
            <div key={a.id} className="grid gap-1 rounded-2xl bg-white/10 p-3 text-sm" data-spa-appointment={a.id}>
              <span className="font-medium">
                {when(a.startsAt)} · {a.treatment}
              </span>
              {a.status === "booked" ? (
                a.mayCancel ? (
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-white/70">{t("spaCancelUntil", { time: when(a.cancelUntil) })}</span>
                    <button type="button" disabled={pending} onClick={() => run(() => spaCancelAction(portalKey, language, a.id))} className={guestButton} data-spa-cancel>
                      {t("spaCancel")}
                    </button>
                  </span>
                ) : (
                  <span className="text-white/70" data-spa-rule>
                    {t("spaCancelRule", { n: spa.spas.find((s) => s.name === a.spa)?.cancelHours ?? 0 })}
                  </span>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
