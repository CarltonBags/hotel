import { getSubscription, listSubscriptionInvoices } from "@hoteloftware/db";
import { ActionForm } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { paymentDetailsAction } from "./actions";

/** The subscription (ticket 88), the Owner's alone: payment details and the monthly invoices. */
export default async function SubscriptionPage() {
  const { messages: m, language } = await loadShell();
  const { tenant } = await requireAllowed("manage_subscription");
  const [sub, invoices] = await Promise.all([getSubscription(pool(), tenant.id), listSubscriptionInvoices(pool(), tenant.id)]);
  const input = "h-9 rounded-xl border border-ink-10 bg-surface px-2";
  const money = (n: number) => n.toLocaleString(language === "de" ? "de-DE" : "en-GB", { style: "currency", currency: "EUR" });
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6" data-subscription>
      <h1 className="text-xl font-medium">{m["module.settings_subscription"]}</h1>
      <section className="grid gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
        <h2 className="font-medium">{m["sub.payment"]}</h2>
        <p className="text-ink-60">
          {sub.paymentMethod === "sepa" && sub.mandateReference ? `${m["sub.sepa"]} · ${sub.accountHolder} · ${sub.mandateReference}${sub.accountLast4 ? ` · …${sub.accountLast4}` : ""}` : sub.paymentMethod === "transfer" ? m["sub.transfer"] : m["sub.none"]}
          {sub.yearly ? ` · ${m["sub.yearly"]}` : ""}
        </p>
        <ActionForm action={paymentDetailsAction} submitLabel={m["action.save"]} className="grid gap-2">
          <select name="method" defaultValue={sub.paymentMethod} className={input}>
            <option value="sepa">{m["sub.sepa"]}</option>
            <option value="transfer">{m["sub.transfer"]}</option>
          </select>
          <input name="accountHolder" defaultValue={sub.accountHolder ?? ""} placeholder={m["sub.holder"]} className={input} />
          <input name="mandateReference" defaultValue={sub.mandateReference ?? ""} placeholder={m["sub.mandate"]} className={input} />
          <input name="last4" defaultValue={sub.accountLast4 ?? ""} placeholder={m["sub.last4"]} inputMode="numeric" maxLength={4} className={`${input} w-32`} />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="yearly" defaultChecked={sub.yearly} /> {m["sub.yearlyChoice"]}
          </label>
          <p className="text-xs text-ink-60">{m["sub.cardNote"]}</p>
        </ActionForm>
      </section>
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm">
        <h2 className="font-medium">{m["sub.invoices"]}</h2>
        <ul className="grid gap-1" data-invoices>
          {invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap gap-3">
              <span className="font-medium">{i.number}</span>
              <span>{i.month}</span>
              <span className="tabular-nums">{money(i.gross)}</span>
              <a className="text-accent underline" href={`/subscription-invoice/${i.id}?f=pdf`} target="_blank">
                PDF
              </a>
              <a className="text-accent underline" href={`/subscription-invoice/${i.id}?f=xml`}>
                XRechnung
              </a>
            </li>
          ))}
          {invoices.length === 0 ? <li className="text-ink-60">{m["sub.noInvoices"]}</li> : null}
        </ul>
      </section>
    </div>
  );
}
