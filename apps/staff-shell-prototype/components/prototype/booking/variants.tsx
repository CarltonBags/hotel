"use client";
// PROTOTYPE the three looks of the hosted booking page. Each owns its page chrome, landing and room list.
import { BedDouble, Check, Maximize, ShoppingBag, Users } from "lucide-react";
import { HOTEL, PHOTO, TYPES, eur, type B, type Plan, type RoomType } from "./model";
import { LaterSteps, SearchBar, Stepper, Summary } from "./shared";

const visible = (b: B, t: RoomType) => t.plans.filter((p) => !p.hidden || b.unlocked);
const total = (p: Plan) => p.perNight * HOTEL.nights;

function PlanRow({ b, t, p, dark, phone }: { b: B; t: RoomType; p: Plan; dark: boolean; phone: boolean }) {
  const sold = t.left <= 0;
  return (
    <div className={`flex gap-3 rounded-[16px] p-3 ${dark ? "bg-white/8" : "bg-white"} ${phone ? "flex-col" : "items-center"} ${p.hidden ? "ring-1 ring-[var(--accent)]" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium">{p.name}{p.hidden && <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] text-white">with your code</span>}</div>
        <div className={`flex items-center gap-1 text-[13px] ${p.policy === "full" ? (dark ? "text-white/60" : "text-black/55") : dark ? "text-[#7be0b5]" : "text-[#178a5c]"}`}>{p.policy !== "full" && <Check size={13} />}{p.cancel}</div>
        <div className={`text-[13px] ${dark ? "text-white/60" : "text-black/55"}`}>{p.pay}{p.breakfast && " Breakfast included."}</div>
      </div>
      <div className={`flex shrink-0 items-center gap-3 ${phone ? "justify-between" : ""}`}>
        <div className={phone ? "" : "whitespace-nowrap text-right"}><div className="text-[20px] font-semibold leading-tight tracking-tight">{eur(total(p))}</div><div className={`text-[12px] ${dark ? "text-white/50" : "text-black/45"}`}>{eur(p.perNight)} per night, incl. VAT</div></div>
        <button disabled={sold || b.cart.length >= 5} onClick={() => b.add(t.id, p.id)} className={`h-11 shrink-0 rounded-full px-5 text-[15px] font-medium disabled:opacity-40 ${dark ? "bg-white text-[#171a1d]" : "bg-[var(--accent)] text-white"}`}>{sold ? "Sold out" : "Add room"}</button>
      </div>
    </div>
  );
}

function Facts({ t, dark }: { t: RoomType; dark: boolean }) {
  const m = dark ? "text-white/60" : "text-black/55";
  return <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] ${m}`}><span className="flex items-center gap-1"><Maximize size={14} />{t.size}</span><span className="flex items-center gap-1"><BedDouble size={14} />{t.beds}</span><span className="flex items-center gap-1"><Users size={14} />up to {t.max}</span>{t.features.map((f) => <span key={f}>{f}</span>)}</div>;
}

function Left({ t }: { t: RoomType }) {
  if (t.left <= 0) return <span className="rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-medium text-white">Sold out for these dates</span>;
  if (t.left <= 2) return <span className="rounded-full bg-[#e2552b] px-2.5 py-1 text-[12px] font-medium text-white">Only {t.left} left</span>;
  return null;
}

// A: Cinematic. Photo hero with glass search, dark page, large photo cards, cart as a floating bar at the bottom.
export const nameA = "Cinematic dark";
export function LookA({ b, phone }: { b: B; phone: boolean }) {
  return (
    <div className="min-h-dvh bg-[#0e1318] pb-28 text-white">
      <div className={`${phone ? "px-4 pb-6 pt-12" : "px-12 pb-10 pt-8"}`} style={{ background: PHOTO.hero }}>
        <div className="flex items-center justify-between text-[14px] uppercase tracking-[0.25em] text-white/80"><span>{HOTEL.name}</span>{!phone && <span className="normal-case tracking-normal text-white/60">English · Deutsch · Français</span>}</div>
        {b.step === "rooms" && <><h1 className={`mt-16 max-w-2xl font-light tracking-tight ${phone ? "text-[34px]" : "text-[56px]"} leading-[1.05]`}>{HOTEL.line}</h1>
          <div className="mt-6 rounded-[26px] border border-white/10 bg-[#171a1d]/55 p-2 backdrop-blur-xl"><SearchBar b={b} tone="dark" phone={phone} /></div></>}
        {b.step !== "rooms" && b.step !== "done" && <div className="mt-8"><Stepper b={b} tone="dark" phone={phone} /></div>}
      </div>
      <div className={`mx-auto w-full max-w-[1100px] ${phone ? "p-4" : "px-12 py-8"}`}>
        {b.step === "rooms" ? (
          <div className={`grid gap-5 ${phone ? "" : "grid-cols-2"}`}>
            {TYPES.map((t) => (
              <article key={t.id} className="overflow-hidden rounded-[28px] bg-white/6">
                <div className="relative h-56" style={{ background: PHOTO[t.id] }}><div className="absolute left-4 top-4"><Left t={t} /></div><h3 className="absolute bottom-4 left-5 text-[30px] font-light tracking-tight">{t.name}</h3></div>
                <div className="space-y-2 p-4"><Facts t={t} dark />{visible(b, t).map((p) => <PlanRow key={p.id} b={b} t={t} p={p} dark phone />)}</div>
              </article>
            ))}
          </div>
        ) : <div className="mx-auto max-w-[760px]"><LaterSteps b={b} tone="dark" phone={phone} /></div>}
      </div>
      {b.lines.length > 0 && b.step !== "done" && (
        <div className={`fixed inset-x-0 bottom-16 z-20 mx-auto flex w-fit max-w-[92%] items-center gap-4 rounded-full border border-white/10 bg-[#171a1d]/80 py-2 pl-5 pr-2 shadow-2xl backdrop-blur-xl ${phone ? "absolute bottom-4" : ""}`}>
          <ShoppingBag size={18} /><span className="text-[14px]">{b.lines.length} room{b.lines.length > 1 ? "s" : ""}</span><span className="text-[18px] font-semibold tracking-tight">{eur(b.total)}</span>
          {b.step === "rooms" && <button onClick={b.next} className="h-11 rounded-full bg-white px-5 text-[15px] font-medium text-[#171a1d]">Continue</button>}
        </div>
      )}
    </div>
  );
}

// B: Editorial light. White page, stepper on top, room rows with photo at the side, summary always visible at the right.
export const nameB = "Light with side summary";
export function LookB({ b, phone }: { b: B; phone: boolean }) {
  return (
    <div className="min-h-dvh bg-white pb-24 text-[#1d1d1f]">
      <div className={`flex items-center gap-6 border-b border-black/10 ${phone ? "px-4 pb-3 pt-12" : "px-12 py-4"}`}>
        <span className="text-[18px] font-semibold tracking-tight">{HOTEL.name}</span>
        {!phone && <div className="flex-1"><Stepper b={b} tone="light" phone={false} /></div>}
        <span className="ml-auto text-[14px] text-black/50">EN</span>
      </div>
      {phone && <div className="border-b border-black/10 px-4 py-3"><Stepper b={b} tone="light" phone /></div>}
      <div className={`mx-auto flex w-full max-w-[1240px] gap-8 ${phone ? "flex-col p-4" : "px-12 py-8"}`}>
        <div className="min-w-0 flex-1">
          {b.step === "rooms" ? (
            <>
              <h1 className={`font-semibold tracking-tight ${phone ? "text-[28px]" : "text-[38px]"}`}>Choose your room</h1>
              <div className="mt-3 rounded-[22px] bg-white p-2 shadow-[0_2px_24px_-8px_rgba(0,0,0,.18)] ring-1 ring-black/5"><SearchBar b={b} tone="light" phone={phone} /></div>
              <div className="mt-6 space-y-5">
                {TYPES.map((t) => (
                  <article key={t.id} className={`flex gap-4 rounded-[26px] bg-[#f5f5f7] p-3 ${phone ? "flex-col" : ""}`}>
                    <div className={`relative shrink-0 rounded-[18px] ${phone ? "h-44" : "w-48"}`} style={{ background: PHOTO[t.id] }}><div className="absolute left-3 top-3"><Left t={t} /></div></div>
                    <div className="min-w-0 flex-1 space-y-2 py-1"><h3 className="text-[22px] font-semibold tracking-tight">{t.name}</h3><Facts t={t} dark={false} />{visible(b, t).map((p) => <PlanRow key={p.id} b={b} t={t} p={p} dark={false} phone={phone} />)}</div>
                  </article>
                ))}
              </div>
            </>
          ) : <LaterSteps b={b} tone="light" phone={phone} />}
        </div>
        {b.step !== "done" && (
          <aside className={phone ? "" : "w-[340px] shrink-0"}>
            <div className={`rounded-[26px] bg-white p-5 shadow-[0_2px_24px_-8px_rgba(0,0,0,.18)] ring-1 ring-black/5 ${phone ? "" : "sticky top-6"}`}>
              <Summary b={b} tone="light" />
              {b.step === "rooms" && <button disabled={!b.lines.length} onClick={b.next} className="mt-4 h-12 w-full rounded-full bg-[var(--accent)] text-[16px] font-medium text-white disabled:opacity-40">Continue</button>}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// C: Split. Photo panel fixed on the left with the stay on it, the flow scrolls on the right; room types fold open one at a time.
export const nameC = "Split with photo panel";
export function LookC({ b, phone, open, setOpen }: { b: B; phone: boolean; open: string; setOpen: (id: string) => void }) {
  const cur = TYPES.find((t) => t.id === open) ?? TYPES[0];
  const panel = (
    <div className={`relative flex flex-col justify-between text-white ${phone ? "h-64 px-4 pb-4 pt-12" : "sticky top-0 h-dvh w-[44%] shrink-0 p-10"}`} style={{ background: b.step === "rooms" ? PHOTO[cur.id] : PHOTO.hero }}>
      <div className="text-[14px] uppercase tracking-[0.25em] text-white/85">{HOTEL.name}</div>
      <div>
        {b.step === "rooms" ? <><div className={`font-light tracking-tight ${phone ? "text-[32px]" : "text-[60px]"} leading-none`}>{cur.name}</div><div className="mt-2 text-[15px] text-white/80">{cur.size} · {cur.beds}</div></>
          : !phone && <div className="max-w-sm rounded-[24px] border border-white/10 bg-[#171a1d]/55 p-5 backdrop-blur-xl"><Summary b={b} tone="dark" /></div>}
      </div>
    </div>
  );
  return (
    <div className={`min-h-dvh bg-[#faf8f5] text-[#1d1d1f] ${phone ? "" : "flex"}`}>
      {panel}
      <div className={`min-w-0 flex-1 pb-28 ${phone ? "p-4" : "p-10"}`}>
        {b.step !== "done" && <div className="mb-5"><Stepper b={b} tone="light" phone={phone} /></div>}
        {b.step === "rooms" ? (
          <>
            <div className="rounded-[22px] bg-white p-2 ring-1 ring-black/5"><SearchBar b={b} tone="light" phone /></div>
            <div className="mt-5 space-y-2">
              {TYPES.map((t) => {
                const on = t.id === cur.id;
                const from = Math.min(...visible(b, t).map((p) => p.perNight));
                return (
                  <article key={t.id} className={`rounded-[22px] bg-white ring-1 ring-black/5 ${on ? "p-4" : ""}`}>
                    <button onClick={() => setOpen(t.id)} className={`flex w-full items-center gap-3 text-left ${on ? "" : "p-4"}`}>
                      <span className="size-12 shrink-0 rounded-[12px]" style={{ background: PHOTO[t.id] }} />
                      <span className="min-w-0 flex-1"><span className="block text-[18px] font-semibold tracking-tight">{t.name}</span><span className="block text-[13px] text-black/55">{t.size} · up to {t.max}</span></span>
                      <Left t={t} />
                      {!on && <span className="text-right text-[14px]">from <span className="text-[17px] font-semibold">{eur(from)}</span></span>}
                    </button>
                    {on && <div className="mt-3 space-y-2"><Facts t={t} dark={false} />{visible(b, t).map((p) => <div key={p.id} className="rounded-[16px] bg-[#f5f5f7]"><PlanRow b={b} t={t} p={p} dark={false} phone={phone} /></div>)}</div>}
                  </article>
                );
              })}
            </div>
            {b.lines.length > 0 && <div className="mt-5 rounded-[22px] bg-white p-5 ring-1 ring-black/5"><Summary b={b} tone="light" /><button onClick={b.next} className="mt-4 h-12 w-full rounded-full bg-[var(--accent)] text-[16px] font-medium text-white">Continue</button></div>}
          </>
        ) : <><LaterSteps b={b} tone="light" phone={phone} />{phone && b.step !== "done" && <div className="mt-5 rounded-[22px] bg-white p-5 ring-1 ring-black/5"><Summary b={b} tone="light" compact /></div>}</>}
      </div>
    </div>
  );
}
