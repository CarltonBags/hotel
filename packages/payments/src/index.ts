import { FakePaymentProvider } from "./fake";
import type { PaymentProvider } from "./provider";
import { StripePaymentProvider } from "./stripe";

export * from "./provider";
export { FakePaymentProvider } from "./fake";
export { StripePaymentProvider } from "./stripe";

/**
 * The provider for this process: Stripe when STRIPE_SECRET_KEY is set, else
 * the in-memory fake (development and tests only; refused in production).
 * One instance per process, so the fake keeps its state between requests.
 */
export function paymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const g = globalThis as { __hsPaymentProvider?: PaymentProvider };
  if (g.__hsPaymentProvider) return g.__hsPaymentProvider;
  const key = env.STRIPE_SECRET_KEY;
  if (!key && env.NODE_ENV === "production") throw new Error("STRIPE_SECRET_KEY is not set");
  g.__hsPaymentProvider = key ? new StripePaymentProvider(key, env.STRIPE_WEBHOOK_SECRET ?? null) : new FakePaymentProvider();
  return g.__hsPaymentProvider;
}
