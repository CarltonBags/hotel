"use client";
// PROTOTYPE model and state for the hosted booking page. In memory only. Photos are gradients standing in for hotel photography.
import { useEffect, useState } from "react";

export const HOTEL = { name: "Spreehof Berlin", city: "Berlin", line: "Quiet rooms by the river, ten minutes from Alexanderplatz", nights: 3, from: "Fri 9 Oct", to: "Mon 12 Oct", guests: "2 adults" };
export const PHOTO = {
  hero: "radial-gradient(80% 70% at 85% 0%, #f2b48a 0%, transparent 55%), radial-gradient(70% 80% at 5% 10%, #5d8fb0 0%, transparent 60%), linear-gradient(180deg, #2c4a63 0%, #1a2b3a 50%, #0f171f 100%)",
  DBL: "linear-gradient(135deg, #c9b8a3 0%, #8d7b68 45%, #4a4038 100%)",
  DBS: "linear-gradient(135deg, #a9c4d4 0%, #6b8ea3 45%, #2f4656 100%)",
  JRS: "linear-gradient(135deg, #d8c4a0 0%, #a3865a 45%, #4d3d26 100%)",
  STE: "linear-gradient(135deg, #b9a9c9 0%, #7b6a93 45%, #3a3047 100%)",
} as Record<string, string>;

export type Plan = { id: string; name: string; perNight: number; breakfast: boolean; policy: "guarantee" | "full" | "deposit"; cancel: string; pay: string; hidden?: boolean };
export type RoomType = { id: string; name: string; size: string; beds: string; max: number; left: number; features: string[]; plans: Plan[] };

const plans = (base: number): Plan[] => [
  { id: "flex-bb", name: "Flexible with breakfast", perNight: base + 36, breakfast: true, policy: "guarantee", cancel: "Free cancellation until Wed 7 Oct, 18:00", pay: "Pay at the hotel. Your card only guarantees the booking." },
  { id: "flex", name: "Flexible, room only", perNight: base, breakfast: false, policy: "guarantee", cancel: "Free cancellation until Wed 7 Oct, 18:00", pay: "Pay at the hotel. Your card only guarantees the booking." },
  { id: "nonref", name: "Saver, non-refundable", perNight: Math.round(base * 0.88), breakfast: false, policy: "full", cancel: "Cannot be cancelled or changed", pay: "Pay the full amount now." },
  { id: "corp", name: "Siemens corporate rate", perNight: Math.round(base * 0.8) + 18, breakfast: true, policy: "guarantee", cancel: "Free cancellation until arrival day, 18:00", pay: "Invoice to company.", hidden: true },
];
export const TYPES: RoomType[] = [
  { id: "DBL", name: "Double", size: "22 m²", beds: "1 double bed", max: 2, left: 5, features: ["Courtyard view", "Rain shower", "Desk"], plans: plans(149) },
  { id: "DBS", name: "Double Superior", size: "28 m²", beds: "1 king bed", max: 3, left: 2, features: ["River view", "Bathtub", "Sofa"], plans: plans(189) },
  { id: "JRS", name: "Junior Suite", size: "38 m²", beds: "1 king bed, 1 sofa bed", max: 4, left: 1, features: ["River view", "Balcony", "Bathtub"], plans: plans(259) },
  { id: "STE", name: "Suite", size: "55 m²", beds: "1 king bed, 1 sofa bed", max: 4, left: 0, features: ["Top floor", "Terrace", "Separate living room"], plans: plans(389) },
];
export const EXTRAS = [
  { id: "parking", name: "Parking", text: "Underground garage", price: 18, per: "night" },
  { id: "late", name: "Late checkout", text: "Keep your room until 14:00", price: 30, per: "stay" },
  { id: "pet", name: "Pet", text: "Dog or cat welcome", price: 15, per: "night" },
  { id: "bubbly", name: "Bottle of sparkling wine", text: "Waiting in your room", price: 39, per: "stay" },
];
export const PROPERTIES = [
  { name: "Spreehof Berlin", city: "Berlin", from: 131, photo: PHOTO.hero, free: true },
  { name: "Hotel Isartor", city: "München", from: 149, photo: PHOTO.DBS, free: true },
  { name: "Haus am Ring", city: "Wien", from: 0, photo: PHOTO.STE, free: false },
];

export type Step = "rooms" | "extras" | "details" | "payment" | "done";
export const STEPS: Step[] = ["rooms", "extras", "details", "payment", "done"];
export const STEP_NAME: Record<Step, string> = { rooms: "Rooms", extras: "Extras", details: "Your details", payment: "Payment", done: "Confirmed" };
export type Page = "flow" | "tenant" | "widget" | "voucher";
export type Line = { key: string; typeId: string; planId: string };

export const eur = (n: number) => `€ ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function useBooking() {
  const [step, setStep] = useState<Step>("rooms");
  const [cart, setCart] = useState<Line[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [page, setPage] = useState<Page>("flow");
  const [hold, setHold] = useState<number | null>(null);
  const [opt, setOpt] = useState({ other: false, company: false });

  useEffect(() => {
    if (hold === null || hold <= 0 || step === "done") return;
    const t = setTimeout(() => setHold(hold - 1), 1000);
    return () => clearTimeout(t);
  }, [hold, step]);

  const unlocked = code.trim().toUpperCase() === "SIEMENS26";
  const lines = cart.map((l) => {
    const type = TYPES.find((t) => t.id === l.typeId)!;
    const plan = type.plans.find((p) => p.id === l.planId)!;
    const gross = plan.perNight * HOTEL.nights;
    const roomGross = gross - (plan.breakfast ? 36 * HOTEL.nights : 0);
    const tax = Math.round((roomGross / 1.07) * 0.075 * 100) / 100;
    return { ...l, type, plan, gross, tax };
  });
  const extraLines = EXTRAS.filter((e) => extras.includes(e.id)).map((e) => ({ ...e, total: e.per === "night" ? e.price * HOTEL.nights : e.price }));
  const rooms = lines.reduce((a, l) => a + l.gross, 0);
  const tax = lines.reduce((a, l) => a + l.tax, 0);
  const ext = extraLines.reduce((a, e) => a + e.total, 0);
  const total = rooms + tax + ext;
  const now = lines.filter((l) => l.plan.policy === "full").reduce((a, l) => a + l.gross + l.tax, 0);

  const go = (s: Step) => { setStep(s); if ((s === "details" || s === "payment") && hold === null) setHold(600); };
  return {
    step, go, cart, lines, extraLines, extras, code, setCode, unlocked, page, setPage, hold, setHold, opt, setOpt,
    rooms, tax, ext, total, now, later: total - now,
    add: (typeId: string, planId: string) => setCart((c) => (c.length >= 5 ? c : [...c, { key: `${typeId}-${planId}-${c.length}-${Date.now()}`, typeId, planId }])),
    remove: (key: string) => setCart((c) => c.filter((l) => l.key !== key)),
    toggleExtra: (id: string) => setExtras((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id])),
    next: () => go(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)]),
    back: () => go(STEPS[Math.max(0, STEPS.indexOf(step) - 1)]),
    demo: (s: Step) => { setCart([{ key: "d1", typeId: "DBS", planId: "flex-bb" }, { key: "d2", typeId: "DBL", planId: "nonref" }]); setExtras(["parking"]); setStep(s); if (s === "details" || s === "payment") setHold(95); },
  };
}
export type B = ReturnType<typeof useBooking>;

export const TONE = {
  dark: { text: "text-white", muted: "text-white/60", panel: "bg-white/10", line: "border-white/12", input: "h-12 w-full rounded-[14px] border border-white/15 bg-white/10 px-4 text-[15px] text-white outline-none placeholder:text-white/40 focus:border-white/60", primary: "bg-white text-[#171a1d]", ghost: "text-white/80 hover:bg-white/10", chip: "bg-white/15", good: "text-[#7be0b5]", warn: "text-[#ffcf7a]" },
  light: { text: "text-[#1d1d1f]", muted: "text-black/55", panel: "bg-[#f5f5f7]", line: "border-black/10", input: "h-12 w-full rounded-[14px] border border-transparent bg-[#f0f0f3] px-4 text-[15px] text-[#1d1d1f] outline-none placeholder:text-black/35 focus:border-[var(--accent)] focus:bg-white", primary: "bg-[var(--accent)] text-white", ghost: "text-[var(--accent)] hover:bg-black/5", chip: "bg-black/5", good: "text-[#178a5c]", warn: "text-[#9a6b00]" },
};
export type Tone = keyof typeof TONE;
