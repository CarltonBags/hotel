import { cantonProfileOf, tessinExport } from "@hoteloftware/db";
import { CANTON_FIELDS, CANTON_GROUPINGS, CANTON_SIGNATURES, CANTON_TRANSMISSIONS, CANTONS, RETENTION_ASSUMED, todayIn } from "@hoteloftware/domain";
import { ActionForm, Field } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { presetAction, profileAction } from "./actions";

/** The Canton Profile of a Swiss property (ticket 47), and Tessin's export of completed forms. */
export default async function CantonPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_canton"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_property_settings", property.id);
  if (property.country !== "CH") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_canton"]}</h1>
        <p className="mt-2 text-ink-60">{m["canton.notSwiss"]}</p>
      </div>
    );
  }
  const profile = await cantonProfileOf(pool(), tenant.schemaName, property.id);
  const q = await searchParams;
  const today = todayIn(property.timeZone);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from ?? "") ? q.from! : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to ?? "") ? q.to! : today;
  const exported = profile?.transmission === "ti_export" && profile.tiUserId?.trim() ? (await tessinExport(pool(), tenant.schemaName, property.id, from, to)).records : null;
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const input = "h-9 rounded-xl border border-ink-10 bg-surface px-2";
  const radio = (name: string, value: string, label: string, checked: boolean) => (
    <label key={value} className="flex items-center gap-2">
      <input type="radio" name={name} value={value} defaultChecked={checked} /> {label}
    </label>
  );
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.settings_canton"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["canton.help"]}</p>
        <p className="text-sm text-ink-60">{m["canton.noCardPath"]}</p>
      </div>
      <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-canton-preset>
        <ActionForm action={presetAction} submitLabel={m["canton.applyPreset"]} className="flex flex-wrap items-end gap-3">
          {hidden}
          <label className="grid gap-1">
            <span>{m["canton.canton"]}</span>
            <select name="canton" defaultValue={profile?.canton ?? "ZH"} className={input}>
              {CANTONS.map((c) => (
                <option key={c} value={c}>
                  {c === "other" ? "–" : c}
                </option>
              ))}
            </select>
          </label>
          <span className="rounded-full bg-warning/20 px-3 py-1 text-[12px]">{m["canton.verify"]}</span>
        </ActionForm>
      </section>
      {profile ? (
        <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-canton-profile={profile.canton}>
          <ActionForm action={profileAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-4">
            {hidden}
            <input type="hidden" name="canton" value={profile.canton} />
            <fieldset className="grid gap-1">
              <legend className="font-medium">{m["canton.registers"]}</legend>
              {radio("registers", "foreign", m["canton.registers.foreign"], profile.registers === "foreign")}
              {radio("registers", "all", m["canton.registers.all"], profile.registers === "all")}
            </fieldset>
            <fieldset className="grid gap-1">
              <legend className="font-medium">{m["canton.grouping"]}</legend>
              {CANTON_GROUPINGS.map((g) => radio("grouping", g, m[`canton.grouping.${g}`], profile.grouping === g))}
            </fieldset>
            <fieldset className="grid gap-1">
              <legend className="font-medium">{m["canton.fields"]}</legend>
              {CANTON_FIELDS.map((f) => (
                <label key={f} className="flex items-center gap-2">
                  <input type="checkbox" name="extraFields" value={f} defaultChecked={profile.extraFields.includes(f)} /> {m[`canton.field.${f}`]}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="font-medium">{m["canton.retention"]}</legend>
              {radio("retention", "years", "", "years" in profile.retention)}
              <input name="retentionYears" type="number" min={1} max={10} defaultValue={"years" in profile.retention ? profile.retention.years : 5} className={`${input} w-20`} />
              {radio("retention", "end_of_next_january", m["canton.retentionGE"], "until" in profile.retention)}
              {RETENTION_ASSUMED.includes(profile.canton) ? <span className="w-full text-warning" data-retention-assumed>{m["canton.retentionAssumed"]}</span> : null}
            </fieldset>
            <label className="flex items-center gap-2">
              <input type="hidden" name="documentCopy" value="off" />
              <input type="checkbox" name="documentCopy" defaultChecked={profile.documentCopy} /> {m["canton.documentCopy"]}
            </label>
            <fieldset className="grid gap-1">
              <legend className="font-medium">{m["canton.signature"]}</legend>
              {CANTON_SIGNATURES.map((g) => radio("signature", g, m[`canton.sig.${g}`], profile.signature === g))}
              <label className="flex items-center gap-2 pl-6 text-ink-60">
                <input type="hidden" name="idCheckConfirmed" value="off" />
                <input type="checkbox" name="idCheckConfirmed" defaultChecked={profile.idCheckConfirmed === true} /> {m["canton.idCheckConfirmed"]}
              </label>
            </fieldset>
            <fieldset className="grid gap-1">
              <legend className="font-medium">{m["canton.transmission"]}</legend>
              {CANTON_TRANSMISSIONS.map((g) => radio("transmission", g, m[`canton.tx.${g}`], profile.transmission === g))}
            </fieldset>
            <Field label={m["canton.tiUserId"]} name="tiUserId" defaultValue={profile.tiUserId ?? ""} />
          </ActionForm>
        </section>
      ) : null}
      {profile?.transmission === "ti_export" ? (
        <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-tessin-export>
          <h2 className="font-medium">{m["canton.export"]}</h2>
          <p className="text-ink-60">{m["canton.exportHelp"]}</p>
          <form className="flex flex-wrap items-end gap-3">
            <Field label={m["canton.from"]} name="from" type="date" defaultValue={from} />
            <Field label={m["canton.to"]} name="to" type="date" defaultValue={to} />
            <button type="submit" className="h-9 rounded-full bg-surface px-4">
              {m["canton.show"]}
            </button>
          </form>
          {exported && exported.length ? (
            <>
              <a href={`/registration-export?propertyId=${property.id}&from=${from}&to=${to}&format=csv`} className="font-medium underline" data-tessin-csv>
                {m["canton.csv"]}
              </a>
              <ul className="grid gap-1">
                {exported.map((r) => (
                  <li key={r.personId}>
                    {r.problems.length ? (
                      <span className="text-warning" data-tessin-problem>
                        {r.name} · {r.arrival}: {m["canton.notForXml"]} {r.problems.join(", ")}
                      </span>
                    ) : (
                      <a href={`/registration-export?propertyId=${property.id}&from=${from}&to=${to}&format=xml&person=${r.personId}`} className="underline" data-tessin-xml>
                        {r.name} · {r.arrival} (XML)
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-ink-60">{m["canton.none"]}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
