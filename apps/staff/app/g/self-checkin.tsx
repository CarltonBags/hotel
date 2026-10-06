"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BedDouble, CalendarDays, Check, QrCode, Users } from "lucide-react";
import type { SelfCheckinView } from "@hoteloftware/db";
import type { CheckInCondition } from "@hoteloftware/domain";
import { FIELD_TEXT, GuestFormSteps, T as FORM_TEXT, type Lang } from "../tablet/guest-form";
import { loadStripe, type StripeJs } from "./pay-panel";
import { simulateAction, startCardAction, startPayAction } from "./pay-actions";
import { cardStoredAction, findAction, finishAction, paidAction, registerAction, startAction, stepAction, viewAction, keysAction, kioskCardAction } from "./self-checkin-actions";

const T = {
  find: { de: "Ihre Buchung finden", en: "Find your booking" },
  scan: { de: "Code scannen", en: "Scan the code" },
  scanHelp: { de: "Halten Sie den QR-Code aus Ihrer Bestätigung vor die Kamera.", en: "Hold the QR code from your confirmation in front of the camera." },
  typeIt: { de: "Oder eintippen", en: "Or type it in" },
  number: { de: "Buchungsnummer", en: "Booking number" },
  lastName: { de: "Nachname", en: "Last name" },
  findIt: { de: "Buchung finden", en: "Find my booking" },
  notFound: { de: "Wir haben keine Anreise für heute gefunden. Bitte prüfen Sie die Angaben oder kommen Sie zur Rezeption.", en: "We found no arrival for today. Please check the details or come to reception." },
  welcome: { de: "Willkommen, {name}", en: "Welcome, {name}" },
  nights: { de: "{n} Nächte", en: "{n} nights" },
  night: { de: "1 Nacht", en: "1 night" },
  people: { de: "{a} Erw., {c} Kinder", en: "{a} adults, {c} children" },
  adults: { de: "{a} Erwachsene", en: "{a} adults" },
  adult: { de: "1 Erwachsene(r)", en: "1 adult" },
  thisIsMe: { de: "Ja, das ist mein Aufenthalt", en: "Yes, this is my stay" },
  here: { de: "Sind Sie im Hotel?", en: "Are you at the hotel?" },
  hereHelp: { de: "Das Zimmer gibt es, sobald Sie hier sind.", en: "Your room is given once you are here." },
  imHere: { de: "Ich bin im Hotel", en: "I am at the hotel" },
  pay: { de: "Zahlung", en: "Payment" },
  due: { de: "Noch offen: {amount}", en: "Still due: {amount}" },
  payNow: { de: "{amount} bezahlen", en: "Pay {amount}" },
  orCard: { de: "Oder eine Karte als Garantie hinterlegen; bezahlt wird später.", en: "Or leave a card as guarantee and pay later." },
  leaveCard: { de: "Karte hinterlegen", en: "Leave a card" },
  confirm: { de: "Bestätigen", en: "Confirm" },
  testPay: { de: "Testkarte: Zahlung gelingt", en: "Test card: payment succeeds" },
  testDecline: { de: "Testkarte: abgelehnt", en: "Test card: declined" },
  declined: { de: "Die Zahlung ging nicht durch: {reason}", en: "The payment did not go through: {reason}" },
  yourRoom: { de: "Ihr Zimmer", en: "Your room" },
  keyReception: { de: "Ihren Schlüssel erhalten Sie an der Rezeption.", en: "Collect your key at reception." },
  keyCardWriting: { de: "Ihre Schlüsselkarte wird geschrieben …", en: "Your key card is being written …" },
  keyCardReady: { de: "Ihre Schlüsselkarte liegt bereit: Bitte nehmen Sie sie vom Kartenleser.", en: "Your key card is ready: please take it from the card reader." },
  doorPin: { de: "Ihr Tür-PIN", en: "Your door PIN" },
  doorPinHelp: { de: "Gültig bis zur Abreise. Sie finden ihn auch in Ihrem Gästeportal.", en: "Valid until you leave. You also find it in your Guest Portal." },
  digitalKey: { de: "Ihr Digitaler Schlüssel ist bereit.", en: "Your Digital Key is ready." },
  digitalKeyKiosk: { de: "Ihr Digitaler Schlüssel ist in Ihrem Gästeportal auf dem Handy.", en: "Your Digital Key is in your Guest Portal on your phone." },
  openKey: { de: "Schlüssel öffnen", en: "Open your key" },
  keyComing: { de: "Ihr Schlüssel wird vorbereitet …", en: "Your key is being prepared …" },
  waiting: { de: "Ihr Zimmer wird gerade vorbereitet", en: "Your room is being prepared" },
  waitingHelp: { de: "Sie sind eingecheckt bis auf das Zimmer. Wir sagen Ihnen Bescheid, sobald es fertig ist.", en: "Everything else is done. We will let you know as soon as your room is ready." },
  help: { de: "Die Rezeption hilft Ihnen gern", en: "Reception will help you" },
  helpHelp: { de: "Ihre Angaben sind gespeichert. Bitte kommen Sie zur Rezeption.", en: "What you entered is saved. Please come to reception." },
  arrival_day: { de: "Der Self-Check-in ist am Anreisetag möglich.", en: "Self check-in opens on your arrival day." },
  too_early: { de: "Check-in ab {time} Uhr.", en: "Check-in from {time}." },
  registration: { de: "Der Meldeschein wird an der Rezeption unterschrieben.", en: "Your registration form is signed at reception." },
  payment: { de: "Es ist noch ein Betrag offen.", en: "An amount is still due." },
  room_not_ready: { de: "Ihr Zimmer ist noch nicht fertig.", en: "Your room is not ready yet." },
  offline: { de: "Bitte kommen Sie zur Rezeption.", en: "Please come to reception." },
  done: { de: "Fertig", en: "Done" },
  checkedIn: { de: "Sie sind bereits eingecheckt.", en: "You are checked in already." },
  error: { de: "Das hat nicht geklappt. Bitte noch einmal.", en: "That did not work. Please try again." },
} as const;
type Key = keyof typeof T;

/** How long a kiosk waits for a touch before it forgets the guest; longer while paying (the card form's touches do not reach the page). */
const KIOSK_IDLE_MS = 120_000;
const KIOSK_PAY_IDLE_MS = 600_000;
const DOTS = ["find", "stay", "register", "pay", "result"] as const;
type Screen = (typeof DOTS)[number] | "here" | "offline";

/**
 * Self Check-in (ticket 49), variant A "Cinematic glass", on a lobby kiosk or
 * the guest's phone. A kiosk starts by finding the booking and forgets
 * everything after the result, after two idle minutes, and when it goes
 * offline (then it shows only "come to reception"). Nothing is kept in the
 * browser: the stay lives in memory for the flow only.
 */
/**
 * The last screen's key (ticket 69): at reception; a card written on the
 * kiosk's encoder; the door PIN; or the Digital Key on the phone. A PIN or
 * Digital Key is made by the lock system moments after check-in: asked
 * for until it is there, else the guest is sent to reception.
 */
function KeyStep({ channel, portalKey, handover, t }: { channel: "kiosk" | "phone"; portalKey: string | null; handover: SelfCheckinView["property"]["keyHandover"]; t: (k: Key) => string }) {
  const [state, setState] = useState<{ card?: "writing" | "ready" | "failed"; pin?: string | undefined; guestKey?: string | undefined; gaveUp?: boolean }>({});
  const box = "mx-auto mt-8 max-w-md rounded-3xl bg-white/5 p-6 text-lg";
  const kioskCard = handover === "kiosk_encoder" && channel === "kiosk";
  useEffect(() => {
    if (!portalKey) return;
    let stopped = false;
    if (kioskCard) {
      setState({ card: "writing" });
      void kioskCardAction(portalKey).then((r) => !stopped && setState({ card: r.ok ? "ready" : "failed" }));
    } else if (handover === "door_pin" || handover === "digital_key") {
      const want = handover === "door_pin" ? "pin" : "phone";
      const until = Date.now() + 45_000;
      const ask = async () => {
        const keys = await keysAction(portalKey).catch(() => null);
        const k = keys?.keys.find((x) => x.kind === want);
        if (stopped) return;
        if (k) return setState({ pin: k.pin ?? undefined, guestKey: k.guestKey ?? undefined });
        if (Date.now() > until) return setState({ gaveUp: true });
        setTimeout(() => void ask(), 2000);
      };
      void ask();
    }
    return () => {
      stopped = true;
    };
  }, [portalKey, handover, kioskCard]);
  if (handover === "reception" || state.card === "failed" || state.gaveUp || (handover === "kiosk_encoder" && channel === "phone")) return <div className={box}>{t("keyReception")}</div>;
  if (kioskCard) return <div className={box} data-key-card={state.card}>{state.card === "ready" ? t("keyCardReady") : t("keyCardWriting")}</div>;
  if (handover === "door_pin") {
    return state.pin ? (
      <div className={box} data-door-pin>
        <p className="text-sm uppercase tracking-[0.3em] opacity-80">{t("doorPin")}</p>
        <p className="mt-2 font-mono text-6xl tracking-[0.3em]">{state.pin}</p>
        <p className="mt-3 text-base opacity-80">{t("doorPinHelp")}</p>
      </div>
    ) : (
      <div className={box}>{t("keyComing")}</div>
    );
  }
  return state.guestKey ? (
    <div className={box} data-digital-key>
      {channel === "kiosk" ? (
        t("digitalKeyKiosk")
      ) : (
        <>
          <p>{t("digitalKey")}</p>
          <a href={state.guestKey} className="mt-4 inline-block rounded-full bg-white px-6 py-3 font-medium text-black" data-open-key>
            {t("openKey")}
          </a>
        </>
      )}
    </div>
  ) : (
    <div className={box}>{t("keyComing")}</div>
  );
}

export function SelfCheckin({ channel, propertyName, portalKey, language, hereAlready = false }: { channel: "kiosk" | "phone"; propertyName: string; portalKey?: string; language: Lang; hereAlready?: boolean }) {
  const [lang, setLang] = useState<Lang>(language);
  const [screen, setScreen] = useState<Screen>(channel === "kiosk" ? "find" : "stay");
  const [key, setKey] = useState<string | null>(portalKey ?? null);
  const [view, setView] = useState<SelfCheckinView | null>(null);
  const [here, setHere] = useState(hereAlready);
  const [result, setResult] = useState<{ outcome: "checked_in" | "waiting" | "help"; roomNumber: string | null; failed: CheckInCondition[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const t = (k: Key, v: Record<string, string | number> = {}) => T[k][lang].replace(/\{(\w+)\}/g, (_, x: string) => String(v[x] ?? ""));
  const formText = (k: keyof typeof FORM_TEXT, vars: Record<string, string> = {}): string => Object.entries(vars).reduce<string>((out, [a, b]) => out.replace(`{${a}}`, b), FORM_TEXT[k][lang]);

  const forget = useCallback(() => {
    setKey(null);
    setView(null);
    setResult(null);
    setError("");
    setHere(false);
    setScreen("find");
  }, []);

  // the kiosk: offline shows only "come to reception" and forgets the guest; idle forgets too
  useEffect(() => {
    if (channel !== "kiosk") return;
    const off = () => {
      forget();
      setScreen("offline");
    };
    const on = () => setScreen("find");
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    if (!navigator.onLine) off();
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, [channel, forget]);
  // after a server that did not answer: back to the start once the network is there
  useEffect(() => {
    if (channel !== "kiosk" || screen !== "offline") return;
    const retry = setInterval(() => navigator.onLine && setScreen("find"), 30_000);
    return () => clearInterval(retry);
  }, [channel, screen]);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (channel !== "kiosk") return;
    const touch = () => {
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(forget, screen === "pay" ? KIOSK_PAY_IDLE_MS : KIOSK_IDLE_MS);
    };
    touch();
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      if (idle.current) clearTimeout(idle.current);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [channel, forget, screen]);

  /** A server call; a kiosk that cannot reach the server shows only "come to reception". */
  async function call<R>(fn: () => Promise<R>): Promise<R | null> {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch {
      if (channel === "kiosk") {
        forget();
        setScreen("offline");
      } else setError(t("error"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function begin(k: string) {
    const r = await call(() => startAction(k));
    if (!r) return;
    if (!r.ok) return setError(r.error.startsWith("field:") ? t("error") : r.error);
    setKey(k);
    setView(r.view);
    setScreen("stay");
  }
  useEffect(() => {
    if (channel === "phone" && portalKey) void begin(portalKey);
    // once, for the Portal Link the page opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The next screen the stay needs: registration, payment, then the result. */
  async function next(v: SelfCheckinView, from: Screen, hereNow = here) {
    const order: Screen[] = ["here", "register", "pay", "result"];
    for (const s of order.slice(from === "stay" ? 0 : order.indexOf(from) + 1)) {
      if (s === "here" && channel === "phone" && !hereNow) return go("here");
      if (s === "register" && v.registration.status === "pending") return go("register");
      if (s === "pay" && v.failed.includes("payment") && v.registration.status === "done") return go("pay");
      if (s === "result") return finish(hereNow);
    }
  }
  function go(s: Screen) {
    setError("");
    setScreen(s);
    if (key && (s === "register" || s === "pay")) stepAction(key, s).catch(() => undefined);
  }
  async function finish(hereNow: boolean) {
    if (!key) return;
    const r = await call(() => finishAction(key, hereNow));
    if (!r) return;
    if (!r.ok) return setError(r.error);
    setResult({ outcome: r.outcome, roomNumber: r.roomNumber, failed: r.failed });
    setScreen("result");
  }

  const field = "h-14 w-full rounded-2xl border border-white/20 bg-white/10 px-4 text-lg text-white placeholder-white/40";
  const button = "mt-6 h-14 w-full rounded-full bg-white px-10 text-lg font-medium text-[#0b1520] disabled:opacity-50";
  const err = error ? (
    <p role="alert" className="mt-3 text-red-300">
      {error}
    </p>
  ) : null;
  const locale = lang === "de" ? "de-DE" : "en-GB";
  const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

  let body: React.ReactNode = null;
  if (screen === "offline") {
    body = <h1 className="text-center text-3xl" data-offline>{t("offline")}</h1>;
  } else if (screen === "find") {
    body = (
      <div data-step="find">
        <h1 className="text-4xl font-light sm:text-5xl">{t("find")}</h1>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Scanner
            t={t}
            onLink={async (link) => {
              const r = await call(() => findAction({ link }));
              if (r?.ok) {
                await begin(r.key);
                return true;
              }
              if (r) setError(t("notFound"));
              return false;
            }}
          />
          <form
            className="grid content-start gap-3 rounded-3xl bg-white/5 p-6"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const r = await call(() => findAction({ confirmationNumber: String(f.get("number") ?? ""), lastName: String(f.get("lastName") ?? "") }));
              if (r?.ok) await begin(r.key);
              else if (r) setError(t("notFound"));
            }}
          >
            <p className="text-lg">{t("typeIt")}</p>
            <input name="number" required autoComplete="off" placeholder={t("number")} aria-label={t("number")} className={field} />
            <input name="lastName" required autoComplete="off" placeholder={t("lastName")} aria-label={t("lastName")} className={field} />
            <button type="submit" disabled={busy} className={button} data-find>
              {t("findIt")}
            </button>
          </form>
        </div>
        {err}
      </div>
    );
  } else if (!view) {
    body = err ?? <p className="text-center opacity-70">…</p>;
  } else if (screen === "stay") {
    const n = Math.round((Date.parse(view.stay.departure) - Date.parse(view.stay.arrival)) / 86_400_000);
    const blocking = view.failed.filter((c) => c === "arrival_day" || c === "too_early");
    body = (
      <div data-step="stay">
        <h1 className="text-3xl font-light sm:text-4xl">{t("welcome", { name: view.stay.firstName })}</h1>
        <ul className="mt-6 divide-y divide-white/10 rounded-3xl bg-white/5 px-6">
          <li className="flex items-center gap-4 py-4">
            <CalendarDays size={20} className="opacity-70" />
            <span className="flex-1 text-lg">
              {date(view.stay.arrival)} – {date(view.stay.departure)}
            </span>
            <span className="opacity-70">{n === 1 ? t("night") : t("nights", { n })}</span>
          </li>
          <li className="flex items-center gap-4 py-4">
            <BedDouble size={20} className="opacity-70" />
            <span className="flex-1 text-lg">{view.stay.roomType}</span>
            <span className="opacity-70">{view.stay.ratePlan}</span>
          </li>
          <li className="flex items-center gap-4 py-4">
            <Users size={20} className="opacity-70" />
            <span className="flex-1 text-lg">{view.stay.children ? t("people", { a: view.stay.adults, c: view.stay.children }) : view.stay.adults === 1 ? t("adult") : t("adults", { a: view.stay.adults })}</span>
            <span className="opacity-70">
              {view.stay.firstName} {view.stay.lastName}
            </span>
          </li>
        </ul>
        {view.status === "checked_in" ? (
          <p className="mt-6 text-lg" data-checked-in>
            {t("checkedIn")} {view.roomNumber ? `${t("yourRoom")}: ${view.roomNumber}` : ""}
          </p>
        ) : blocking.length ? (
          <p className="mt-6 text-lg" data-not-yet>
            {blocking.map((c) => t(c, { time: view.property.checkinFrom })).join(" ")}
          </p>
        ) : (
          <button type="button" disabled={busy} className={button} data-confirm-stay onClick={() => void next(view, "stay")}>
            <Check size={18} className="mr-2 inline" />
            {t("thisIsMe")}
          </button>
        )}
        {err}
      </div>
    );
  } else if (screen === "here") {
    body = (
      <div data-step="here" className="text-center">
        <h1 className="text-3xl font-light">{t("here")}</h1>
        <p className="mt-2 opacity-80">{t("hereHelp")}</p>
        <button
          type="button"
          className={button}
          data-here
          onClick={() => {
            setHere(true);
            void next(view, "here", true);
          }}
        >
          {t("imHere")}
        </button>
      </div>
    );
  } else if (screen === "register" && view.registration.form) {
    const form = view.registration.form;
    body = (
      <GuestFormSteps
        state={form}
        t={formText}
        err={err}
        field={field}
        button={button}
        send={async (input, quiet) => {
          if (!key) return;
          if (quiet) return;
          const r = await call(() => registerAction(key, input));
          if (!r) return;
          if (!r.ok) {
            const f = r.error.startsWith("field:") ? (FIELD_TEXT as Record<string, keyof typeof FORM_TEXT>)[r.error.slice(6)] : undefined;
            return setError(f ? formText("problem", { f: formText(f) }) : r.error === "error" ? t("error") : r.error);
          }
          setView(r.view);
          if (r.view.registration.status !== "pending") await next(r.view, "register");
        }}
      />
    );
  } else if (screen === "pay" && key) {
    const amount = view.amountDue.toLocaleString(locale, { style: "currency", currency: view.property.currency });
    body = (
      <div data-step="pay">
        <h1 className="text-3xl font-light">{t("pay")}</h1>
        <p className="mt-2 text-lg opacity-80">{t("due", { amount })}</p>
        <InlinePay
          portalKey={key}
          t={t}
          amount={amount}
          button={button}
          onPaid={async () => {
            const r = await call(() => viewAction(key));
            if (r?.ok) {
              setView(r.view);
              await next(r.view, "pay");
            }
          }}
        />
        {err}
      </div>
    );
  } else if (screen === "result" && result) {
    body =
      result.outcome === "checked_in" ? (
        <div className="text-center" data-result="checked_in">
          <p className="text-sm uppercase tracking-[0.3em] opacity-80">{t("yourRoom")}</p>
          <p className="mt-2 text-[8rem] font-extralight leading-none" data-room-number>
            {result.roomNumber}
          </p>
          {/* the key step follows the property's key handover (ticket 69) */}
          <KeyStep channel={channel} portalKey={key} handover={view.property.keyHandover} t={t} />
        </div>
      ) : result.outcome === "waiting" ? (
        <div className="text-center" data-result="waiting">
          <h1 className="text-3xl font-light">{t("waiting")}</h1>
          <p className="mt-3 text-lg opacity-80">{t("waitingHelp")}</p>
        </div>
      ) : (
        <div className="text-center" data-result="help">
          <h1 className="text-3xl font-light">{t("help")}</h1>
          <p className="mt-3 text-lg opacity-80">{result.failed.map((c) => t(c, { time: view.property.checkinFrom })).join(" ")}</p>
          <p className="mt-2 opacity-70">{t("helpHelp")}</p>
        </div>
      );
    if (channel === "kiosk") {
      body = (
        <>
          {body}
          <button type="button" className={`${button} mx-auto block max-w-xs`} onClick={forget} data-done>
            {t("done")}
          </button>
        </>
      );
    }
  }

  const at = DOTS.indexOf((screen === "here" ? "stay" : screen) as (typeof DOTS)[number]);
  const dots = channel === "kiosk" ? DOTS : DOTS.slice(1);
  return (
    <div className={channel === "kiosk" ? "relative min-h-dvh overflow-hidden bg-[#0b1520] text-white" : "relative"} data-self-checkin={channel}>
      {channel === "kiosk" ? (
        <div aria-hidden className="fixed inset-0" style={{ backgroundImage: "radial-gradient(ellipse at 15% 10%, #3b6e8f 0%, transparent 55%), radial-gradient(ellipse at 85% 0%, #e0a27a 0%, transparent 40%), linear-gradient(170deg, #1d3b52 0%, #0b1520 70%)" }} />
      ) : null}
      <div className={channel === "kiosk" ? "relative z-10 mx-auto flex min-h-dvh max-w-5xl flex-col px-8 py-10" : "relative grid gap-4"}>
        <header className="flex items-center justify-between">
          <p className="text-sm uppercase tracking-[0.3em] text-white/80">{propertyName}</p>
          <div className="flex gap-2 text-sm text-white/70">
            {(["en", "de"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} className={l === lang ? "text-white underline" : ""}>
                {l === "en" ? "English" : "Deutsch"}
              </button>
            ))}
          </div>
        </header>
        <section className={`${channel === "kiosk" ? "my-auto p-10" : "p-6"} rounded-[2rem] border border-white/15 bg-black/45 shadow-2xl backdrop-blur-xl`}>{body}</section>
        <div className="mt-6 flex justify-center gap-1.5" aria-hidden>
          {dots.map((d) => (
            <span key={d} className={`h-1.5 rounded-full ${DOTS.indexOf(d) === at ? "w-8 bg-white" : "w-1.5 bg-white/40"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

type BarcodeDetectorLike = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** The confirmation's QR code before the kiosk's camera, where the browser can read codes. */
function Scanner({ t, onLink }: { t: (k: Key) => string; onLink: (link: string) => Promise<boolean> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const found = useRef(onLink);
  found.current = onLink;
  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let stop = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (stop || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setOn(true);
        const detector = new Detector({ formats: ["qr_code"] });
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          // a code that finds nothing: keep reading (the next guest, or the right code)
          if (codes[0] && (await found.current(codes[0].rawValue))) break;
          if (codes[0]) await new Promise((r) => setTimeout(r, 2500));
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch {
        // no camera: the guest types the booking in
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, []);
  return (
    <div className="grid content-center justify-items-center gap-3 rounded-3xl bg-white/5 p-6 text-center">
      <video ref={video} muted playsInline className={on ? "h-40 rounded-2xl object-cover" : "hidden"} />
      {on ? null : <QrCode size={56} strokeWidth={1.4} />}
      <p className="text-xl">{t("scan")}</p>
      <p className="opacity-70">{t("scanHelp")}</p>
    </div>
  );
}

/**
 * Pay what is due, or leave a card as the stay's guarantee, without leaving
 * the flow: the card form from Stripe (card data never reaches us), 3-D
 * Secure in place.
 */
function InlinePay({ portalKey, t, amount, button, onPaid }: { portalKey: string; t: (k: Key, v?: Record<string, string | number>) => string; amount: string; button: string; onPaid: () => Promise<void> }) {
  const [started, setStarted] = useState<{ kind: "payment" | "setup"; id: string; stripe: StripeJs | null; elements: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mount = useRef<HTMLDivElement>(null);
  async function settle(kind: "payment" | "setup", id: string) {
    const r = kind === "payment" ? await paidAction(portalKey, id) : await cardStoredAction(portalKey, id);
    setStarted(null);
    if (r.ok) await onPaid();
    else setError(t("declined", { reason: r.error ?? "" }));
  }
  async function begin(kind: "payment" | "setup") {
    setBusy(true);
    setError("");
    try {
      const s = kind === "payment" ? await startPayAction(portalKey, false) : await startCardAction(portalKey);
      if (!s.ok) return setError(s.error);
      if (!s.publishableKey) return setStarted({ kind, id: s.id, stripe: null, elements: null });
      const stripe = await loadStripe(s.publishableKey, s.accountId);
      const elements = stripe.elements({ clientSecret: s.clientSecret, appearance: { theme: "night" } });
      setStarted({ kind, id: s.id, stripe, elements });
      setTimeout(() => mount.current && elements.create("payment").mount(mount.current), 0);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!started?.stripe) return;
    setBusy(true);
    try {
      // the confirmation stays on this page (redirect only where the bank insists), so the flow goes on
      const o = { elements: started.elements, redirect: "if_required", confirmParams: { return_url: window.location.href } };
      const confirmIt = (started.kind === "payment" ? started.stripe.confirmPayment : started.stripe.confirmSetup) as unknown as (x: typeof o) => Promise<{ error?: { type?: string; message?: string } }>;
      const r = await confirmIt(o);
      if (r.error && r.error.type !== "card_error") return setError(r.error.message ?? "");
      await settle(started.kind, started.id);
    } finally {
      setBusy(false);
    }
  }
  async function simulate(outcome: "succeed" | "decline") {
    if (!started) return;
    setBusy(true);
    try {
      await simulateAction(portalKey, started.kind, started.id, outcome);
      await settle(started.kind, started.id);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3" data-pay>
      {!started ? (
        <>
          <button type="button" disabled={busy} onClick={() => void begin("payment")} className={button} data-pay-start>
            {t("payNow", { amount })}
          </button>
          <p className="mt-2 opacity-70">{t("orCard")}</p>
          <button type="button" disabled={busy} onClick={() => void begin("setup")} className={`${button} mt-0 bg-white/70`} data-card-start>
            {t("leaveCard")}
          </button>
        </>
      ) : started.stripe ? (
        <>
          <div ref={mount} className="mt-4 rounded-2xl bg-white/5 p-3" />
          <button type="button" disabled={busy} onClick={() => void confirm()} className={button}>
            {t("confirm")}
          </button>
        </>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3" data-test-card>
          <button type="button" disabled={busy} onClick={() => void simulate("succeed")} className={button}>
            {t("testPay")}
          </button>
          <button type="button" disabled={busy} onClick={() => void simulate("decline")} className={`${button} bg-white/70`}>
            {t("testDecline")}
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
