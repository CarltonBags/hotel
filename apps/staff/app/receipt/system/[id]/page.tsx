import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { atSystemReceipt } from "@hoteloftware/db";
import { requireAllowed, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { PrintButton } from "../../[token]/print-button";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  INITIALIZATION: "Startbeleg",
  MONTHLY_CLOSE: "Monatsbeleg",
  YEARLY_CLOSE: "Jahresbeleg",
  DECOMMISSION: "Schlussbeleg",
  SIGNATURE_CREATION_UNIT_FAULT_CLEARANCE: "Sammelbeleg nach Ausfall",
};

/** A receipt the Austrian provider made itself (start, monthly, yearly), printable: the yearly one is printed and checked by 15 February (ticket 52). */
export default async function SystemReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requirePrincipal();
  const r = await atSystemReceipt(pool(), tenant.schemaName, (await params).id);
  if (!r) notFound();
  await requireAllowed("manage_cash_desk", r.propertyId);
  const qr = await QRCode.toString(r.qrCodeData, { type: "svg", margin: 1, errorCorrectionLevel: "L" });
  return (
    <main className="mx-auto grid max-w-sm gap-3 bg-white p-6 font-mono text-[13px] text-black print:p-0" data-system-receipt={r.type}>
      <p className="text-center font-bold">{LABEL[r.type] ?? r.type}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 break-all">
        <dt>Kassen-ID</dt>
        <dd>{r.registerSerial}</dd>
        <dt>RKSV-Beleg</dt>
        <dd>{r.receiptNumber}</dd>
        <dt>RKSV-Datum</dt>
        <dd>{new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Vienna" }).format(r.timeSignature)}</dd>
        <dt>Betrag</dt>
        <dd>0,00 €</dd>
        {r.validation ? (
          <>
            <dt>FinanzOnline</dt>
            <dd>{r.validation === "SUCCESS" ? "geprüft" : "Prüfung fehlgeschlagen"}</dd>
          </>
        ) : null}
        {r.checkBy ? (
          <>
            <dt>Prüfen bis</dt>
            <dd>{r.checkBy}</dd>
          </>
        ) : null}
      </dl>
      <div className="mx-auto w-40" dangerouslySetInnerHTML={{ __html: qr }} />
      <PrintButton />
    </main>
  );
}
