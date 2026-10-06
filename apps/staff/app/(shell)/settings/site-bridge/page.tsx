import { bridgePluginVersions, siteBridges } from "@hoteloftware/db";
import { formatDateTime } from "@hoteloftware/domain";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { enrollBridgeAction, pushPluginAction, revokeBridgeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The Site Bridge (ticket 68, ADR 0014): the small program on the hotel's
 * lock PC that reaches lock systems (and tills) on the hotel's network,
 * calling out only. Enrolled here with a token; its health, plugins and
 * plugin updates are shown and pushed from here.
 */
export default async function SiteBridgePage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_site_bridge"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = await requireAllowed("manage_property_settings", property.id);
  const [bridges, versions] = await Promise.all([siteBridges(pool(), tenant.schemaName, property.id, { userId: session.user.id, actor }), bridgePluginVersions(pool())]);
  const when = (iso: string) => formatDateTime(new Date(iso), language, "DE", property.timeZone);
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <h1 className="text-xl font-medium">
        {m["module.settings_site_bridge"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      <p className="text-sm text-ink-60">{m["bridge.help"]}</p>
      {bridges.map((b) => (
        <section key={b.id} className={section} data-bridge={b.name} data-online={b.online ? "yes" : "no"}>
          <h2 className="flex flex-wrap items-center gap-2 font-medium">
            {b.name}
            <span className={`rounded-full px-2 text-xs ${b.online ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>{b.online ? m["bridge.online"] : m["bridge.offline"]}</span>
          </h2>
          <p className="text-ink-60">
            {b.lastSeenAt ? `${m["bridge.lastSeen"]} ${when(b.lastSeenAt)}` : m["bridge.neverSeen"]}
            {b.version ? ` · ${m["bridge.version"]} ${b.version}` : ""}
          </p>
          <ul className="grid gap-1" data-bridge-plugins>
            {b.plugins.map((p) => (
              <li key={p.name} data-plugin={p.name} data-version={p.version}>
                {p.name} {p.version} · {p.health ? `${p.health.ok ? "✓" : "✗"} ${p.health.detail}` : "–"}
                {b.wanted[p.name] && b.wanted[p.name] !== p.version ? ` · ${m["bridge.installing"]} ${b.wanted[p.name]}` : ""}
              </li>
            ))}
          </ul>
          {versions.length ? (
            <ActionForm action={pushPluginAction} submitLabel={m["bridge.push"]} className="flex flex-wrap items-end gap-2">
              {hidden}
              <input type="hidden" name="bridgeId" value={b.id} />
              <Select label={m["bridge.plugin"]} name="plugin" options={versions.map((v) => ({ value: `${v.name}@${v.version}`, label: `${v.name} ${v.version}` }))} defaultValue={`${versions.at(-1)!.name}@${versions.at(-1)!.version}`} />
            </ActionForm>
          ) : null}
          <ActionForm action={revokeBridgeAction} submitLabel={m["bridge.revoke"]} className="grid gap-2">
            {hidden}
            <input type="hidden" name="bridgeId" value={b.id} />
          </ActionForm>
        </section>
      ))}
      <section className={section} data-new-bridge>
        <h2 className="font-medium">{m["bridge.enroll"]}</h2>
        <p className="text-ink-60">{m["bridge.enrollHelp"]}</p>
        <ActionForm action={enrollBridgeAction} submitLabel={m["bridge.enrollButton"]} className="flex flex-wrap items-end gap-2">
          {hidden}
          <Field label={m["bridge.name"]} name="name" required />
        </ActionForm>
      </section>
    </div>
  );
}
