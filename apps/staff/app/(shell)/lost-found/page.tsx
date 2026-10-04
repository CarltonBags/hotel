import { listLostItems, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { ActionForm, Select } from "@/components/form-fields";
import { lostItemStatusAction } from "./actions";

/** Lost and Found (ticket 35): items found in rooms, recorded from the phone with a photo. */
export default async function LostFoundPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.lost_found"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("view_lost_items", property.id);
  const [items, users] = await Promise.all([listLostItems(pool(), tenant.schemaName, property.id), listTenantUsers(pool(), tenant.id)]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone }).format(d);
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-6">
      <h1 className="text-xl font-medium">
        {m["module.lost_found"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      {items.length ? null : <p className="text-ink-60">{m["lost.none"]}</p>}
      {items.map((i) => (
        <div key={i.id} data-lost={i.roomNumber} className="flex flex-wrap items-center gap-4 rounded-2xl bg-surface-2 p-4 text-sm">
          {i.hasPhoto ? <img src={`/floor-photo/lost/${i.id}`} alt="" className="size-20 rounded-xl object-cover" /> : null}
          <div className="grid min-w-48 flex-1">
            <span className="font-medium">
              {m["lost.room"]} {i.roomNumber} · {m[`lost.pick.${i.pick}`]}
            </span>
            {i.note ? <span>{i.note}</span> : null}
            <span className="text-xs text-ink-60">
              {when(i.foundAt)} · {name.get(i.foundBy) ?? "?"}
            </span>
          </div>
          <ActionForm action={lostItemStatusAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="flex items-end gap-2">
            <input type="hidden" name="propertyId" value={property.id} />
            <input type="hidden" name="id" value={i.id} />
            <Select label={m["lost.status"]} name="status" defaultValue={i.status} options={(["kept", "returned", "disposed"] as const).map((s) => ({ value: s, label: m[`lost.status.${s}`] }))} />
          </ActionForm>
        </div>
      ))}
    </div>
  );
}
