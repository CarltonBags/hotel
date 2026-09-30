"use client";
// PROTOTYPE, throwaway. Question: what does the hosted booking page look like on desktop and phone, including the room list with
// several rate plans, the summary, the multi-room cart, the hold countdown, the rate code, the tenant page, the widget and the voucher page?
// Three looks via ?variant=. A control strip at the top (not part of any design) switches device and page.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Monitor, Smartphone } from "lucide-react";
import { PrototypeSwitcher } from "../PrototypeSwitcher";
import { STEPS, useBooking, type Page, type Step } from "./model";
import { TenantPage, VoucherPage, WidgetPage } from "./shared";
import { LookA, LookB, LookC, nameA, nameB, nameC } from "./variants";

const VARIANTS = [{ key: "A", name: nameA }, { key: "B", name: nameB }, { key: "C", name: nameC }];
const PAGES: [Page, string][] = [["flow", "Booking flow"], ["tenant", "Chain page"], ["widget", "Widget on hotel site"], ["voucher", "Voucher"]];

export function BookingPrototype() {
  const q = useSearchParams();
  const raw = q.get("variant") ?? "A";
  const variant = VARIANTS.some((v) => v.key === raw) ? raw : "A";
  const b = useBooking();
  const [phone, setPhone] = useState(q.get("device") === "phone");
  const [open, setOpen] = useState("DBS");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search); // PROTOTYPE debug params
    const s = p.get("demo") as Step | null; if (s) b.demo(s);
    const pg = p.get("page") as Page | null; if (pg) b.setPage(pg);
    const c = p.get("code"); if (c) b.setCode(c);
    const a = p.get("accent"); if (a) document.documentElement.style.setProperty("--accent", `#${a}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tone = variant === "A" ? "dark" : "light";
  const body = b.page === "tenant" ? <div className={tone === "dark" ? "min-h-full bg-[#0e1318] text-white" : "min-h-full bg-white text-[#1d1d1f]"}><TenantPage tone={tone} phone={phone} onPick={() => b.setPage("flow")} /></div>
    : b.page === "widget" ? <WidgetPage phone={phone} onGo={() => b.setPage("flow")} />
    : b.page === "voucher" ? <div className={tone === "dark" ? "min-h-full bg-[#0e1318] text-white" : "min-h-full bg-white text-[#1d1d1f]"}><VoucherPage tone={tone} phone={phone} /></div>
    : variant === "A" ? <LookA b={b} phone={phone} /> : variant === "B" ? <LookB b={b} phone={phone} /> : <LookC b={b} phone={phone} open={open} setOpen={setOpen} />;
  const seg = (on: boolean) => `flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] ${on ? "bg-white text-black" : "text-white/80 hover:bg-white/15"}`;

  return (
    <>
      <div className="sticky top-0 z-40 flex flex-wrap items-center gap-1 bg-black px-3 py-1.5 font-mono text-white ring-2 ring-fuchsia-500">
        <span className="px-2 text-[12px]">PROTOTYPE controls</span>
        <button onClick={() => setPhone(false)} className={seg(!phone)}><Monitor size={14} />Desktop</button>
        <button onClick={() => setPhone(true)} className={seg(phone)}><Smartphone size={14} />Phone</button>
        <span className="mx-1 h-4 w-px bg-white/30" />
        {PAGES.map(([p, l]) => <button key={p} onClick={() => b.setPage(p)} className={seg(b.page === p)}>{l}</button>)}
        <span className="mx-1 h-4 w-px bg-white/30" />
        {STEPS.map((s) => <button key={s} onClick={() => { b.setPage("flow"); b.demo(s); }} className={seg(b.page === "flow" && b.step === s)}>{s}</button>)}
        <button onClick={() => b.setHold(45)} className={seg(false)}>hold 0:45</button>
        <button onClick={() => b.setCode(b.unlocked ? "" : "SIEMENS26")} className={seg(b.unlocked)}>rate code</button>
      </div>
      {phone ? (
        <div className="flex min-h-dvh justify-center bg-canvas p-8 pb-28">
          <div className="h-[820px] w-[400px] rounded-[54px] bg-black p-3 shadow-2xl"><div className="relative h-full w-full overflow-auto rounded-[44px]">{body}</div></div>
        </div>
      ) : <div className="min-h-dvh">{body}</div>}
      <PrototypeSwitcher variants={VARIANTS} current={variant} state={{ variant, device: phone ? "phone" : "desktop", page: b.page, step: b.step, code: b.code, codeUnlocked: b.unlocked, holdSeconds: b.hold, cart: b.lines.map((l) => ({ room: l.type.name, plan: l.plan.name, policy: l.plan.policy, gross: l.gross, cityTax: l.tax })), extras: b.extras, total: b.total, dueNow: b.now, dueAtHotel: b.later }} />
    </>
  );
}
