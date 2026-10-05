import { FakeFiscalProvider } from "./fake";
import { FiskalyProvider } from "./fiskaly";
import { FiscalUnavailable, type FiscalProvider } from "./provider";

export * from "./provider";
export { FakeFiscalProvider } from "./fake";
export { FiskalyProvider } from "./fiskaly";
export { adminPinFor, seal, unseal } from "./secrets";

/** A provider that is not set up: every signature fails, so Receipts carry the outage notice and the managers hear of it. */
class UnconfiguredFiscalProvider extends FakeFiscalProvider {
  override down = true;
  override async createTss(): Promise<never> {
    throw new FiscalUnavailable("The fiscal provider is not configured (FISKALY_API_KEY, FISKALY_API_SECRET)");
  }
}

/**
 * The fiscal provider: fiskaly with its keys; without them the stand-in in
 * development and tests, and in production one that signs nothing (never a
 * made-up signature on a real Receipt).
 */
export function fiscalProvider(env: NodeJS.ProcessEnv = process.env): FiscalProvider {
  const g = globalThis as { __hsFiscalProvider?: FiscalProvider };
  if (g.__hsFiscalProvider) return g.__hsFiscalProvider;
  g.__hsFiscalProvider =
    env.FISKALY_API_KEY && env.FISKALY_API_SECRET ? new FiskalyProvider(env.FISKALY_API_KEY, env.FISKALY_API_SECRET) : env.NODE_ENV === "production" ? new UnconfiguredFiscalProvider() : devFake(env);
  return g.__hsFiscalProvider;
}

/** The development stand-in; FISCAL_FAKE_DOWN=1 plays an outage. */
function devFake(env: NodeJS.ProcessEnv): FakeFiscalProvider {
  const fake = new FakeFiscalProvider();
  fake.down = env.FISCAL_FAKE_DOWN === "1";
  return fake;
}

/** The platform's secret for the TSS admin PIN and the sealed PUK. */
export function fiscalSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.FISCAL_SECRET ?? (env.NODE_ENV === "production" ? "" : "development-fiscal-secret");
  if (s.length < 16) throw new Error("FISCAL_SECRET is not set");
  return s;
}
