"use client";

import { useActionState, useEffect } from "react";
import type { Messages } from "@/i18n/messages";
import { openTenantAction } from "./actions";

/** Choose a customer and say why; the access opens on the customer's subdomain. */
export function OpenTenant({ tenants, m }: { tenants: { id: string; name: string; slug: string }[]; m: Messages }) {
  const [state, action, pending] = useActionState(openTenantAction, {});
  useEffect(() => {
    if (state.url) window.location.href = state.url;
  }, [state.url]);
  const input = "h-10 rounded-xl border border-ink-10 bg-surface px-3 text-sm";
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">
        <span className="text-ink-80">{m["support.tenant"]}</span>
        <select name="tenantId" className={input}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.slug})
            </option>
          ))}
        </select>
      </label>
      <label className="grid min-w-72 flex-1 gap-1 text-sm">
        <span className="text-ink-80">{m["support.reason"]}</span>
        <input name="reason" required minLength={10} placeholder={m["support.reasonHint"]} className={input} />
      </label>
      <button type="submit" disabled={pending} className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-white disabled:opacity-50">
        {m["support.open"]}
      </button>
      {state.error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
