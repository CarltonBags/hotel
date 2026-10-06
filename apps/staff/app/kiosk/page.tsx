import { findProperty } from "@hoteloftware/db";
import { currentKiosk } from "@/lib/tablet";
import { pool } from "@/lib/db";
import { SelfCheckin } from "../g/self-checkin";

export const dynamic = "force-dynamic";

/** The lobby kiosk (ticket 49): Self Check-in for today's arrivals; an unknown or revoked device sends guests to reception. */
export default async function KioskPage() {
  const k = await currentKiosk();
  const property = k ? await findProperty(pool(), k.tenant.schemaName, k.device.propertyId) : null;
  if (!k || !property) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#0b1520] p-6 text-white">
        <p className="text-2xl">Bitte an der Rezeption melden · Please come to reception</p>
      </main>
    );
  }
  return <SelfCheckin channel="kiosk" propertyName={property.name} language={property.country === "DE" || property.country === "AT" || property.country === "CH" ? "de" : "en"} />;
}
