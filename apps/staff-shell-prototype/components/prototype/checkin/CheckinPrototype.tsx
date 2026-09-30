"use client";
// PROTOTYPE, throwaway. Question: what does the Apple-like self check-in look like, on a lobby kiosk and on the guest's phone,
// and what happens when check-in cannot complete without staff? Three looks via ?variant=; device, key handover and blockers via the control panel.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BellRing, Check, Monitor, Smartphone } from "lucide-react";
import { PrototypeSwitcher } from "../PrototypeSwitcher";
import { BLOCKER_TEXT, STAY, useCheckin, type Blocker, type Device, type KeyMode, type Step } from "./model";
import { VariantA, name as nameA } from "./VariantA";
import { VariantB, name as nameB } from "./VariantB";
import { VariantC, name as nameC } from "./VariantC";

const VARIANTS = [{ key: "A", name: nameA }, { key: "B", name: nameB }, { key: "C", name: nameC }];

function Flow({ device, variant, setDevice }: { device: Device; variant: string; setDevice: (d: Device) => void }) {
  const c = useCheckin(device);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search); // PROTOTYPE debug params
    const k = q.get("key") as KeyMode | null; if (k) c.setKeyMode(k);
    const b = q.get("blocker") as Blocker | null; if (b) c.setBlocker(b);
    const s = q.get("demo") as Step | null; if (s) setTimeout(() => c.jump(s), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sel = "h-10 w-full rounded-[12px] border border-ink-10 bg-surface-2 px-3 text-[14px]";
  const seg = (on: boolean) => `flex h-10 flex-1 items-center justify-center gap-2 rounded-[12px] text-[14px] ${on ? "bg-ink text-canvas" : "bg-surface-2 text-ink-80"}`;

  return (
    <>
      <div className="flex min-h-dvh items-start justify-center gap-8 bg-canvas p-8 pb-28">
        <div className="w-[300px] shrink-0 space-y-4">
          <div className="rounded-[22px] bg-surface p-5 shadow-card">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-40">Prototype controls</div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setDevice("kiosk")} className={seg(device === "kiosk")}><Monitor size={16} />Kiosk</button>
              <button onClick={() => setDevice("phone")} className={seg(device === "phone")}><Smartphone size={16} />Phone</button>
            </div>
            <label className="mt-3 block text-[12px] text-ink-60">Key handover (property setting)
              <select className={sel} value={c.keyMode} onChange={(e) => c.setKeyMode(e.target.value as KeyMode)}>
                <option value="reception">Collect at reception</option><option value="encoder">Kiosk key-card encoder</option><option value="digital">Digital key on phone</option><option value="pin">Door PIN code</option>
              </select>
            </label>
            <label className="mt-3 block text-[12px] text-ink-60">Condition that fails
              <select className={sel} value={c.blocker} onChange={(e) => c.setBlocker(e.target.value as Blocker)}>
                <option value="none">None, all conditions met</option><option value="room-not-ready">Room not ready</option><option value="too-early">Too early</option><option value="payment-failed">Payment fails</option>
              </select>
            </label>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {c.steps.map((s) => <button key={s} onClick={() => c.jump(s)} className={`rounded-full px-3 py-1 text-[12px] ${c.step === s ? "bg-accent text-white" : "bg-ink-10"}`}>{s}</button>)}
              <button onClick={c.restart} className="rounded-full bg-ink-10 px-3 py-1 text-[12px]">restart</button>
            </div>
          </div>
          <div className="rounded-[22px] bg-surface p-5 shadow-card">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-40">Front desk sees</div>
            {c.step !== "result" && <div className="mt-2 text-[14px] text-ink-60">{STAY.guest} is checking in on {device === "kiosk" ? "Lobby kiosk 1" : "their phone"}: <span className="font-medium text-ink">{c.step}</span></div>}
            {c.step === "result" && c.success && (
              <div className="mt-2 flex gap-2.5 rounded-[14px] bg-success/10 p-3 text-[14px]"><Check size={18} className="mt-0.5 shrink-0 text-success" /><div><div className="font-medium">Self check-in complete</div><div className="text-ink-60">{STAY.guest} · Room {STAY.room} assigned automatically · € 1,240.00 paid by card · key: {c.keyMode} · registered by card payment</div></div></div>
            )}
            {c.step === "result" && !c.success && (
              <div className="mt-2 flex gap-2.5 rounded-[14px] bg-warning/15 p-3 text-[14px]"><BellRing size={18} className="mt-0.5 shrink-0 text-warning" /><div><div className="font-medium">Guest needs help at {device === "kiosk" ? "Lobby kiosk 1" : "reception"}</div><div className="text-ink-60">{STAY.guest} · {BLOCKER_TEXT[c.blocker === "none" ? "payment-failed" : c.blocker].desk} · registration and details already saved</div><button className="mt-2 h-8 rounded-full bg-ink px-3 text-[13px] font-medium text-canvas">Open reservation</button></div></div>
            )}
          </div>
        </div>
        <div className={`overflow-hidden bg-black shadow-2xl ${device === "kiosk" ? "h-[700px] w-[1000px] rounded-[36px] p-3" : "h-[820px] w-[400px] rounded-[54px] p-3"}`}>
          <div className={`h-full w-full overflow-hidden ${device === "kiosk" ? "rounded-[26px]" : "rounded-[44px]"}`}>
            {variant === "A" && <VariantA c={c} />}
            {variant === "B" && <VariantB c={c} />}
            {variant === "C" && <VariantC c={c} />}
          </div>
        </div>
      </div>
      <PrototypeSwitcher variants={VARIANTS} current={variant} state={{ variant, device, step: c.step, paid: c.paid, keyMode: c.keyMode, blocker: c.blocker, success: c.success }} />
    </>
  );
}

export function CheckinPrototype() {
  const q = useSearchParams();
  const raw = q.get("variant") ?? "A";
  const variant = VARIANTS.some((v) => v.key === raw) ? raw : "A";
  const [device, setDevice] = useState<Device>(q.get("device") === "phone" ? "phone" : "kiosk");
  return <Flow key={device} device={device} variant={variant} setDevice={setDevice} />;
}
