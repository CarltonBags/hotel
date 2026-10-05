import { notFound, redirect } from "next/navigation";
import { findProperty, outletBill, roomChargeSlip } from "@hoteloftware/db";
import { formatCurrency } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { outletAppContext } from "@/lib/outlets";
import { PrintButton } from "../../../../../receipt/[token]/print-button";

export const dynamic = "force-dynamic";

/** The Room Charge slip (ticket 61): the guest signs it when not on the device; room, surname and the items, never card data. */
export default async function RoomChargeSlipPage({ params }: { params: Promise<{ id: string; billId: string }> }) {
  const ctx = await outletAppContext();
  if (!ctx) redirect("/");
  const { id, billId } = await params;
  const viewer = { userId: ctx.session.user.id, actor: ctx.actor };
  const bill = await outletBill(pool(), ctx.tenant.schemaName, billId, viewer).catch(() => null);
  if (!bill || bill.outlet.id !== id || bill.status !== "charged" || !bill.roomCharge) notFound();
  const [slip, property] = await Promise.all([roomChargeSlip(pool(), ctx.tenant.schemaName, billId, viewer), findProperty(pool(), ctx.tenant.schemaName, bill.outlet.propertyId)]);
  const money = (n: number) => formatCurrency(n, property?.currency ?? "EUR", "de", property?.country ?? "DE");
  return (
    <main className="mx-auto grid max-w-sm gap-3 bg-white p-6 font-mono text-[13px] text-black print:p-0" data-slip>
      <header className="text-center">
        <p className="font-bold">{property?.name}</p>
        <p>
          {bill.outlet.name} · Bon {bill.number}
        </p>
        <p>{slip.closedAt.toISOString().slice(0, 16).replace("T", " ")}</p>
      </header>
      <hr className="border-dashed border-black" />
      <p className="text-center font-bold">
        Zimmer / Room {bill.roomCharge.room ?? "–"} · {bill.roomCharge.guest}
      </p>
      {slip.items.map((l, i) => (
        <p key={i} className="flex justify-between">
          <span>
            {l.quantity} × {l.description}
          </span>
          <span>{money(l.amount)}</span>
        </p>
      ))}
      {bill.discount ? (
        <p className="flex justify-between">
          <span>Rabatt / Discount {bill.discountPercent} %</span>
          <span>−{money(bill.discount)}</span>
        </p>
      ) : null}
      <p className="flex justify-between font-bold">
        <span>Aufs Zimmer / Charged to the room</span>
        <span>{money(slip.total)}</span>
      </p>
      <hr className="border-dashed border-black" />
      {/* signed on the device, or here on paper */}
      {slip.signature ? <img src={slip.signature} alt="Unterschrift / Signature" className="mx-auto h-24" /> : <div className="mt-10 border-b border-black" />}
      <p className="text-center text-[11px]">Unterschrift / Signature</p>
      <PrintButton />
    </main>
  );
}
