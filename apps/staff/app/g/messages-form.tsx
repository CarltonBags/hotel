"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { PortalLanguage } from "@hoteloftware/domain";
import type { FormState } from "@/lib/form";
import { portalText } from "@/i18n/portal";
import { guestButton, guestInput } from "./glass";

/** Write to the hotel: text and perhaps an image or PDF. */
export function GuestMessageForm({ action, language }: { action: (prev: FormState, formData: FormData) => Promise<FormState>; language: PortalLanguage }) {
  const [state, run, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const t = (k: Parameters<typeof portalText>[1]) => portalText(language, k);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={run} className="grid gap-2" data-guest-message>
      <textarea name="body" rows={3} maxLength={5000} placeholder={t("messagePlaceholder")} className={`${guestInput} h-auto py-2`} />
      <label className="grid gap-1 text-sm text-white/70">
        <span>{t("messageAttach")}</span>
        <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" />
      </label>
      <button type="submit" disabled={pending} className={guestButton}>
        {t("messageSend")}
      </button>
      {state.error ? (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** The hotel's answers appear without reloading: the page is fetched again now and then while open. */
export function PortalPoll({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
