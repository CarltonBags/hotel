"use client";

import { useActionState } from "react";
import { EMPTY_GUEST, type GuestData } from "@hoteloftware/domain";
import Link from "next/link";
import { fill, type Messages } from "@/i18n/messages";
import { createGuestAction, type NewGuestState } from "./actions";
import { GuestFields } from "./guest-fields";


/** New profile: the first submit checks for possible duplicates and offers to use one; "create anyway" skips the check. */
export function NewGuestForm({ m }: { m: Messages }) {
  const [state, action, pending] = useActionState<NewGuestState, FormData>(createGuestAction, {});
  return (
    <form action={action} className="grid gap-4">
      <GuestFields key={JSON.stringify(state.values ?? {})} guest={state.values ? ({ ...EMPTY_GUEST, ...state.values } as GuestData) : undefined} contacts readOnly={false} m={m} />
      {state.duplicates?.length ? (
        <div role="alert" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium">{m["guests.possibleDuplicate"]}</p>
          <ul className="mt-2 grid gap-1">
            {state.duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {d.firstName} {d.lastName}
                  {d.dateOfBirth ? ` · ${d.dateOfBirth}` : ""}
                  {d.email ? ` · ${d.email}` : ""}
                </span>
                <span className="text-ink-60">({d.reasons.map((r) => m[`guests.reason.${r}`]).join(", ")})</span>
                <Link href={`/guests/${d.id}`} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white">
                  {m["guests.useThis"]}
                </Link>
              </li>
            ))}
          </ul>
          {/* the submitting button's name and value travel with the form data */}
          <button type="submit" name="createAnyway" value="on" className="mt-3 text-sm underline">
            {fill(m["guests.createAnyway"], {})}
          </button>
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="h-10 justify-self-start rounded-full bg-accent px-5 text-sm font-medium text-white shadow-pill disabled:opacity-60">
        {pending ? m["action.saving"] : m["action.create"]}
      </button>
    </form>
  );
}
