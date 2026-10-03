import Link from "next/link";
import { AGEING_BUCKETS, formatCurrency } from "@hoteloftware/domain";
import { listCancellationInvoices, listReceivables, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { ReceivablesTable } from "./receivables-table";

/** Receivables at the property selected in the navbar: ageing, per Company, transfers matched by hand, reminders; and the Cancellation Invoices. */
export default async function ReceivablesPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["rcv.title"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_receivables", property.id);
  const [open, cancellations, users] = await Promise.all([
    listReceivables(pool(), tenant.schemaName, property.id),
    listCancellationInvoices(pool(), tenant.schemaName, property.id),
    listTenantUsers(pool(), tenant.id),
  ]);
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const currency = { code: property.currency, language, country: property.country };
  const money = (v: number) => formatCurrency(v, currency.code, language, currency.country);
  const day = (d: string) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["rcv.title"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["rcv.help"]}</p>
      </div>
      <dl aria-label={m["rcv.total"]} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {AGEING_BUCKETS.map((b) => (
          <div key={b} data-bucket={b} className="rounded-2xl bg-surface-2 p-3">
            <dt className="text-xs text-ink-60">{m[`rcv.bucket.${b}`]}</dt>
            <dd className="tabular-nums">{money(open.ageing[b])}</dd>
          </div>
        ))}
        <div data-bucket="total" className="rounded-2xl bg-accent/10 p-3">
          <dt className="text-xs text-ink-60">{m["rcv.total"]}</dt>
          <dd className="font-medium tabular-nums">{money(open.ageing.total)}</dd>
        </div>
      </dl>
      {open.rows.length === 0 ? <p className="text-ink-60">{m["rcv.empty"]}</p> : <ReceivablesTable propertyId={property.id} today={open.today} rows={open.rows} currency={currency} m={m} />}
      <section aria-label={m["rcv.cxlTitle"]} className="grid gap-2">
        <h2 className="font-medium">{m["rcv.cxlTitle"]}</h2>
        {cancellations.length === 0 ? <p className="text-sm text-ink-60">{m["rcv.cxlEmpty"]}</p> : null}
        <ul className="grid gap-1 text-sm">
          {cancellations.map((c) => (
            <li key={c.id} data-cancellation={c.number} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <a href={`/invoices/${c.id}/pdf`} target="_blank" rel="noreferrer" className="font-medium underline">
                  {c.number}
                </a>{" "}
                · {fill(m["rcv.cxlCancels"], { number: c.cancelsNumber })} · {c.billToName} · {day(c.issueDate)} · {userName(c.issuedBy)} · <span className="text-ink-60">{c.reason}</span>
              </span>
              <Link href={`/reservations/${c.reservationId}`} className="text-ink-60 underline">
                {m["res.confirmationShort"]}
              </Link>
              <span className="tabular-nums">{money(c.gross)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
