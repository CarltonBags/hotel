import { listDevices, pinEvents, pinStates } from "@hoteloftware/auth";
import QRCode from "qrcode";
import { listTenantUsers, lobbyToken } from "@hoteloftware/db";
import { can, canUsePin, mayLookAfterPinUser, pinRolesFor } from "@hoteloftware/domain";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { tenantUrl } from "@/lib/env";
import { loadShell } from "@/lib/shell";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { createPinUserAction, deviceUsersAction, idleAction, resetPinAction, revokeAction } from "./actions";
import { EnrolForm } from "./enrol-form";

/** Devices and PIN users of the property (ticket 14). */
export default async function DevicesSettingsPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_devices"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("manage_floor_users", property.id);
  const manager = can(actor, "manage_devices", property.id);
  const [users, devices, pins] = await Promise.all([listTenantUsers(pool(), tenant.id), manager ? listDevices(pool(), tenant.id, property.id) : [], pinStates(pool(), tenant.id)]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  // people who sign in by PIN here; the Housekeeping Supervisor looks after Housekeepers
  const floor = users.filter((u) => !u.pendingInvitation && canUsePin({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, property.id));
  const roleAt = (u: (typeof users)[number]) => u.propertyRoles.filter((r) => r.propertyId === property.id).map((r) => r.role);
  const mine = floor.filter((u) => mayLookAfterPinUser(actor, { tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }));
  const events = await pinEvents(pool(), tenant.id, mine.map((u) => u.id));
  const when = (d: Date | null) => (d ? new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone }).format(d) : "–");
  const deviceName = new Map(devices.map((d) => [d.id, d.name]));
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const floorIds = new Set(floor.map((u) => u.id));
  // the lobby QR code for Self Check-in on the phone (ticket 49), from the configured domain
  const token = manager ? await lobbyToken(pool(), tenant.schemaName, property.id) : null;
  const lobbyUrl = token ? tenantUrl(tenant.slug, `/here/${token}`) : null;
  const lobbyQr = lobbyUrl ? await QRCode.toString(lobbyUrl, { type: "svg", margin: 1 }) : null;
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.settings_devices"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["dev.help"]}</p>
      </div>

      {manager ? (
        <>
          <section aria-label={m["dev.enrolTitle"]} className={section}>
            <h2 className="font-medium">{m["dev.enrolTitle"]}</h2>
            <EnrolForm
              propertyId={property.id}
              people={floor.map((u) => ({ id: u.id, name: u.name }))}
              labels={{ name: m["dev.name"], kind: m["dev.kind"], staff: m["dev.kind.staff"], guest: m["dev.kind.guest"], kiosk: m["dev.kind.kiosk"], shared: m["dev.shared"], owner: m["dev.owner"], who: m["dev.allowed"], create: m["dev.createCode"], pending: m["action.saving"], scan: m["dev.scan"], until: m["dev.validUntil"] }}
            />
          </section>

          {lobbyQr && lobbyUrl ? (
            <section aria-label={m["sci.lobbyQr"]} className={section} data-lobby-qr>
              <h2 className="font-medium">{m["sci.lobbyQr"]}</h2>
              <p className="text-ink-60">{m["sci.lobbyQrHelp"]}</p>
              {/* the SVG is made on our server from our own link */}
              <div className="w-40 bg-white p-2" dangerouslySetInnerHTML={{ __html: lobbyQr }} />
              <p className="break-all text-xs text-ink-60">{lobbyUrl}</p>
            </section>
          ) : null}

          <section aria-label={m["dev.list"]} className={section}>
            <h2 className="font-medium">{m["dev.list"]}</h2>
            {devices.length ? null : <p className="text-ink-60">{m["dev.none"]}</p>}
            {devices.map((d) => (
              <div key={d.id} className={`grid gap-2 rounded-xl bg-surface p-3 ${d.revokedAt ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-ink-60">{d.kind === "guest" && d.guestMode === "kiosk" ? m["dev.kind.kiosk"] : m[`dev.kind.${d.kind}`]}</span>
                  {d.ownerUserId ? <span>{`${m["dev.owner"]}: ${name.get(d.ownerUserId) ?? "?"}`}</span> : null}
                  <span>{`${m["dev.lastUse"]}: ${when(d.lastSeenAt)}`}</span>
                  <span>{`${m["dev.lastUser"]}: ${d.lastUserId ? (name.get(d.lastUserId) ?? "?") : "–"}`}</span>
                  {d.revokedAt ? <span className="text-danger">{`${m["dev.revokedAt"]} ${when(d.revokedAt)}`}</span> : null}
                </div>
                {!d.revokedAt && d.kind === "staff" && !d.ownerUserId ? (
                  <details>
                    <summary className="cursor-pointer text-accent">{`${m["dev.allowed"]} (${d.userIds.length})`}</summary>
                    <ActionForm action={deviceUsersAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="mt-2 grid gap-2">
                      {hidden}
                      <input type="hidden" name="deviceId" value={d.id} />
                      <div className="flex flex-wrap gap-3">
                        {floor.map((u) => (
                          <label key={u.id} className="flex items-center gap-1">
                            <input type="checkbox" name="userIds" value={u.id} defaultChecked={d.userIds.includes(u.id)} /> {u.name}
                          </label>
                        ))}
                        {d.userIds.filter((id) => !floorIds.has(id)).map((id) => (
                          <label key={id} className="flex items-center gap-1 text-ink-60">
                            <input type="checkbox" name="userIds" value={id} defaultChecked /> {name.get(id) ?? "?"}
                          </label>
                        ))}
                      </div>
                    </ActionForm>
                  </details>
                ) : null}
                {!d.revokedAt ? (
                  <ActionForm action={revokeAction} submitLabel={m["dev.revoke"]} pendingLabel={m["action.saving"]} className="flex items-center gap-2">
                    {hidden}
                    <input type="hidden" name="deviceId" value={d.id} />
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </section>

          <section aria-label={m["dev.idle"]} className={section}>
            <ActionForm action={idleAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-3">
              {hidden}
              <Select label={m["dev.idle"]} name="minutes" defaultValue={String(property.deviceIdleMinutes)} options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} min` }))} />
            </ActionForm>
          </section>
        </>
      ) : null}

      <section aria-label={m["dev.pinUsers"]} className={section}>
        <h2 className="font-medium">{m["dev.pinUsers"]}</h2>
        <p className="text-xs text-ink-60">{m["dev.pinUsersHelp"]}</p>
        {mine.map((u) => {
          const pin = pins.get(u.id);
          return (
            <div key={u.id} className="flex flex-wrap items-end gap-3 rounded-xl bg-surface p-3">
              <div className="grid min-w-40">
                <span className="font-medium">{u.name}</span>
                <span className="text-xs text-ink-60">
                  {u.username} · {roleAt(u).map((r) => m[`role.${r}`]).join(", ")}
                </span>
                <span className={`text-xs ${pin?.locked ? "text-danger" : "text-ink-60"}`}>{!pin ? m["dev.noPin"] : pin.locked ? m["dev.locked"] : pin.mustChange ? m["dev.mustChange"] : m["dev.pinSet"]}</span>
              </div>
              <ActionForm action={resetPinAction} submitLabel={pin?.locked ? m["dev.unlock"] : m["dev.resetPin"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
                {hidden}
                <input type="hidden" name="userId" value={u.id} />
                <Field label={m["dev.firstPin"]} name="pin" type="password" autoComplete="new-password" required />
              </ActionForm>
            </div>
          );
        })}
        <details>
          <summary className="cursor-pointer text-accent">{m["dev.newPinUser"]}</summary>
          <ActionForm action={createPinUserAction} submitLabel={m["dev.newPinUser"]} pendingLabel={m["action.saving"]} className="mt-2 grid gap-3 sm:grid-cols-2">
            {hidden}
            <Field label={m["dev.personName"]} name="name" required />
            <Field label={m["dev.username"]} name="username" required />
            <Select label={m["dev.role"]} name="role" options={pinRolesFor(actor, property.id).map((r) => ({ value: r, label: m[`role.${r}`] }))} />
            <Field label={m["dev.firstPin"]} name="pin" type="password" autoComplete="new-password" required />
          </ActionForm>
        </details>
      </section>

      <section aria-label={m["dev.events"]} className={section}>
        <h2 className="font-medium">{m["dev.events"]}</h2>
        <ul className="grid gap-1">
          {events.map((e, i) => (
              <li key={i}>
                {when(e.at)} · {name.get(e.userId) ?? "?"} · {m[`dev.event.${e.kind}`]}
                {e.deviceId ? ` · ${deviceName.get(e.deviceId) ?? m["dev.aDevice"]}` : ""}
                {e.byUserId && e.byUserId !== e.userId ? ` · ${name.get(e.byUserId) ?? "?"}` : ""}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
