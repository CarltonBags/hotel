"use client";

import { useEffect, useRef, useState } from "react";
import { eposPrintXml } from "@hoteloftware/domain";
import type { PrintJob } from "@hoteloftware/db";
import { reportPrintAction, takePrintJobsAction } from "../actions";

/**
 * The outlet device prints the order rounds: it takes the outlet's print jobs
 * and sends each to its printer's ePOS address on the outlet's network; a
 * printer without an address shows the ticket here. A failed job is tried
 * again (up to five times) and shown until it prints.
 */
export function PrintAgent({ outletId, labels }: { outletId: string; labels: { printing: string; failed: string } }) {
  const [shown, setShown] = useState<{ id: string; printer: string; text: string; error: string | null }[]>([]);
  const busy = useRef(false);
  useEffect(() => {
    const tick = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const jobs: PrintJob[] = await takePrintJobsAction(outletId);
        for (const j of jobs) {
          let error: string | null = null;
          if (j.address) {
            try {
              // ten seconds for the printer, well inside the two minutes before another device may take the job
              const res = await fetch(`${j.address.replace(/\/$/, "")}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=8000`, {
                method: "POST",
                headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
                body: eposPrintXml(j.text),
                signal: AbortSignal.timeout(10_000),
              });
              const body = await res.text();
              if (!res.ok || !/success="true"/.test(body)) error = /code="([^"]+)"/.exec(body)?.[1] ?? `HTTP ${res.status}`;
            } catch {
              error = "Printer not reachable";
            }
          }
          // a lost answer leaves the job taken: it comes back after two minutes
          await reportPrintAction(outletId, j.id, error === null, error ?? "").catch(() => undefined);
          // on screen: tickets of printers without an address, and failures to print by hand
          if (!j.address || error) setShown((s) => [{ id: j.id, printer: j.printerName, text: j.text, error }, ...s.filter((x) => x.id !== j.id)].slice(0, 6));
        }
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [outletId]);
  if (!shown.length) return null;
  return (
    <section className="grid gap-2 rounded-2xl bg-surface-2 p-3 text-sm" aria-label={labels.printing} data-print-agent>
      <h2 className="font-medium">{labels.printing}</h2>
      <div className="flex flex-wrap gap-3">
        {shown.map((j) => (
          <figure key={j.id} className="rounded-xl bg-surface p-2" data-printed={j.printer} data-print-error={j.error ?? ""}>
            <figcaption className={j.error ? "text-danger" : "text-ink-60"}>
              {j.printer}
              {j.error ? ` · ${labels.failed} (${j.error})` : ""}
            </figcaption>
            <pre className="font-mono text-xs">{j.text}</pre>
          </figure>
        ))}
      </div>
    </section>
  );
}
