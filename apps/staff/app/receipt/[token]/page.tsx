import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { receiptByToken, signReceipt } from "@hoteloftware/db";
import { formatCurrency, localeFor, vatSplit } from "@hoteloftware/domain";
import { notifyFiscalOutage } from "@hoteloftware/events";
import { pool } from "@/lib/db";
import { fiscalDeps } from "@/lib/fiscal";
import { env } from "@/lib/env";
import { currentTenant } from "@/lib/tenant";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * A desk Receipt (ticket 50), separate from the invoice: shown on screen,
 * printed, or opened by the guest from its code without signing in. In
 * Germany it is signed by the TSE when first shown (ticket 51) and prints
 * the amounts per VAT rate, the TSE data and its QR code; when the TSE could
 * not sign, the outage notice instead.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) notFound();
  const { token } = await params;
  let r = await receiptByToken(pool(), tenant.schemaName, token);
  if (!r) notFound();
  if (r.fiscal?.state === "signing" || r.fiscal?.state === "at_unsigned") {
    // normally signed with the payment; one still open is tried once more here (the worker signs any left)
    const signed = await signReceipt(pool(), tenant.schemaName, fiscalDeps(), r.id).catch((err) => (console.error("[fiscal] sign", err), null));
    if (signed?.state === "failed" && signed.outageStarted) await notifyFiscalOutage(pool(), tenant, { propertyId: signed.propertyId, error: signed.error }).catch(() => undefined);
    if (signed && signed.state !== "none") r = (await receiptByToken(pool(), tenant.schemaName, token)) ?? r;
  }
  const f = r.fiscal;
  const tse = f?.state === "signed" || f?.state === "at_signed" ? await QRCode.toString(f.qrCodeData, { type: "svg", margin: 1, errorCorrectionLevel: "L" }) : null;
  const unix = (d: Date) => Math.floor(d.getTime() / 1000);
  const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
  const scheme = env.authUrl.startsWith("https") ? "https" : "http";
  const url = `${scheme}://${tenant.slug}.${env.appDomain}/receipt/${r.token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1 });
  const money = (n: number) => formatCurrency(n, r.currency, "de", r.legalEntity.country);
  const locale = localeFor("de", r.legalEntity.country);
  const tender = r.tender === "voucher" ? "Gutschein / Voucher" : r.tender === "bank_transfer" ? "Überweisung / Bank transfer" : r.tender === "cash" ? "Bar / Cash" : r.tender === "card_terminal" ? `Karte / Card${r.cardBrand ? ` ${r.cardBrand.toUpperCase()} •••• ${r.cardLast4}` : ""}` : r.tender;
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
      {/* issued on a device without a connection (ticket 62): signed when it synced */}
      {r.issuedOfflineAt ? (
        <p className="text-center font-bold" data-offline-receipt>
          {/* Austria: the signature unit's failure wording (RKSV); Germany: issued without the TSE, signed afterwards */}
          {r.legalEntity.country === "AT" ? "Sicherheitseinrichtung ausgefallen" : "TSE nicht erreichbar, nachträglich signiert"} / Issued offline{" "}
          {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: r.timeZone }).format(r.issuedOfflineAt)}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-1">
        {r.guestName ? (
          <>
            <dt>Gast / Guest</dt>
            <dd className="text-right">{r.guestName}</dd>
          </>
        ) : null}
        {r.confirmationNumber ? (
          <>
            <dt>Buchung / Booking</dt>
            <dd className="text-right">{r.confirmationNumber}</dd>
          </>
        ) : null}
        {/* the service paid for (KassenSichV: type and quantity); an Outlet Sale lists its items */}
        {r.outletSale ? (
          <>
            <dt>Outlet</dt>
            <dd className="text-right">
              {r.outletSale.outlet} · Bon {r.outletSale.bill}
            </dd>
            {/* Germany: the time of the first order (ticket 62); orders and Receipt share the bill as table key at the TSE */}
            {r.outletSale.firstOrderAt ? (
              <>
                <dt>Erste Bestellung / First order</dt>
                <dd className="text-right" data-first-order>
                  {new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: r.timeZone }).format(r.outletSale.firstOrderAt)}
                </dd>
              </>
            ) : null}
            {r.outletSale.lines.map((l, i) => (
              <div key={i} className="col-span-2 flex justify-between" data-receipt-line={l.description}>
                <span>
                  {l.quantity} × {l.description}
                </span>
                <span>{money(l.amount)}</span>
              </div>
            ))}
          </>
        ) : (
          <>
            <dt>Leistung / Service</dt>
            <dd className="text-right" data-receipt-service>
              {r.voucherSale
                ? `1 × Wertgutschein / Voucher ••••-${r.voucherSale.codeEnd}`
                : `1 × ${f && "businessCase" in f && f.businessCase === "Anzahlungseinstellung" ? "Anzahlung Übernachtung / Deposit, stay" : "Übernachtung / Hotel stay"} ${r.stay ? `${day(r.stay.arrival)}–${day(r.stay.departure)}` : ""}`}
            </dd>
          </>
        )}
        <dt>Zahlungsart / Tender</dt>
        <dd className="text-right">{tender}</dd>
        <dt className="font-bold">{r.refund ? "Erstattet / Refunded" : "Bezahlt / Paid"}</dt>
        <dd className="text-right font-bold" data-receipt-amount={Math.abs(r.amount)}>
          {money(Math.abs(r.amount))}
        </dd>
        {/* a tip on top (ticket 61): not part of the amount paid for the service */}
        {r.tip ? (
          <>
            <dt>Trinkgeld / Tip</dt>
            <dd className="text-right" data-receipt-tip={r.tip}>
              {money(r.tip)}
            </dd>
          </>
        ) : null}
      </dl>
      {f ? (
        <table className="w-full" data-receipt-vat>
          <thead>
            <tr>
              <th className="text-left font-normal">USt / VAT</th>
              <th className="text-right font-normal">Netto</th>
              <th className="text-right font-normal">USt</th>
              <th className="text-right font-normal">Brutto</th>
            </tr>
          </thead>
          <tbody>
            {f.amounts.map((a) => {
              const v = vatSplit(a.amount, a.rate);
              return (
                <tr key={String(a.rate)}>
                  <td>{a.rate === null ? "n. b." : `${String(a.rate).replace(".", ",")} %`}</td>
                  <td className="text-right">{money(Math.abs(v.excl))}</td>
                  <td className="text-right">{money(Math.abs(v.vat))}</td>
                  <td className="text-right">{money(Math.abs(v.incl))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <p className="text-[11px]">Keine Rechnung. Die Rechnung erhalten Sie separat. / Not an invoice; the invoice is issued separately.</p>
      {f?.state === "signed" ? (
        <section className="grid gap-1 text-[11px]" data-tse>
          <hr className="border-dashed border-black" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 break-all">
            <dt>TSE-Transaktion</dt>
            <dd>{f.number}</dd>
            <dt>TSE-Start</dt>
            <dd>{unix(f.timeStart)}</dd>
            <dt>TSE-Stop</dt>
            <dd>{unix(f.timeEnd)}</dd>
            <dt>TSE-Seriennummer</dt>
            <dd>{f.tssSerial}</dd>
            <dt>Kassen-Seriennummer</dt>
            <dd>{f.clientSerial}</dd>
            <dt>TSE-Signaturzähler</dt>
            <dd>{f.signatureCounter}</dd>
            <dt>TSE-Zeitformat</dt>
            <dd>{f.timestampFormat}</dd>
            <dt>TSE-Hashalgorithmus</dt>
            <dd>{f.algorithm}</dd>
            <dt>TSE-PublicKey</dt>
            <dd>{f.publicKey}</dd>
            <dt>TSE-Signatur</dt>
            <dd>{f.signature}</dd>
          </dl>
          {/* the TSE's own QR code, printed as the provider gives it (made on our server from the signed data) */}
          <div className="mx-auto w-40" data-tse-qr dangerouslySetInnerHTML={{ __html: tse! }} />
        </section>
      ) : f?.state === "at_signed" ? (
        <section className="grid gap-1 text-[11px]" data-rksv>
          <hr className="border-dashed border-black" />
          {f.cancellation ? <p className="font-bold">Stornobuchung</p> : null}
          {f.unitFailed ? <p className="font-bold">Sicherheitseinrichtung ausgefallen</p> : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 break-all">
            <dt>Kassen-ID</dt>
            <dd>{f.registerSerial}</dd>
            <dt>RKSV-Beleg</dt>
            <dd>{f.receiptNumber}</dd>
            <dt>RKSV-Datum</dt>
            <dd>{new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "medium", timeZone: r.timeZone }).format(f.timeSignature)}</dd>
          </dl>
          {/* the RKSV's machine-readable code, as the provider gives it (made on our server from the signed data) */}
          <div className="mx-auto w-40" data-rksv-qr dangerouslySetInnerHTML={{ __html: tse! }} />
        </section>
      ) : f?.state === "at_unsigned" ? (
        <section className="grid gap-1 text-[11px]" data-rksv-outage>
          <hr className="border-dashed border-black" />
          {f.cancellation ? <p className="font-bold">Stornobuchung</p> : null}
          <p className="font-bold">{f.notice}</p>
          {f.registerSerial ? <p>Kassen-ID {f.registerSerial}</p> : null}
        </section>
      ) : f?.state === "failed" ? (
        <section className="grid gap-1 text-[11px]" data-tse-outage>
          <hr className="border-dashed border-black" />
          <p className="font-bold">{f.notice}</p>
          <p>Kassen-Seriennummer {f.clientSerial}</p>
        </section>
      ) : null}
      <hr className="border-dashed border-black" />
      <p className="text-center text-[11px]">Beleg online / Receipt online</p>
      <div className="mx-auto w-32" dangerouslySetInnerHTML={{ __html: qr }} />
      <PrintButton />
    </main>
  );
}
