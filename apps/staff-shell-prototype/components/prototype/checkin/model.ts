"use client";
// PROTOTYPE model and state for guest self check-in. In memory only.
import { useState } from "react";

export type Device = "kiosk" | "phone";
export type KeyMode = "reception" | "encoder" | "digital" | "pin";
export type Step = "find" | "stay" | "register" | "pay" | "result";
export type Blocker = "none" | "room-not-ready" | "too-early" | "payment-failed";

export const STEP_TITLE: Record<Step, string> = { find: "Find your booking", stay: "Your stay", register: "Your details", pay: "Payment", result: "Done" };

export const STAY = {
  guest: "Aiko Tanaka", confirmation: "R-48220", property: "Hotel Isartor", city: "München",
  arrival: "Mon 28 Sep", departure: "Sat 3 Oct", nights: 5, roomType: "Junior Suite", guests: "2 adults, 1 child",
  room: "501", floor: "5th floor", balance: 1240, cityTax: 52.5, pin: "4 8 2 1 #",
  lines: [["5 nights Junior Suite, breakfast included", 1187.5], ["City tax", 52.5]] as [string, number][],
};

export const KEY_TEXT: Record<KeyMode, { title: string; text: string }> = {
  reception: { title: "Collect your key at reception", text: "Show this screen. Your key card is ready for you, no forms to fill in." },
  encoder: { title: "Take your key card", text: "Your key card is being written. Take it from the slot below the screen." },
  digital: { title: "Your phone is your key", text: "Hold your phone to the door lock. The key is also in your booking link." },
  pin: { title: "Your door code", text: "Enter this code on the keypad at your door. It works until 11:00 on your departure day." },
};

export const BLOCKER_TEXT: Record<Exclude<Blocker, "none">, { guest: string; desk: string }> = {
  "room-not-ready": { guest: "Your room is still being prepared.", desk: "No inspected Junior Suite available" },
  "too-early": { guest: "Check-in opens at 15:00.", desk: "Before earliest self check-in time" },
  "payment-failed": { guest: "The payment did not go through.", desk: "Card declined at self check-in" },
};

export function useCheckin(device: Device) {
  const steps: Step[] = device === "phone" ? ["stay", "register", "pay", "result"] : ["find", "stay", "register", "pay", "result"];
  const [i, setI] = useState(0);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [keyMode, setKeyMode] = useState<KeyMode>("reception");
  const [blocker, setBlocker] = useState<Blocker>("none");
  const step = steps[Math.min(i, steps.length - 1)];
  const next = () => setI((x) => Math.min(x + 1, steps.length - 1));
  const back = () => setI((x) => Math.max(x - 1, 0));
  const pay = () => {
    setPaying(true);
    setTimeout(() => { setPaying(false); setPaid(blocker !== "payment-failed"); setI(steps.length - 1); }, 1600);
  };
  const restart = () => { setI(0); setPaid(false); setPaying(false); };
  const jump = (s: Step) => { const k = steps.indexOf(s); if (k >= 0) { setI(k); if (s === "result") setPaid(blocker !== "payment-failed"); } };
  const success = step === "result" && blocker === "none" && paid;
  return { device, steps, i, step, next, back, pay, paying, paid, restart, jump, keyMode, setKeyMode, blocker, setBlocker, success };
}
export type Checkin = ReturnType<typeof useCheckin>;

export const TONE = {
  dark: {
    input: "h-14 w-full rounded-[16px] border border-white/15 bg-white/10 px-5 text-[18px] text-white outline-none placeholder:text-white/40 focus:border-white/60",
    primary: "flex h-14 items-center justify-center gap-2 rounded-full bg-white px-8 text-[18px] font-medium text-[#171a1d] transition-transform duration-100 active:scale-[0.98] disabled:opacity-40",
    ghost: "flex h-14 items-center justify-center gap-2 rounded-full px-6 text-[17px] text-white/80 hover:bg-white/10",
    muted: "text-white/60", panel: "rounded-[22px] bg-white/10", line: "border-white/10", text: "text-white",
  },
  light: {
    input: "h-14 w-full rounded-[16px] border border-transparent bg-[#f0f0f3] px-5 text-[18px] text-[#1d1d1f] outline-none placeholder:text-black/30 focus:border-[#0071e3] focus:bg-white",
    primary: "flex h-14 items-center justify-center gap-2 rounded-full bg-[#0071e3] px-8 text-[18px] font-medium text-white transition-transform duration-100 active:scale-[0.98] disabled:opacity-40",
    ghost: "flex h-14 items-center justify-center gap-2 rounded-full px-6 text-[17px] text-[#0071e3] hover:bg-[#0071e3]/10",
    muted: "text-black/50", panel: "rounded-[22px] bg-[#f5f5f7]", line: "border-black/10", text: "text-[#1d1d1f]",
  },
};
export type Tone = keyof typeof TONE;
