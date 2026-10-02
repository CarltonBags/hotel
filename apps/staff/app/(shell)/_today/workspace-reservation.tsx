"use client";

import { useEffect, useState, useTransition } from "react";
import { BedDouble, Building2, CreditCard, ExternalLink, KeyRound, ListPlus, Receipt } from "lucide-react";
import type { Guest } from "@hoteloftware/db";
import type { RegistrationField } from "@hoteloftware/domain";
import { fill, type Messages } from "@/i18n/messages";
import { useShell } from "@/shell/ShellProvider";
import { CheckInButton } from "../reservations/check-in-button";
import { findCompanies, notesAction, type Picked } from "../reservations/actions";
import { useFormAction } from "../reservations/use-form-action";
import { addFolioAction } from "../reservations/folio-actions";
import { FixedCharges } from "../reservations/[id]/fixed-charges";
import { FolioPanel } from "../reservations/[id]/folio-panel";
import { GuestDetails } from "../reservations/[id]/guest-details";
import { ReservationActions } from "../reservations/[id]/reservation-actions";

type Tab = "stay" | "guest" | "folio" | "fixed" | "billing" | "notes";

export interface WorkspaceReservationProps {
  summary: {
    id: string;
    status: string;
    confirmationNumber: string;
    guestName: string;
    stay: string;
    room: string | null;
    roomType: string;
    ratePlan: string;
    booker: string;
    balance: string;
    canCheckIn: boolean;
    notes: string;
    companyFolios: string[];
  };
  rights: { manage: boolean; folio: boolean; post: boolean; manageFolios: boolean; companies: boolean; editGuests: boolean; contacts: boolean };
  actionsProps: Omit<React.ComponentProps<typeof ReservationActions>, "m">;
  folioProps: Omit<React.ComponentProps<typeof FolioPanel>, "m">;
  fixedProps: Omit<React.ComponentProps<typeof FixedCharges>, "m">;
  guest: Guest | null;
  registration: { gaps: RegistrationField[]; fields: RegistrationField[] };
  m: Messages;
}

const pill = "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium";

/**
 * Right side of the Today workspace: the selected reservation with the desk's
 * actions always in the same place, and its parts in tabs, editable in place.
 * Actions whose feature is not built yet show disabled with their ticket.
 */
export function WorkspaceReservation({ summary: s, rights, actionsProps, folioProps, fixedProps, guest, registration, m }: WorkspaceReservationProps) {
  const { openRecord } = useShell();
  const [tab, setTab] = useState<Tab>("stay");
  // "Move room" opens the stay and brings its room assignment into view
  const [toRooms, setToRooms] = useState(0);
  useEffect(() => {
    if (toRooms) document.querySelector(`[role=tabpanel] section[aria-label="${m["res.roomAssignment"]}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [toRooms, m]);
  const tabs: Tab[] = [
    "stay",
    ...(guest ? (["guest"] as const) : []),
    ...(rights.folio ? (["folio", "fixed"] as const) : []),
    ...(rights.manageFolios ? (["billing"] as const) : []),
    ...(rights.contacts ? (["notes"] as const) : []),
  ];
  const soon = (ticket: string) => fill(m["ws.comesWith"], { ticket });
  const action = (label: string, icon: React.ReactNode, onClick: () => void, enabled = true) => (
    <button type="button" onClick={onClick} disabled={!enabled} className={`${pill} bg-surface-2 hover:bg-ink-5 disabled:opacity-40`}>
      {icon}
      {label}
    </button>
  );
  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">
            {s.guestName} <span className="text-ink-60">· {s.confirmationNumber}</span>
          </h2>
          <span className="text-sm">
            {m["ws.col.balance"]} <strong className="tabular-nums">{s.balance}</strong>
          </span>
        </div>
        <p className="text-sm text-ink-60">
          {m[`res.status.${s.status}` as keyof Messages]} · {s.stay} · {s.room ? `${m["ws.col.room"]} ${s.room}` : m["ws.noRoom"]} · {s.roomType} · {s.ratePlan} · {s.booker}
        </p>
      </header>

      <div role="toolbar" aria-label={m["ws.reservation"]} className="flex flex-wrap gap-2">
        {s.canCheckIn ? <CheckInButton reservationId={s.id} label={m["res.checkIn"]} /> : null}
        <span title={soon("27, 28")}>
          <button type="button" disabled className={`${pill} bg-surface-2 disabled:opacity-40`}>
            <CreditCard size={15} />
            {m["ws.settle"]}
          </button>
        </span>
        <span title={soon("68, 70–77")}>
          <button type="button" disabled className={`${pill} bg-surface-2 disabled:opacity-40`}>
            <KeyRound size={15} />
            {m["ws.lock"]}
          </button>
        </span>
        {action(m["ws.reservation"], <ExternalLink size={15} />, () => openRecord("reservations", s.id, `${s.confirmationNumber} · ${s.guestName}`, `/reservations/${s.id}`))}
        {rights.folio ? action(m["ws.folio"], <Receipt size={15} />, () => setTab("folio")) : null}
        {rights.folio ? action(m["ws.fixed"], <ListPlus size={15} />, () => setTab("fixed"), rights.post) : null}
        {rights.manageFolios ? action(m["ws.companyBilling"], <Building2 size={15} />, () => setTab("billing")) : null}
        {rights.manage ? action(m["ws.moveRoom"], <BedDouble size={15} />, () => (setTab("stay"), setToRooms((n) => n + 1))) : null}
      </div>

      <div role="tablist" className="flex gap-1 border-b border-ink-10">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-accent font-medium" : "border-transparent text-ink-60 hover:text-ink"}`}
          >
            {m[`ws.tab.${t}`]}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "stay" ? rights.manage ? <ReservationActions {...actionsProps} m={m} /> : <p className="text-sm text-ink-60">{s.stay}</p> : null}
        {tab === "guest" && guest ? (
          <GuestDetails guest={guest} gaps={registration.gaps} marked={registration.fields} canEdit={rights.editGuests} contacts={rights.contacts} compact m={m} />
        ) : null}
        {tab === "folio" ? <FolioPanel {...folioProps} m={m} /> : null}
        {tab === "fixed" ? <FixedCharges {...fixedProps} m={m} /> : null}
        {tab === "billing" ? <CompanyBilling reservationId={s.id} existing={s.companyFolios} canSearch={rights.companies} m={m} /> : null}
        {tab === "notes" && rights.contacts ? <Notes reservationId={s.id} notes={s.notes} canEdit={rights.manage} m={m} /> : null}
      </div>
    </div>
  );
}

/** Company billing: a folio billed to a Company, its default Routing Rules moved there at once. */
function CompanyBilling({ reservationId, existing, canSearch, m }: { reservationId: string; existing: string[]; canSearch: boolean; m: Messages }) {
  const { pending, run, note } = useFormAction(m);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Picked[]>([]);
  const [, startSearch] = useTransition();
  return (
    <section className="grid gap-3 text-sm">
      <p className="text-xs text-ink-60">{m["ws.billingHelp"]}</p>
      {note}
      {existing.length ? (
        <p>
          {m["ws.companyFolios"]}: {existing.join(", ")}
        </p>
      ) : null}
      {canSearch ? (
        <>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              const v = e.target.value;
              if (v.trim().length >= 2) startSearch(async () => setHits(await findCompanies(v)));
              else setHits([]);
            }}
            placeholder={m["ws.findCompany"]}
            aria-label={m["ws.findCompany"]}
            className="h-9 rounded-xl border border-ink-10 bg-surface px-3"
          />
          <ul className="grid gap-1">
            {hits.map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
                {h.label}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => addFolioAction(reservationId, { companyId: h.id }), () => (setQ(""), setHits([])))}
                  className={`${pill} bg-accent text-white`}
                >
                  {m["ws.addCompanyFolio"]}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Notes({ reservationId, notes, canEdit, m }: { reservationId: string; notes: string; canEdit: boolean; m: Messages }) {
  const { pending, run, note } = useFormAction(m);
  const [text, setText] = useState(notes);
  useEffect(() => setText(notes), [notes]);
  return (
    <section className="grid gap-2 text-sm">
      <p className="text-xs text-ink-60">{m["ws.notesHelp"]}</p>
      {note}
      <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={!canEdit} rows={5} aria-label={m["ws.tab.notes"]} className="w-full rounded-xl border border-ink-10 bg-surface p-3" />
      {canEdit ? (
        <button type="button" disabled={pending || text === notes} onClick={() => run(() => notesAction(reservationId, text))} className={`${pill} justify-self-start bg-accent text-white disabled:opacity-40`}>
          {m["action.save"]}
        </button>
      ) : null}
    </section>
  );
}
