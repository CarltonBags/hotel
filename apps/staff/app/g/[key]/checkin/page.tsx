import { cookies } from "next/headers";
import { portalView } from "@hoteloftware/db";
import { portalLanguage } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { HERE_COOKIE } from "@/lib/here";
import { Glass } from "../../glass";
import { SelfCheckin } from "../../self-checkin";

export const dynamic = "force-dynamic";

/** Self Check-in on the guest's phone, from the Portal Link (ticket 49); the lobby QR code scanned before counts as being here. */
export default async function PhoneCheckinPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { key } = await params;
  const tenant = await currentTenant();
  const view = tenant ? await portalView(pool(), tenant.schemaName, key) : null;
  if (!view || view.kind !== "reservation") {
    return (
      <Glass>
        <p>Dieser Link öffnet nichts · This link does not open anything</p>
      </Glass>
    );
  }
  const here = (await cookies()).get(HERE_COOKIE)?.value === view.property.id;
  return <SelfCheckin channel="phone" portalKey={key} propertyName={view.property.name} language={portalLanguage((await searchParams).lang, view.language)} hereAlready={here} />;
}
