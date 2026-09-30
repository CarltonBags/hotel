"use client";
// PROTOTYPE guest-facing tablet. Shows only what the desk pushed. Apple-like: one task per screen, large type.
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CreditCard, Eraser, Globe, Loader, PenLine, Printer } from "lucide-react";
import { GUESTS, PATHS, duty, type FormState, type Guest, type Path, type Step } from "./model";

const field = "mt-1.5 h-12 w-full rounded-[14px] border border-white/15 bg-white/10 px-4 text-[17px] text-white outline-none placeholder:text-white/40 focus:border-white/60";
const primary = "flex h-14 items-center justify-center gap-2 rounded-full bg-white px-8 text-[17px] font-medium text-[#171a1d] transition-transform duration-100 active:scale-[0.98] disabled:opacity-40";
const ghost = "flex h-14 items-center justify-center gap-2 rounded-full px-6 text-[17px] text-white/80 hover:bg-white/10";

function SignaturePad({ onChange }: { onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 900, ((e.clientY - r.top) / r.height) * 260];
  };
  return (
    <div>
      <canvas
        ref={ref} width={900} height={260}
        className="h-[170px] w-full touch-none rounded-[20px] bg-white"
        onPointerDown={(e) => { drawing.current = true; const c = ref.current!.getContext("2d")!; const [x, y] = pos(e); c.lineWidth = 3; c.lineCap = "round"; c.strokeStyle = "#171a1d"; c.beginPath(); c.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const c = ref.current!.getContext("2d")!; const [x, y] = pos(e); c.lineTo(x, y); c.stroke(); }}
        onPointerUp={() => { drawing.current = false; onChange(ref.current!.toDataURL()); }}
        onPointerLeave={() => { drawing.current = false; }}
      />
      <button onClick={() => { ref.current!.getContext("2d")!.clearRect(0, 0, 900, 260); onChange(null); }} className="mt-2 flex items-center gap-1.5 text-[14px] text-white/70 hover:text-white"><Eraser size={15} />Clear</button>
    </div>
  );
}

export function Tablet({ path, form, update, deviceName }: { path: Path; form: FormState | null; update: (patch: Partial<FormState>) => void; deviceName: string }) {
  const [sig, setSig] = useState<string | null>(null);
  const at = PATHS[path].country === "AT";
  const go = (step: Step) => update({ step });
  const set = (k: keyof Guest, v: string) => form && update({ data: { ...form.data, [k]: v } });
  const counted = GUESTS.filter((g) => g.id !== form?.guestId && duty(g, path) === "counted");

  const body = () => {
    if (!form || form.step === "idle") {
      return (
        <div className="grid h-full place-items-center text-center">
          <div>
            <div className="text-[15px] uppercase tracking-[0.2em] text-white/60">{PATHS[path].property}</div>
            <div className="mt-3 text-[64px] font-light tracking-tight">Welcome</div>
            <div className="mt-2 text-[17px] text-white/60">The reception will hand over to you in a moment.</div>
          </div>
        </div>
      );
    }
    const d = form.data;
    switch (form.step) {
      case "welcome":
        return (
          <div className="grid h-full place-items-center text-center">
            <div>
              <div className="text-[44px] font-light tracking-tight">Hello {d.first}</div>
              <p className="mx-auto mt-3 max-w-md text-[18px] text-white/70">Please check your registration details. It takes about one minute.</p>
              <div className="mt-6 flex justify-center gap-2 text-[15px]">
                {["English", "Deutsch", "Français", "日本語"].map((l, i) => <span key={l} className={`flex h-10 items-center gap-1.5 rounded-full px-4 ${i === 0 ? "bg-white/20" : "bg-white/5 text-white/60"}`}>{i === 0 && <Globe size={15} />}{l}</span>)}
              </div>
              <button onClick={() => go("details")} className={`${primary} mx-auto mt-8`}>Start<ArrowRight size={19} /></button>
            </div>
          </div>
        );
      case "details":
        return (
          <div>
            <h2 className="text-[30px] font-light tracking-tight">Your details</h2>
            <p className="text-[15px] text-white/60">Arrival 28 Sep 2026 · Departure 3 Oct 2026 (set by the hotel)</p>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[14px] text-white/70">
              <label>First names<input className={field} value={d.first} onChange={(e) => set("first", e.target.value)} /></label>
              <label>Family name<input className={field} value={d.last} onChange={(e) => set("last", e.target.value)} /></label>
              <label>Date of birth<input type="date" className={field} value={d.dob} onChange={(e) => set("dob", e.target.value)} /></label>
              <label>Nationality<input className={field} value={d.nationality} onChange={(e) => set("nationality", e.target.value)} /></label>
              <label className="col-span-2">Street and number<input className={field} value={d.street} onChange={(e) => set("street", e.target.value)} /></label>
              <label>Postcode<input className={field} value={d.postcode} onChange={(e) => set("postcode", e.target.value)} /></label>
              <label>City<input className={field} value={d.city} onChange={(e) => set("city", e.target.value)} /></label>
              <label>Country<input className={field} value={d.country} onChange={(e) => set("country", e.target.value)} /></label>
              <label>Passport number<input className={field} value={d.passport} onChange={(e) => set("passport", e.target.value)} /></label>
              {at && <label>Gender<input className={field} placeholder="as in travel document" value={d.gender} onChange={(e) => set("gender", e.target.value)} /></label>}
            </div>
            <div className="mt-5 flex justify-between"><button onClick={() => go("welcome")} className={ghost}><ArrowLeft size={18} />Back</button><button onClick={() => go(counted.length ? "companions" : "review")} className={primary}>Continue<ArrowRight size={19} /></button></div>
          </div>
        );
      case "companions":
        return (
          <div>
            <h2 className="text-[30px] font-light tracking-tight">Travelling with you</h2>
            <p className="mt-1 text-[16px] text-white/70">{at ? "Children travelling with you are listed on your form." : "Your spouse, partner and children under 18 are recorded by number only. No names are stored on the form."}</p>
            <div className="mt-5 rounded-[20px] bg-white/10 p-5">
              <div className="text-[52px] font-light leading-none">{counted.length}</div>
              <div className="mt-1 text-[16px] text-white/70">family member{counted.length === 1 ? "" : "s"} · nationality {Array.from(new Set(counted.map((c) => c.nationality))).join(", ")}</div>
              {at && <ul className="mt-3 space-y-1 text-[16px]">{counted.map((c) => <li key={c.id}>{c.first} {c.last}, born {c.dob}</li>)}</ul>}
            </div>
            <div className="mt-6 flex justify-between"><button onClick={() => go("details")} className={ghost}><ArrowLeft size={18} />Back</button><button onClick={() => go("review")} className={primary}>Correct<ArrowRight size={19} /></button></div>
          </div>
        );
      case "review":
        return (
          <div>
            <h2 className="text-[30px] font-light tracking-tight">Is everything correct?</h2>
            <dl className="mt-4 grid grid-cols-[150px_1fr] gap-y-2 rounded-[20px] bg-white/10 p-5 text-[16px]">
              <dt className="text-white/60">Name</dt><dd>{d.first} {d.last}</dd>
              <dt className="text-white/60">Born</dt><dd>{d.dob}</dd>
              <dt className="text-white/60">Nationality</dt><dd>{d.nationality}</dd>
              <dt className="text-white/60">Address</dt><dd>{d.street}, {d.postcode} {d.city}, {d.country}</dd>
              <dt className="text-white/60">Passport</dt><dd>{d.passport}</dd>
              <dt className="text-white/60">With you</dt><dd>{counted.length} family member{counted.length === 1 ? "" : "s"}</dd>
            </dl>
            {path === "DE_CARD" && (
              <label className="mt-4 flex items-start gap-3 text-[15px] text-white/80">
                <input type="checkbox" checked={form.consent} onChange={(e) => update({ consent: e.target.checked })} className="mt-1 size-5" />
                I agree to register electronically and to confirm my details with a card payment. Without this, I can sign a printed form at the reception instead.
              </label>
            )}
            <div className="mt-5 flex justify-between">
              <button onClick={() => go(counted.length ? "companions" : "details")} className={ghost}><ArrowLeft size={18} />Back</button>
              {path === "AT_SIGN" && <button onClick={() => go("sign")} className={primary}><PenLine size={19} />Continue to sign</button>}
              {path === "DE_PRINT" && <button onClick={() => go("handoff")} className={primary}>Confirm<ArrowRight size={19} /></button>}
              {path === "DE_CARD" && (
                <div className="flex gap-2">
                  <button onClick={() => go("handoff")} className={ghost}><Printer size={18} />Sign on paper instead</button>
                  <button disabled={!form.consent} onClick={() => go("card")} className={primary}><CreditCard size={19} />Confirm by card</button>
                </div>
              )}
            </div>
          </div>
        );
      case "sign":
        return (
          <div>
            <h2 className="text-[30px] font-light tracking-tight">Please sign</h2>
            <p className="mb-3 text-[15px] text-white/60">With my signature I confirm that the details are correct.</p>
            <SignaturePad onChange={setSig} />
            <div className="mt-4 flex justify-between"><button onClick={() => go("review")} className={ghost}><ArrowLeft size={18} />Back</button><button disabled={!sig} onClick={() => update({ signature: sig, step: "done" })} className={primary}><Check size={19} />Confirm and sign</button></div>
          </div>
        );
      case "handoff":
        return (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Printer size={44} className="mx-auto text-white/70" />
              <div className="mt-4 text-[36px] font-light tracking-tight">Thank you, {d.first}</div>
              <p className="mx-auto mt-2 max-w-md text-[18px] text-white/70">Your form is being printed. Please sign it by hand at the reception.</p>
            </div>
          </div>
        );
      case "card":
        return (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Loader size={44} className="mx-auto animate-spin text-white/70" />
              <div className="mt-4 text-[36px] font-light tracking-tight">Please use the card terminal</div>
              <p className="mx-auto mt-2 max-w-md text-[18px] text-white/70">Your card payment confirms your registration. No signature is needed.</p>
            </div>
          </div>
        );
      case "done":
        return (
          <div className="grid h-full place-items-center text-center">
            <div>
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#35cb91]"><Check size={34} /></span>
              <div className="mt-4 text-[40px] font-light tracking-tight">All set</div>
              <p className="mt-2 text-[18px] text-white/70">Enjoy your stay, {d.first}.</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="rounded-[44px] bg-[#0b0c0e] p-4 shadow-2xl">
      <div className="relative h-[620px] w-[820px] overflow-hidden rounded-[30px] text-white" style={{ background: "radial-gradient(120% 90% at 10% 0%, #3b6f8f 0%, #1f3d52 38%, #14202b 70%, #0e1318 100%)" }}>
        <div className="absolute inset-0 overflow-auto p-10">{body()}</div>
        <div className="pointer-events-none absolute bottom-3 right-5 text-[11px] text-white/30">{deviceName} · shows only what reception sends</div>
      </div>
    </div>
  );
}
