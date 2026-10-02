"use client";

import { useActionState, useEffect, useState } from "react";
import { X } from "lucide-react";
import { registrationFields, registrationGaps } from "@hoteloftware/domain";
import type { Guest } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import type { FormState } from "@/lib/form";
import { saveGuestAction } from "../guests/actions";
import { GuestFields } from "../guests/guest-fields";
import { guestForDrawer, type Picked } from "./actions";
import { RegistrationStatus } from "./[id]/guest-details";

/**
 * The full guest form in a side drawer over the booking screen, so address,
 * documents and the rest are entered without leaving the booking. Fields the
 * property's registration needs are marked.
 */
export function GuestDrawer({ guest: picked, propertyCountry, onClose, onSaved, m }: { guest: Picked; propertyCountry: string; onClose: () => void; onSaved?: ((g: Picked) => void) | undefined; m: Messages }) {
  const [data, setData] = useState<{ guest: Guest; contacts: boolean; canEdit: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    void guestForDrawer(picked.id).then((r) => {
      setError(null);
      if ("error" in r) setError(r.error);
      else setData(r);
    });
  // another guest: never show the previous one's data while loading
  useEffect(() => {
    setData(null);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.id]);
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const r = await saveGuestAction(prev, form);
    if (!r.error) {
      onSaved?.({ id: picked.id, label: `${String(form.get("lastName") ?? "")}, ${String(form.get("firstName") ?? "")}` });
      load();
    }
    return r;
  }, {});
  const gaps = data ? registrationGaps(data.guest, propertyCountry) : [];
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={m["res.guestDetails"]}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="flex h-full w-full max-w-xl flex-col bg-surface shadow-pop"
      >
        <header className="flex items-center justify-between border-b border-ink-10 px-5 py-3">
          <h2 className="font-medium">
            {m["res.guestDetails"]} · {picked.label}
          </h2>
          <button type="button" aria-label={m["res.closeDrawer"]} onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-ink-5">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          {data ? (
            <form action={action} className="grid gap-3">
              <RegistrationStatus gaps={gaps} m={m} />
              <input type="hidden" name="id" value={data.guest.id} />
              <GuestFields key={String(data.guest.updatedAt)} guest={data.guest} contacts={data.contacts} readOnly={!data.canEdit} marked={registrationFields(propertyCountry, data.guest.nationality)} compact m={m} />
              {/* the save bar stays at the bottom of the drawer while the form scrolls */}
              <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 border-t border-ink-10 bg-surface px-5 py-3">
                {data.canEdit ? (
                  <button type="submit" disabled={pending} className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-white disabled:opacity-60">
                    {pending ? m["action.saving"] : m["action.save"]}
                  </button>
                ) : null}
                {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
                {state.ok ? <p role="status" className="text-sm text-ink-60">{m["grid.saved"]}</p> : null}
              </div>
            </form>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
