"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReservationKeys } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import { issueCardAction, readCardAction, revokeKeyAction } from "./key-actions";

/**
 * The stay's door keys (ticket 67): what is issued, until when, the door PIN,
 * and only the actions the property's lock system supports; an unsupported
 * lock says keys are made in its own software.
 */
export function KeysPanel({ propertyId, reservationId, keys, language, timeZone, m }: { propertyId: string; reservationId: string; keys: ReservationKeys; language: string; timeZone: string; m: Messages }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [encoder, setEncoder] = useState(keys.deskEncoder ?? keys.encoders[0]?.id ?? "");
  const when = (iso: string) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(iso));
  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ? { error: true, text: r.error } : r.message ? { error: false, text: r.message } : null);
      router.refresh();
    });
  const button = "h-9 rounded-full border border-ink-10 px-4 text-sm disabled:opacity-50";
  if (keys.system === "other") {
    return (
      <section aria-label={m["keys.title"]} className="grid gap-1 rounded-2xl bg-surface-2 p-5 text-sm" data-keys="other">
        <h2 className="font-medium">{m["keys.title"]}</h2>
        <p className="text-ink-60">{m["keys.byLockSoftware"].replace("{name}", keys.otherName)}</p>
      </section>
    );
  }
  return (
    <section aria-label={m["keys.title"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-keys={keys.system}>
      <h2 className="font-medium">{m["keys.title"]}</h2>
      {note ? (
        <p role={note.error ? "alert" : "status"} className={note.error ? "text-danger" : "text-ink-60"}>
          {note.text}
        </p>
      ) : null}
      {keys.keys.length ? (
        <ul className="grid gap-1">
          {keys.keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-2" data-key={k.kind} data-key-status={k.status} data-key-room={k.room}>
              <span>
                {m["keys.room"]} {k.room} · {m[`keys.kind.${k.kind}`]} · {m[`keys.status.${k.status}` as keyof Messages]}
                {k.status === "active" ? ` · ${m["keys.until"]} ${when(k.validUntil)}` : ""}
                {k.revokeReason ? ` · ${m[`keys.reason.${k.revokeReason}` as keyof Messages] ?? k.revokeReason}` : ""}
                {k.error ? ` · ${k.error}` : ""}
              </span>
              {k.pin && keys.actions.showPin ? (
                <span className="rounded-lg bg-surface px-2 font-mono" data-pin>
                  {k.pin}
                </span>
              ) : null}
              {keys.actions.revoke && k.status === "active" ? (
                <button type="button" disabled={pending} onClick={() => run(() => revokeKeyAction(propertyId, reservationId, k.id))} className="text-danger underline" data-revoke-key>
                  {m["keys.revokeLost"]}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-60">{m["keys.none"]}</p>
      )}
      {keys.actions.issueCard || keys.actions.readCard ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={encoder} onChange={(e) => setEncoder(e.target.value)} aria-label={m["keys.encoder"]} className="h-9 rounded-xl border border-ink-10 bg-surface px-3">
            {keys.encoders.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          {keys.actions.issueCard ? (
            <button type="button" disabled={pending || !encoder} onClick={() => run(() => issueCardAction(propertyId, reservationId, encoder))} className={`${button} bg-accent text-white`} data-issue-card>
              {m["keys.issueCard"]}
            </button>
          ) : null}
          {keys.actions.readCard ? (
            <button
              type="button"
              disabled={pending || !encoder}
              onClick={() =>
                start(async () => {
                  const r = await readCardAction(propertyId, encoder);
                  setNote(r.error ? { error: true, text: r.error } : { error: false, text: r.card ? `${m["keys.room"]} ${r.card.room ?? "–"} · ${r.card.guest ?? "–"} · ${m["keys.until"]} ${when(r.card.validUntil)}` : m["keys.noCard"] });
                })
              }
              className={button}
              data-read-card
            >
              {m["keys.readCard"]}
            </button>
          ) : null}
        </div>
      ) : null}
      {keys.events.length ? (
        <details className="text-ink-60">
          <summary>{m["keys.log"]}</summary>
          <ul className="mt-1 grid gap-0.5" data-key-log>
            {keys.events.map((e, i) => (
              <li key={i} data-key-event={e.action}>
                {when(e.at)} · {m[`keys.event.${e.action}` as keyof Messages] ?? e.action}
                {typeof e.detail.reason === "string" ? ` · ${m[`keys.reason.${e.detail.reason}` as keyof Messages] ?? e.detail.reason}` : ""}
                {typeof e.detail.warning === "string" ? ` · ${m[`keys.warning.${e.detail.warning}` as keyof Messages] ?? e.detail.warning}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
