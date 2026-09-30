"use client";
// PROTOTYPE, throwaway. Question: what does the Rates screen look like and how does bulk editing feel, including keyboard entry?
// Three structures via ?variant=: A spreadsheet grid, B month calendar per rate, C price periods. Bulk edit panel shared.
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PrototypeSwitcher } from "../PrototypeSwitcher";
import { useWorkspace } from "../shell/useWorkspace";
import { VariantE } from "../shell/VariantE";
import { BulkPanel, SyncState, Warnings } from "./BulkPanel";
import { DAYS, useRates } from "./model";
import { CalendarB, GridA, PeriodsC, nameA, nameB, nameC } from "./variants";

const VARIANTS = [{ key: "A", name: nameA }, { key: "B", name: nameB }, { key: "C", name: nameC }];

export function RatesPrototype() {
  const q = useSearchParams();
  const raw = q.get("variant") ?? "A";
  const variant = VARIANTS.some((v) => v.key === raw) ? raw : "A";
  const ws = useWorkspace();
  const r = useRates();
  useEffect(() => {
    ws.openModule("rates");
    const p = new URLSearchParams(window.location.search); // PROTOTYPE debug param: preselect a range with a bulk change
    if (p.get("demo") === "bulk") { r.setSel({ rows: ["flex|DBL", "flex|DBS", "saver|DBL"], from: 12, to: 20 }); r.setBulk({ weekdays: [true, true, true, true, true, false, false], action: "percent", value: -40, restr: { key: "minArr", value: 2 } }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-10 px-5 py-3">
        <h1 className="text-[20px] font-semibold tracking-tight">Rates</h1>
        <SyncState r={r} />
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-60"><span>STOP stop sell</span><span>CTA closed to arrival</span><span>CTD closed to departure</span><span>2N min stay on arrival</span><span>2T min stay through</span><span>≤7 max stay</span><span className="text-danger">red below floor</span></div>
      </div>
      <Warnings r={r} />
      <div className="flex min-h-0 flex-1">
        {variant === "A" && <GridA r={r} />}
        {variant === "B" && <CalendarB r={r} />}
        {variant === "C" && <PeriodsC r={r} />}
        <BulkPanel r={r} />
      </div>
    </div>
  );

  return (
    <>
      <VariantE ws={ws} content={content} contentKind="rates" />
      <PrototypeSwitcher variants={VARIANTS} current={variant} state={{ variant, horizonDays: DAYS, selection: r.sel, bulk: r.bulk, preview: r.preview(r.sel, r.bulk), pendingSync: r.pending, lastSync: r.synced, pricesEnding: r.ends, log: r.log }} />
    </>
  );
}
