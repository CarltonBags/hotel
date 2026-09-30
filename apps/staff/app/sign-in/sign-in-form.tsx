"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

export function SignInForm({ tenantName }: { tenantName: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="grid gap-4">
      <div>
        <h1 className="text-xl font-medium">{tenantName}</h1>
        <p className="text-ink-60">Sign in to the staff app</p>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="text-ink-80">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="h-11 rounded-xl border border-ink-10 bg-surface-2 px-3 text-base"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-ink-80">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 rounded-xl border border-ink-10 bg-surface-2 px-3 text-base"
        />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-full bg-accent font-medium text-white shadow-pill disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
