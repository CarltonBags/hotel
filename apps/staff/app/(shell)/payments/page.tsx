import Link from "next/link";
import { formatCurrency } from "@hoteloftware/domain";
import { listRecentPayments } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";

/** Payments and refunds at the property selected in the navbar over the last 7 days. */
export default async function PaymentsPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["plist.title"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant } = await requireAllowed("take_payments", property.id);
  const rows = await listRecentPayments(pool(), tenant.schemaName, property.id);
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  const when = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone });
  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["plist.title"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["plist.help"]}</p>
      </div>
      {rows.length === 0 ? <p className="text-ink-60">{m["plist.empty"]}</p> : null}
      {rows.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-ink-60">
            <tr className="border-b border-ink-10">
              <th className="py-2 pr-3 font-normal">{m["plist.when"]}</th>
              <th className="py-2 pr-3 font-normal">{m["res.confirmationShort"]}</th>
              <th className="py-2 pr-3 font-normal">{m["ws.col.guest"]}</th>
              <th className="py-2 pr-3 font-normal">{m["pay.tender"]}</th>
              <th className="py-2 pr-3 font-normal">{m["pay.amount"]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} data-payment={p.tender} className="border-b border-ink-5">
                <td className="py-2 pr-3 text-ink-60">{when.format(new Date(p.postedAt))}</td>
                <td className="py-2 pr-3">
                  <Link href={`/reservations/${p.reservationId}`} className="underline">
                    {p.confirmationNumber}
                  </Link>
                </td>
                <td className="py-2 pr-3">{p.guestName}</td>
                <td className="py-2 pr-3">
                  {p.refundOf ? `${m["pay.refundLabel"]} · ` : ""}
                  {m[`pay.tender.${p.tender}`]}
                  {p.cardLast4 ? ` •••• ${p.cardLast4}` : ""} · {m[`pay.status.${p.status}`]}
                </td>
                <td className={`py-2 pr-3 text-right tabular-nums ${p.status === "failed" ? "text-ink-60 line-through" : ""}`}>{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
