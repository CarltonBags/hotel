"use client";

import type { Guest, GuestDuplicate, GuestSummary } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import { ActionForm } from "@/components/form-fields";
import { mergeGuestAction, saveGuestAction } from "../actions";
import { GuestFields } from "../guest-fields";

interface Rights {
  edit: boolean;
  merge: boolean;
}

export function GuestProfile({ guest, rights, duplicates, candidates, mergeQ, m }: { guest: Guest; rights: Rights; duplicates: GuestDuplicate[]; candidates: GuestSummary[]; mergeQ: string; m: Messages }) {
  return (
    <>
      <section className="rounded-2xl bg-surface-2 p-5">
        {rights.edit ? (
          <ActionForm action={saveGuestAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]}>
            <input type="hidden" name="id" value={guest.id} />
            <GuestFields guest={guest} contacts readOnly={false} m={m} />
          </ActionForm>
        ) : (
          <GuestFields guest={guest} contacts readOnly m={m} />
        )}
      </section>

      {rights.merge ? (
        <section aria-label={m["guests.merge"]} className="rounded-2xl bg-surface-2 p-5">
          <h2 className="font-medium">{m["guests.merge"]}</h2>
          <p className="mt-1 text-sm text-ink-60">{m["guests.mergeHelp"]}</p>
          {duplicates.length ? (
            <div className="mt-3">
              <h3 className="text-sm font-medium">{m["guests.possibleDuplicates"]}</h3>
              <ul className="mt-1 grid gap-2">
                {duplicates.map((d) => (
                  <MergeRow key={d.id} keepId={guest.id} other={d} note={d.reasons.map((r) => m[`guests.reason.${r}`]).join(", ")} m={m} />
                ))}
              </ul>
            </div>
          ) : null}
          <form className="mt-3 flex gap-2">
            <input name="mergeQ" defaultValue={mergeQ} placeholder={m["guests.searchHint"]} aria-label={m["guests.findOther"]} className="h-9 flex-1 rounded-xl border border-ink-10 bg-surface px-3 text-sm" />
            <button type="submit" className="h-9 rounded-full px-4 text-sm hover:bg-ink-5">
              {m["guests.search"]}
            </button>
          </form>
          <ul className="mt-2 grid gap-2">
            {candidates.map((c) => (
              <MergeRow key={c.id} keepId={guest.id} other={c} note="" m={m} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function MergeRow({ keepId, other, note, m }: { keepId: string; other: GuestSummary; note: string; m: Messages }) {
  return (
    <li className="rounded-xl bg-surface p-3 text-sm">
      <div>
        <a href={`/guests/${other.id}`} className="font-medium hover:underline">
          {other.firstName} {other.lastName}
        </a>{" "}
        <span className="text-ink-60">
          {[other.dateOfBirth, other.email, other.phone].filter(Boolean).join(" · ")}
          {note ? ` (${note})` : ""}
        </span>
      </div>
      <ActionForm action={mergeGuestAction} submitLabel={m["guests.mergeInto"]} pendingLabel={m["action.saving"]} className="mt-2 flex flex-wrap items-center gap-3">
        <input type="hidden" name="keepId" value={keepId} />
        <input type="hidden" name="mergeId" value={other.id} />
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="confirm" value="on" required />
          {m["guests.mergeConfirm"]}
        </label>
      </ActionForm>
    </li>
  );
}
