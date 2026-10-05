import Link from "next/link";
import { channelOverview, channelProblems, channelSettings } from "@hoteloftware/db";
import { can, channelStatusText } from "@hoteloftware/domain";
import { ActionForm, Field } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { channelSettingAction, connectChannelsAction, fullPushAction, googleAction, resolveProblemAction } from "./actions";

/** The channel manager connection of the property in the navbar (ticket 37): connect, what is mapped, what waits, failures. */
export default async function ChannelsPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_channels"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("manage_rates", property.id);
  const [{ connection, status, mappings }, settings, problems] = await Promise.all([channelOverview(pool(), tenant.schemaName, property.id), channelSettings(pool(), tenant.schemaName, property.id), channelProblems(pool(), tenant.schemaName, property.id)]);
  const canSet = can(actor, "manage_property_settings", property.id);
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const settingForm = (x: { channel: string; pricesIncludeVat: boolean; pricesIncludeCityTax: boolean; sendConfirmation: boolean; paidViaTool: boolean } | null) => (
    <ActionForm key={x?.channel ?? "new"} action={channelSettingAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3">
      {hidden}
      {x ? <input type="hidden" name="channel" value={x.channel} /> : null}
      {x ? <span className="min-w-32 font-medium">{x.channel}</span> : <Field label={m["channels.channelName"]} name="channel" required />}
      {(
        [
          ["vat", m["channels.includesVat"], x?.pricesIncludeVat ?? true],
          ["cityTax", m["channels.includesCityTax"], x?.pricesIncludeCityTax ?? false],
          ["confirmation", m["channels.ourConfirmation"], x?.sendConfirmation ?? true],
          ["tool", m["channels.paidViaTool"], x?.paidViaTool ?? false],
        ] as const
      ).map(([name, label, on]) => (
        <label key={name} className="flex items-center gap-1">
          <input type="hidden" name={name} value="off" />
          <input type="checkbox" name={name} defaultChecked={on} /> {label}
        </label>
      ))}
    </ActionForm>
  );
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: property.timeZone }).format(d);
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.settings_channels"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["channels.help"]}</p>
      </div>
      {connection?.externalId ? (
        <section className="grid gap-2 rounded-2xl bg-surface-2 p-5 text-sm" data-connection>
          <p>
            {m["channels.connectedSince"]} {when(connection.connectedAt)} · Channex {connection.externalId}
          </p>
          <p className={status.failing ? "text-red-700" : "text-ink-60"} data-channel-status={status.failing ? "failing" : status.pending ? "sending" : "up_to_date"}>
            {channelStatusText(status, language)}
            {status.failing && status.lastError ? ` · ${status.lastError}` : ""}
          </p>
          {status.refused ? <p className="text-red-700" data-refused>{status.refused} {m["channels.refused"]}</p> : null}
          {connection.closedAt ? <p className="text-red-700" data-closed>{m["channels.closed"]}</p> : null}
          {connection.fullPushAt ? <p className="text-ink-60">{m["channels.fullPush"]} {when(connection.fullPushAt)}</p> : null}
          <h2 className="mt-2 font-medium">{m["channels.mapped"]}</h2>
          <ul className="grid gap-1" data-mappings>
            {mappings.map((x) => (
              <li key={x.externalId}>
                {x.ratePlanName ? `${x.ratePlanName} · ${x.roomTypeName}` : x.roomTypeName} <span className="text-xs text-ink-60">{x.externalId}</span>
              </li>
            ))}
          </ul>
          <ActionForm action={fullPushAction} submitLabel={m["channels.pushAll"]} pendingLabel={m["action.saving"]} className="contents">
            {hidden}
          </ActionForm>
        </section>
      ) : null}
      {problems.length ? (
        <section className="grid gap-2 rounded-2xl bg-surface-2 p-5 text-sm" data-channel-problems>
          <h2 className="font-medium">{m["channels.problems"]}</h2>
          <ul className="grid gap-2">
            {problems.map((p) => (
              <li key={p.revisionId} className="grid gap-1 rounded-xl bg-surface p-3" data-problem={p.outcome}>
                <span className={p.outcome === "refused" ? "text-red-700" : "text-amber-700"}>
                  {p.channel} · {when(p.at)}
                </span>
                <span>{p.message}</span>
                <div className="flex gap-2">
                  {p.reservationId ? <Link href={`/reservations/${p.reservationId}`} className="text-accent underline">{m["channels.openBooking"]}</Link> : null}
                  <ActionForm action={resolveProblemAction} submitLabel={m["channels.resolved"]} pendingLabel={m["action.saving"]} className="contents">
                    {hidden}
                    <input type="hidden" name="revisionId" value={p.revisionId} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {connection?.externalId ? (
        <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-channel-settings>
          <h2 className="font-medium">{m["channels.perChannel"]}</h2>
          <p className="text-ink-60">{m["channels.perChannelHelp"]}</p>
          {canSet ? (
            <>
              {settings.map((x) => settingForm(x))}
              {settingForm(null)}
            </>
          ) : (
            <ul>
              {settings.map((x) => (
                <li key={x.channel}>{x.channel}</li>
              ))}
            </ul>
          )}
          <h2 className="mt-2 font-medium">Google</h2>
          <p className="text-ink-60">{m["channels.googleHelp"]}</p>
          {canSet ? (
            <ActionForm action={googleAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="flex items-center gap-3" >
              {hidden}
              <label className="flex items-center gap-2" data-google>
                <input type="hidden" name="google" value="off" />
                <input type="checkbox" name="google" defaultChecked={connection.google} /> {m["channels.googleOn"]}
              </label>
            </ActionForm>
          ) : null}
        </section>
      ) : can(actor, "manage_property_settings", property.id) ? (
        <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-connect>
          <p>{m["channels.connectHelp"]}</p>
          <ActionForm action={connectChannelsAction} submitLabel={m["channels.connect"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-3">
            {hidden}
            <Field label={m["channels.email"]} name="email" type="email" required />
          </ActionForm>
        </section>
      ) : (
        <p className="text-ink-60">{m["channels.notConnected"]}</p>
      )}
    </div>
  );
}
