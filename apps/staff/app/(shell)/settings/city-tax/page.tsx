import { CITY_TAX_EXEMPTION_REASONS, CITY_TAX_KINDS, can, formatCityTaxFlat, formatCityTaxSteps, todayIn, type CityTaxVersion } from "@hoteloftware/domain";
import { getCityTaxRule, listServices, listTaxCodes } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill, type Messages } from "@/i18n/messages";
import { ActionForm, Field, Select, inputClass } from "@/components/form-fields";
import { addVersionAction, createRuleAction, passOnAction, removeVersionAction, saveRuleAction } from "./actions";

/** City Tax set-up (ticket 30): pass-on, the property's rule, its versions, base Services and exemption reasons. */
export default async function CityTaxSettingsPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_city_tax"]}</h1>
        <p className="mt-2 text-ink-60">{m["ctax.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("view_property", property.id);
  const edit = can(actor, "manage_property_settings", property.id);
  const [{ passOn, rule }, taxCodes, services] = await Promise.all([
    getCityTaxRule(pool(), tenant.schemaName, property.id),
    listTaxCodes(pool(), tenant.schemaName, property.legalEntityId, { today: todayIn(property.timeZone) }),
    listServices(pool(), tenant.schemaName, property.id),
  ]);
  const codeOptions = taxCodes.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }));
  const day = (d: string) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const money = (n: number) => new Intl.NumberFormat(language === "de" ? "de-DE" : "en-GB", { style: "currency", currency: property.currency }).format(n);
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.settings_city_tax"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["ctax.help"]}</p>
      </div>

      <section aria-label={m["ctax.passOn"]} className={section}>
        {edit ? (
          <ActionForm action={passOnAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-3">
            {hidden}
            <Select label={m["ctax.passOn"]} name="passOn" defaultValue={passOn} options={(["on_top", "absorbed"] as const).map((p) => ({ value: p, label: m[`ctax.passOn.${p}`] }))} />
            <p className="w-full text-xs text-ink-60">{m["ctax.passOnHelp"]}</p>
          </ActionForm>
        ) : (
          <p>
            {m["ctax.passOn"]} {m[`ctax.passOn.${passOn}`]}
          </p>
        )}
      </section>

      {!rule ? (
        <section aria-label={m["ctax.create"]} className={section}>
          <p className="text-ink-60">{m["ctax.none"]}</p>
          {edit ? (
            <ActionForm action={createRuleAction} submitLabel={m["ctax.create"]} pendingLabel={m["action.saving"]} className="grid gap-3 sm:grid-cols-2">
              {hidden}
              <Select label={m["ctax.preset"]} name="preset" options={(["", "berlin", "hamburg", "wien"] as const).map((p) => ({ value: p, label: m[`ctax.preset.${p || "none"}`] }))} />
              <Field label={m["ctax.name"]} name="name" />
              <Select label={m["ctax.taxCode"]} name="taxCodeId" options={codeOptions} defaultValue={taxCodes.find((t) => t.currentRate === 0)?.id} />
              <Field label={m["ctax.revenueAccount"]} name="revenueAccount" />
              <p className="text-xs text-ink-60 sm:col-span-2">{m["ctax.taxCodeHelp"]}</p>
            </ActionForm>
          ) : null}
        </section>
      ) : (
        <>
          <section aria-label={m["ctax.rule"]} className={section}>
            <h2 className="font-medium">{m["ctax.rule"]}</h2>
            {rule.preset ? <p className="rounded-xl bg-warning/10 p-3 text-xs">{fill(m["ctax.presetNote"], { preset: m[`ctax.preset.${rule.preset}`] })}</p> : null}
            <RuleForm m={m} edit={edit} hidden={hidden} rule={rule} codeOptions={codeOptions} services={services.map((s) => ({ id: s.id, name: `${s.code} · ${s.name}` }))} />
          </section>

          <section aria-label={m["ctax.versions"]} className={section}>
            <h2 className="font-medium">{m["ctax.versions"]}</h2>
            <ul className="grid gap-1">
              {rule.versions.map((v) => (
                <li key={v.id} data-version={v.validFrom} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <strong>{day(v.validFrom)}</strong>
                    {v.bookedFrom ? ` · ${fill(m["ctax.bookedFromShort"], { date: day(v.bookedFrom) })}` : ""} · {describe(v, m, money)}
                  </span>
                  {edit ? (
                    <ActionForm action={removeVersionAction} submitLabel={m["ctax.removeVersion"]} pendingLabel={m["action.saving"]} className="flex items-center gap-2">
                      {hidden}
                      <input type="hidden" name="versionId" value={v.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {edit ? <VersionForm m={m} hidden={hidden} last={rule.versions.at(-1)} /> : null}
          </section>
        </>
      )}
    </div>
  );
}

function describe(v: CityTaxVersion, m: Messages, money: (n: number) => string): string {
  if (v.kind === "percentage") return `${v.percent} %${v.nightCap ? ` · ${fill(m["ctax.capNights"], { n: String(v.nightCap) })}` : ""}`;
  if (v.kind === "step_table") {
    const bands = v.steps.map((s) => `${s.upTo === null ? "∞" : `≤ ${money(s.upTo)}`}: ${money(s.amount)}`).join(", ");
    const beyond = v.beyondEvery && v.beyondAmount ? ` · ${fill(m["ctax.beyond"], { amount: money(v.beyondAmount), every: money(v.beyondEvery) })}` : "";
    return `${m["ctax.kind.step_table"]} (${m[`ctax.stepBasis.${v.stepBasis}`]}): ${bands}${beyond}`;
  }
  return `${m["ctax.kind.flat"]}: ${formatCityTaxFlat(v.flat).replaceAll("\n", "; ")}`;
}

function RuleForm({
  m,
  edit,
  hidden,
  rule,
  codeOptions,
  services,
}: {
  m: Messages;
  edit: boolean;
  hidden: React.ReactNode;
  rule: NonNullable<Awaited<ReturnType<typeof getCityTaxRule>>["rule"]>;
  codeOptions: { value: string; label: string }[];
  services: { id: string; name: string }[];
}) {
  const body = (
    <>
      {hidden}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={m["ctax.name"]} name="name" defaultValue={rule.name} readOnly={!edit} />
        <Select label={m["ctax.taxCode"]} name="taxCodeId" options={codeOptions} defaultValue={rule.taxCodeId} readOnly={!edit} />
        <Field label={m["ctax.revenueAccount"]} name="revenueAccount" defaultValue={rule.revenueAccount} readOnly={!edit} />
      </div>
      <p className="text-xs text-ink-60">{m["ctax.taxCodeHelp"]}</p>
      <fieldset className="grid gap-1">
        <legend className="font-medium">{m["ctax.base"]}</legend>
        <p className="text-xs text-ink-60">{m["ctax.baseHelp"]}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input type="checkbox" name="base" value={s.id} defaultChecked={rule.baseServiceIds.includes(s.id)} disabled={!edit} />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="font-medium">{m["ctax.reasons"]}</legend>
        <p className="text-xs text-ink-60">{m["ctax.reasonsHelp"]}</p>
        {CITY_TAX_EXEMPTION_REASONS.map((r) => {
          const s = rule.reasons.find((x) => x.reason === r);
          const automatic = r === "age" || r === "long_stay";
          return (
            <div key={r} data-reason={r} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name={`reason_${r}`} value="off" />
              <label className="flex min-w-56 items-center gap-2">
                <input type="checkbox" name={`reason_${r}`} defaultChecked={!!s} disabled={!edit} />
                {m[`ctax.reason.${r}`]}
              </label>
              {automatic ? (
                <label className="flex items-center gap-2">
                  <input name={`param_${r}`} inputMode="numeric" defaultValue={s?.param ?? ""} aria-label={m[`ctax.reason.${r}`]} className={`${inputClass} w-20`} readOnly={!edit} />
                  <span className="text-ink-60">{m[r === "age" ? "ctax.ageUnit" : "ctax.nightsUnit"]}</span>
                </label>
              ) : (
                <select name={`evidence_${r}`} defaultValue={s?.evidence ?? "none"} aria-label={`${m[`ctax.reason.${r}`]}: ${m["ctax.reason"]}`} className={`${inputClass} w-auto`} disabled={!edit}>
                  {(["none", "note", "document"] as const).map((e) => (
                    <option key={e} value={e}>
                      {fill(m["ctax.evidenceNeeded"], { evidence: m[`ctax.evidence.${e}`] })}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </fieldset>
    </>
  );
  return edit ? (
    <ActionForm action={saveRuleAction} submitLabel={m["ctax.saveRule"]} pendingLabel={m["action.saving"]}>
      {body}
    </ActionForm>
  ) : (
    <div className="grid gap-3">{body}</div>
  );
}

function VersionForm({ m, hidden, last }: { m: Messages; hidden: React.ReactNode; last: CityTaxVersion | undefined }) {
  return (
    <ActionForm action={addVersionAction} submitLabel={m["ctax.addVersion"]} pendingLabel={m["action.saving"]} className="grid gap-3 rounded-xl bg-surface p-4">
      {hidden}
      <p className="text-xs text-ink-60">{m["ctax.addVersionHelp"]}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={m["ctax.validFrom"]} name="validFrom" type="date" required />
        <Field label={m["ctax.bookedFrom"]} name="bookedFrom" type="date" />
        <Select label={m["ctax.kind"]} name="kind" defaultValue={last?.kind} options={CITY_TAX_KINDS.map((k) => ({ value: k, label: m[`ctax.kind.${k}`] }))} />
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="text-xs text-ink-60">{m["ctax.kind.percentage"]}</legend>
        <Field label={m["ctax.percent"]} name="percent" defaultValue={last?.percent?.toString()} />
        <Field label={m["ctax.nightCap"]} name="nightCap" defaultValue={last?.nightCap?.toString()} />
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="text-xs text-ink-60">{m["ctax.kind.step_table"]}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={m["ctax.stepBasis"]} name="stepBasis" defaultValue={last?.stepBasis} options={(["per_person", "per_room"] as const).map((b) => ({ value: b, label: m[`ctax.stepBasis.${b}`] }))} />
          <Field label={m["ctax.beyondEvery"]} name="beyondEvery" defaultValue={last?.beyondEvery?.toString()} />
          <Field label={m["ctax.beyondAmount"]} name="beyondAmount" defaultValue={last?.beyondAmount?.toString()} />
        </div>
        <label className="grid gap-1">
          <span className="text-ink-80">{m["ctax.steps"]}</span>
          <textarea name="steps" rows={5} defaultValue={last ? formatCityTaxSteps(last.steps) : ""} className="rounded-xl border border-ink-10 bg-surface-2 p-3 font-mono text-sm" />
        </label>
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="text-xs text-ink-60">{m["ctax.kind.flat"]}</legend>
        <label className="grid gap-1">
          <span className="text-ink-80">{m["ctax.flat"]}</span>
          <textarea name="flat" rows={4} defaultValue={last ? formatCityTaxFlat(last.flat) : ""} className="rounded-xl border border-ink-10 bg-surface-2 p-3 font-mono text-sm" />
        </label>
      </fieldset>
    </ActionForm>
  );
}
