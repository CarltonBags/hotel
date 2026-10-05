import { redirect } from "next/navigation";
import { deviceMessages } from "@/lib/device";
import { outletAppContext } from "@/lib/outlets";
import { OutletTill } from "./outlet-till";

export const dynamic = "force-dynamic";

/**
 * The outlet till that keeps selling without a connection (ticket 62). The
 * page itself carries no data (it is kept for offline use); the till keeps
 * the outlet's last snapshot and what it did offline on the device.
 */
export default async function OutletTillPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await outletAppContext())) redirect("/");
  return <OutletTill outletId={(await params).id} m={await deviceMessages()} />;
}
