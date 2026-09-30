"use client";
// PROTOTYPE Variant C: "Concierge conversation". The flow reads as a dialogue: answered steps stay visible as a short thread, the current step is the newest card.
import { Check } from "lucide-react";
import { STAY, type Checkin, type Step } from "./model";
import { StepBody } from "./steps";

export const name = "Concierge conversation";

const ASK: Record<Step, string> = {
  find: "Good evening. Let us find your booking.",
  stay: `Welcome, ${STAY.guest.split(" ")[0]}. Is this your stay?`,
  register: "Are your details still correct?",
  pay: "One last thing: the payment.",
  result: "",
};
const SAID: Record<Step, string> = {
  find: `${STAY.confirmation}, Tanaka`,
  stay: `${STAY.arrival} to ${STAY.departure}, ${STAY.roomType}`,
  register: "Details confirmed",
  pay: "Paid € 1,240.00",
  result: "",
};

export function VariantC({ c }: { c: Checkin }) {
  const phone = c.device === "phone";
  return (
    <div className="flex h-full flex-col bg-[#f6f1ea] text-[#1d1d1f]">
      <div className={`flex items-center gap-3 ${phone ? "px-4 pb-2 pt-12" : "px-10 pb-2 pt-7"}`}>
        <span className="grid size-10 place-items-center rounded-full bg-[#1d1d1f] text-[15px] font-medium text-white">HI</span>
        <div><div className="text-[16px] font-medium leading-tight">{STAY.property}</div><div className="text-[13px] text-black/50">Your digital reception</div></div>
      </div>
      <div className={`flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-auto ${phone ? "p-4" : "mx-auto w-full max-w-[860px] px-10 pb-8"}`}>
        {c.steps.slice(0, c.i).map((s) => (
          <div key={s} className="space-y-1.5">
            <div className="w-fit max-w-[80%] rounded-[20px] rounded-bl-[6px] bg-white px-4 py-2 text-[15px] text-black/60 shadow-sm">{ASK[s]}</div>
            <div className="ml-auto flex w-fit max-w-[80%] items-center gap-1.5 rounded-[20px] rounded-br-[6px] bg-[#1d1d1f] px-4 py-2 text-[15px] text-white"><Check size={15} />{SAID[s]}</div>
          </div>
        ))}
        {c.step !== "result" && <div className={`w-fit max-w-[90%] rounded-[24px] rounded-bl-[6px] bg-white px-5 py-3 font-medium tracking-tight shadow-sm ${phone ? "text-[22px]" : "text-[28px]"}`}>{ASK[c.step]}</div>}
        <div className={`rounded-[28px] bg-white shadow-sm ${phone ? "p-4" : "p-7"}`}><StepBody c={c} tone="light" /></div>
      </div>
    </div>
  );
}
