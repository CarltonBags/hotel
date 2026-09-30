"use client";
// PROTOTYPE Variant A: "Cinematic". Full-bleed landscape wallpaper, one dark glass card, one question per screen, progress as dots.
import { STAY, STEP_TITLE, type Checkin } from "./model";
import { StepBody } from "./steps";

export const name = "Cinematic glass";

export function VariantA({ c }: { c: Checkin }) {
  const phone = c.device === "phone";
  return (
    <div className="relative flex h-full flex-col text-white" style={{ background: "radial-gradient(90% 60% at 80% 0%, #f2b48a 0%, transparent 55%), radial-gradient(80% 70% at 10% 10%, #5d8fb0 0%, transparent 60%), linear-gradient(180deg, #2c4a63 0%, #1a2b3a 45%, #0f171f 100%)" }}>
      <div className={`flex items-center justify-between ${phone ? "px-5 pt-12" : "px-10 pt-8"}`}>
        <div className="text-[14px] uppercase tracking-[0.25em] text-white/70">{STAY.property}</div>
        {!phone && <div className="text-[14px] text-white/60">English · Deutsch · 日本語</div>}
      </div>
      <div className={`flex min-h-0 flex-1 items-center justify-center ${phone ? "px-4 pb-4" : "px-10 pb-6"}`}>
        <div className={`w-full rounded-[32px] border border-white/10 bg-[#171a1d]/55 backdrop-blur-xl ${phone ? "p-5" : "max-w-[820px] p-10"}`}>
          {c.step !== "result" && <h1 className={`mb-5 font-light tracking-tight ${phone ? "text-[32px]" : "text-[46px]"}`}>{c.step === "stay" ? `Welcome, ${STAY.guest.split(" ")[0]}` : STEP_TITLE[c.step]}</h1>}
          <StepBody c={c} tone="dark" />
        </div>
      </div>
      <div className="flex justify-center gap-2 pb-6">
        {c.steps.map((s, k) => <span key={s} className={`h-1.5 rounded-full transition-all duration-300 ${k === c.i ? "w-8 bg-white" : k < c.i ? "w-1.5 bg-white/70" : "w-1.5 bg-white/25"}`} />)}
      </div>
    </div>
  );
}
