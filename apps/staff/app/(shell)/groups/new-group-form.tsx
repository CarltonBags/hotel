"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import { createGroupAction } from "./actions";

/** A new Group: name, organiser, contact, option date, release days, the plan its prices start from, terms (ticket 58). */
export function NewGroupForm({ propertyId, companies, plans, m }: { propertyId: string; companies: { id: string; name: string }[]; plans: { id: string; name: string }[]; m: Messages }) {
  const [state, action, pending] = useActionState(createGroupAction, {});
  const router = useRouter();
  useEffect(() => {
    if (state.id) router.push(`/groups/${state.id}`);
  }, [state.id, router]);
  const input = "h-10 w-full rounded-xl border border-ink-10 bg-surface px-3";
  return (
    <form action={action} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm sm:grid-cols-2" data-new-group>
      <h2 className="font-medium sm:col-span-2">{m["group.new"]}</h2>
      <input type="hidden" name="propertyId" value={propertyId} />
      <label className="grid gap-1">
        <span className="text-ink-80">{m["group.name"]}</span>
        <input name="name" required maxLength={120} className={input} />
      </label>
      <label className="grid gap-1">
        <span className="text-ink-80">{m["group.organiser"]}</span>
        <select name="companyId" className={input}>
          <option value="">–</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-ink-80">{m["group.contact"]}</span>
        <input name="contact" maxLength={300} className={input} />
      </label>
      <label className="grid gap-1">
        <span className="text-ink-80">{m["group.optionDate"]}</span>
        <input name="optionDate" type="date" className={input} />
      </label>
      <label className="grid gap-1">
        <span className="text-ink-80">{m["group.releaseDays"]}</span>
        <input name="releaseDays" type="number" min={0} max={365} defaultValue={14} className={input} />
      </label>
      <label className="grid gap-1">
        <span className="text-ink-80">{m["group.basePlan"]}</span>
        <select name="basePlanId" required className={input}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className="text-ink-80">{m["group.terms"]}</span>
        <textarea name="terms" rows={3} maxLength={5000} className="w-full rounded-xl border border-ink-10 bg-surface p-3" />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className="text-ink-80">{m["group.reductionRules"]}</span>
        <textarea name="reductionRules" rows={2} maxLength={2000} className="w-full rounded-xl border border-ink-10 bg-surface p-3" />
      </label>
      {state.error ? (
        <p role="alert" className="text-danger sm:col-span-2">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="h-10 justify-self-start rounded-full bg-accent px-5 font-medium text-white shadow-pill disabled:opacity-60">
        {pending ? m["action.saving"] : m["group.create"]}
      </button>
    </form>
  );
}
