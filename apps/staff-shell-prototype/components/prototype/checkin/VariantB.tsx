"use client";
// PROTOTYPE Variant B: "Light checkout". White surface, numbered stepper on top, stay summary always visible beside the step (kiosk) or above it (phone).
import { Check } from "lucide-react";
import { STAY, STEP_TITLE, type Checkin } from "./model";
import { StepBody } from "./steps";

export const name = "Light checkout with summary";

export function VariantB({ c }: { c: Checkin }) {
  const phone = c.device === "phone";
  const summary = (
    <aside className={`rounded-[24px] bg-[#f5f5f7] ${phone ? "p-4" : "w-[280px] shrink-0 p-6"}`}>
      <div className="text-[13px] uppercase tracking-wide text-black/40">{STAY.property}, {STAY.city}</div>
      <div className={`mt-1 font-medium tracking-tight ${phone ? "text-[19px]" : "text-[24px]"}`}>{STAY.guest}</div>
      <div className="mt-1 text-[15px] text-black/60">{STAY.arrival} to {STAY.departure}</div>
      {!phone && <><div className="mt-4 text-[15px] text-black/60">{STAY.roomType}<br />{STAY.guests}<br />{STAY.nights} nights, breakfast included</div><div className="mt-5 border-t border-black/10 pt-4 text-[15px] text-black/50">Total</div><div className="text-[28px] font-medium tracking-tight">€ 1,240.00</div></>}
    </aside>
  );
  return (
    <div className="flex h-full flex-col bg-white text-[#1d1d1f]">
      <div className={`flex items-center gap-2 border-b border-black/10 ${phone ? "overflow-x-auto px-4 pb-3 pt-12" : "px-10 py-5"}`}>
        {c.steps.map((s, k) => (
          <div key={s} className="flex shrink-0 items-center gap-2">
            <span className={`grid size-8 place-items-center rounded-full text-[14px] font-medium ${k < c.i ? "bg-[#1fa971] text-white" : k === c.i ? "bg-[#0071e3] text-white" : "bg-[#f0f0f3] text-black/40"}`}>{k < c.i ? <Check size={16} /> : k + 1}</span>
            {(!phone || k === c.i) && <span className={`text-[15px] ${k === c.i ? "font-medium" : "text-black/40"}`}>{STEP_TITLE[s]}</span>}
            {k < c.steps.length - 1 && <span className={`mx-1 h-px bg-black/15 ${phone ? "w-4" : "w-10"}`} />}
          </div>
        ))}
      </div>
      <div className={`flex min-h-0 flex-1 overflow-auto ${phone ? "flex-col gap-4 p-4" : "gap-8 p-10"}`}>
        {c.step !== "find" && c.step !== "result" && summary}
        <div className="min-w-0 flex-1">
          {c.step !== "result" && <h1 className={`mb-4 font-semibold tracking-tight ${phone ? "text-[26px]" : "text-[34px]"}`}>{STEP_TITLE[c.step]}</h1>}
          <StepBody c={c} tone="light" compact={!phone && c.step === "register"} />
        </div>
      </div>
    </div>
  );
}
