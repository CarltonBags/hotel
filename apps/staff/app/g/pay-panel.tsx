"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PortalLanguage } from "@hoteloftware/domain";
import { portalText } from "@/i18n/portal";
import { guestButton } from "./glass";
import { checkoutAction, simulateAction, startCardAction, startPayAction, type PayStart } from "./pay-actions";

export type StripeJs = {
  elements: (o: { clientSecret: string; appearance?: object }) => { create: (t: string) => { mount: (el: HTMLElement) => void } };
  confirmPayment: (o: { elements: unknown; confirmParams: { return_url: string } }) => Promise<{ error?: { type?: string; message?: string } }>;
  confirmSetup: (o: { elements: unknown; confirmParams: { return_url: string } }) => Promise<{ error?: { type?: string; message?: string } }>;
};

/** Stripe.js from Stripe, with the hotel's connected account: card data stays between the guest's browser and Stripe. */
export async function loadStripe(publishableKey: string, accountId: string): Promise<StripeJs> {
  const w = window as unknown as { Stripe?: (k: string, o: object) => StripeJs };
  if (!w.Stripe) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("The payment form did not load"));
      document.head.appendChild(s);
    });
  }
  return w.Stripe!(publishableKey, { stripeAccount: accountId });
}

/** Pay the amount due (and maybe keep the card), or store a card without paying (ticket 41). */
export function PayPanel({ portalKey, language, amountText, due, canStore }: { portalKey: string; language: PortalLanguage; amountText: string; due: boolean; canStore: boolean }) {
  const t = (k: Parameters<typeof portalText>[1], v?: Record<string, string | number>) => portalText(language, k, v);
  const router = useRouter();
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<{ kind: "payment" | "setup"; start: Extract<PayStart, { ok: true }>; stripe: StripeJs | null; elements: unknown } | null>(null);
  const mount = useRef<HTMLDivElement>(null);
  const back = (kind: "payment" | "setup", id: string) => `${window.location.origin}/g/${portalKey}/${kind === "payment" ? "paid" : "card"}?id=${encodeURIComponent(id)}&lang=${language}`;

  async function begin(kind: "payment" | "setup") {
    setBusy(true);
    setError(null);
    const start = kind === "payment" ? await startPayAction(portalKey, keep) : await startCardAction(portalKey);
    setBusy(false);
    if (!start.ok) return setError(start.error);
    if (!start.publishableKey) return setStarted({ kind, start, stripe: null, elements: null });
    try {
      const stripe = await loadStripe(start.publishableKey, start.accountId);
      const elements = stripe.elements({ clientSecret: start.clientSecret, appearance: { theme: "night" } });
      setStarted({ kind, start, stripe, elements });
      // mounted once the box is on the page
      setTimeout(() => mount.current && elements.create("payment").mount(mount.current), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment form did not load");
    }
  }

  async function confirm() {
    if (!started?.stripe) return;
    setBusy(true);
    const url = back(started.kind, started.start.id);
    const r = started.kind === "payment" ? await started.stripe.confirmPayment({ elements: started.elements, confirmParams: { return_url: url } }) : await started.stripe.confirmSetup({ elements: started.elements, confirmParams: { return_url: url } });
    setBusy(false);
    // a card the bank refused: the payment is settled as declined (and the desk told) on the result page
    if (r.error?.type === "card_error" && started.kind === "payment") return router.push(url.replace(window.location.origin, ""));
    if (r.error) setError(r.error.message ?? "The card was not accepted");
  }

  async function simulate(outcome: "succeed" | "decline") {
    if (!started) return;
    setBusy(true);
    await simulateAction(portalKey, started.kind, started.start.id, outcome);
    router.push(back(started.kind, started.start.id).replace(window.location.origin, ""));
  }

  return (
    <div className="grid gap-3" data-pay>
      {!started ? (
        <>
          {due ? (
            <>
              <p className="text-white/80">{t("balance", { amount: amountText })}</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {t("keepCard")}
              </label>
              <button type="button" disabled={busy} onClick={() => void begin("payment")} className={guestButton} data-pay-start>
                {t("pay", { amount: amountText })}
              </button>
            </>
          ) : null}
          {canStore ? (
            <>
              <p className="text-sm text-white/70">{t("storeCardHelp")}</p>
              <button type="button" disabled={busy} onClick={() => void begin("setup")} className={`${guestButton} bg-white/80`} data-card-start>
                {t("storeCard")}
              </button>
            </>
          ) : null}
        </>
      ) : started.stripe ? (
        <>
          <div ref={mount} className="rounded-xl bg-white/5 p-3" />
          <button type="button" disabled={busy} onClick={() => void confirm()} className={guestButton}>
            {t("confirm")}
          </button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2" data-test-card>
          <button type="button" disabled={busy} onClick={() => void simulate("succeed")} className={guestButton}>
            {t("testPay")}
          </button>
          <button type="button" disabled={busy} onClick={() => void simulate("decline")} className={`${guestButton} bg-white/70`}>
            {t("testDecline")}
          </button>
        </div>
      )}
      {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
    </div>
  );
}

/** Express Checkout: with nothing due, check out (alone where the property allows it); the page then shows the outcome. */
export function CheckoutButton({ portalKey, language }: { portalKey: string; language: PortalLanguage }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = (k: Parameters<typeof portalText>[1]) => portalText(language, k);
  async function checkout() {
    setBusy(true);
    const r = await checkoutAction(portalKey);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }
  return (
    <div className="grid gap-2">
      <button type="button" disabled={busy} onClick={() => void checkout()} className={guestButton} data-checkout>
        {t("checkoutNow")}
      </button>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
