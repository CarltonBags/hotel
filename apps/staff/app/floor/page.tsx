import { redirect } from "next/navigation";
import { floorContext } from "@/lib/floor";
import { outletAppContext } from "@/lib/outlets";
import { FloorRoot } from "./floor-root";

export const dynamic = "force-dynamic";

/**
 * The phone view for Housekeepers, Housekeeping Supervisors and Maintenance
 * (ticket 35). The page itself carries no data (it is kept for offline use);
 * the app fetches its day and keeps it encrypted on the phone.
 */
export default async function FloorPage() {
  // a PIN Sign-in lands here: Service and Spa Staff work the outlet app (ticket 60)
  if (!(await floorContext())) redirect((await outletAppContext()) ? "/outlet" : "/");
  return <FloorRoot />;
}
