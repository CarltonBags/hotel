import type { DeviceInfo } from "@hoteloftware/auth";
import type { Tenant } from "@hoteloftware/db";
import { currentDevice } from "./device";
import { currentTenant } from "./tenant";

/** The guest tablet of this request: an enrolled guest Device of the host's tenant, not revoked. Server only. */
export async function currentTablet(): Promise<{ device: DeviceInfo; tenant: Tenant } | null> {
  return guestDevice("tablet");
}

/** The Self Check-in kiosk of this request (ticket 49): a guest Device enrolled as a kiosk. Server only. */
export async function currentKiosk(): Promise<{ device: DeviceInfo; tenant: Tenant } | null> {
  return guestDevice("kiosk");
}

async function guestDevice(mode: DeviceInfo["guestMode"]): Promise<{ device: DeviceInfo; tenant: Tenant } | null> {
  const [device, tenant] = await Promise.all([currentDevice(), currentTenant()]);
  if (!device || !tenant || device.revoked || device.kind !== "guest" || device.guestMode !== mode || device.tenantId !== tenant.id) return null;
  return { device, tenant };
}
