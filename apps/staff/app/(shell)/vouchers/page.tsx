import { redirect } from "next/navigation";
import { listVouchers } from "@hoteloftware/db";
import { can, formatCurrency, formatDate, maskVoucherCode } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { VoucherDesk } from "./voucher-desk";

/** Vouchers at the desk (ticket 53): sell one, look a code up, the Vouchers in circulation with their balance. */
export default async function VouchersPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.vouchers"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  if (!can(shell.principal.actor, "sell_vouchers", property.id)) redirect("/not-allowed");
  const open = await listVouchers(pool(), shell.principal.tenant.schemaName, property.id, { open: true });
  const money = (v: number, c: string) => formatCurrency(v, c, language, property.country);
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.vouchers"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["voucher.help"]}</p>
      </div>
      <VoucherDesk propertyId={property.id} currency={property.currency} m={m} />
      <section aria-label={m["voucher.circulation"]} className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-vouchers>
        <h2 className="font-medium">{m["voucher.circulation"]}</h2>
        {open.length ? (
          <table className="w-full">
            <tbody>
              {open.map((v) => (
                <tr key={v.id} className="border-t border-ink-10" data-voucher={v.code.slice(-4)}>
                  <td className="py-1.5 font-mono">{maskVoucherCode(v.code)}</td>
                  <td>{v.recipientName || v.recipientEmail}</td>
                  <td className="text-ink-60">
                    {m["voucher.soldAt"]} {v.soldAtProperty}, {formatDate(v.soldAt, language, property.country, property.timeZone)}
                  </td>
                  <td className="text-right tabular-nums">{money(v.amount, v.currency)}</td>
                  <td className="text-right font-medium tabular-nums" data-balance>
                    {money(v.balance, v.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-ink-60">{m["voucher.none"]}</p>
        )}
      </section>
    </div>
  );
}
