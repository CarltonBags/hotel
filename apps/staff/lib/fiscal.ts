import type { FiscalDeps } from "@hoteloftware/db";
import { fiscalProvider, fiscalSecret } from "@hoteloftware/fiscal";

/** The fiscal provider and the platform's fiscal secret (ticket 51); null when the secret is not set (nothing is signed). Server only. */
export function fiscalDeps(): FiscalDeps | null {
  try {
    return { provider: fiscalProvider(), secret: fiscalSecret() };
  } catch {
    return null;
  }
}
