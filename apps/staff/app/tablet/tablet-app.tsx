"use client";

import { useCallback, useEffect, useState } from "react";
import type { TabletState } from "@hoteloftware/db";
import { FIELD_TEXT, GuestFormSteps, T, type Lang } from "./guest-form";

/**
 * The guest's steps on the tablet (ticket 45): welcome with language, details
 * (statutory fields only; arrival and departure read-only), companions,
 * review, completion — a signature on the tablet (Austria; Swiss cantons that
 * allow it), the printed form (Germany; Switzerland by default), or the ID
 * Check alone. Switzerland adds place of birth and document type; Tessin the car.
 * Polls what the desk sends; keeps nothing.
 */
export function TabletApp({ deviceName }: { deviceName: string }) {
  const [state, setState] = useState<TabletState | null>(null);
  const [lang, setLang] = useState<Lang>("de");
  const [error, setError] = useState("");
  const [thanks, setThanks] = useState<"" | "pass" | "done">("");
  const t = (k: keyof typeof T, vars: Record<string, string> = {}): string => Object.entries(vars).reduce<string>((out, [a, b]) => out.replace(`{${a}}`, b), T[k][lang]);

  const load = useCallback(async () => {
    const r = await fetch("/api/tablet", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const body = (await r.json()) as { state: TabletState | null };
    setState(body.state);
    if (body.state && body.state.person.language) setLang(body.state.person.language === "en" ? "en" : "de");
  }, []);
  useEffect(() => {
    void load();
    const i = setInterval(() => void load(), 2000);
    return () => clearInterval(i);
  }, [load]);

  const send = async (input: Record<string, unknown>, quiet = false) => {
    if (!state) return;
    if (quiet) {
      await fetch("/api/tablet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: state.person.id, input }) }).catch(() => undefined);
      return;
    }
    setError("");
    const r = await fetch("/api/tablet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: state.person.id, input }) });
    if (!r.ok) {
      const e = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "";
      // a field to check, named in the guest's language; anything else in plain words
      const field = (FIELD_TEXT as Record<string, keyof typeof T>)[e];
      setError(r.status === 422 && field ? t("problem", { f: t(field) }) : r.status === 409 ? t("moved") : t("error"));
      await load();
      return;
    }
    if (input.step === "review") {
      setThanks(state.next > 0 ? "pass" : "done");
      setTimeout(() => setThanks(""), 6000);
    }
    await load();
  };

  const shell = (children: React.ReactNode) => (
    <main className="min-h-full bg-gradient-to-br from-[#1d3a52] to-[#0b1520] p-8 text-white" data-tablet>
      <div className="mx-auto max-w-3xl">{children}</div>
      <p className="fixed bottom-3 right-4 text-xs opacity-50">{deviceName} · shows only what reception sends</p>
    </main>
  );
  if (thanks) return shell(<h1 className="mt-24 text-center text-3xl" data-tablet-thanks>{t(thanks)}</h1>);
  if (!state) return shell(<h1 className="mt-24 text-center text-3xl" data-tablet-idle>{t("idle")}</h1>);
  const p = state.person;
  const field = "h-14 w-full rounded-xl border border-white/20 bg-white/10 px-4 text-lg text-white placeholder-white/40";
  const button = "mt-6 h-14 rounded-full bg-white px-10 text-lg font-medium text-[#0b1520]";
  const err = error ? <p role="alert" className="mt-3 text-red-300">{error}</p> : null;

  if (p.step === "welcome") {
    return shell(
      <div className="mt-16 text-center" data-step="welcome">
        <h1 className="text-4xl">
          {t("welcome")}, {p.firstName}
        </h1>
        <p className="mt-2 opacity-80">{state.propertyName}</p>
        <p className="mt-10">{t("choose")}</p>
        <div className="mt-4 flex justify-center gap-4">
          {(["de", "en"] as const).map((l) => (
            <button key={l} type="button" className={button} data-lang={l} onClick={() => void send({ step: "welcome", language: l })}>
              {l === "de" ? "Deutsch" : "English"}
            </button>
          ))}
        </div>
        {err}
      </div>,
    );
  }
  if (p.step === "details" || p.step === "companions" || p.step === "review") return shell(<GuestFormSteps state={state} t={t} send={send} err={err} field={field} button={button} />);
  return shell(<h1 className="mt-24 text-center text-3xl">{t("idle")}</h1>);
}

