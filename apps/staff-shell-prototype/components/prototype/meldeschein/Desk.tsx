"use client";
// PROTOTYPE front desk panel: what staff see and do on the reservation while the guest uses the tablet.
import { Ban, Check, CircleAlert, CreditCard, FileText, Printer, ShieldCheck, TabletSmartphone } from "lucide-react";
import { DEVICES, GUESTS, PATHS, duty, type FormState, type Path } from "./model";

const STEP_LABEL: Record<string, string> = {
  welcome: "Tablet: welcome screen", details: "Tablet: editing details", companions: "Tablet: companions", review: "Tablet: reviewing",
  sign: "Tablet: signing", handoff: "Waiting for handwritten signature", card: "Waiting for card payment", done: "Guest part complete",
};

export function status(f: FormState | undefined): { label: string; tone: string } {
  if (!f) return { label: "Not started", tone: "bg-ink-10 text-ink-80" };
  if (f.completedAt) return { label: "Registered", tone: "bg-success/15 text-success" };
  if (f.step === "done") return { label: "ID check pending", tone: "bg-warning/15 text-warning" };
  return { label: STEP_LABEL[f.step] ?? "On tablet", tone: "bg-accent/15 text-accent" };
}

export function Desk(p: {
  path: Path; forms: Record<string, FormState>; onTablet: string | null; deviceId: string; selected: string;
  setDevice: (id: string) => void; select: (id: string) => void; send: (id: string) => void; recall: () => void;
  patch: (id: string, patch: Partial<FormState>) => void; complete: (id: string) => void; takePayment: (id: string) => void; paying: boolean;
}) {
  const cfg = PATHS[p.path];
  const sel = GUESTS.find((g) => g.id === p.selected)!;
  const f = p.forms[sel.id];
  const guestPartDone = !!f && (f.step === "done" || (p.path === "DE_PRINT" && f.signedOnPaper) || (p.path === "DE_CARD" && !!f.cardToken));
  const btn = "flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium shadow-pill hover:bg-ink-5 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="w-[520px] shrink-0 rounded-[26px] bg-surface p-6 shadow-card">
      <div className="flex items-center gap-2 text-[12px] text-ink-60"><FileText size={15} />Reservation R-48220 · {cfg.property}</div>
      <h1 className="mt-1 text-[24px] font-medium tracking-tight">Guest registration</h1>
      <div className="mt-3 flex items-start gap-2 rounded-[14px] bg-accent/10 p-3 text-[13px] text-ink-80"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" />{cfg.rule}</div>

      <div className="mt-4 overflow-hidden rounded-[16px] border border-ink-10">
        {GUESTS.map((g) => {
          const du = duty(g, p.path);
          const st = status(p.forms[g.id]);
          return (
            <button key={g.id} disabled={du !== "own-form"} onClick={() => p.select(g.id)} className={`flex w-full items-center gap-3 border-b border-ink-5 px-3 py-2.5 text-left last:border-0 ${p.selected === g.id ? "bg-ink-5" : ""} ${du === "own-form" ? "hover:bg-ink-5" : "cursor-default opacity-60"}`}>
              <span className="w-8 rounded-[6px] bg-ink-10 py-0.5 text-center font-mono text-[11px]">{g.nationality}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{g.first} {g.last}</span><span className="block text-[12px] text-ink-60">{g.relation}</span></span>
              {du === "own-form" && <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${st.tone}`}>{st.label}</span>}
              {du === "counted" && <span className="text-[12px] text-ink-60">counted on family form</span>}
              {du === "none" && <span className="flex items-center gap-1 text-[12px] text-ink-60"><Ban size={13} />not required</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-5 text-[12px] font-semibold uppercase tracking-wide text-ink-40">{sel.first} {sel.last}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={p.deviceId} onChange={(e) => p.setDevice(e.target.value)} className="h-10 rounded-full border border-ink-10 bg-surface-2 px-3 text-[14px]">
          {DEVICES.map((d) => <option key={d.id} value={d.id} disabled={!d.online}>{d.name}{d.online ? "" : " (offline)"}</option>)}
        </select>
        {p.onTablet === sel.id
          ? <button onClick={p.recall} className={btn}><Ban size={16} />Take back from tablet</button>
          : <button disabled={!!f?.completedAt || (!!p.onTablet && p.onTablet !== sel.id)} onClick={() => p.send(sel.id)} className={`${btn} bg-accent text-white hover:bg-accent hover:brightness-105`}><TabletSmartphone size={16} />{f ? "Send again" : "Send to tablet"}</button>}
        {p.onTablet && p.onTablet !== sel.id && <span className="flex items-center gap-1 text-[12px] text-warning"><CircleAlert size={14} />Tablet busy with another guest</span>}
      </div>

      {f && (
        <div className="mt-4 space-y-3 rounded-[16px] bg-surface-2 p-4">
          <div className="text-[13px] text-ink-60">Live from tablet: <span className="font-medium text-ink">{f.data.first} {f.data.last}</span>, {f.data.street}, {f.data.postcode} {f.data.city}, {f.data.country} · passport {f.data.passport || "—"}</div>
          <label className="flex items-start gap-2.5 text-[14px]">
            <input type="checkbox" checked={f.idChecked} onChange={(e) => p.patch(sel.id, { idChecked: e.target.checked })} className="mt-0.5 size-4" />
            I compared the details with the passport.
          </label>
          <input value={f.idNote} onChange={(e) => p.patch(sel.id, { idNote: e.target.value })} placeholder="Discrepancy or 'no valid ID shown' (optional)" className="h-9 w-full rounded-[10px] border border-ink-10 bg-surface px-3 text-[13px]" />

          {(p.path === "DE_PRINT" || (p.path === "DE_CARD" && f.step === "handoff")) && (
            <div className="flex flex-wrap gap-2">
              <button disabled={f.step !== "handoff"} onClick={() => p.patch(sel.id, { printed: true })} className={btn}><Printer size={16} />{f.printed ? "Print again" : "Print form"}</button>
              <button disabled={!f.printed} onClick={() => p.patch(sel.id, { signedOnPaper: true })} className={btn}><Check size={16} />{f.signedOnPaper ? "Signed on paper" : "Guest signed the paper"}</button>
            </div>
          )}
          {p.path === "DE_CARD" && f.step !== "handoff" && (
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={f.step !== "card" || !!f.cardToken || p.paying} onClick={() => p.takePayment(sel.id)} className={btn}><CreditCard size={16} />{f.cardToken ? "Card confirmed" : p.paying ? "Terminal waiting for card" : "Start payment on terminal"}</button>
              {f.cardToken && <span className="font-mono text-[12px] text-ink-60">{f.cardToken} · Stripe</span>}
            </div>
          )}
          {p.path === "AT_SIGN" && f.signature && <img src={f.signature} alt="Signature" className="h-16 rounded-[10px] bg-white" />}

          <button disabled={!guestPartDone || !f.idChecked || !!f.completedAt} onClick={() => p.complete(sel.id)} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-[14px] font-medium text-canvas disabled:opacity-30">
            <Check size={17} />{f.completedAt ? `Registered ${f.completedAt}` : "Complete registration"}
          </button>
          {!f.completedAt && <div className="text-[12px] text-ink-60">Needs: guest part done{guestPartDone ? " ✓" : ""} · passport compared{f.idChecked ? " ✓" : ""}</div>}
        </div>
      )}
    </div>
  );
}
