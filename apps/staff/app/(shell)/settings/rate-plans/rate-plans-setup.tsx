"use client";

import { useState } from "react";
import { CHANNEL_LIMITS, FEE_KINDS, MEAL_PLANS, PAYMENT_KINDS, RESTRICTION_FIELDS, formatCurrency, type Language } from "@hoteloftware/domain";
import type { AgeBand, CancellationPolicy, PaymentPolicy, RatePlan, RoomType, Service } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { closeOut, saveCancellationPolicy, savePaymentPolicy, savePriceFloors, saveRatePlan } from "./actions";

interface PropertyInfo {
  id: string;
  name: string;
  currency: string;
  country: string;
}

interface Props {
  property: PropertyInfo;
  ratePlans: RatePlan[];
  roomTypes: RoomType[];
  ageBands: AgeBand[];
  services: Service[];
  paymentPolicies: PaymentPolicy[];
  cancellationPolicies: CancellationPolicy[];
  companies: { id: string; name: string }[];
  language: Language;
  m: Messages;
}

type TabId = "plans" | "policies" | "floors" | "closeout";

export function RatePlansSetup(props: Props) {
  const { property, ratePlans, paymentPolicies, cancellationPolicies, m } = props;
  const policiesMissing = paymentPolicies.length === 0 || cancellationPolicies.length === 0;
  const [tab, setTab] = useState<TabId>(policiesMissing ? "policies" : "plans");
  const projected = ratePlans.reduce((n, p) => n + p.roomTypeIds.length, 0);
  const tabs: [TabId, string, number | null][] = [
    ["plans", m["rates.ratePlans"], ratePlans.length],
    ["policies", m["rates.policies"], paymentPolicies.length + cancellationPolicies.length],
    ["floors", m["rates.priceFloors"], null],
    ["closeout", m["rates.closeOut"], null],
  ];
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-medium">
        {m["rates.title"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      <p className="mt-1 text-sm text-ink-60">{fill(m["rates.projected"], { count: String(projected), limit: String(CHANNEL_LIMITS.projectedRatePlans) })}</p>
      <div role="tablist" className="mt-4 flex flex-wrap gap-1 rounded-full bg-surface-2 p-1">
        {tabs.map(([id, label, count]) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`h-9 rounded-full px-4 text-sm ${tab === id ? "bg-surface font-medium shadow-pill" : "text-ink-80 hover:bg-ink-5"}`}
          >
            {label} {count !== null ? <span className="text-ink-60">{count}</span> : null}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "plans" ? <PlansTab {...props} /> : null}
        {tab === "policies" ? <PoliciesTab {...props} /> : null}
        {tab === "floors" ? <FloorsTab {...props} /> : null}
        {tab === "closeout" ? <CloseOutTab {...props} /> : null}
      </div>
    </div>
  );
}

/** Checkbox that always submits: a hidden "off" precedes it, the action reads getAll(name). */
function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean | undefined }) {
  return (
    <label className="flex items-center gap-1 text-sm">
      <input type="hidden" name={name} value="off" />
      <input type="checkbox" name={name} value="on" defaultChecked={defaultChecked ?? false} />
      {label}
    </label>
  );
}

function Hidden({ property, id }: { property: PropertyInfo; id?: string | undefined }) {
  return (
    <>
      <input type="hidden" name="propertyId" value={property.id} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
    </>
  );
}

function PlanForm({ property, plan, ratePlans, roomTypes, ageBands, services, paymentPolicies, cancellationPolicies, companies, m }: Props & { plan?: RatePlan }) {
  const [kind, setKind] = useState<"base" | "derived">(plan?.kind ?? "base");
  const [isPublic, setIsPublic] = useState(plan?.public ?? true);
  const [edk, setEdk] = useState<string>(plan?.earlyDepartureFeeKind ?? "none");
  const basePlans = ratePlans.filter((p) => p.kind === "base" && p.id !== plan?.id);
  const supp = (k: string, bandId?: string) => plan?.supplements.find((s) => s.kind === k && (k !== "child" || s.ageBandId === bandId))?.amount;
  const money = (v: number | undefined) => (v === undefined ? undefined : v.toFixed(2));
  const included = (id: string) => plan?.includedServices.find((s) => s.serviceId === id);
  return (
    <ActionForm action={saveRatePlan} submitLabel={plan ? m["action.save"] : m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-4">
      <Hidden property={property} id={plan?.id} />
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={m["rooms.code"]} name="code" defaultValue={plan?.code} required />
        <Field label={m["rooms.nameMain"]} name="name" defaultValue={plan?.name} required />
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["rates.kind"]}</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "base" | "derived")} className="h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm">
            <option value="base">{m["rates.kind.base"]}</option>
            <option value="derived" disabled={basePlans.length === 0}>
              {m["rates.kind.derived"]}
            </option>
          </select>
        </label>
        <Field label={m["rooms.nameDe"]} name="name_de" defaultValue={plan?.names.de} />
        <Field label={m["rooms.nameEn"]} name="name_en" defaultValue={plan?.names.en} />
        <Field label={m["rates.baseOccupancy"]} name="baseOccupancy" type="number" defaultValue={String(plan?.baseOccupancy ?? 2)} required />
      </div>

      {kind === "derived" ? (
        <fieldset className="grid gap-3 rounded-xl border border-ink-10 p-3">
          <legend className="px-1 text-sm text-ink-80">{m["rates.derivation"]}</legend>
          <div className="grid gap-3 md:grid-cols-3">
            <Select label={m["rates.basePlan"]} name="basePlanId" options={basePlans.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} defaultValue={plan?.basePlanId ?? undefined} />
            <Select
              label={m["rates.derivationKind"]}
              name="derivationKind"
              options={[
                { value: "percent", label: m["rates.derivationKind.percent"] },
                { value: "amount", label: `${m["rates.derivationKind.amount"]} (${property.currency})` },
              ]}
              defaultValue={plan?.derivation?.kind ?? "percent"}
            />
            <Field label={m["rates.derivationValue"]} name="derivationValue" type="number" step="0.01" defaultValue={plan?.derivation ? String(plan.derivation.value) : "-10"} required />
          </div>
          <p className="text-xs text-ink-60">{m["rates.inheritsHelp"]}</p>
          <div className="flex flex-wrap gap-4">
            {RESTRICTION_FIELDS.map((f) => (
              <Check key={f} name={`inherit_${f}`} label={m[`rates.restriction.${f}`]} defaultChecked={plan ? plan.inherits[f] : true} />
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="grid gap-2 rounded-xl border border-ink-10 p-3">
        <legend className="px-1 text-sm text-ink-80">{m["rates.roomTypes"]}</legend>
        <div className="flex flex-wrap gap-4">
          {roomTypes.map((t) => (
            <Check key={t.id} name={`rt_${t.id}`} label={`${t.code} · ${t.name}`} defaultChecked={plan ? plan.roomTypeIds.includes(t.id) : false} />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 md:grid-cols-3">
        <Select label={m["rates.mealPlan"]} name="mealPlan" options={MEAL_PLANS.map((v) => ({ value: v, label: m[`rates.mealPlan.${v}`] }))} defaultValue={plan?.mealPlan ?? "none"} />
        <Select label={m["rates.paymentPolicy"]} name="paymentPolicyId" options={paymentPolicies.map((p) => ({ value: p.id, label: p.name }))} defaultValue={plan?.paymentPolicyId} />
        <Select label={m["rates.cancellationPolicy"]} name="cancellationPolicyId" options={cancellationPolicies.map((p) => ({ value: p.id, label: p.name }))} defaultValue={plan?.cancellationPolicyId} />
      </div>
      <div className="grid gap-1">
        <Select
          label={m["rates.accommodationService"]}
          name="accommodationServiceId"
          options={[{ value: "", label: "–" }, ...services.map((s) => ({ value: s.id, label: `${s.code} · ${s.name} · ${s.taxCodeCode}` }))]}
          defaultValue={plan?.accommodationServiceId ?? ""}
        />
        <p className="text-xs text-ink-60">{m["rates.accommodationServiceHelp"]}</p>
      </div>

      <fieldset className="grid gap-2 rounded-xl border border-ink-10 p-3">
        <legend className="px-1 text-sm text-ink-80">{m["rates.supplements"]}</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={`${m["rates.supplement.single"]} (${property.currency})`} name="supp_single" type="number" step="0.01" defaultValue={money(supp("single"))} />
          <Field label={`${m["rates.supplement.extra_adult"]} (${property.currency})`} name="supp_extra_adult" type="number" step="0.01" defaultValue={money(supp("extra_adult"))} />
          {ageBands.map((b) => (
            <Field
              key={b.id}
              label={`${m["rates.supplement.child"]} ${b.name} (${b.minAge}–${b.maxAge ?? "∞"}) (${property.currency})`}
              name={`supp_child_${b.id}`}
              type="number"
              step="0.01"
              defaultValue={money(supp("child", b.id))}
            />
          ))}
        </div>
        {ageBands.length === 0 ? <p className="text-xs text-ink-60">{m["rates.noAgeBands"]}</p> : null}
      </fieldset>

      <fieldset className="grid gap-2 rounded-xl border border-ink-10 p-3">
        <legend className="px-1 text-sm text-ink-80">{m["rates.includedServices"]}</legend>
        <p className="text-xs text-ink-60">{m["rates.includedHelp"]}</p>
        {services.map((s) => (
          <div key={s.id} className="flex flex-wrap items-end gap-3">
            <Check name={`svc_${s.id}`} label={`${s.code} · ${s.name}`} defaultChecked={Boolean(included(s.id))} />
            <div className="w-40">
              <Field label={`${m["rates.componentPrice"]} (${property.currency})`} name={`svcprice_${s.id}`} type="number" step="0.01" defaultValue={(included(s.id)?.componentPrice ?? s.defaultPrice).toFixed(2)} />
            </div>
          </div>
        ))}
        {services.length === 0 ? <p className="text-xs text-ink-60">{m["rates.noServices"]}</p> : null}
      </fieldset>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{m["rates.earlyDeparture"]}</span>
          <select name="earlyDepartureFeeKind" value={edk} onChange={(e) => setEdk(e.target.value)} className="h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm">
            {FEE_KINDS.map((k) => (
              <option key={k} value={k}>
                {m[`rates.fee.${k}`]}
              </option>
            ))}
          </select>
        </label>
        {edk === "percent" ? <Field label={m["rates.feePercent"]} name="earlyDepartureFeePercent" type="number" step="0.01" defaultValue={plan?.earlyDepartureFeePercent?.toString()} required /> : <div className="hidden md:block" />}
        {!isPublic ? <Field label={m["rates.rateCode"]} name="rateCode" defaultValue={plan?.rateCode ?? undefined} required /> : <div className="hidden md:block" />}
        {!isPublic ? (
          <Select label={m["rates.company"]} name="companyId" options={[{ value: "", label: "–" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} defaultValue={plan?.companyId ?? ""} />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-4">
        <Check name="dateChangeAllowed" label={m["rates.dateChangeAllowed"]} defaultChecked={plan?.dateChangeAllowed ?? true} />
        <label className="flex items-center gap-1 text-sm">
          <input type="hidden" name="public" value="off" />
          <input type="checkbox" name="public" value="on" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          {m["rates.public"]}
        </label>
        <Check name="soldOnChannels" label={m["rates.soldOnChannels"]} defaultChecked={plan?.soldOnChannels ?? true} />
        {plan ? <Check name="active" label={m["services.active"]} defaultChecked={plan.active} /> : null}
      </div>

      <details className="rounded-xl border border-ink-10 p-3">
        <summary className="cursor-pointer text-sm text-ink-80">{m["rates.texts"]}</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label={`${m["rates.description"]} (DE)`} name="description_de" defaultValue={plan?.descriptions.de} />
          <Field label={`${m["rates.description"]} (EN)`} name="description_en" defaultValue={plan?.descriptions.en} />
          <Field label={`${m["rates.policyText"]} (DE)`} name="policyText_de" defaultValue={plan?.policyTexts.de} />
          <Field label={`${m["rates.policyText"]} (EN)`} name="policyText_en" defaultValue={plan?.policyTexts.en} />
        </div>
      </details>
    </ActionForm>
  );
}

function PlansTab(props: Props) {
  const { property, ratePlans, roomTypes, paymentPolicies, cancellationPolicies, language, m } = props;
  if (paymentPolicies.length === 0 || cancellationPolicies.length === 0) return <p className="text-ink-60">{m["rates.needPolicies"]}</p>;
  if (roomTypes.length === 0) return <p className="text-ink-60">{m["rates.needRoomTypes"]}</p>;
  const typeCode = (id: string) => roomTypes.find((t) => t.id === id)?.code ?? "?";
  return (
    <div className="grid gap-4">
      {ratePlans.map((p) => (
        <details key={p.id} className={`rounded-2xl bg-surface-2 p-5 ${p.active ? "" : "opacity-60"}`}>
          <summary className="cursor-pointer">
            <span className="font-mono text-ink-80">{p.code}</span> <span className="font-medium">{p.name}</span>{" "}
            <span className="text-ink-60">
              · {p.kind === "derived" ? fill(m["rates.follows"], { base: p.basePlanCode ?? "?", rule: p.derivation ? (p.derivation.kind === "percent" ? `${p.derivation.value} %` : formatCurrency(p.derivation.value, property.currency, language, property.country)) : "" }) : m["rates.kind.base"]}
              {" · "}
              {p.roomTypeIds.map(typeCode).join(", ")} · {m[`rates.mealPlan.${p.mealPlan}`]}
              {p.public ? "" : ` · ${m["rates.rateCode"]} ${p.rateCode}${p.companyName ? ` (${p.companyName})` : ""}`}
              {p.soldOnChannels ? "" : ` · ${m["rates.notOnChannels"]}`}
              {p.active ? "" : ` · ${m["services.inactive"]}`}
            </span>
          </summary>
          <div className="mt-4">
            <PlanForm {...props} plan={p} />
          </div>
        </details>
      ))}
      <section className="rounded-2xl bg-surface-2 p-5">
        <h2 className="mb-3 font-medium">{m["rates.newPlan"]}</h2>
        <PlanForm {...props} />
      </section>
    </div>
  );
}

function PaymentPolicyForm({ property, policy, m }: { property: PropertyInfo; policy?: PaymentPolicy; m: Messages }) {
  const [kind, setKind] = useState<string>(policy?.kind ?? "card_guarantee");
  return (
    <ActionForm action={savePaymentPolicy} submitLabel={policy ? m["action.save"] : m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
      <Hidden property={property} id={policy?.id} />
      <Field label={m["field.name"]} name="name" defaultValue={policy?.name} required />
      <label className="grid gap-1 text-sm">
        <span className="text-ink-80">{m["rates.paymentKind"]}</span>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm">
          {PAYMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {m[`rates.payment.${k}`]}
            </option>
          ))}
        </select>
      </label>
      {kind === "deposit_percent" ? <Field label={m["rates.depositPercent"]} name="depositPercent" type="number" step="0.01" defaultValue={policy?.depositPercent?.toString()} required /> : <div className="hidden md:block" />}
    </ActionForm>
  );
}

function CancellationPolicyForm({ property, policy, m }: { property: PropertyInfo; policy?: CancellationPolicy; m: Messages }) {
  const [neverFree, setNeverFree] = useState(policy ? policy.freeUntilDays === null : false);
  const [feeKind, setFeeKind] = useState<string>(policy?.feeKind ?? "first_night");
  const [noShowKind, setNoShowKind] = useState<string>(policy?.noShowFeeKind ?? "first_night");
  const feeSelect = (name: string, label: string, value: string, set: (v: string) => void) => (
    <label className="grid gap-1 text-sm">
      <span className="text-ink-80">{label}</span>
      <select name={name} value={value} onChange={(e) => set(e.target.value)} className="h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm">
        {FEE_KINDS.map((k) => (
          <option key={k} value={k}>
            {m[`rates.fee.${k}`]}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <ActionForm action={saveCancellationPolicy} submitLabel={policy ? m["action.save"] : m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
      <Hidden property={property} id={policy?.id} />
      <Field label={m["field.name"]} name="name" defaultValue={policy?.name} required />
      <label className="flex items-center gap-1 self-end pb-2 text-sm">
        <input type="hidden" name="neverFree" value="off" />
        <input type="checkbox" name="neverFree" value="on" checked={neverFree} onChange={(e) => setNeverFree(e.target.checked)} />
        {m["rates.neverFree"]}
      </label>
      <div className="hidden md:block" />
      {!neverFree ? (
        <>
          <Field label={m["rates.freeUntilDays"]} name="freeUntilDays" type="number" defaultValue={String(policy?.freeUntilDays ?? 1)} required />
          <Field label={m["rates.freeUntilTime"]} name="freeUntilTime" type="time" defaultValue={policy?.freeUntilTime ?? "18:00"} required />
          <div className="hidden md:block" />
        </>
      ) : null}
      {feeSelect("feeKind", m["rates.cancellationFee"], feeKind, setFeeKind)}
      {feeKind === "percent" ? <Field label={m["rates.feePercent"]} name="feePercent" type="number" step="0.01" defaultValue={policy?.feePercent?.toString()} required /> : <div className="hidden md:block" />}
      <div className="hidden md:block" />
      {feeSelect("noShowFeeKind", m["rates.noShowFee"], noShowKind, setNoShowKind)}
      {noShowKind === "percent" ? <Field label={m["rates.feePercent"]} name="noShowFeePercent" type="number" step="0.01" defaultValue={policy?.noShowFeePercent?.toString()} required /> : <div className="hidden md:block" />}
    </ActionForm>
  );
}

function PoliciesTab({ property, paymentPolicies, cancellationPolicies, m }: Props) {
  const describePayment = (p: PaymentPolicy) => (p.kind === "deposit_percent" ? `${m["rates.payment.deposit_percent"]} ${p.depositPercent} %` : m[`rates.payment.${p.kind}`]);
  const describeCxl = (p: CancellationPolicy) =>
    `${p.freeUntilDays === null ? m["rates.neverFree"] : fill(m["rates.freeUntil"], { days: String(p.freeUntilDays), time: p.freeUntilTime })} · ${m["rates.cancellationFee"]}: ${m[`rates.fee.${p.feeKind}`]}${p.feePercent ? ` ${p.feePercent} %` : ""} · ${m["rates.noShowFee"]}: ${m[`rates.fee.${p.noShowFeeKind}`]}${p.noShowFeePercent ? ` ${p.noShowFeePercent} %` : ""}`;
  return (
    <div className="grid gap-6">
      <section className="grid gap-4">
        <h2 className="font-medium">{m["rates.paymentPolicies"]}</h2>
        {paymentPolicies.map((p) => (
          <details key={p.id} className="rounded-2xl bg-surface-2 p-5">
            <summary className="cursor-pointer">
              <span className="font-medium">{p.name}</span> <span className="text-ink-60">· {describePayment(p)}</span>
            </summary>
            <div className="mt-4">
              <PaymentPolicyForm property={property} policy={p} m={m} />
            </div>
          </details>
        ))}
        <div className="rounded-2xl bg-surface-2 p-5">
          <h3 className="mb-3 text-sm text-ink-80">{m["rates.newPaymentPolicy"]}</h3>
          <PaymentPolicyForm property={property} m={m} />
        </div>
      </section>
      <section className="grid gap-4">
        <h2 className="font-medium">{m["rates.cancellationPolicies"]}</h2>
        {cancellationPolicies.map((p) => (
          <details key={p.id} className="rounded-2xl bg-surface-2 p-5">
            <summary className="cursor-pointer">
              <span className="font-medium">{p.name}</span> <span className="text-ink-60">· {describeCxl(p)}</span>
            </summary>
            <div className="mt-4">
              <CancellationPolicyForm property={property} policy={p} m={m} />
            </div>
          </details>
        ))}
        <div className="rounded-2xl bg-surface-2 p-5">
          <h3 className="mb-3 text-sm text-ink-80">{m["rates.newCancellationPolicy"]}</h3>
          <CancellationPolicyForm property={property} m={m} />
        </div>
      </section>
    </div>
  );
}

function FloorsTab({ property, roomTypes, m }: Props) {
  return (
    <section className="rounded-2xl bg-surface-2 p-5">
      <p className="mb-3 text-sm text-ink-60">{m["rates.priceFloorHelp"]}</p>
      <ActionForm action={savePriceFloors} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
        <Hidden property={property} />
        {roomTypes.map((t) => (
          <Field key={t.id} label={`${t.code} · ${t.name} (${property.currency})`} name={`floor_${t.id}`} type="number" step="0.01" defaultValue={t.priceFloor?.toFixed(2)} />
        ))}
      </ActionForm>
    </section>
  );
}

function CloseOutTab({ property, roomTypes, m }: Props) {
  return (
    <section className="rounded-2xl bg-surface-2 p-5">
      <p className="mb-3 text-sm text-ink-60">{m["rates.closeOutHelp"]}</p>
      <ActionForm action={closeOut} submitLabel={m["rates.closeOutApply"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
        <Hidden property={property} />
        <Select label={m["rates.closeWhat"]} name="roomTypeId" options={[{ value: "", label: m["rates.wholeProperty"] }, ...roomTypes.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))]} />
        <Field label={m["rates.from"]} name="from" type="date" required />
        <Field label={m["rates.to"]} name="to" type="date" required />
      </ActionForm>
    </section>
  );
}
