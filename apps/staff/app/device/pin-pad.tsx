"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/lib/form";
import { pinSignInAction } from "./actions";

/** Tap your name, then enter your PIN. */
export function PinPad({ people, labels }: { people: { id: string; name: string }[]; labels: { who: string; pin: string; signIn: string; back: string; pending: string } }) {
  const [userId, setUserId] = useState<string | null>(people.length === 1 ? people[0]!.id : null);
  const [pin, setPin] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(pinSignInAction, {});
  const person = people.find((p) => p.id === userId);
  if (!person) {
    return (
      <div className="grid gap-3">
        <h1 className="text-lg font-medium">{labels.who}</h1>
        <div className="grid grid-cols-2 gap-2">
          {people.map((p) => (
            <button key={p.id} type="button" onClick={() => setUserId(p.id)} className="h-14 rounded-2xl bg-surface-2 px-3 text-base font-medium">
              {p.name}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const key = (d: string) => setPin((v) => (v.length < 6 ? v + d : v));
  return (
    <form action={action} className="grid gap-3" onSubmit={() => setTimeout(() => setPin(""), 0)}>
      <input type="hidden" name="userId" value={person.id} />
      <input type="hidden" name="pin" value={pin} />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">{person.name}</h1>
        {people.length > 1 ? (
          <button type="button" onClick={() => (setUserId(null), setPin(""))} className="text-sm text-accent">
            {labels.back}
          </button>
        ) : null}
      </div>
      <p aria-label={labels.pin} className="h-10 text-center text-3xl tracking-[0.5em]">
        {"•".repeat(pin.length) || <span className="text-base tracking-normal text-ink-60">{labels.pin}</span>}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => key(d)} className="h-14 rounded-2xl bg-surface-2 text-xl">
            {d}
          </button>
        ))}
        <button type="button" onClick={() => setPin((v) => v.slice(0, -1))} className="h-14 rounded-2xl text-xl" aria-label="⌫">
          ⌫
        </button>
        <button type="button" onClick={() => key("0")} className="h-14 rounded-2xl bg-surface-2 text-xl">
          0
        </button>
        <button type="submit" disabled={pending || pin.length < 4} className="h-14 rounded-2xl bg-accent text-base font-medium text-white disabled:opacity-50">
          {pending ? labels.pending : labels.signIn}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
