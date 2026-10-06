import { listWhatsAppTemplates, whatsAppConnection, whatsAppUsage } from "@hoteloftware/db";
import { FakeWhatsAppProvider, whatsAppProvider } from "@hoteloftware/messaging";
import { todayIn } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { fill } from "@/i18n/messages";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { connectTestAction, templateAction } from "./actions";
import { EmbeddedSignup } from "./signup";

/** The WhatsApp Module of the property in view (ticket 44): the hotel's own number, its templates and their review, this month's usage. */
export default async function WhatsAppSettingsPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_whatsapp"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_property_settings", property.id);
  const [connection, templates, usage] = await Promise.all([
    whatsAppConnection(pool(), tenant.schemaName, property.id),
    listWhatsAppTemplates(pool(), tenant.schemaName, property.id),
    whatsAppUsage(pool(), tenant.id, property.id, todayIn(property.timeZone).slice(0, 7)),
  ]);
  const fake = whatsAppProvider() instanceof FakeWhatsAppProvider && process.env.NODE_ENV !== "production";
  const appId = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
  const configId = process.env.NEXT_PUBLIC_META_SIGNUP_CONFIG_ID ?? "";
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const date = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeZone: property.timeZone }).format(d);
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.settings_whatsapp"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["wa.help"]}</p>
      </div>
      <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-wa-connection>
        {connection ? <p data-connected>{fill(m["wa.connected"], { number: connection.displayNumber, date: date(connection.connectedAt) })}</p> : <p>{m["wa.notConnected"]}</p>}
        <p className="text-ink-60">{m["wa.guide"]}</p>
        {appId && configId ? <EmbeddedSignup propertyId={property.id} appId={appId} configId={configId} labels={{ keep: m["wa.connectKeep"], fresh: m["wa.connectNew"] }} /> : null}
        {fake && !connection ? (
          <ActionForm action={connectTestAction} submitLabel={m["wa.connectTest"]} className="flex">
            {hidden}
          </ActionForm>
        ) : null}
        {connection ? <p className="text-ink-60" data-usage>{fill(m["wa.usage"], { n: String(usage) })}</p> : null}
      </section>
      {templates.length ? (
        <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-wa-templates>
          <h2 className="font-medium">{m["wa.templates"]}</h2>
          <p className="text-ink-60">{m["wa.templatesHelp"]}</p>
          {templates.map((t) => (
            <ActionForm key={t.id} action={templateAction} submitLabel={m["wa.save"]} pendingLabel={m["action.saving"]} className="grid gap-2 rounded-xl bg-surface p-3">
              {hidden}
              <input type="hidden" name="templateId" value={t.id} />
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m[`messages.type.${t.type}`]}</span>
                <span className="uppercase text-ink-60">{t.language}</span>
                <span data-template-status={t.status} className={`rounded-full px-2 text-[12px] ${t.status === "approved" ? "bg-success/15" : t.status === "rejected" ? "bg-danger/15" : "bg-warning/20"}`}>
                  {m[`wa.status.${t.status}`]}
                </span>
                {t.reason ? <span className="text-danger">{t.reason}</span> : null}
              </p>
              <textarea name="text" rows={5} defaultValue={t.text} maxLength={1024} className="rounded-xl border border-ink-10 bg-surface-2 p-2" />
            </ActionForm>
          ))}
        </section>
      ) : null}
    </div>
  );
}
