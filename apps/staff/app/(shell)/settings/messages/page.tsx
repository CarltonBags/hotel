import { messageText, messagingSettings, previewMessage } from "@hoteloftware/db";
import { MESSAGE_LANGUAGES, MESSAGE_TYPES, MESSAGE_TYPE_INFO, PLACEHOLDERS, type MessageLanguage, type MessageType } from "@hoteloftware/domain";
import Link from "next/link";
import { ActionForm, Field } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { messageTextAction, messagingSettingsAction, resetMessageTextAction, senderDomainAction, testMessageAction } from "./actions";

/** Guest messages of the property in the navbar (ticket 39): Sending Hours, languages, which types go, the sender, and the texts with preview, test send and reset. */
export default async function MessagesSettingsPage({ searchParams }: { searchParams: Promise<{ type?: string; lang?: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_messages"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_property_settings", property.id);
  const q = await searchParams;
  const type: MessageType = (MESSAGE_TYPES as readonly string[]).includes(q.type ?? "") ? (q.type as MessageType) : "confirmation";
  const lang: MessageLanguage = (MESSAGE_LANGUAGES as readonly string[]).includes(q.lang ?? "") ? (q.lang as MessageLanguage) : "de";
  const s = await messagingSettings(pool(), tenant.schemaName, property.id);
  const text = await messageText(pool(), tenant.schemaName, property.id, type, lang);
  const preview = await previewMessage(pool(), tenant.schemaName, property.id, type, lang);
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const which = (
    <>
      {hidden}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="language" value={lang} />
    </>
  );
  const input = "h-9 rounded-xl border border-ink-10 bg-surface px-2";
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">{m["module.settings_messages"]}</h1>
        <p className="text-sm text-ink-60">{m["messages.help"]}</p>
      </div>

      <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-messaging-settings>
        <h2 className="font-medium">{m["messages.settings"]}</h2>
        <ActionForm action={messagingSettingsAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3">
          {hidden}
          <div className="flex flex-wrap items-end gap-3">
            <Field label={m["messages.hoursFrom"]} name="sendingFrom" type="time" defaultValue={s.sendingFrom} required />
            <Field label={m["messages.hoursTo"]} name="sendingTo" type="time" defaultValue={s.sendingTo} required />
            <Field label={m["messages.preArrivalDays"]} name="preArrivalDays" type="number" defaultValue={String(s.preArrivalDays)} required />
            <label className="grid gap-1">
              <span>{m["messages.fallbackLanguage"]}</span>
              <select name="fallbackLanguage" defaultValue={s.fallbackLanguage} className={input}>
                {MESSAGE_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <Field label={m["messages.replyTo"]} name="replyTo" type="email" defaultValue={s.replyTo ?? ""} />
          </div>
          <label className="flex items-center gap-2">
            <input type="hidden" name="useGuestLanguage" value="off" />
            <input type="checkbox" name="useGuestLanguage" defaultChecked={s.useGuestLanguage} /> {m["messages.useGuestLanguage"]}
          </label>
          <fieldset className="grid gap-1 sm:grid-cols-2">
            <legend className="mb-1 text-ink-60">{m["messages.types"]}</legend>
            {MESSAGE_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2" data-type-toggle={t}>
                {MESSAGE_TYPE_INFO[t].switchable ? (
                  <>
                    <input type="hidden" name={`on_${t}`} value="off" />
                    <input type="checkbox" name={`on_${t}`} defaultChecked={s.enabled[t]} />
                  </>
                ) : (
                  <input type="checkbox" checked disabled readOnly />
                )}
                {m[`messages.type.${t}`]}
                <span className="text-xs text-ink-60">{MESSAGE_TYPE_INFO[t].timing === "at_once" ? m["messages.atOnce"] : m["messages.inHours"]}</span>
              </label>
            ))}
          </fieldset>
        </ActionForm>
      </section>

      <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-sender>
        <h2 className="font-medium">{m["messages.sender"]}</h2>
        <p className="text-ink-60">{s.senderDomain && s.senderVerified ? `${s.senderLocal}@${s.senderDomain} · ${m["messages.verified"]}` : s.senderDomain ? `${s.senderLocal}@${s.senderDomain} · ${m["messages.notVerified"]}` : m["messages.platformSender"]}</p>
        <ActionForm action={senderDomainAction} submitLabel={m["messages.checkDomain"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-3">
          {hidden}
          <Field label={m["messages.senderLocal"]} name="local" defaultValue={s.senderLocal} required />
          <Field label={m["messages.senderDomain"]} name="domain" defaultValue={s.senderDomain ?? ""} />
        </ActionForm>
      </section>

      <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-template-editor>
        <h2 className="font-medium">{m["messages.texts"]}</h2>
        <nav className="flex flex-wrap gap-1">
          {MESSAGE_TYPES.map((t) => (
            <Link key={t} href={`/settings/messages?type=${t}&lang=${lang}`} className={`rounded-full px-3 py-1 ${t === type ? "bg-accent text-white" : "bg-surface"}`}>
              {m[`messages.type.${t}`]}
            </Link>
          ))}
        </nav>
        <nav className="flex gap-1">
          {MESSAGE_LANGUAGES.map((l) => (
            <Link key={l} href={`/settings/messages?type=${type}&lang=${l}`} className={`rounded-full px-3 py-1 ${l === lang ? "bg-accent text-white" : "bg-surface"}`}>
              {l.toUpperCase()}
            </Link>
          ))}
          <span className="ml-auto self-center text-xs text-ink-60">{text.edited ? m["messages.edited"] : m["messages.shipped"]}</span>
        </nav>
        <ActionForm action={messageTextAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-2">
          {which}
          <Field label={m["messages.subject"]} name="subject" defaultValue={text.subject} required />
          <label className="grid gap-1">
            <span>{m["messages.blocks"]}</span>
            <textarea name="blocks" rows={8} defaultValue={text.blocks.join("\n\n")} className="rounded-xl border border-ink-10 bg-surface p-2" />
          </label>
          <p className="text-xs text-ink-60">
            {m["messages.placeholders"]} {PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}
          </p>
        </ActionForm>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={testMessageAction} submitLabel={m["messages.testSend"]} pendingLabel={m["action.saving"]} className="contents">
            {which}
          </ActionForm>
          {text.edited ? (
            <ActionForm action={resetMessageTextAction} submitLabel={m["messages.reset"]} pendingLabel={m["action.saving"]} className="contents">
              {which}
            </ActionForm>
          ) : null}
        </div>
        <h3 className="mt-2 font-medium">{m["messages.preview"]}</h3>
        <p className="text-ink-60" data-preview-subject>
          {preview.subject}
        </p>
        <iframe title={m["messages.preview"]} srcDoc={preview.html} sandbox="" className="h-[28rem] w-full rounded-xl border border-ink-10 bg-white" data-preview />
      </section>
    </div>
  );
}
