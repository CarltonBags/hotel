import { can } from "@hoteloftware/domain";
import { listLegalEntities, listPaymentAccounts, listTerminalReaders, refreshPaymentAccount } from "@hoteloftware/db";
import { paymentProvider } from "@hoteloftware/payments";
import { requireAllowedAnywhere } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { ActionForm, Field } from "@/components/form-fields";
import { onboardAction, pairReaderAction, refreshAccountAction, refundLimitAction, removeReaderAction } from "./actions";

/**
 * Payments set-up (ticket 27): each Legal Entity's account at the payment
 * provider (Owner and Tenant Admin), and per property its card readers and
 * the Front Desk refund limit (Property Manager).
 */
export default async function PaymentSettingsPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { tenant, actor } = await requireAllowedAnywhere("manage_payment_settings");
  const { messages: m, properties, scope } = await loadShell();
  const provider = paymentProvider();
  // a Legal Entity's account is managed by a Property Manager of one of its properties (Owner and Tenant Admin everywhere)
  const canAccount = (legalEntityId: string) => properties.some((p) => p.legalEntityId === legalEntityId && can(actor, "manage_payment_settings", p.id));
  // back from the provider's onboarding: read the account's new state
  const back = (await searchParams).account;
  if (back && canAccount(back)) await refreshPaymentAccount(pool(), tenant.schemaName, provider, back).catch(() => undefined);
  const [entities, accounts] = await Promise.all([listLegalEntities(pool(), tenant.schemaName), listPaymentAccounts(pool(), tenant.schemaName)]);
  const property = properties.find((p) => p.id === scope);
  const readers = property ? await listTerminalReaders(pool(), tenant.schemaName, property.id) : [];
  const manageProperty = property ? can(actor, "manage_payment_settings", property.id) : false;
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">{m["module.settings_payments"]}</h1>
        <p className="text-sm text-ink-60">
          {fill(m["pset.provider"], { name: provider.name === "stripe" ? "Stripe" : m["pset.simulated"] })}
          {provider.testMode ? ` · ${m["pay.testMode"]}` : ""}
        </p>
      </div>

      <section aria-label={m["pset.accounts"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
        <h2 className="font-medium">{m["pset.accounts"]}</h2>
        <p className="text-xs text-ink-60">{m["pset.accountsHelp"]}</p>

        <ul className="grid gap-2">
          {entities.map((le) => {
            const a = accounts.find((x) => x.legalEntityId === le.id);
            return (
              <li key={le.id} data-legal-entity={le.name} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3">
                <span className="min-w-0 flex-1">
                  <strong>{le.name}</strong> · {a ? (a.chargesEnabled ? m["pset.ready"] : m["pset.notReady"]) : m["pset.none"]}
                </span>
                {canAccount(le.id) && !a?.chargesEnabled ? (
                  <ActionForm action={onboardAction} submitLabel={a ? m["pset.continue"] : m["pset.setUp"]} pendingLabel={m["action.saving"]} className="flex">
                    <input type="hidden" name="legalEntityId" value={le.id} />
                  </ActionForm>
                ) : null}
                {canAccount(le.id) && a ? (
                  <ActionForm action={refreshAccountAction} submitLabel={m["pset.refresh"]} pendingLabel={m["action.saving"]} className="flex">
                    <input type="hidden" name="legalEntityId" value={le.id} />
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {property && manageProperty ? (
        <>
          <section aria-label={m["pset.readers"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
            <h2 className="font-medium">
              {m["pset.readers"]} · {property.name}
            </h2>
            <p className="text-xs text-ink-60">{m["pset.readersHelp"]}</p>
            {readers.length === 0 ? <p className="text-ink-60">{m["pset.noReaders"]}</p> : null}
            <ul className="grid gap-1">
              {readers.map((r) => (
                <li key={r.id} data-reader={r.label} className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2">
                  <span>
                    <strong>{r.label}</strong> <span className="text-ink-60">· {r.deviceType}</span>
                  </span>
                  <ActionForm action={removeReaderAction} submitLabel={m["pset.remove"]} pendingLabel={m["action.saving"]} className="flex">
                    <input type="hidden" name="propertyId" value={property.id} />
                    <input type="hidden" name="id" value={r.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
            <ActionForm action={pairReaderAction} submitLabel={m["pset.pair"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
              <input type="hidden" name="propertyId" value={property.id} />
              <Field label={m["pset.code"]} name="code" required />
              <Field label={m["pset.label"]} name="label" required />
            </ActionForm>
          </section>

          <section aria-label={m["pset.limit"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm">
            <h2 className="font-medium">{m["pset.limit"]}</h2>
            <p className="text-xs text-ink-60">{m["pset.limitHelp"]}</p>
            <ActionForm action={refundLimitAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
              <input type="hidden" name="propertyId" value={property.id} />
              <Field label={`${m["pset.limit"]} (${property.currency})`} name="limit" defaultValue={String(property.refundLimit)} />
            </ActionForm>
          </section>
        </>
      ) : (
        <p className="text-sm text-ink-60">{m["lists.pickProperty"]}</p>
      )}
    </div>
  );
}
