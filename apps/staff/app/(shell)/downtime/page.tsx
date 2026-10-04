import { downtimeSet } from "@hoteloftware/db";
import { DOWNTIME_LISTS, can, type DowntimeList } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { DowntimeLists } from "@/components/downtime-lists";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { downtimeText } from "@/lib/downtime-text";
import { downtimeOptionsAction } from "./actions";
import { PrintButton } from "./print-button";

/** The Downtime Reports of the property in the navbar (ticket 86): the whole set in one print job, or one list alone. */
export default async function DowntimePage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.downtime_reports"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = await requireAllowed("use_downtime", property.id);
  const requested = (await searchParams).list;
  const lists: DowntimeList[] = DOWNTIME_LISTS.includes(requested as DowntimeList) ? [requested as DowntimeList] : [...DOWNTIME_LISTS];
  const set = await downtimeSet(pool(), tenant.schemaName, property.id);
  const printed = new Intl.DateTimeFormat(shell.language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: property.timeZone }).format(new Date());
  const o = set.options;
  return (
    <div className="grid gap-4 p-6 print:p-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="flex-1 text-xl font-medium">{m["module.downtime_reports"]}</h1>
        <nav className="flex flex-wrap gap-1 text-sm">
          <a href="/downtime" className={`rounded-full px-3 py-1 ${lists.length > 1 ? "bg-ink text-canvas" : "bg-surface-2"}`}>
            {m["downtime.all"]}
          </a>
          {DOWNTIME_LISTS.map((l) => (
            <a key={l} href={`/downtime?list=${l}`} className={`rounded-full px-3 py-1 ${lists.length === 1 && lists[0] === l ? "bg-ink text-canvas" : "bg-surface-2"}`}>
              {m[`downtime.list.${l}`]}
            </a>
          ))}
        </nav>
        <PrintButton label={m["downtime.print"]} propertyId={property.id} />
      </div>
      <DowntimeLists set={set} lists={lists} m={downtimeText(m)} />
      {/* on every printed page */}
      <footer className="hidden text-xs text-ink-60 print:fixed print:bottom-0 print:left-0 print:block" data-print-footer>
        {property.name} · {printed} · {session.user.name}
      </footer>
      {can(actor, "manage_downtime", property.id) ? (
        <details className="rounded-2xl bg-surface-2 p-4 text-sm print:hidden">
          <summary className="cursor-pointer font-medium">{m["downtime.settings"]}</summary>
          <ActionForm action={downtimeOptionsAction} submitLabel={m["action.save"]} className="mt-3 grid gap-3">
            <input type="hidden" name="propertyId" value={property.id} />
            {(["balance", "notes", "hkNotes"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="hidden" name={k} value="off" />
                <input type="checkbox" name={k} defaultChecked={o.show[k]} /> {m[`downtime.show.${k}`]}
              </label>
            ))}
            <label className="grid gap-1">
              <span className="text-ink-60">{m["downtime.sort"]}</span>
              <select name="sort" defaultValue={o.sort} className="h-9 rounded-xl border border-ink-10 bg-surface px-2">
                <option value="room">{m["downtime.sort.room"]}</option>
                <option value="name">{m["downtime.sort.name"]}</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["downtime.reminderAt"]}</span>
              <input type="time" name="reminderAt" defaultValue={o.reminderAt ?? ""} className="h-9 w-32 rounded-xl border border-ink-10 bg-surface px-2" />
            </label>
            <label className="grid gap-1">
              <span className="text-ink-60">{m["downtime.blankForms"]}</span>
              <input type="number" name="blankForms" min={0} max={20} defaultValue={o.blankForms} className="h-9 w-24 rounded-xl border border-ink-10 bg-surface px-2" />
            </label>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}
