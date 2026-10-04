import type { DeviceInfo } from "@hoteloftware/auth";
import type { Tenant } from "@hoteloftware/db";
import { currentDevice } from "./device";
import { currentTenant } from "./tenant";

/** The guest tablet of this request: an enrolled guest Device of the host's tenant, not revoked. Server only. */
export async function currentTablet(): Promise<{ device: DeviceInfo; tenant: Tenant } | null> {
  const [device, tenant] = await Promise.all([currentDevice(), currentTenant()]);
  if (!device || !tenant || device.revoked || device.kind !== "guest" || device.tenantId !== tenant.id) return null;
  return { device, tenant };
}
