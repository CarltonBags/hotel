"use client";

import { useState } from "react";
import { POSTING_RHYTHMS, formatCurrency, splitGross, type Language } from "@hoteloftware/domain";
import type { Service, TaxCode } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { addTaxCode, applyPreset, dropTaxRate, saveService, saveTaxCode } from "./actions";

interface Rights {
  settings: boolean;
  prices: boolean;
  tax: boolean;
}

interface PropertyInfo {
  id: string;
  name: string;
  country: string;
  currency: string;
  legalEntityName: string;
  /** YYYY-MM-DD in the property's time zone */
  today: string;
}

export function CatalogueSetup({
  property,
  services,
  taxCodes,
  rights,
  presetAvailable,
  language,
  m,
}: {
  property: PropertyInfo;
  services: Service[];
  taxCodes: TaxCode[];
  rights: Rights;
  presetAvailable: boolean;
  language: Language;
  m: Messages;
}) {
  const [tab, setTab] = useState<"services" | "tax">(taxCodes.length === 0 ? "tax" : "services");
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-medium">
        {m["services.title"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      <div role="tablist" className="mt-4 flex gap-1 rounded-full bg-surface-2 p-1">
        {(
          [
            ["services", m["services.services"], services.length],
            ["tax", m["services.taxCodes"], taxCodes.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`h-9 rounded-full px-4 text-sm ${tab === id ? "bg-surface font-medium shadow-pill" : "text-ink-80 hover:bg-ink-5"}`}
          >
            {label} <span className="text-ink-60">{count}</span>
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "services" ? (
          <ServicesTab property={property} services={services} taxCodes={taxCodes} rights={rights} language={language} m={m} />
        ) : (
          <TaxCodesTab property={property} taxCodes={taxCodes} rights={rights} presetAvailable={presetAvailable} m={m} />
        )}
      </div>
    </div>
  );
}

function ServiceForm({ property, service, taxCodes, rights, m }: { property: PropertyInfo; service?: Service; taxCodes: TaxCode[]; rights: Rights; m: Messages }) {
  const taxOptions = taxCodes.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}${t.currentRate !== null ? ` (${t.currentRate} %)` : ""}` }));
  const rhythmOptions = POSTING_RHYTHMS.map((r) => ({ value: r, label: m[`services.rhythm.${r}`] }));
  const ro = (allowed: boolean) => (allowed ? {} : { readOnly: true });
  return (
    <ActionForm action={saveService} submitLabel={service ? m["action.save"] : m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
      <input type="hidden" name="propertyId" value={property.id} />
      {service ? <input type="hidden" name="id" value={service.id} /> : null}
      <Field label={m["rooms.code"]} name="code" defaultValue={service?.code} required {...ro(rights.settings)} />
      <Field label={m["rooms.nameMain"]} name="name" defaultValue={service?.name} required {...ro(rights.settings)} />
      <Select label={m["services.postingRhythm"]} name="postingRhythm" options={rhythmOptions} defaultValue={service?.postingRhythm ?? "once"} readOnly={!rights.settings} />
      <Field label={`${m["rooms.nameDe"]}${service && !service.names.de ? ` (${m["rooms.missingTranslation"]})` : ""}`} name="name_de" defaultValue={service?.names.de} {...ro(rights.settings)} />
      <Field label={`${m["rooms.nameEn"]}${service && !service.names.en ? ` (${m["rooms.missingTranslation"]})` : ""}`} name="name_en" defaultValue={service?.names.en} {...ro(rights.settings)} />
      <div className="hidden md:block" />
      <Field label={`${m["services.price"]} (${property.currency})`} name="defaultPrice" type="number" step="0.01" defaultValue={service ? service.defaultPrice.toFixed(2) : "0.00"} required {...ro(rights.prices)} />
      <Select label={m["services.taxCode"]} name="taxCodeId" options={taxOptions} defaultValue={service?.taxCodeId} readOnly={!rights.tax} />
      <Field label={m["services.revenueAccount"]} name="revenueAccount" defaultValue={service?.revenueAccount} {...ro(rights.tax)} />
      <div className="flex flex-wrap gap-4 text-sm md:col-span-3">
        <label className="flex items-center gap-1">
          <input type="checkbox" name="bookableOnline" defaultChecked={service?.bookableOnline ?? false} disabled={!rights.settings} />
          {!rights.settings && service?.bookableOnline ? <input type="hidden" name="bookableOnline" value="on" /> : null}
          {m["services.bookableOnline"]}
        </label>
        {service ? (
          <label className="flex items-center gap-1">
            <input type="hidden" name="active" value="off" />
            <input type="checkbox" name="active" value="on" defaultChecked={service.active} disabled={!rights.settings} />
            {!rights.settings && service.active ? <input type="hidden" name="active" value="on" /> : null}
            {m["services.active"]}
          </label>
        ) : null}
      </div>
      {!rights.prices ? <p className="text-xs text-ink-60 md:col-span-3">{m["services.noRightPrices"]}</p> : null}
      {!rights.tax ? <p className="text-xs text-ink-60 md:col-span-3">{m["services.noRightTax"]}</p> : null}
    </ActionForm>
  );
}

function ServicesTab({ property, services, taxCodes, rights, language, m }: { property: PropertyInfo; services: Service[]; taxCodes: TaxCode[]; rights: Rights; language: Language; m: Messages }) {
  if (taxCodes.length === 0) return <p className="text-ink-60">{m["services.noTaxCodes"]}</p>;
  const canEdit = rights.settings || rights.prices || rights.tax;
  return (
    <div className="grid gap-4">
      {services.map((s) => {
        const split = s.currentTaxRate === null ? null : splitGross(s.defaultPrice, s.currentTaxRate);
        return (
          <details key={s.id} className={`rounded-2xl bg-surface-2 p-5 ${s.active ? "" : "opacity-60"}`}>
            <summary className="cursor-pointer">
              <span className="font-mono text-ink-80">{s.code}</span> <span className="font-medium">{s.name}</span>{" "}
              <span className="text-ink-60">
                · {formatCurrency(s.defaultPrice, property.currency, language, property.country)} · {s.taxCodeCode}
                {s.currentTaxRate !== null ? ` ${s.currentTaxRate} %` : ""}
                {split ? ` (${fill(m["services.netVat"], { net: formatCurrency(split.net, property.currency, language, property.country), vat: formatCurrency(split.vat, property.currency, language, property.country) })})` : ""} · {m[`services.rhythm.${s.postingRhythm}`]}
                {s.revenueAccount ? ` · ${s.revenueAccount}` : ""}
                {s.active ? "" : ` · ${m["services.inactive"]}`}
                {!s.names.de || !s.names.en ? ` · ${m["rooms.missingTranslation"]}` : ""}
              </span>
            </summary>
            {canEdit ? (
              <div className="mt-4">
                <ServiceForm property={property} service={s} taxCodes={taxCodes} rights={rights} m={m} />
              </div>
            ) : null}
          </details>
        );
      })}
      {rights.settings ? (
        <section className="rounded-2xl bg-surface-2 p-5">
          <h2 className="mb-3 font-medium">{m["services.newService"]}</h2>
          <ServiceForm property={property} taxCodes={taxCodes} rights={rights} m={m} />
        </section>
      ) : null}
    </div>
  );
}

function TaxCodesTab({ property, taxCodes, rights, presetAvailable, m }: { property: PropertyInfo; taxCodes: TaxCode[]; rights: Rights; presetAvailable: boolean; m: Messages }) {
  const today = property.today;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-60">{fill(m["services.taxCodesOf"], { legalEntity: property.legalEntityName })}</p>
      {rights.tax && presetAvailable ? (
        <section className="rounded-2xl bg-surface-2 p-5">
          <p className="mb-3 text-sm text-ink-60">{m["services.presetHelp"]}</p>
          <ActionForm action={applyPreset} submitLabel={fill(m["services.applyPreset"], { country: property.country })} pendingLabel={m["action.saving"]}>
            <input type="hidden" name="propertyId" value={property.id} />
          </ActionForm>
        </section>
      ) : null}
      {taxCodes.map((t) => (
        <details key={t.id} className="rounded-2xl bg-surface-2 p-5">
          <summary className="cursor-pointer">
            <span className="font-mono text-ink-80">{t.code}</span> <span className="font-medium">{t.name}</span>{" "}
            <span className="text-ink-60">· {t.currentRate !== null ? `${t.currentRate} % ${m["services.current"]}` : "–"}</span>
          </summary>
          <div className="mt-4 grid gap-4">
            <div>
              <h3 className="text-sm text-ink-80">{m["services.rateHistory"]}</h3>
              <ul className="mt-1 grid gap-1 text-sm">
                {t.rates.map((r) => (
                  <li key={r.validFrom} className="flex items-center gap-3">
                    <span className="font-mono">{r.validFrom}</span>
                    <span>{r.rate} %</span>
                    {rights.tax && t.rates.length > 1 && r.validFrom > today ? (
                      <ActionForm action={dropTaxRate} submitLabel={m["action.delete"]} className="inline-grid">
                        <input type="hidden" name="propertyId" value={property.id} />
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="validFrom" value={r.validFrom} />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            {rights.tax ? (
              <ActionForm action={saveTaxCode} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
                <input type="hidden" name="propertyId" value={property.id} />
                <input type="hidden" name="id" value={t.id} />
                <Field label={m["field.name"]} name="name" defaultValue={t.name} />
                <Field label={`${m["services.rate"]} (${m["services.addRate"]})`} name="rate" type="number" step="0.01" />
                <Field label={m["services.validFrom"]} name="validFrom" type="date" />
              </ActionForm>
            ) : null}
          </div>
        </details>
      ))}
      {rights.tax ? (
        <section className="rounded-2xl bg-surface-2 p-5">
          <h2 className="mb-3 font-medium">{m["services.newTaxCode"]}</h2>
          <ActionForm action={addTaxCode} submitLabel={m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-4">
            <input type="hidden" name="propertyId" value={property.id} />
            <Field label={m["rooms.code"]} name="code" required />
            <Field label={m["field.name"]} name="name" required />
            <Field label={m["services.rate"]} name="rate" type="number" step="0.01" required />
            <Field label={m["services.validFrom"]} name="validFrom" type="date" />
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
