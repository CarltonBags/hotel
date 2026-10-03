"use client";

import { useRef, useState } from "react";
import { FileDown } from "lucide-react";
import type { CityTaxReasonSetting } from "@hoteloftware/domain";
import type { CityTaxExemption } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { useFormAction } from "../use-form-action";
import { removeCityTaxExemptionAction, setCityTaxExemptionAction } from "../city-tax-actions";

const button = "h-9 rounded-full px-4 text-sm font-medium";
const secondary = `${button} border border-ink-10 bg-surface hover:bg-ink-5`;
const input = "h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm";

/** City Tax exemptions per person of the reservation, with their evidence (ticket 30). */
export function CityTaxPanel({
  reservationId,
  persons,
  reasons,
  exemptions,
  canEdit,
  m,
}: {
  reservationId: string;
  /** Labels of the persons staying: adults first, then children. */
  persons: string[];
  reasons: CityTaxReasonSetting[];
  exemptions: CityTaxExemption[];
  canEdit: boolean;
  m: Messages;
}) {
  const { pending, run, note } = useFormAction(m);
  const form = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState(reasons[0]?.reason ?? "");
  const evidence = reasons.find((r) => r.reason === reason)?.evidence ?? "none";
  return (
    <section aria-label={m["ctax.exemptions"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
      <h2 className="font-medium">{m["ctax.exemptions"]}</h2>
      <p className="text-xs text-ink-60">{m["ctax.exemptionsHelp"]}</p>
      {note}
      {exemptions.length === 0 ? <p className="text-ink-60">{m["ctax.noExemptions"]}</p> : null}
      <ul className="grid gap-1">
        {exemptions.map((e) => (
          <li key={e.id} data-exemption={e.reason} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2">
            <span className="min-w-0 flex-1">
              <strong>{persons[e.person] ?? `#${e.person + 1}`}</strong> · {m[`ctax.reason.${e.reason}`]}
              {e.note ? <span className="text-ink-60"> · {e.note}</span> : null}
            </span>
            {e.documentName ? (
              <a href={`/city-tax/evidence/${e.id}`} target="_blank" rel="noreferrer" className={`${secondary} inline-flex items-center gap-1`}>
                <FileDown size={15} /> {e.documentName}
              </a>
            ) : null}
            {canEdit ? (
              <button type="button" disabled={pending} onClick={() => run(() => removeCityTaxExemptionAction(reservationId, e.id))} className={secondary}>
                {m["ctax.remove"]}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit && reasons.length === 0 ? <p className="text-xs text-ink-60">{m["ctax.noReasons"]}</p> : null}
      {canEdit && reasons.length ? (
        <form
          ref={form}
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            run(
              () => setCityTaxExemptionAction(reservationId, data),
              () => form.current?.reset(),
            );
          }}
        >
          <label className="grid gap-1 text-xs text-ink-60">
            {m["ctax.person"]}
            <select name="person" className={input}>
              {persons.map((p, i) => (
                <option key={i} value={i}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-60">
            {m["ctax.reason"]}
            <select name="reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={input}>
              {reasons.map((r) => (
                <option key={r.reason} value={r.reason}>
                  {m[`ctax.reason.${r.reason}`]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid flex-1 gap-1 text-xs text-ink-60">
            {m["ctax.note"]}
            <input name="note" required={evidence === "note"} className={input} />
          </label>
          {evidence === "document" ? (
            <label className="grid gap-1 text-xs text-ink-60">
              {m["ctax.document"]}
              <input name="document" type="file" required accept="application/pdf,image/jpeg,image/png" className="text-sm" />
            </label>
          ) : null}
          <span className="w-full text-xs text-ink-60">{fill(m["ctax.evidenceNeeded"], { evidence: m[`ctax.evidence.${evidence}`] })}</span>
          <button type="submit" disabled={pending} className={`${button} bg-accent text-white disabled:opacity-60`}>
            {m["ctax.exempt"]}
          </button>
        </form>
      ) : null}
    </section>
  );
}
