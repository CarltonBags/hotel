"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/form";
import { startTrialAction } from "./actions";

const input = "h-11 rounded-xl border border-ink-10 bg-surface-2 px-3 text-base";

export function SignupForm({ appDomain }: { appDomain: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(startTrialAction, {});
  const text = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="grid gap-1 text-sm">
      <span className="text-ink-80">{label}</span>
      <input name={name} required className={input} {...props} />
    </label>
  );
  return (
    <form action={action} className="grid gap-4">
      <div>
        <h1 className="text-xl font-medium">Try Hoteloftware for 30 days</h1>
        <p className="text-ink-60">No payment details. Nothing you do in the trial reaches a guest, a channel or a card.</p>
      </div>
      {text("company", "Company")}
      <label className="grid gap-1 text-sm">
        <span className="text-ink-80">Your address</span>
        <span className="flex items-center gap-1">
          <input name="slug" required pattern="[a-z0-9-]{3,30}" autoCapitalize="none" spellCheck={false} className={`${input} min-w-0 flex-1`} />
          <span className="text-ink-60">.{appDomain}</span>
        </span>
      </label>
      {text("name", "Your name", { autoComplete: "name" })}
      {text("email", "Email", { type: "email", autoComplete: "email" })}
      {text("username", "Username", { autoCapitalize: "none", spellCheck: false, autoComplete: "username" })}
      {text("password", "Password (at least 10 characters)", { type: "password", minLength: 10, autoComplete: "new-password" })}
      <fieldset className="grid gap-2 text-sm">
        <legend className="mb-1 text-ink-80">Start with</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="kind" value="demo" defaultChecked className="mt-1" />
          <span>
            <span className="font-medium">Demo data</span> — a demo hotel with rooms, rates, guests and a week of history. Deleted 30 days after the trial.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="kind" value="own" className="mt-1" />
          <span>
            <span className="font-medium">My own data in Test Mode</span> — set up your real hotel; at go-live the test records are cleared and the setup stays.
          </span>
        </label>
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="h-11 rounded-full bg-accent font-medium text-white shadow-pill disabled:opacity-60">
        {pending ? "Setting up your trial…" : "Start the trial"}
      </button>
    </form>
  );
}
