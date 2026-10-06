import { redirect } from "next/navigation";
import { deviceMessages } from "@/lib/device";
import { outletAppContext } from "@/lib/outlets";
import { OfflineSales } from "./offline-sales";

export const dynamic = "force-dynamic";

/**
 * Offline Sales at an outlet (ticket 62): selling on without a connection.
 * The page itself carries no data (it is kept for offline use); the device
 * keeps the outlet's last snapshot and what it sold offline.
 */
export default async function OfflineSalesPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await outletAppContext())) redirect("/");
  return <OfflineSales outletId={(await params).id} m={await deviceMessages()} />;
}
