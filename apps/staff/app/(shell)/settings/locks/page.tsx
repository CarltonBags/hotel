import { listDevices } from "@hoteloftware/auth";
import { lockSetup } from "@hoteloftware/db";
import { KEY_HANDOVERS } from "@hoteloftware/domain";
import { selectableLockSystems } from "@hoteloftware/locks";
import type { Messages } from "@/i18n/messages";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { lockDeps } from "@/lib/locks";
import { loadShell } from "@/lib/shell";
import { deskEncodersAction, lockDoorsAction, lockSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Door locks (ticket 67): the property's lock system and key handover, each
 * room's door at the lock system, and the encoder each desk workstation
 * writes key cards on. Only what the system's plugin supports is offered.
 */
export default async function LockSettingsPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_locks"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = await requireAllowed("manage_property_settings", property.id);
  const [setup, devices] = await Promise.all([lockSetup(pool(), tenant.schemaName, property.id, { userId: session.user.id, actor }, lockDeps()), listDevices(pool(), tenant.id, property.id)]);
  const desks = devices.filter((d) => d.kind === "staff" && !d.revokedAt);
  const label = (k: string) => m[k as keyof Messages] ?? k;
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const plugin = setup.capabilities !== null;
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <h1 className="text-xl font-medium">
        {m["module.settings_locks"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      <section className={section} data-lock-settings>
        <ActionForm action={lockSettingsAction} submitLabel={m["action.save"]} className="grid gap-3 sm:grid-cols-2">
          {hidden}
          <Select label={m["locks.system"]} name="system" options={selectableLockSystems().map((s) => ({ value: s, label: label(`locks.system.${s}`) }))} defaultValue={setup.system} />
          <Field label={m["locks.otherName"]} name="otherName" defaultValue={setup.otherName} />
          <Field label={m["locks.bridgePlugin"]} name="bridgePlugin" defaultValue={setup.bridgePlugin} />
          <Select label={m["locks.handover"]} name="handover" options={KEY_HANDOVERS.map((h) => ({ value: h, label: label(`locks.handover.${h}`) }))} defaultValue={setup.handover} />
          <Field label={m["locks.grace"]} name="graceMinutes" type="number" defaultValue={String(setup.graceMinutes)} />
          <Field label={m["locks.secret"]} name="secret" type="password" defaultValue="" autoComplete="off" />
        </ActionForm>
        {setup.capabilities ? (
          <p className="text-ink-60" data-lock-capabilities>
            {m["locks.capabilities"]}:{" "}
            {[setup.capabilities.card ? m["keys.kind.card"] : null, setup.capabilities.pin ? m["keys.kind.pin"] : null, setup.capabilities.phoneKey ? m["keys.kind.phone"] : null].filter(Boolean).join(", ")}
          </p>
        ) : null}
        {setup.health ? (
          <p className={setup.health.ok ? "text-ink-60" : "text-danger"} data-lock-health>
            {m["locks.health"]}: {setup.health.ok ? "✓" : "✗"} {setup.health.detail}
          </p>
        ) : null}
      </section>
      {plugin ? (
        <section className={section} data-lock-doors>
          <h2 className="font-medium">{m["locks.doors"]}</h2>
          <ActionForm action={lockDoorsAction} submitLabel={m["action.save"]} className="grid gap-2 sm:grid-cols-3">
            {hidden}
            {setup.doors.map((d) => (
              <Field key={d.roomId} label={`${m["keys.room"]} ${d.number}`} name={`door_${d.roomId}`} defaultValue={d.lockRef} />
            ))}
          </ActionForm>
        </section>
      ) : null}
      {setup.capabilities?.encoders && desks.length ? (
        <section className={section} data-desk-encoders>
          <h2 className="font-medium">{m["locks.encoders"]}</h2>
          <ActionForm action={deskEncodersAction} submitLabel={m["action.save"]} className="grid gap-2 sm:grid-cols-2">
            {hidden}
            {desks.map((d) => (
              <Select key={d.id} label={d.name} name={`device_${d.id}`} options={[{ value: "", label: "–" }, ...setup.encoders.map((e) => ({ value: e.id, label: e.name }))]} defaultValue={setup.deskEncoders[d.id] ?? ""} />
            ))}
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
