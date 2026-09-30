"use client";
// PROTOTYPE shared pieces of the booking flow: summary, later steps, extra pages. Variants own landing, room list and page chrome.
import { CalendarDays, CalendarPlus, Check, CircleCheck, CreditCard, Gift, Info, KeyRound, Lock, Search, Tag, Timer, Trash2, Users } from "lucide-react";
import { EXTRAS, HOTEL, PROPERTIES, STEPS, STEP_NAME, TONE, eur, type B, type Tone } from "./model";

const btn = "flex h-13 items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[16px] font-medium transition-transform duration-100 active:scale-[0.98] disabled:opacity-40";

export function SearchBar({ b, tone, phone }: { b: B; tone: Tone; phone: boolean }) {
  const t = TONE[tone];
  const cell = `flex h-14 shrink-0 items-center gap-2.5 rounded-[16px] px-4 text-[15px] ${phone ? "" : "min-w-0 flex-1"} ${t.panel}`;
  return (
    <div className={`flex gap-2 ${phone ? "flex-col" : "items-center"}`}>
      <div className={cell}><CalendarDays size={18} className={t.muted} /><span className="truncate whitespace-nowrap">{HOTEL.from} to {HOTEL.to}</span><span className={`ml-auto shrink-0 whitespace-nowrap text-[13px] ${t.muted}`}>{HOTEL.nights} nights</span></div>
      <div className={cell}><Users size={18} className={t.muted} />{HOTEL.guests}</div>
      <label className={cell}><Tag size={18} className={t.muted} /><input value={b.code} onChange={(e) => b.setCode(e.target.value)} placeholder="Rate code" className="w-full bg-transparent uppercase outline-none placeholder:normal-case placeholder:opacity-50" />{b.unlocked && <Check size={18} className={t.good} />}</label>
      <button className={`${btn} ${t.primary} shrink-0`}><Search size={18} />Search</button>
    </div>
  );
}

export function Hold({ b, tone }: { b: B; tone: Tone }) {
  if (b.hold === null || b.step === "done" || b.step === "rooms" || b.step === "extras") return null;
  const t = TONE[tone];
  const m = Math.floor(b.hold / 60), s = String(b.hold % 60).padStart(2, "0");
  if (b.hold <= 0) return <div className={`flex items-center gap-2 rounded-[14px] p-3 text-[14px] ${t.panel}`}><Timer size={16} />Your rooms were released. <button onClick={() => b.setHold(600)} className="underline">Check availability again</button></div>;
  if (b.hold > 120) return <div className={`flex items-center gap-2 text-[13px] ${t.muted}`}><Lock size={14} />Your rooms are reserved for you while you complete the booking.</div>;
  return <div className={`flex items-center gap-2 rounded-[14px] p-3 text-[14px] font-medium ${t.panel} ${t.warn}`}><Timer size={16} />Your rooms are held for {m}:{s} more minutes.</div>;
}

export function Summary({ b, tone, compact = false }: { b: B; tone: Tone; compact?: boolean }) {
  const t = TONE[tone];
  return (
    <div>
      <div className={`text-[13px] uppercase tracking-wide ${t.muted}`}>{HOTEL.name}</div>
      <div className="text-[17px] font-medium">{HOTEL.from} to {HOTEL.to}</div>
      <div className={`text-[14px] ${t.muted}`}>{HOTEL.nights} nights · {HOTEL.guests}</div>
      {b.lines.length === 0 && <div className={`mt-4 text-[14px] ${t.muted}`}>Choose a room to start.</div>}
      <div className="mt-3 space-y-2">
        {b.lines.map((l, i) => (
          <div key={l.key} className={`rounded-[14px] p-3 ${t.panel}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">Room {i + 1}: {l.type.name}</div><div className={`text-[13px] ${t.muted}`}>{l.plan.name}</div></div>
              <div className="text-[14px] font-medium">{eur(l.gross)}</div>
              {b.step !== "done" && <button aria-label="Remove room" onClick={() => b.remove(l.key)} className={`-mr-1 grid size-7 place-items-center rounded-full ${t.ghost}`}><Trash2 size={14} /></button>}
            </div>
          </div>
        ))}
      </div>
      {b.lines.length > 0 && !compact && (
        <div className={`mt-3 space-y-1 border-t pt-3 text-[14px] ${t.line}`}>
          {b.extraLines.map((e) => <div key={e.id} className="flex justify-between"><span className={t.muted}>{e.name}</span><span>{eur(e.total)}</span></div>)}
          <div className="flex justify-between"><span className={t.muted}>City tax</span><span>{eur(b.tax)}</span></div>
        </div>
      )}
      {b.lines.length > 0 && (
        <div className={`mt-3 border-t pt-3 ${t.line}`}>
          <div className="flex items-baseline justify-between"><span className="text-[15px]">Total</span><span className="text-[24px] font-semibold tracking-tight">{eur(b.total)}</span></div>
          <div className={`text-[12px] ${t.muted}`}>Includes VAT and city tax. {eur(b.now)} due now, {eur(b.later)} at the hotel.</div>
        </div>
      )}
      {b.cart.length >= 5 && <div className={`mt-2 flex items-start gap-1.5 text-[12px] ${t.muted}`}><Info size={13} className="mt-0.5 shrink-0" />For more than 5 rooms please contact the hotel.</div>}
    </div>
  );
}

export function Stepper({ b, tone, phone }: { b: B; tone: Tone; phone: boolean }) {
  const t = TONE[tone];
  const i = STEPS.indexOf(b.step);
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {STEPS.slice(0, 4).map((s, k) => (
        <div key={s} className="flex shrink-0 items-center gap-2">
          <span className={`grid size-7 place-items-center rounded-full text-[13px] font-medium ${k < i ? "bg-[#1fa971] text-white" : k === i ? t.primary : t.chip}`}>{k < i ? <Check size={14} /> : k + 1}</span>
          {(!phone || k === i) && <span className={`text-[14px] ${k === i ? "font-medium" : t.muted}`}>{STEP_NAME[s]}</span>}
          {k < 3 && <span className={`h-px w-6 border-t ${t.line}`} />}
        </div>
      ))}
    </div>
  );
}

export function LaterSteps({ b, tone, phone }: { b: B; tone: Tone; phone: boolean }) {
  const t = TONE[tone];
  const nav = (label: string, disabled = false) => (
    <div className={`mt-6 flex gap-2 ${phone ? "flex-col-reverse" : "items-center justify-between"}`}>
      <button onClick={b.back} className={`${btn} ${t.ghost}`}>Back</button>
      <button disabled={disabled} onClick={b.next} className={`${btn} ${t.primary}`}>{label}</button>
    </div>
  );
  if (b.step === "extras") return (
    <div>
      <h2 className="text-[28px] font-semibold tracking-tight">Anything else?</h2>
      <div className={`mt-4 grid gap-2 ${phone ? "" : "grid-cols-2"}`}>
        {EXTRAS.map((e) => { const on = b.extras.includes(e.id); return (
          <button key={e.id} onClick={() => b.toggleExtra(e.id)} className={`flex items-center gap-3 rounded-[18px] p-4 text-left ${t.panel} ${on ? "ring-2 ring-[var(--accent)]" : ""}`}>
            <span className={`grid size-6 place-items-center rounded-full border ${on ? "border-transparent bg-[var(--accent)] text-white" : t.line}`}>{on && <Check size={14} />}</span>
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">{e.name}</span><span className={`block text-[13px] ${t.muted}`}>{e.text}</span></span>
            <span className="text-[14px]">{eur(e.price)}<span className={`text-[12px] ${t.muted}`}> / {e.per}</span></span>
          </button>); })}
      </div>
      {nav("Continue")}
    </div>
  );
  if (b.step === "details") return (
    <div>
      <h2 className="text-[28px] font-semibold tracking-tight">Your details</h2>
      <div className="mt-2"><Hold b={b} tone={tone} /></div>
      <div className={`mt-4 grid gap-3 ${phone ? "" : "grid-cols-2"}`}>
        <input className={t.input} placeholder="First name" defaultValue="Aiko" /><input className={t.input} placeholder="Last name" defaultValue="Tanaka" />
        <input className={t.input} placeholder="Email" defaultValue="aiko.tanaka@example.jp" /><input className={t.input} placeholder="Phone" defaultValue="+81 90 1234 5678" />
        <input className={t.input} placeholder="Country" defaultValue="Japan" /><input className={t.input} placeholder="Arrival time (optional)" />
        <textarea className={`${t.input} h-20 py-3 ${phone ? "" : "col-span-2"}`} placeholder="Special requests (optional)" />
      </div>
      <div className="mt-3 space-y-2 text-[14px]">
        <label className="flex items-center gap-2"><input type="checkbox" checked={b.opt.other} onChange={(e) => b.setOpt({ ...b.opt, other: e.target.checked })} className="size-4" />I am booking for someone else</label>
        {b.opt.other && <div className={`grid gap-3 ${phone ? "" : "grid-cols-2"}`}><input className={t.input} placeholder="Guest first name" /><input className={t.input} placeholder="Guest last name" /></div>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={b.opt.company} onChange={(e) => b.setOpt({ ...b.opt, company: e.target.checked })} className="size-4" />I need a company invoice</label>
        {b.opt.company && <div className={`grid gap-3 ${phone ? "" : "grid-cols-2"}`}><input className={t.input} placeholder="Company name" /><input className={t.input} placeholder="VAT ID" /><input className={`${t.input} ${phone ? "" : "col-span-2"}`} placeholder="Company address" /></div>}
      </div>
      {nav("Continue to payment")}
    </div>
  );
  if (b.step === "payment") return (
    <div>
      <h2 className="text-[28px] font-semibold tracking-tight">Payment</h2>
      <div className="mt-2"><Hold b={b} tone={tone} /></div>
      <div className={`mt-4 space-y-2 rounded-[18px] p-4 text-[14px] ${t.panel}`}>
        {b.lines.map((l, i) => <div key={l.key}><span className="font-medium">Room {i + 1}, {l.plan.name}:</span> <span className={t.muted}>{l.plan.pay} {l.plan.cancel}.</span></div>)}
        <div className={`border-t pt-2 ${t.line}`}><span className="font-medium">Charged now: {eur(b.now)}.</span> <span className={t.muted}>The rest, {eur(b.later)}, is paid at the hotel.</span></div>
      </div>
      <div className={`mt-3 grid gap-3 ${phone ? "" : "grid-cols-2"}`}>
        <input className={`${t.input} ${phone ? "" : "col-span-2"}`} placeholder="Card number" defaultValue="4242 4242 4242 4242" /><input className={t.input} placeholder="MM / YY" defaultValue="08 / 29" /><input className={t.input} placeholder="Security code" defaultValue="123" />
      </div>
      <p className={`mt-3 text-[12px] ${t.muted}`}>Your bank will ask you to confirm. By booking you allow {HOTEL.name} to charge this card for a late cancellation or no-show fee according to the conditions above, and for extras you order during your stay.</p>
      {nav(b.now > 0 ? `Pay ${eur(b.now)} and book` : "Book with card guarantee", b.hold !== null && b.hold <= 0)}
    </div>
  );
  if (b.step === "done") return (
    <div className="text-center">
      <CircleCheck size={56} strokeWidth={1.4} className={`mx-auto ${t.good}`} />
      <h2 className="mt-3 text-[34px] font-semibold tracking-tight">See you on {HOTEL.from}</h2>
      <p className={`mt-1 text-[16px] ${t.muted}`}>Booking B-20931 is confirmed. We sent the details to aiko.tanaka@example.jp.</p>
      <div className={`mt-5 flex justify-center gap-2 ${phone ? "flex-col" : ""}`}>
        <button className={`${btn} ${t.primary}`}><KeyRound size={18} />Open my booking</button>
        <button className={`${btn} ${t.ghost}`}><CalendarPlus size={18} />Add to calendar</button>
      </div>
      <p className={`mx-auto mt-4 max-w-md text-[14px] ${t.muted}`}>In your booking you can change dates, add extras, cancel, and check in online before you arrive.</p>
    </div>
  );
  return null;
}

export function TenantPage({ tone, phone, onPick }: { tone: Tone; phone: boolean; onPick: () => void }) {
  const t = TONE[tone];
  return (
    <div className={`mx-auto w-full max-w-[1100px] ${phone ? "p-4" : "p-10"}`}>
      <div className={`text-[13px] uppercase tracking-[0.2em] ${t.muted}`}>Flussufer Hotels</div>
      <h1 className={`font-semibold tracking-tight ${phone ? "text-[30px]" : "text-[44px]"}`}>Three houses, one welcome</h1>
      <p className={`text-[15px] ${t.muted}`}>{HOTEL.from} to {HOTEL.to} · {HOTEL.guests}</p>
      <div className={`mt-6 grid gap-4 ${phone ? "" : "grid-cols-3"}`}>
        {PROPERTIES.map((p) => (
          <button key={p.name} onClick={onPick} disabled={!p.free} className={`overflow-hidden rounded-[24px] text-left ${t.panel} disabled:opacity-60`}>
            <div className="h-44" style={{ background: p.photo }} />
            <div className="p-4"><div className="text-[18px] font-medium">{p.name}</div><div className={`text-[14px] ${t.muted}`}>{p.city}</div>
              <div className="mt-2 text-[15px]">{p.free ? <>from <span className="text-[20px] font-semibold">{eur(p.from)}</span> <span className={t.muted}>per night</span></> : <span className={t.muted}>No rooms for these dates</span>}</div></div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function WidgetPage({ phone, onGo }: { phone: boolean; onGo: () => void }) {
  return (
    <div className="min-h-full bg-[#fbf7f0] text-[#2b2118]" style={{ fontFamily: "Georgia, serif" }}>
      <div className={`flex items-center justify-between border-b border-black/10 ${phone ? "p-4" : "px-12 py-5"}`}><span className="text-[22px]">Spreehof</span><span className="text-[14px] text-black/50">Rooms · Restaurant · Contact</span></div>
      <div className={phone ? "p-4" : "px-12 py-10"}>
        <div className="text-[13px] uppercase tracking-widest text-black/40">The hotel's own website, not ours</div>
        <h1 className={phone ? "text-[30px]" : "text-[52px]"}>A house by the river</h1>
        <p className="max-w-xl text-[16px] text-black/60">Forty-two rooms in a former grain store. This page belongs to the hotel; only the bar below comes from us.</p>
        <div className={`mt-6 flex gap-2 rounded-[22px] bg-white p-2 shadow-xl ring-1 ring-black/5 ${phone ? "flex-col" : "max-w-3xl items-center"}`} style={{ fontFamily: "var(--font-geist-sans)" }}>
          <div className="flex h-12 flex-1 items-center gap-2 rounded-[14px] bg-[#f5f5f7] px-4 text-[15px]"><CalendarDays size={17} className="text-black/50" />{HOTEL.from} to {HOTEL.to}</div>
          <div className="flex h-12 flex-1 items-center gap-2 rounded-[14px] bg-[#f5f5f7] px-4 text-[15px]"><Users size={17} className="text-black/50" />{HOTEL.guests}</div>
          <button onClick={onGo} className="h-12 shrink-0 rounded-full bg-[var(--accent)] px-6 text-[15px] font-medium text-white">Check availability</button>
        </div>
        <p className="mt-2 text-[12px] text-black/40" style={{ fontFamily: "var(--font-geist-sans)" }}>Opens book.spreehof-berlin.de</p>
      </div>
    </div>
  );
}

export function VoucherPage({ tone, phone }: { tone: Tone; phone: boolean }) {
  const t = TONE[tone];
  return (
    <div className={`mx-auto w-full max-w-[720px] ${phone ? "p-4" : "p-10"}`}>
      <Gift size={36} strokeWidth={1.5} />
      <h1 className={`mt-2 font-semibold tracking-tight ${phone ? "text-[28px]" : "text-[40px]"}`}>Give a stay at {HOTEL.name}</h1>
      <p className={`text-[15px] ${t.muted}`}>A voucher for any amount. Valid at our hotels for rooms, breakfast and extras, until it is used up.</p>
      <div className="mt-5 flex flex-wrap gap-2">{[50, 100, 150, 250, 500].map((a, i) => <button key={a} className={`h-12 rounded-full px-5 text-[16px] font-medium ${i === 2 ? TONE[tone].primary : t.panel}`}>{eur(a).replace(".00", "")}</button>)}<input className={`${t.input} w-36`} placeholder="Other amount" /></div>
      <div className={`mt-4 grid gap-3 ${phone ? "" : "grid-cols-2"}`}><input className={t.input} placeholder="For (name)" /><input className={t.input} placeholder="Send to (email)" /><textarea className={`${t.input} h-24 py-3 ${phone ? "" : "col-span-2"}`} placeholder="Your message" /><input className={t.input} placeholder="Your name" /><input className={t.input} placeholder="Your email" /></div>
      <button className={`${btn} ${t.primary} mt-5`}><CreditCard size={18} />Pay € 150 by card</button>
      <p className={`mt-2 text-[12px] ${t.muted}`}>The voucher arrives by email with a code. It is redeemed at the reception.</p>
    </div>
  );
}
