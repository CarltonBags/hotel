import { redirect } from "next/navigation";
import { floorContext } from "@/lib/floor";
import { FloorRoot } from "./floor-root";

export const dynamic = "force-dynamic";

/**
 * The phone view for Housekeepers, Housekeeping Supervisors and Maintenance
 * (ticket 35). The page itself carries no data (it is kept for offline use);
 * the app fetches its day and keeps it encrypted on the phone.
 */
export default async function FloorPage() {
  if (!(await floorContext())) redirect("/");
  return <FloorRoot />;
}
