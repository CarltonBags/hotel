"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TabletState } from "@hoteloftware/db";

type Lang = "de" | "en";
const T = {
  idle: { de: "Willkommen. Bitte wenden Sie sich an die Rezeption.", en: "Welcome. Please come to reception." },
  welcome: { de: "Willkommen", en: "Welcome" },
  choose: { de: "Bitte wählen Sie Ihre Sprache", en: "Please choose your language" },
  details: { de: "Ihre Angaben", en: "Your details" },
  stay: { de: "Anreise {a} · Abreise {d} (vom Hotel festgelegt)", en: "Arrival {a} · Departure {d} (set by the hotel)" },
  firstName: { de: "Vorname(n)", en: "First names" },
  lastName: { de: "Familienname", en: "Family name" },
  dob: { de: "Geburtsdatum", en: "Date of birth" },
  nationality: { de: "Staatsangehörigkeit (z. B. DE)", en: "Nationality (e.g. DE)" },
  address: { de: "Straße und Hausnummer", en: "Street and number" },
  postcode: { de: "PLZ", en: "Postcode" },
  city: { de: "Ort", en: "City" },
  country: { de: "Land (z. B. AT)", en: "Country (e.g. AT)" },
  document: { de: "Reisedokument-Nummer", en: "Travel document number" },
  gender: { de: "Geschlecht (wie im Reisedokument)", en: "Gender (as in the travel document)" },
  genderF: { de: "weiblich", en: "female" },
  genderM: { de: "männlich", en: "male" },
  genderX: { de: "divers", en: "diverse" },
  back: { de: "Zurück", en: "Back" },
  signLine: { de: "Mit meiner Unterschrift bestätige ich, dass die Angaben richtig sind.", en: "With my signature I confirm the details are correct." },
  moved: { de: "Die Rezeption hat die Anmeldung zurückgeholt.", en: "Reception has taken the registration back." },
  error: { de: "Das hat nicht geklappt. Bitte noch einmal.", en: "That did not work. Please try again." },
  relationCount: { de: "Ehepartner, Lebenspartner und Kinder werden mit Anzahl und Staatsangehörigkeit erfasst.", en: "Spouse, partner and children are recorded by number and nationality." },
  next: { de: "Weiter", en: "Next" },
  companions: { de: "Mitreisende", en: "Travelling with you" },
  companionsHelp: { de: "Ehepartner, Lebenspartner und minderjährige Kinder, die mit Ihnen reisen.", en: "Spouse, partner and children under 18 travelling with you." },
  add: { de: "Hinzufügen", en: "Add" },
  role: { de: "Beziehung", en: "Relation" },
  spouse: { de: "Ehepartner", en: "Spouse" },
  partner: { de: "Lebenspartner", en: "Partner" },
  child: { de: "Kind", en: "Child" },
  review: { de: "Bitte prüfen", en: "Please check" },
  sign: { de: "Bitte hier unterschreiben", en: "Please sign here" },
  clear: { de: "Löschen", en: "Clear" },
  confirm: { de: "Bestätigen", en: "Confirm" },
  paper: { de: "Ihr Meldeschein wird an der Rezeption gedruckt; Sie unterschreiben ihn dort.", en: "Your form is being printed at reception; you sign it there." },
  done: { de: "Vielen Dank! Bitte geben Sie das Tablet zurück.", en: "Thank you! Please hand the tablet back." },
  pass: { de: "Danke! Bitte reichen Sie das Tablet an die nächste Person weiter.", en: "Thank you! Please pass the tablet to the next guest." },
  problem: { de: "Bitte prüfen Sie: {f}", en: "Please check: {f}" },
  placeOfBirth: { de: "Geburtsort", en: "Place of birth" },
  documentType: { de: "Art des Ausweises", en: "Type of document" },
  passport: { de: "Reisepass", en: "Passport" },
  idCard: { de: "Identitätskarte", en: "Identity card" },
  otherDocument: { de: "Anderes", en: "Other" },
  carNumber: { de: "Kontrollschild Ihres Fahrzeugs (falls mit dem Auto)", en: "Car registration (if you came by car)" },
  residence: { de: "Wohnsitzland (z. B. CH)", en: "Country of residence (e.g. CH)" },
  idCheck: { de: "Die Rezeption vergleicht Ihre Angaben mit Ihrem Ausweis.", en: "Reception checks your details against your document." },
} as const;

/** The fields the server may name as a problem, and their labels. */
const FIELD_TEXT = {
  firstName: "firstName",
  lastName: "lastName",
  dateOfBirth: "dob",
  nationality: "nationality",
  gender: "gender",
  signature: "sign",
  companions: "companions",
  placeOfBirth: "placeOfBirth",
  documentType: "documentType",
  documentNumber: "document",
  country: "country",
} as const;

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

  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  if (p.step === "details") {
    const swiss = state.country === "CH";
    return shell(
      <form
        data-step="details"
        onInput={(e) => {
          // the desk sees what is typed, live: saved a moment after the guest stops typing
          const f = new FormData(e.currentTarget);
          if (draftTimer.current) clearTimeout(draftTimer.current);
          draftTimer.current = setTimeout(() => void send({ step: "draft", details: Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)])) }, true), 700);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const v = (k: string) => String(f.get(k) ?? "");
          if (draftTimer.current) clearTimeout(draftTimer.current);
          void send({
            step: "details",
            details: {
              firstName: v("firstName"),
              lastName: v("lastName"),
              dateOfBirth: v("dateOfBirth"),
              nationality: v("nationality"),
              addressLine1: v("addressLine1"),
              postalCode: v("postalCode"),
              city: v("city"),
              country: v("country"),
              documentNumber: v("documentNumber"),
              gender: v("gender"),
              ...(swiss ? { placeOfBirth: v("placeOfBirth"), documentType: v("documentType"), carNumber: v("carNumber") } : {}),
            },
          });
        }}
      >
        <h1 className="text-3xl">{t("details")}</h1>
        <p className="mt-1 opacity-80">{t("stay", { a: state.arrival, d: state.departure })}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {(
            [
              ["firstName", "firstName", p.firstName],
              ["lastName", "lastName", p.lastName],
              ["dateOfBirth", "dob", p.dateOfBirth ?? ""],
              ["nationality", "nationality", p.nationality],
              ["addressLine1", "address", p.addressLine1],
              ["postalCode", "postcode", p.postalCode],
              ["city", "city", p.city],
              ["country", "country", p.country],
              ["documentNumber", "document", p.documentNumber],
            ] as const
          ).map(([name, label, value]) => (
            <label key={name} className="grid gap-1">
              <span className="opacity-80">{t(label)}</span>
              <input name={name} defaultValue={value} type={name === "dateOfBirth" ? "date" : "text"} required={name !== "documentNumber" || swiss} className={field} />
            </label>
          ))}
          <label className="grid gap-1">
            <span className="opacity-80">{t("gender")}</span>
            <select name="gender" defaultValue={p.gender} className={field}>
              <option value="" />
              <option value="f">{t("genderF")}</option>
              <option value="m">{t("genderM")}</option>
              <option value="x">{t("genderX")}</option>
            </select>
          </label>
          {swiss ? (
            <>
              <label className="grid gap-1">
                <span className="opacity-80">{t("placeOfBirth")}</span>
                <input name="placeOfBirth" defaultValue={p.placeOfBirth} required className={field} />
              </label>
              <label className="grid gap-1">
                <span className="opacity-80">{t("documentType")}</span>
                <select name="documentType" defaultValue={p.documentType} required className={field}>
                  <option value="" />
                  <option value="passport">{t("passport")}</option>
                  <option value="id_card">{t("idCard")}</option>
                  <option value="other">{t("otherDocument")}</option>
                </select>
              </label>
              {state.extraFields.includes("car_number") ? (
                <label className="grid gap-1">
                  <span className="opacity-80">{t("carNumber")}</span>
                  <input name="carNumber" defaultValue={p.carNumber} className={field} />
                </label>
              ) : null}
            </>
          ) : null}
        </div>
        {err}
        <button type="submit" className={button}>
          {t("next")}
        </button>
      </form>,
    );
  }
  if (p.step === "companions") return shell(<Companions t={t} field={field} button={button} countOnly={state.country === "DE"} residence={state.country === "CH"} existing={state.companions.map((c) => (state.country === "DE" ? `${c.role} · ${c.nationality}` : `${c.firstName} ${c.lastName}`))} onDone={(add) => void send({ step: "companions", add })} err={err} />);
  if (p.step === "review") {
    return shell(
      <div data-step="review">
        <h1 className="text-3xl">{t("review")}</h1>
        <dl className="mt-6 grid grid-cols-2 gap-2 text-lg">
          <dt className="opacity-70">{t("lastName")}</dt>
          <dd>{p.lastName}</dd>
          <dt className="opacity-70">{t("firstName")}</dt>
          <dd>{p.firstName}</dd>
          <dt className="opacity-70">{t("dob")}</dt>
          <dd>{p.dateOfBirth}</dd>
          <dt className="opacity-70">{t("nationality")}</dt>
          <dd>{p.nationality}</dd>
          <dt className="opacity-70">{t("address")}</dt>
          <dd>
            {p.addressLine1}, {p.postalCode} {p.city}, {p.country}
          </dd>
        </dl>
        <button type="button" className="mt-6 h-12 rounded-full border border-white/40 px-6" onClick={() => void send({ step: "back" })}>
          {t("back")}
        </button>
        {state.signature === "tablet" ? <Signature t={t} button={button} onSign={(png) => void send({ step: "review", signature: png })} /> : (
          <>
            <p className="mt-6 opacity-80">{state.signature === "id_check" ? t("idCheck") : t("paper")}</p>
            <button type="button" className={button} onClick={() => void send({ step: "review" })}>
              {t("confirm")}
            </button>
          </>
        )}
        {err}
      </div>,
    );
  }
  return shell(<h1 className="mt-24 text-center text-3xl">{t("idle")}</h1>);
}

function Companions({ t, field, button, existing, onDone, err, countOnly, residence }: { t: (k: keyof typeof T) => string; field: string; button: string; existing: string[]; onDone: (add: unknown[]) => void; err: React.ReactNode; countOnly: boolean; residence: boolean }) {
  const [added, setAdded] = useState<{ role: string; firstName: string; lastName: string; dateOfBirth: string; nationality: string; countryOfResidence?: string }[]>([]);
  return (
    <div data-step="companions">
      <h1 className="text-3xl">{t("companions")}</h1>
      <p className="mt-1 opacity-80">{t("companionsHelp")}</p>
      {countOnly ? <p className="text-sm opacity-70">{t("relationCount")}</p> : null}
      <ul className="mt-4 text-lg">
        {[...existing, ...added.map((a) => (countOnly ? `${t(a.role as keyof typeof T)} · ${a.nationality}` : `${a.firstName} ${a.lastName}`))].map((n, i) => (
          <li key={`${n}-${i}`}>· {n}</li>
        ))}
      </ul>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setAdded((a) => [
            ...a,
            {
              role: String(f.get("role")),
              firstName: String(f.get("firstName") ?? ""),
              lastName: String(f.get("lastName") ?? ""),
              dateOfBirth: String(f.get("dateOfBirth") || ""),
              nationality: String(f.get("nationality")).toUpperCase(),
              ...(residence ? { countryOfResidence: String(f.get("countryOfResidence") ?? "").toUpperCase() } : {}),
            },
          ]);
          e.currentTarget.reset();
        }}
      >
        <select name="role" className={field} aria-label={t("role")}>
          <option value="spouse">{t("spouse")}</option>
          <option value="partner">{t("partner")}</option>
          <option value="child">{t("child")}</option>
        </select>
        {/* Germany counts them by number and nationality: no names asked */}
        {countOnly ? null : (
          <>
            <input name="firstName" required placeholder={t("firstName")} className={field} />
            <input name="lastName" required placeholder={t("lastName")} className={field} />
          </>
        )}
        {/* Switzerland: date of birth and Country of Residence of every guest */}
        <input name="dateOfBirth" type="date" required={residence} className={field} aria-label={t("dob")} />
        <input name="nationality" required placeholder="DE" className={field} aria-label={t("nationality")} />
        {residence ? <input name="countryOfResidence" required placeholder="CH" className={field} aria-label={t("residence")} /> : null}
        <button type="submit" className="h-12 rounded-full border border-white/40 px-6 sm:col-span-5 sm:justify-self-start">
          {t("add")}
        </button>
      </form>
      {err}
      <button type="button" className={button} onClick={() => onDone(added.map((a) => ({ ...a, dateOfBirth: a.dateOfBirth || null })))}>
        {t("next")}
      </button>
    </div>
  );
}

function Signature({ t, button, onSign }: { t: (k: keyof typeof T) => string; button: string; onSign: (png: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height] as const;
  };
  return (
    <div className="mt-6">
      <p className="opacity-80">{t("sign")}</p>
      <p className="text-sm opacity-70">{t("signLine")}</p>
      <canvas
        ref={ref}
        width={900}
        height={260}
        data-signature
        className="mt-2 w-full touch-none rounded-xl bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          const c = e.currentTarget.getContext("2d")!;
          c.lineWidth = 3;
          c.lineCap = "round";
          c.strokeStyle = "#0b1520";
          c.beginPath();
          c.moveTo(...at(e));
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const c = e.currentTarget.getContext("2d")!;
          c.lineTo(...at(e));
          c.stroke();
          setDrawn(true);
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div className="flex gap-4">
        <button type="button" className="mt-6 h-14 rounded-full border border-white/40 px-8" onClick={() => {
          const c = ref.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          setDrawn(false);
        }}>
          {t("clear")}
        </button>
        <button type="button" disabled={!drawn} className={`${button} disabled:opacity-40`} onClick={() => onSign(ref.current!.toDataURL("image/png"))}>
          {t("confirm")}
        </button>
      </div>
    </div>
  );
}
