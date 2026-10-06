import Link from "next/link";
import { MAX_COMPANIONS, expressCheckoutView, portalConversation, portalView } from "@hoteloftware/db";
import { cardLabel, extrasOpen, portalLanguage, type PortalLanguage } from "@hoteloftware/domain";
import { headers } from "next/headers";
import { portalText, type PortalKey } from "@/i18n/portal";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { extraAction, inviteAction, precheckinAction } from "../actions";
import { ExtraForm, InviteForm, PrecheckinForm } from "../forms";
import { Glass } from "../glass";
import { PortalMessages } from "../messages";
import { CheckoutButton, PayPanel } from "../pay-panel";

export const dynamic = "force-dynamic";

/** The Guest Portal (ticket 40): the stay of a Portal Link, or the Booker's whole booking. */
export default async function PortalPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { key } = await params;
  const asked = (await searchParams).lang;
  const tenant = await currentTenant();
  const view = tenant ? await portalView(pool(), tenant.schemaName, key) : null;
  if (!view) return <NotFound language={portalLanguage(asked, (await headers()).get("accept-language"))} />;
  const language = portalLanguage(asked, view.language);
  const t = (k: PortalKey, v?: Record<string, string | number>) => portalText(language, k, v);
  const locale = language === "de" ? "de-DE" : "en-GB";
  const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const money = (n: number) => n.toLocaleString(locale, { style: "currency", currency: view.property.currency });
  const nights = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const other: PortalLanguage = language === "de" ? "en" : "de";
  const thread = await portalConversation(pool(), tenant!.schemaName, key);
  const messages = thread ? <PortalMessages portalKey={key} language={language} messages={thread} timeZone={view.property.timeZone} /> : null;
  // the property's own landscape behind the card, when it set one
  const wallpaper = view.property.photoFileId ? <div aria-hidden className="fixed inset-0 -z-0 bg-cover bg-center opacity-80" style={{ backgroundImage: `url(/g/${key}/photo)` }} /> : null;
  const header = (
    <header className="relative flex items-center justify-between" lang={language}>
      <p className="text-sm uppercase tracking-[0.2em] text-white/70">{view.property.name}</p>
      <Link href={`/g/${key}?lang=${other}`} className="text-sm text-white/70 underline">
        {t("language")}
      </Link>
    </header>
  );

  if (view.kind === "booking") {
    return (
      <>
        {wallpaper}
        {header}
        <Glass data-booking>
          <h1 className="text-2xl font-semibold">{t("rooms")}</h1>
          <p className="text-white/70">
            {t("booking")} {view.confirmationNumber} · {view.bookerName}
          </p>
        </Glass>
        {view.stays.map((s) => (
          <Glass key={s.reservationId} data-room={s.reservationId}>
            <p className="font-medium">
              {s.roomType} · {s.guestName}
            </p>
            <p className="text-sm text-white/70">
              {date(s.arrival)} – {date(s.departure)}
              {s.precheckinAt ? ` · ${t("precheckinDone")}` : ""}
            </p>
            {s.status === "confirmed" ? <InviteForm action={inviteAction.bind(null, key)} language={language} reservationId={s.reservationId} /> : null}
          </Glass>
        ))}
        {messages}
        <p className="text-center text-xs text-white/50">{t("noChange")}</p>
      </>
    );
  }

  const s = view.stay;
  const g = s.guest;
  const open = s.status === "confirmed";
  const info = view.property.info[language] ?? view.property.info.en ?? view.property.info.de ?? "";
  const express = await expressCheckoutView(pool(), tenant!.schemaName, key);
  const payable = s.status === "confirmed" || s.status === "checked_in";
  return (
    <>
      {wallpaper}
      {header}
      <Glass data-stay>
        <p className="text-sm text-white/60">{t("title")}</p>
        <h1 className="text-3xl font-semibold leading-tight">
          {date(s.arrival)} – {date(s.departure)}
        </h1>
        <p className="text-white/80">
          {nights(s.arrival, s.departure) === 1 ? t("night") : t("nights", { n: nights(s.arrival, s.departure) })} · {s.roomType} · {s.adults + s.childAges.length === 1 ? t("guest") : t("guests", { n: s.adults + s.childAges.length })}
        </p>
        <p className="text-sm text-white/60">
          {t("booking")} {s.confirmationNumber}
        </p>
        {s.status === "cancelled" ? <p className="text-red-300">{t("cancelled")}</p> : null}
      </Glass>

      {open ? (
        <Glass data-section="precheckin">
          <h2 className="text-xl font-semibold">{s.precheckinAt ? t("precheckinDone") : t("precheckin")}</h2>
          {/* a form signed by hand: the registration ends at reception (Germany; Swiss cantons asking it) */}
          {view.property.registrationAtReception ? <p className="text-sm text-white/70" data-at-reception>{t("registrationAtReception")}</p> : null}
          <p className="text-sm text-white/70">{t("precheckinHelp")}</p>
          <PrecheckinForm
            action={precheckinAction.bind(null, key)}
            language={language}
            persons={s.adults + s.childAges.length}
            documentImages={view.property.documentImages}
            maxCompanions={MAX_COMPANIONS}
            values={{
              firstName: g.firstName,
              lastName: g.lastName,
              dateOfBirth: g.dateOfBirth,
              nationality: g.nationality,
              countryOfResidence: g.countryOfResidence,
              addressLine1: g.addressLine1,
              postalCode: g.postalCode ?? "",
              city: g.city,
              phone: g.phone ?? "",
              documentType: g.documentType,
              documentNumber: g.documentNumber ?? "",
              documentCountry: g.documentCountry,
              documentExpiry: g.documentExpiry,
              arrivalTime: s.arrivalTime,
              companions: s.companions,
              consent: s.emailConsent ?? false,
              whatsAppConsent: view.property.whatsapp ? (s.whatsAppConsent ?? false) : null,
            }}
          />
        </Glass>
      ) : null}

      {express.open || express.checkedOut ? (
        <Glass data-section="express">
          <h2 className="text-xl font-semibold">{t("express")}</h2>
          <p className="text-sm text-white/70">{t("expressHelp")}</p>
          <ul className="grid gap-1 text-sm" data-folio>
            {express.lines.map((l, i) => (
              <li key={i} className="flex justify-between">
                <span>{l.description === "Payment" ? t("payment") : l.description}</span>
                <span>{money(l.amount)}</span>
              </li>
            ))}
          </ul>
          {express.checkedOut ? (
            <div className="grid gap-1" data-checked-out>
              <p>{t("checkedOutDone")}</p>
              {express.invoices.map((i) => (
                <a key={i.id} href={`/g/${key}/invoice/${i.id}`} className="underline">
                  {i.number}
                </a>
              ))}
            </div>
          ) : express.balance > 0 ? null : express.requestedAt ? <p data-asked-desk>{t("askedDesk")}</p> : <CheckoutButton portalKey={key} language={language} />}
        </Glass>
      ) : null}

      {payable && (s.amountDue > 0 || !s.guarantee) ? (
        <Glass data-section="pay">
          <h2 className="text-xl font-semibold">{t("payTitle")}</h2>
          {s.guarantee ? <p className="text-sm text-white/70">{t("cardGuarantee", { card: cardLabel(s.guarantee.brand, s.guarantee.last4) })}</p> : null}
          <PayPanel portalKey={key} language={language} amountText={money(s.amountDue)} due={s.amountDue > 0} canStore={!s.guarantee} />
        </Glass>
      ) : null}

      {extrasOpen(s.status, s.arrival, view.today) && s.extras.length ? (
        <Glass data-section="extras">
          <h2 className="text-xl font-semibold">{t("extras")}</h2>
          <p className="text-sm text-white/70">{t("extrasHelp")}</p>
          {s.extras.map((x) => (
            <ExtraForm key={x.id} action={extraAction.bind(null, key)} language={language} serviceId={x.id} label={`${x.name} · ${money(x.price)}`} />
          ))}
          {s.added.length ? (
            <ul className="grid gap-1 text-sm text-white/80" data-added>
              {s.added.map((a, i) => (
                <li key={i}>
                  {t("added")}: {a.quantity} × {a.description} · {money(a.amount)}
                </li>
              ))}
            </ul>
          ) : null}
        </Glass>
      ) : null}

      {s.invoices.length ? (
        <Glass data-section="invoices">
          <h2 className="text-xl font-semibold">{t("invoices")}</h2>
          <ul className="grid gap-2">
            {s.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between">
                <span>
                  {i.number} · {money(i.gross)}
                </span>
                <a href={`/g/${key}/invoice/${i.id}`} className="underline">
                  {t("download")}
                </a>
              </li>
            ))}
          </ul>
        </Glass>
      ) : null}

      {info ? (
        <Glass data-section="info">
          <h2 className="text-xl font-semibold">{t("info")}</h2>
          <p className="whitespace-pre-line text-white/85">{info}</p>
        </Glass>
      ) : null}
      {messages}
      <p className="text-center text-xs text-white/50">{t("noChange")}</p>
    </>
  );
}

function NotFound({ language }: { language: PortalLanguage }) {
  return (
    <Glass data-not-found>
      <p className="text-lg">{portalText(language, "notFound")}</p>
      <Link href={`/g/find?lang=${language}`} className="underline">
        {portalText(language, "findTitle")}
      </Link>
    </Glass>
  );
}
