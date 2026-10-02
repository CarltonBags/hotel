import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { StripePaymentProvider } from "../src/index";

/** Seam: Stripe webhooks are accepted only with a valid signature and reduced to what the PMS acts on (no network). */
describe("Stripe webhooks", () => {
  const secret = "whsec_test_secret";
  const provider = new StripePaymentProvider("sk_test_dummy", secret);
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded", account: "acct_123", data: { object: { id: "pi_9", object: "payment_intent" } } });

  it("a signed event maps to its connected account and intent", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
    expect(provider.verifyWebhook(body, header)).toEqual({ id: "evt_1", accountId: "acct_123", type: "intent", objectId: "pi_9" });
  });

  it("a wrong signature or a tampered body is refused", () => {
    expect(provider.verifyWebhook(body, Stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_other" }))).toBeNull();
    const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
    expect(provider.verifyWebhook(body.replace("pi_9", "pi_8"), header)).toBeNull();
  });

  it("test keys mean test mode, live keys do not", () => {
    expect(provider.testMode).toBe(true);
    expect(new StripePaymentProvider("sk_live_dummy", null).testMode).toBe(false);
  });
});
