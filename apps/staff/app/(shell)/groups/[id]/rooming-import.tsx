"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RoomingPreview } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import { importRoomingAction, previewRoomingAction } from "../billing-actions";

/** The organiser's Rooming List (ticket 59): a CSV saved from the template, checked against the Held Rooms first, then the rows without problems imported. */
export function RoomingImport({ groupId, holdingId, m }: { groupId: string; holdingId: string; m: Messages }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<RoomingPreview | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const button = "h-9 rounded-full px-4 text-sm font-medium disabled:opacity-60";
  return (
    <div className="grid gap-2" data-rooming-import>
      <label className="grid gap-1">
        <span className="text-ink-80">{m["group.roomingPaste"]}</span>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) (setText(await f.text()), setPreview(null));
          }}
        />
        <textarea value={text} onChange={(e) => (setText(e.target.value), setPreview(null))} rows={4} name="rooming" className="w-full rounded-xl border border-ink-10 bg-surface p-3 font-mono text-xs" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !text.trim()}
          className={`${button} border border-ink-10`}
          onClick={() =>
            start(async () => {
              const r = await previewRoomingAction(holdingId, text);
              setPreview(r.preview ?? null);
              setNote(r.error ?? null);
            })
          }
        >
          {m["group.roomingCheck"]}
        </button>
        {preview ? (
          <button
            type="button"
            disabled={pending || !preview.rows.some((r) => !r.problem)}
            className={`${button} bg-accent text-white`}
            onClick={() =>
              start(async () => {
                const r = await importRoomingAction(groupId, holdingId, text);
                setNote(r.error ?? r.message ?? null);
                if (!r.error) (setPreview(null), setText(""), router.refresh());
              })
            }
          >
            {m["group.roomingImport"]}
          </button>
        ) : null}
        {note ? <span role="status">{note}</span> : null}
      </div>
      {preview ? (
        <table className="text-xs" data-rooming-preview>
          <tbody>
            {preview.rows.map((r) => (
              <tr key={r.line} data-problem={r.problem ?? ""} className={r.problem ? "text-danger" : ""}>
                <td className="pr-2 text-ink-60">{r.line}</td>
                <td className="pr-2">{r.roomType}</td>
                <td className="pr-2">
                  {r.firstName} {r.lastName}
                </td>
                <td className="pr-2">{r.adults}</td>
                <td>{r.problem ? m[`group.problem.${r.problem}`] : "✓"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
