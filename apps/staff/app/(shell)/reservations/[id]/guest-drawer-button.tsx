"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import type { Picked } from "../actions";
import { GuestDrawer } from "../guest-drawer";

/** "Guest details" on the reservation tab: the full form in the side drawer; the tab refreshes after a save. */
export function GuestDrawerButton({ guest, propertyCountry, m }: { guest: Picked; propertyCountry: string; m: Messages }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="h-9 justify-self-start rounded-full bg-surface px-4 text-sm font-medium hover:bg-ink-5">
        {m["res.guestDetails"]}
      </button>
      {open ? <GuestDrawer guest={guest} propertyCountry={propertyCountry} onClose={() => (setOpen(false), router.refresh())} m={m} /> : null}
    </>
  );
}
