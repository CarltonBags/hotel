"use client";

import { useEffect, useRef, useState } from "react";
import { connectAction } from "./actions";

type FB = { init: (o: object) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: object) => void };

/**
 * Meta's Embedded Signup (ticket 44): the hotel logs in with Facebook, picks
 * or creates its business account and number (an existing business number
 * stays in the app by coexistence); Meta names them in a message to this
 * window and hands a code, which the server exchanges.
 */
export function EmbeddedSignup({ propertyId, appId, configId, label }: { propertyId: string; appId: string; configId: string; label: string }) {
  const session = useRef<{ wabaId?: string | undefined; phoneNumberId?: string | undefined }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!/^https:\/\/([a-z]+\.)?facebook\.com$/.test(e.origin)) return;
      try {
        const d = (typeof e.data === "string" ? JSON.parse(e.data) : e.data) as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } };
        if (d.type === "WA_EMBEDDED_SIGNUP" && d.data) session.current = { wabaId: d.data.waba_id, phoneNumberId: d.data.phone_number_id };
      } catch {
        // not Meta's message
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  async function load(): Promise<FB> {
    const w = window as unknown as { FB?: FB; fbAsyncInit?: () => void };
    if (!w.FB) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://connect.facebook.net/en_US/sdk.js";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Facebook did not load"));
        document.head.appendChild(s);
      });
    }
    w.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" });
    return w.FB!;
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const fb = await load();
      fb.login(
        (r) => {
          const code = r.authResponse?.code;
          const s = session.current;
          if (!code || !s.wabaId || !s.phoneNumberId) {
            setBusy(false);
            setError("The signup was not finished");
            return;
          }
          void connectAction(propertyId, { code, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId }).then((res) => {
            setBusy(false);
            if (res.error) setError(res.error);
            else window.location.reload();
          });
        },
        { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } },
      );
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Facebook did not load");
    }
  }
  return (
    <div className="grid gap-2">
      <button type="button" disabled={busy} onClick={() => void start()} className="h-10 justify-self-start rounded-full bg-[#1877f2] px-5 text-sm font-medium text-white disabled:opacity-60" data-wa-signup>
        {label}
      </button>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
