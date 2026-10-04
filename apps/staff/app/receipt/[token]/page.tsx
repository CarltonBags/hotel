import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { receiptByToken } from "@hoteloftware/db";
import { formatCurrency, localeFor } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { currentTenant } from "@/lib/tenant";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * A desk Receipt (ticket 50), separate from the invoice: shown on screen,
 * printed, or opened by the guest from its code without signing in. The
 * fiscal signature data comes with tickets 51 and 52.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) notFound();
  const { token } = await params;
  const r = await receiptByToken(pool(), tenant.schemaName, token);
  if (!r) notFound();
  const scheme = env.authUrl.startsWith("https") ? "https" : "http";
  const url = `${scheme}://${tenant.slug}.${env.appDomain}/receipt/${r.token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1 });
  const money = (n: number) => formatCurrency(n, r.currency, "de", r.legalEntity.country);
  const locale = localeFor("de", r.legalEntity.country);
  const tender = r.tender === "cash" ? "Bar / Cash" : r.tender === "card_terminal" ? `Karte / Card${r.cardBrand ? ` ${r.cardBrand.toUpperCase()} •••• ${r.cardLast4}` : ""}` : r.tender;
  return (
    <main className="mx-auto grid max-w-sm gap-3 bg-white p-6 font-mono text-[13px] text-black print:p-0">
      <header className="text-center">
        <p className="font-bold">{r.legalEntity.name}</p>
        <p>{r.propertyName}</p>
        <p>
          {r.legalEntity.addressLine1}, {r.legalEntity.postalCode} {r.legalEntity.city}
        </p>
        {r.legalEntity.vatId ? <p>USt-IdNr. / VAT {r.legalEntity.vatId}</p> : null}
      </header>
      <hr className="border-dashed border-black" />
      <p className="text-center font-bold" data-receipt-number={r.number}>
        {r.refund ? "Rückzahlung / Refund" : "Quittung / Receipt"} Nr. {r.number}
      </p>
      <p className="text-center">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: r.timeZone }).format(r.issuedAt)}</p>
      <dl className="grid grid-cols-2 gap-1">
        <dt>Gast / Guest</dt>
        <dd className="text-right">{r.guestName}</dd>
        <dt>Buchung / Booking</dt>
        <dd className="text-right">{r.confirmationNumber}</dd>
        <dt>Zahlungsart / Tender</dt>
        <dd className="text-right">{tender}</dd>
        <dt className="font-bold">{r.refund ? "Erstattet / Refunded" : "Bezahlt / Paid"}</dt>
        <dd className="text-right font-bold" data-receipt-amount={Math.abs(r.amount)}>
          {money(Math.abs(r.amount))}
        </dd>
      </dl>
      <p className="text-[11px]">Keine Rechnung. Die Rechnung erhalten Sie separat. / Not an invoice; the invoice is issued separately.</p>
      <hr className="border-dashed border-black" />
      <div className="mx-auto w-32" dangerouslySetInnerHTML={{ __html: qr }} />
      <PrintButton />
    </main>
  );
}
