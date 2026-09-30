"use client";
// PROTOTYPE supervisor assignment board (desktop): proposed distribution, drag between staff, inspect.
import { CheckCheck, RefreshCw, WifiOff, Wifi } from "lucide-react";
import { SHIFT, STAFF, type Hk } from "./model";
import { TYPE_HUE, TYPE_ICON } from "./parts";

export function Board({ hk }: { hk: Hk }) {
  const cols = [...STAFF, null];
  const toInspect = hk.tasks.filter((t) => t.clean === "clean");
  const ctl = "flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium shadow-pill hover:bg-ink-5";
  return (
    <div className="w-[880px] shrink-0 space-y-4">
      <div className="rounded-[26px] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto"><div className="text-[12px] font-semibold uppercase tracking-wide text-ink-40">Supervisor, desktop</div><h2 className="text-[20px] font-semibold tracking-tight">Housekeeping today</h2></div>
          <button onClick={hk.earlyDeparture} className={ctl}><RefreshCw size={15} />Simulate early departure in 214</button>
          <button onClick={() => hk.setOnline(!hk.online)} className={`${ctl} ${hk.online ? "" : "bg-warning/20"}`}>{hk.online ? <Wifi size={15} /> : <WifiOff size={15} />}Phone is {hk.online ? "online" : "offline"}</button>
          <button onClick={() => hk.setRole(hk.role === "housekeeper" ? "maintenance" : "housekeeper")} className={ctl}>Phone shows: {hk.role}</button>
        </div>
        <div className="mt-4 grid grid-cols-5 gap-2">
          {cols.map((who) => {
            const list = hk.tasks.filter((t) => t.assignee === who);
            const min = list.reduce((a, t) => a + t.minutes, 0);
            return (
              <div key={who ?? "none"} onDragOver={(e) => e.preventDefault()} onDrop={(e) => hk.assign(e.dataTransfer.getData("text/plain"), who)} className={`min-h-[300px] rounded-[18px] p-2 ${who ? "bg-surface-2" : "border-2 border-dashed border-ink-20"}`}>
                <div className="px-1 text-[14px] font-semibold">{who ?? "Unassigned"}</div>
                <div className="px-1 text-[12px] text-ink-60">{list.length} rooms · {min} min</div>
                {who && <div className="mx-1 mt-1 h-1.5 overflow-hidden rounded-full bg-ink-10"><div className={`h-full rounded-full ${min > SHIFT ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min(100, (min / SHIFT) * 100)}%` }} /></div>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {list.map((t) => {
                    const Icon = TYPE_ICON[t.type];
                    return (
                      <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)} title={`${t.room} ${t.type} ${t.minutes} min · ${t.state}`} className={`flex h-8 cursor-grab items-center gap-1 rounded-[10px] bg-surface px-2 text-[13px] font-medium shadow-card ${t.state === "done" ? "opacity-50" : ""} ${t.flag === "waiting" ? "ring-2 ring-danger" : ""}`}>
                        <Icon size={14} style={{ color: TYPE_HUE[t.type] }} />{t.room}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-[26px] bg-surface p-5 shadow-card">
          <h3 className="text-[15px] font-semibold">Waiting for inspection ({toInspect.length})</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {toInspect.length === 0 && <span className="text-[13px] text-ink-60">Rooms appear here when a housekeeper sets them to Clean.</span>}
            {toInspect.map((t) => <button key={t.id} onClick={() => hk.inspect(t.id)} className="flex h-10 items-center gap-1.5 rounded-full bg-success/15 px-3 text-[14px] font-medium text-success"><CheckCheck size={16} />{t.room} inspected</button>)}
          </div>
        </div>
        <div className="rounded-[26px] bg-surface p-5 shadow-card">
          <h3 className="text-[15px] font-semibold">What happened</h3>
          <ul className="mt-2 space-y-1 text-[13px] text-ink-60">{hk.log.length === 0 && <li>Nothing yet.</li>}{hk.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
