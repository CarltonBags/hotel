import type { ThreadMessage } from "@hoteloftware/db";
import type { PortalLanguage } from "@hoteloftware/domain";
import { portalText } from "@/i18n/portal";
import { Glass } from "./glass";
import { GuestMessageForm, PortalPoll } from "./messages-form";
import { guestMessageAction } from "./messages-actions";

/** The Conversation in the Guest Portal (ticket 42): the hotel's and the guest's messages and the automatic ones; no Internal Notes. */
export function PortalMessages({ portalKey, language, messages, timeZone }: { portalKey: string; language: PortalLanguage; messages: ThreadMessage[]; timeZone: string }) {
  const t = (k: Parameters<typeof portalText>[1]) => portalText(language, k);
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone }).format(d);
  return (
    <Glass data-section="messages">
      <h2 className="text-xl font-semibold">{t("messagesTitle")}</h2>
      <p className="text-sm text-white/70">{t("messagesHelp")}</p>
      <ol className="grid gap-2" data-thread>
        {messages.length === 0 ? <li className="text-sm text-white/60">{t("messagesEmpty")}</li> : null}
        {messages.map((m) => (
          <li key={m.id} data-message={m.kind} className={`grid max-w-[85%] gap-1 rounded-2xl px-4 py-2 text-sm ${m.kind === "guest" ? "justify-self-end bg-white/85 text-black" : m.kind === "auto" ? "bg-white/5 text-white/80" : "bg-white/15"}`}>
            <span className="text-[11px] opacity-70">
              {m.kind === "guest" ? t("messageYou") : m.kind === "auto" ? t("messageAuto") : t("messageFromHotel")} · {when(m.at)}
            </span>
            {m.subject ? <span className="font-medium">{m.subject}</span> : null}
            {m.body ? <span className="whitespace-pre-wrap">{m.body}</span> : null}
            {m.fileId ? (
              m.fileType === "application/pdf" ? (
                <a href={`/g/${portalKey}/file/${m.fileId}`} target="_blank" rel="noreferrer" className="underline">
                  {t("messagePdf")}
                </a>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/g/${portalKey}/file/${m.fileId}`} alt="" className="max-h-64 rounded-xl" />
              )
            ) : null}
          </li>
        ))}
      </ol>
      <GuestMessageForm action={guestMessageAction.bind(null, portalKey)} language={language} />
      <PortalPoll seconds={20} />
    </Glass>
  );
}
