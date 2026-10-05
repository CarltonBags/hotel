import { channelOverview } from "@hoteloftware/db";
import { can, channelStatusText } from "@hoteloftware/domain";
import { ActionForm, Field } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { connectChannelsAction, fullPushAction } from "./actions";

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
  const { connection, status, mappings } = await channelOverview(pool(), tenant.schemaName, property.id);
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: property.timeZone }).format(d);
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
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
