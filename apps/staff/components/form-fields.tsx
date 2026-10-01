"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/form";

export const inputClass = "h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm";

export function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  autoComplete,
  step,
  readOnly,
}: {
  label: string;
  name: string;
  type?: string | undefined;
  defaultValue?: string | undefined;
  required?: boolean | undefined;
  autoComplete?: string | undefined;
  step?: string | undefined;
  readOnly?: boolean | undefined;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-ink-80">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        step={step}
        readOnly={readOnly}
        aria-readonly={readOnly}
        className={`${inputClass}${readOnly ? " opacity-60" : ""}`}
      />
    </label>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  readOnly,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string | undefined;
  readOnly?: boolean | undefined;
}) {
  // A disabled select is not submitted, so a read-only one sends its value through a hidden field.
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-ink-80">{label}</span>
      {readOnly ? <input type="hidden" name={name} value={defaultValue ?? options[0]?.value ?? ""} /> : null}
      <select name={readOnly ? undefined : name} defaultValue={defaultValue} disabled={readOnly} aria-readonly={readOnly} className={`${inputClass}${readOnly ? " opacity-60" : ""}`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string | undefined;
  children: React.ReactNode;
  className?: string | undefined;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className={className ?? "grid gap-3"}>
      {children}
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="break-all rounded-xl bg-surface-2 p-3 text-sm">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-10 justify-self-start rounded-full bg-accent px-5 text-sm font-medium text-white shadow-pill disabled:opacity-60"
      >
        {pending ? (pendingLabel ?? "…") : submitLabel}
      </button>
    </form>
  );
}
