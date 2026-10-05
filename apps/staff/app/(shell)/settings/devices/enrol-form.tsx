"use client";

import { useActionState, useState } from "react";
import { enrolAction, type EnrolState } from "./actions";

/** Enrol a Device: name it, say who may sign in on it, then scan the QR code with the Device within 15 minutes. */
export function EnrolForm({
  propertyId,
  people,
  labels,
}: {
  propertyId: string;
  people: { id: string; name: string }[];
  labels: Record<"name" | "kind" | "staff" | "guest" | "kiosk" | "shared" | "owner" | "who" | "create" | "pending" | "scan" | "until", string>;
}) {
  const [state, action, pending] = useActionState<EnrolState, FormData>(enrolAction, {});
  const [kind, setKind] = useState("staff");
  const [owner, setOwner] = useState("");
  const input = "h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm";
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{labels.name}</span>
          <input name="name" required className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{labels.kind}</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            <option value="staff">{labels.staff}</option>
            <option value="guest">{labels.guest}</option>
            <option value="kiosk">{labels.kiosk}</option>
          </select>
        </label>
        {kind === "staff" ? (
          <label className="grid gap-1 text-sm">
            <span className="text-ink-80">{labels.owner}</span>
            <select name="ownerUserId" value={owner} onChange={(e) => setOwner(e.target.value)} className={input}>
              <option value="">{labels.shared}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {kind === "staff" && !owner ? (
        <fieldset className="grid gap-1 text-sm">
          <legend className="text-ink-80">{labels.who}</legend>
          <div className="flex flex-wrap gap-3">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-1">
                <input type="checkbox" name="userIds" value={p.id} /> {p.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.qr && state.url ? (
        <div className="grid justify-items-start gap-2 rounded-xl bg-surface p-3">
          <p>{labels.scan}</p>
          {/* the SVG is made on our server from our own link */}
          <div className="w-48 bg-white p-2" dangerouslySetInnerHTML={{ __html: state.qr }} />
          <a href={state.url} className="break-all text-xs text-accent">
            {state.url}
          </a>
          <p className="text-xs text-ink-60">
            {labels.until} {state.expiresAt ? new Date(state.expiresAt).toLocaleTimeString() : ""}
          </p>
        </div>
      ) : null}
      <button type="submit" disabled={pending} className="h-10 justify-self-start rounded-full bg-accent px-5 text-sm font-medium text-white shadow-pill disabled:opacity-60">
        {pending ? labels.pending : labels.create}
      </button>
    </form>
  );
}
