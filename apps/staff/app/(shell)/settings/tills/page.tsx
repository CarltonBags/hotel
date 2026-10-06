import Link from "next/link";
import { headers } from "next/headers";
import { findProperty, listTaxCodes, tillConnectionsOf, type TillConnection } from "@hoteloftware/db";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { createTillAction, rotateTillKeyAction, updateTillAction } from "./actions";

/**
 * External tills (ticket 65): a till that keeps its own fiscal register
 * charges rooms through our room charge interface or Lightspeed's contract.
 * The Property Manager connects it; the key is shown once.
 */
export default async function TillSettingsPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.settings_tills"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = await requireAllowed("manage_outlets", property.id);
  const legalEntityId = (await findProperty(pool(), tenant.schemaName, property.id))?.legalEntityId ?? "";
  const [tills, codes] = await Promise.all([tillConnectionsOf(pool(), tenant.schemaName, property.id, { userId: session.user.id, actor }), listTaxCodes(pool(), tenant.schemaName, legalEntityId)]);
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  // the rates of the property's Tax Codes; where one fits more than one code, the Property Manager says which
  const rates = [...new Set(codes.flatMap((c) => (c.currentRate === null ? [] : [String(c.currentRate)])))].sort((a, b) => Number(a) - Number(b));
  const codeOptions = [{ value: "", label: m["till.anyCode"] }, ...codes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))];
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const fields = (t: TillConnection | null) => (
    <>
      <input type="hidden" name="propertyId" value={property.id} />
      <Field label={m["till.name"]} name="name" defaultValue={t?.name ?? ""} required />
      <Field label={m["till.businessReference"]} name="businessReference" defaultValue={t?.businessReference ?? ""} />
      <Field label={m["till.revenueAccount"]} name="revenueAccount" defaultValue={t?.revenueAccount ?? "8400"} />
      <Field label={m["till.tipAccount"]} name="tipAccount" defaultValue={t?.tipAccount ?? "1590"} />
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-ink-80">{m["till.taxCodes"]}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {rates.map((r) => (
            <Select key={r} label={`${r} %`} name={`rate_${r}`} options={codeOptions} defaultValue={t?.taxCodes[r] ?? ""} />
          ))}
        </div>
      </fieldset>
    </>
  );
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <h1 className="text-xl font-medium">
        {m["module.settings_tills"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      <p className="text-sm text-ink-60">
        {m["till.help"]}{" "}
        <Link href="https://github.com/CarltonBags/hotel/blob/main/docs/room-charge-interface.md" className="text-accent underline">
          {m["till.docs"]}
        </Link>
      </p>
      {tills.map((t) => (
        <section key={t.id} className={section} data-till={t.name}>
          <p className="text-ink-60">
            {t.kind === "lightspeed" ? `Lightspeed · ${base}/api/lightspeed` : t.kind === "fias" ? `${m["till.fias"]} · ${base}/api/till/v1` : `${m["till.api"]} · ${base}/api/till/v1`} · {m["till.key"]} …{t.keyHint}
          </p>
          <ActionForm action={updateTillAction} submitLabel={m["action.save"]} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={t.id} />
            {fields(t)}
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" value="on" defaultChecked={t.active} />
              {m["till.active"]}
            </label>
          </ActionForm>
          {t.kind === "fias" ? (
            // the FIAS plugin on the Site Bridge carries the key; its settings go into the Bridge's bridge.json
            <p className="text-ink-60" data-fias-help>
              {m["till.fiasHelp"]} <code className="break-all">{`"fias-till": { "port": "5010", "api": "${base}/api/till/v1", "key": "hs_till_…", "subtotalRates": "1:19,2:7" }`}</code>
            </p>
          ) : null}
          <ActionForm action={rotateTillKeyAction} submitLabel={m["till.newKey"]} className="grid gap-2">
            <input type="hidden" name="propertyId" value={property.id} />
            <input type="hidden" name="id" value={t.id} />
          </ActionForm>
        </section>
      ))}
      <section className={section} data-new-till>
        <h2 className="font-medium">{m["till.new"]}</h2>
        <ActionForm action={createTillAction} submitLabel={m["till.connect"]} className="grid gap-3 sm:grid-cols-2">
          <Select
            label={m["till.kind"]}
            name="kind"
            options={[
              { value: "api", label: m["till.api"] },
              { value: "lightspeed", label: "Lightspeed Restaurant" },
              { value: "fias", label: m["till.fias"] },
            ]}
          />
          {fields(null)}
        </ActionForm>
      </section>
    </div>
  );
}
