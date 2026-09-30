"use client";
// PROTOTYPE, throwaway. Question: how does the front desk push a Meldeschein to a guest-facing tablet, and how does the guest complete it
// under each country's rules? Variants are the three legal completion paths, not three looks:
// A Austria (sign on tablet), B Germany (print, handwritten signature), C Germany (card payment with SCA replaces signature).
// Desk and tablet are shown side by side and share in-memory state; in the product they are two devices connected through the server.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PrototypeSwitcher } from "../PrototypeSwitcher";
import { Desk } from "./Desk";
import { Tablet } from "./Tablet";
import { DEVICES, GUESTS, PATHS, duty, type FormState, type Path } from "./model";

const ORDER: Path[] = ["AT_SIGN", "DE_PRINT", "DE_CARD"];
const VARIANTS = ORDER.map((p) => ({ key: PATHS[p].key, name: PATHS[p].name }));

function Flow({ path }: { path: Path }) {
  const first = GUESTS.find((g) => duty(g, path) === "own-form")!.id;
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [onTablet, setOnTablet] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState("d1");
  const [selected, setSelected] = useState(first);
  const [paying, setPaying] = useState(false);

  const patch = (id: string, p: Partial<FormState>) => setForms((f) => ({ ...f, [id]: { ...f[id], ...p } }));
  const send = (id: string) => {
    const g = GUESTS.find((x) => x.id === id)!;
    setForms((f) => ({ ...f, [id]: f[id] ? { ...f[id], step: "welcome" } : { guestId: id, step: "welcome", data: { ...g }, consent: false, signature: null, idChecked: false, idNote: "", printed: false, signedOnPaper: false, cardToken: null, completedAt: null } }));
    setOnTablet(id);
  };
  const complete = (id: string) => { patch(id, { completedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), step: "done" }); };
  const takePayment = (id: string) => {
    setPaying(true);
    setTimeout(() => { patch(id, { cardToken: "pm_tok_" + Math.random().toString(36).slice(2, 10), step: "done" }); setPaying(false); }, 1800);
  };

  useEffect(() => {
    const step = new URLSearchParams(window.location.search).get("demo"); // PROTOTYPE debug param: jump the tablet to a step
    if (step) { send(first); setTimeout(() => patch(first, { step: step as FormState["step"] }), 50); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const record = Object.values(forms).filter((f) => f.completedAt).map((f) => ({
    DatumAnkunft: "2026-09-28", DatumAbreise: "2026-10-03", Familienname: f.data.last, Vornamen: f.data.first, Geburtsdatum: f.data.dob,
    Staatsangehoerigkeiten: f.data.nationality, Anschrift: `${f.data.street}, ${f.data.postcode} ${f.data.city}, ${f.data.country}`,
    AnzahlAngehoerige: GUESTS.filter((g) => g.id !== f.guestId && duty(g, path) === "counted").length, SeriennummerPass: f.data.passport,
    confirmedBy: path === "AT_SIGN" ? "signature on tablet" : f.cardToken ? "card payment with SCA" : "handwritten signature on paper",
    Zahlungszuordnungsnummer: f.cardToken, idChecked: f.idChecked, idNote: f.idNote || null,
    retention: path === "AT_SIGN" ? "7 years" : "delete between day 365 and 455 after departure",
  }));

  return (
    <>
      <div className="flex min-h-dvh items-start justify-center gap-8 bg-canvas p-8 pb-28">
        <div>
          <div className="mb-2 pl-2 text-[12px] font-semibold uppercase tracking-wide text-ink-40">Front desk (staff app)</div>
          <Desk path={path} forms={forms} onTablet={onTablet} deviceId={deviceId} selected={selected} setDevice={setDeviceId} select={setSelected}
            send={send} recall={() => { if (onTablet) patch(onTablet, { step: "idle" }); setOnTablet(null); }} patch={patch} complete={(id) => { complete(id); setOnTablet(null); }} takePayment={takePayment} paying={paying} />
        </div>
        <div>
          <div className="mb-2 pl-4 text-[12px] font-semibold uppercase tracking-wide text-ink-40">Guest tablet ({DEVICES.find((d) => d.id === deviceId)!.name})</div>
          <Tablet path={path} form={onTablet ? forms[onTablet] : null} update={(p) => onTablet && patch(onTablet, p)} deviceName={DEVICES.find((d) => d.id === deviceId)!.name} />
        </div>
      </div>
      <PrototypeSwitcher variants={VARIANTS} current={PATHS[path].key} state={{ path, deviceId, onTablet, forms: Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, { ...v, signature: v.signature ? "<image>" : null }])), storedRecords: record }} />
    </>
  );
}

export function MeldescheinPrototype() {
  const raw = useSearchParams().get("variant") ?? "A";
  const path = ORDER.find((p) => PATHS[p].key === raw) ?? "AT_SIGN";
  return <Flow key={path} path={path} />;
}
