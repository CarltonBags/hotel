import { FakeFiscalProvider } from "./fake";
import { FiskalyProvider } from "./fiskaly";
import { FiscalUnavailable, type FiscalProvider } from "./provider";
import type { AtFiscalProvider } from "./at";
import { FakeAtFiscalProvider } from "./fake-at";
import { FiskalyAtProvider } from "./fiskaly-at";

export * from "./provider";
export * from "./at";
export { FakeAtFiscalProvider } from "./fake-at";
export { FiskalyAtProvider } from "./fiskaly-at";
export { FakeFiscalProvider } from "./fake";
export { FiskalyProvider } from "./fiskaly";
export { adminPinFor, seal, unseal } from "./secrets";

/** A provider that is not set up: every signature fails, so Receipts carry the outage notice and the managers hear of it. */
class UnconfiguredFiscalProvider implements FiscalProvider {
  readonly name = "unconfigured";
  private fail(): never {
    throw new FiscalUnavailable("The fiscal provider is not configured (FISKALY_API_KEY, FISKALY_API_SECRET)");
  }
  async createTss(): Promise<never> {
    this.fail();
  }
  async registerClient(): Promise<never> {
    this.fail();
  }
  async sign(): Promise<never> {
    this.fail();
  }
  async registerCashRegister(): Promise<never> {
    this.fail();
  }
  async closing(): Promise<never> {
    this.fail();
  }
  async tssExport(): Promise<never> {
    this.fail();
  }
  async dsfinvkExport(): Promise<never> {
    this.fail();
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

/**
 * Austria's provider: fiskaly, each Legal Entity with its own organisation's
 * keys (kept with the Legal Entity); the stand-in in development and tests
 * (FISCAL_FAKE_DOWN=1 plays an unreachable provider).
 */
export function atFiscalProvider(env: NodeJS.ProcessEnv = process.env): AtFiscalProvider {
  const g = globalThis as { __hsAtFiscalProvider?: AtFiscalProvider };
  if (g.__hsAtFiscalProvider) return g.__hsAtFiscalProvider;
  if (env.FISKALY_AT === "live" || env.NODE_ENV === "production") g.__hsAtFiscalProvider = new FiskalyAtProvider();
  else {
    const fake = new FakeAtFiscalProvider();
    fake.down = env.FISCAL_FAKE_DOWN === "1";
    g.__hsAtFiscalProvider = fake;
  }
  return g.__hsAtFiscalProvider;
}
