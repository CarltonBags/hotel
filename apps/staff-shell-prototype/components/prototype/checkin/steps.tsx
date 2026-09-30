"use client";
// PROTOTYPE step bodies, shared by all variants. Variants own the layout around them; these own only the controls of one step.
import { BedDouble, CalendarDays, Check, ConciergeBell, CreditCard, Loader, QrCode, Users } from "lucide-react";
import { BLOCKER_TEXT, KEY_TEXT, STAY, TONE, type Checkin, type Tone } from "./model";

const eur = (n: number) => `€ ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

export function StepBody({ c, tone, compact = false }: { c: Checkin; tone: Tone; compact?: boolean }) {
  const t = TONE[tone];
  const phone = c.device === "phone";
  const nav = (label: string, onNext: () => void, icon = <Check size={19} />) => (
    <div className={`mt-6 flex ${phone ? "flex-col-reverse gap-2" : "items-center justify-between"}`}>
      {c.i > 0 ? <button onClick={c.back} className={t.ghost}>Back</button> : <span />}
      <button onClick={onNext} className={`${t.primary} ${phone ? "w-full" : ""}`}>{icon}{label}</button>
    </div>
  );

  switch (c.step) {
    case "find":
      return (
        <div>
          <div className={`grid gap-4 ${phone ? "" : "grid-cols-2"}`}>
            <button onClick={c.next} className={`${t.panel} flex flex-col items-center justify-center gap-3 p-8 text-center transition-transform duration-100 active:scale-[0.98]`}>
              <QrCode size={56} strokeWidth={1.4} />
              <span className="text-[19px] font-medium">Scan the code</span>
              <span className={`text-[15px] ${t.muted}`}>Hold the QR code from your confirmation in front of the camera.</span>
            </button>
            <div className={`${t.panel} space-y-3 p-6`}>
              <div className="text-[19px] font-medium">Or type it in</div>
              <input className={t.input} placeholder="Confirmation number" defaultValue="R-48220" />
              <input className={t.input} placeholder="Last name" defaultValue="Tanaka" />
              <button onClick={c.next} className={`${t.primary} w-full`}>Find my booking</button>
            </div>
          </div>
        </div>
      );
    case "stay":
      return (
        <div>
          <div className={`${t.panel} divide-y ${t.line} px-6`}>
            {[[<CalendarDays key="a" size={20} />, `${STAY.arrival} to ${STAY.departure}`, `${STAY.nights} nights`], [<BedDouble key="b" size={20} />, STAY.roomType, "Breakfast included"], [<Users key="c" size={20} />, STAY.guests, STAY.guest]].map(([ic, a, b], k) => (
              <div key={k} className={`flex items-center gap-4 border-0 py-4 ${k ? `border-t ${t.line}` : ""}`}>
                <span className={t.muted}>{ic}</span><span className="flex-1 text-[18px]">{a}</span><span className={`text-[15px] ${t.muted}`}>{b}</span>
              </div>
            ))}
          </div>
          {nav("Yes, this is my stay", c.next)}
        </div>
      );
    case "register":
      return (
        <div>
          <div className={`grid gap-3 ${phone || compact ? "" : "grid-cols-2"}`}>
            <input className={t.input} defaultValue="Aiko" aria-label="First names" />
            <input className={t.input} defaultValue="Tanaka" aria-label="Family name" />
            <input className={`${t.input} ${phone || compact ? "" : "col-span-2"}`} defaultValue="2-1 Marunouchi, 100-0005 Tokyo, Japan" aria-label="Address" />
            <input className={t.input} defaultValue="Japanese" aria-label="Nationality" />
            <input className={t.input} defaultValue="TR4821193" aria-label="Passport number" />
          </div>
          <p className={`mt-3 text-[14px] ${t.muted}`}>Filled in from your online pre-check-in. Your spouse and child are recorded by number only.</p>
          {nav("Correct", c.next)}
        </div>
      );
    case "pay":
      return (
        <div>
          <div className={`${t.panel} px-6 py-4`}>
            {STAY.lines.map(([l, a]) => <div key={l} className="flex justify-between py-1.5 text-[17px]"><span className={t.muted}>{l}</span><span>{eur(a)}</span></div>)}
            <div className={`mt-2 flex justify-between border-t pt-3 text-[22px] font-medium ${t.line}`}><span>Total</span><span>{eur(STAY.balance)}</span></div>
          </div>
          <p className={`mt-3 text-[14px] ${t.muted}`}>In Germany your card payment also confirms your registration, so no signature is needed.</p>
          {c.paying
            ? <div className={`mt-6 flex items-center justify-center gap-3 text-[18px] ${t.muted}`}><Loader className="animate-spin" size={22} />{phone ? "Confirm in your banking app" : "Follow the card terminal"}</div>
            : nav(phone ? "Pay with card" : "Pay at the terminal", c.pay, <CreditCard size={19} />)}
        </div>
      );
    case "result": {
      if (!c.success) {
        const b = BLOCKER_TEXT[c.blocker === "none" ? "payment-failed" : c.blocker];
        return (
          <div className="text-center">
            <ConciergeBell size={52} strokeWidth={1.4} className="mx-auto" />
            <div className="mt-3 text-[30px] font-light tracking-tight">Reception will help you</div>
            <p className={`mx-auto mt-2 max-w-md text-[18px] ${t.muted}`}>{b.guest} Everything you entered is saved. {phone ? "Please come to the reception desk." : "A colleague is on the way."}</p>
          </div>
        );
      }
      const k = KEY_TEXT[c.keyMode];
      return (
        <div className="text-center">
          <div className={`text-[15px] uppercase tracking-[0.2em] ${t.muted}`}>Your room</div>
          <div className={`font-light leading-none tracking-tight ${phone ? "text-[96px]" : "text-[132px]"}`}>{STAY.room}</div>
          <div className={`text-[17px] ${t.muted}`}>{STAY.floor} · lift on your right</div>
          <div className={`${t.panel} mx-auto mt-5 max-w-md p-5`}>
            <div className="text-[19px] font-medium">{k.title}</div>
            {c.keyMode === "pin" && <div className="my-2 font-mono text-[34px] tracking-[0.3em]">{STAY.pin}</div>}
            <p className={`mt-1 text-[15px] ${t.muted}`}>{k.text}</p>
          </div>
          <p className={`mt-4 text-[15px] ${t.muted}`}>Breakfast 6:30 to 10:30 · Wi-Fi "Isartor Guest" · Checkout until 11:00</p>
        </div>
      );
    }
  }
}
