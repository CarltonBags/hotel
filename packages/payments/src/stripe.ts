import Stripe from "stripe";
import type { AccountStatus, IntentState, IntentStatus, PaymentProvider, ProviderEvent, ReaderInfo, RefundResult, TerminalPaymentInput } from "./provider";
import { ProviderError } from "./provider";

/** Currencies without minor units at Stripe (none of the DACH ones; kept for safety). */
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp", "isk"]);
const toMinor = (amount: number, currency: string) => Math.round(amount * (ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100));
const toMajor = (minor: number, currency: string) => minor / (ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100);

/**
 * Stripe Connect with direct charges (research decision): every call on a
 * hotel's money carries its connected account (Stripe-Account header);
 * readers and locations belong to that account. Accounts are created as
 * Standard accounts through Stripe-hosted onboarding, carrying MCC 7011
 * (needed for 30-day extended holds). UNVERIFIED against a live Stripe test
 * account until the owner supplies test keys (ticket 27 open point).
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly testMode: boolean;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string | null,
  ) {
    this.stripe = new Stripe(secretKey);
    this.testMode = secretKey.startsWith("sk_test_");
  }

  private on(accountId: string, idempotencyKey?: string) {
    return idempotencyKey ? { stripeAccount: accountId, idempotencyKey } : { stripeAccount: accountId };
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // Stripe's messages are written for people (declines, invalid codes); never card data
      if (err instanceof Stripe.errors.StripeError) throw new ProviderError(err.message);
      throw err;
    }
  }

  async createAccount(input: { businessName: string; country: string; email: string | null }): Promise<{ accountId: string }> {
    const a = await this.call(() =>
      this.stripe.accounts.create({
        type: "standard",
        country: input.country,
        ...(input.email ? { email: input.email } : {}),
        business_profile: { name: input.businessName, mcc: "7011" },
      }),
    );
    return { accountId: a.id };
  }

  async onboardingLink(accountId: string, urls: { returnUrl: string; refreshUrl: string }): Promise<string> {
    const link = await this.call(() => this.stripe.accountLinks.create({ account: accountId, type: "account_onboarding", return_url: urls.returnUrl, refresh_url: urls.refreshUrl }));
    return link.url;
  }

  async accountStatus(accountId: string): Promise<AccountStatus> {
    const a = await this.call(() => this.stripe.accounts.retrieve(accountId));
    return { chargesEnabled: a.charges_enabled ?? false, detailsSubmitted: a.details_submitted ?? false, payoutsEnabled: a.payouts_enabled ?? false };
  }

  async createLocation(accountId: string, input: { displayName: string; line1: string; city: string; postalCode: string; country: string }): Promise<{ locationId: string }> {
    const l = await this.call(() =>
      this.stripe.terminal.locations.create({ display_name: input.displayName, address: { line1: input.line1, city: input.city, postal_code: input.postalCode, country: input.country } }, this.on(accountId)),
    );
    return { locationId: l.id };
  }

  async registerReader(accountId: string, input: { registrationCode: string; label: string; locationId: string }): Promise<ReaderInfo> {
    const r = await this.call(() => this.stripe.terminal.readers.create({ registration_code: input.registrationCode, label: input.label, location: input.locationId }, this.on(accountId)));
    return { readerId: r.id, label: r.label ?? input.label, deviceType: r.device_type };
  }

  async startTerminalPayment(accountId: string, input: TerminalPaymentInput): Promise<{ intentId: string }> {
    // keyed card-not-present entry on a reader is a Stripe beta enabled by Stripe Support (research); not wired until it is
    if (input.moto) throw new ProviderError("Keyed entry (MOTO) on the reader needs Stripe Support to enable it for this account first");
    // a hold saves the card to a customer, so it can be renewed or topped up later without the guest (generated card)
    const customer = input.hold
      ? await this.call(() => this.stripe.customers.create({ metadata: input.metadata }, this.on(accountId, `${input.idempotencyKey}:customer`)))
      : null;
    const intent = await this.call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: toMinor(input.amount, input.currency),
          currency: input.currency.toLowerCase(),
          allowed_payment_method_types: ["card_present"],
          capture_method: input.hold ? "manual" : "automatic",
          description: input.description,
          metadata: input.metadata,
          ...(customer
            ? {
                customer: customer.id,
                setup_future_usage: "off_session" as const,
                payment_method_options: { card_present: { request_extended_authorization: true, request_incremental_authorization_support: true } },
              }
            : {}),
        },
        this.on(accountId, input.idempotencyKey),
      ),
    );
    await this.call(() => this.stripe.terminal.readers.processPaymentIntent(input.readerId, { payment_intent: intent.id }, this.on(accountId)));
    return { intentId: intent.id };
  }

  async simulateCard(accountId: string, readerId: string): Promise<void> {
    if (!this.testMode) throw new ProviderError("Simulated cards exist in test mode only");
    await this.call(() => this.stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId, {}, this.on(accountId)));
  }

  async cancelTerminalPayment(accountId: string, readerId: string, intentId: string): Promise<void> {
    // the reader may have nothing left to cancel; that is fine
    await this.call(() => this.stripe.terminal.readers.cancelAction(readerId, {}, this.on(accountId))).catch(() => undefined);
    try {
      await this.stripe.paymentIntents.cancel(intentId, {}, this.on(accountId));
    } catch (err) {
      // already paid or already cancelled: the caller reads the intent's real state next
      if (err instanceof Stripe.errors.StripeError && err.code === "payment_intent_unexpected_state") return;
      if (err instanceof Stripe.errors.StripeError) throw new ProviderError(err.message);
      throw err;
    }
  }

  async getIntent(accountId: string, intentId: string): Promise<IntentState> {
    const pi = await this.call(() => this.stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, this.on(accountId)));
    return this.view(pi);
  }

  async incrementHold(accountId: string, intentId: string, newAmount: number, idempotencyKey: string): Promise<IntentState> {
    const current = await this.call(() => this.stripe.paymentIntents.retrieve(intentId, {}, this.on(accountId)));
    const pi = await this.call(() => this.stripe.paymentIntents.incrementAuthorization(intentId, { amount: toMinor(newAmount, current.currency) }, this.on(accountId, idempotencyKey)));
    return this.getIntent(accountId, pi.id);
  }

  async captureHold(accountId: string, intentId: string, amount: number, idempotencyKey: string): Promise<IntentState> {
    const current = await this.call(() => this.stripe.paymentIntents.retrieve(intentId, {}, this.on(accountId)));
    await this.call(() => this.stripe.paymentIntents.capture(intentId, { amount_to_capture: toMinor(amount, current.currency) }, this.on(accountId, idempotencyKey)));
    return this.getIntent(accountId, intentId);
  }

  async releaseHold(accountId: string, intentId: string): Promise<void> {
    await this.call(() => this.stripe.paymentIntents.cancel(intentId, {}, this.on(accountId)));
  }

  async holdSavedCard(
    accountId: string,
    input: { customerId: string; paymentMethodId: string; amount: number; currency: string; metadata: Record<string, string>; idempotencyKey: string },
  ): Promise<IntentState> {
    // merchant-initiated, off-session, with the card saved by the original hold (its generated card)
    const pi = await this.call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: toMinor(input.amount, input.currency),
          currency: input.currency.toLowerCase(),
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          allowed_payment_method_types: ["card"],
          capture_method: "manual",
          confirm: true,
          off_session: true,
          metadata: input.metadata,
        },
        this.on(accountId, input.idempotencyKey),
      ),
    );
    return this.getIntent(accountId, pi.id);
  }

  async refund(accountId: string, input: { intentId: string; amount: number; metadata: Record<string, string>; idempotencyKey: string }): Promise<RefundResult> {
    const pi = await this.call(() => this.stripe.paymentIntents.retrieve(input.intentId, {}, this.on(accountId)));
    try {
      const r = await this.stripe.refunds.create({ payment_intent: input.intentId, amount: toMinor(input.amount, pi.currency), metadata: input.metadata }, this.on(accountId, input.idempotencyKey));
      return { refundId: r.id, status: refundStatus(r.status), error: r.failure_reason ?? null };
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError && err.code === "balance_insufficient") return { refundId: "", status: "insufficient_balance", error: err.message };
      if (err instanceof Stripe.errors.StripeError) throw new ProviderError(err.message);
      throw err;
    }
  }

  async getRefund(accountId: string, refundId: string): Promise<RefundResult> {
    const r = await this.call(() => this.stripe.refunds.retrieve(refundId, {}, this.on(accountId)));
    return { refundId: r.id, status: refundStatus(r.status), error: r.failure_reason ?? null };
  }

  readonly signatureHeader = "stripe-signature";

  verifyWebhook(rawBody: string, signature: string): ProviderEvent | null {
    if (!this.webhookSecret) return null;
    try {
      return this.parseEvent(this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret));
    } catch {
      return null;
    }
  }

  parseEvent(body: unknown): ProviderEvent | null {
    const event = body as { id?: string; type?: string; account?: string; data?: { object?: { id?: string } } } | null;
    if (!event?.id || !event.type) return null;
    const t = event.type;
    const type = t.startsWith("payment_intent.") ? "intent" : t.startsWith("refund.") || t === "charge.refund.updated" ? "refund" : t === "account.updated" ? "account" : "other";
    return { id: event.id, accountId: event.account ?? null, type, objectId: event.data?.object?.id ?? null };
  }

  private view(pi: Stripe.PaymentIntent): IntentState {
    const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
    const present = charge?.payment_method_details?.card_present ?? null;
    const card = present ?? charge?.payment_method_details?.card ?? null;
    // a declined tap leaves the intent waiting for another card on the reader: still waiting, with the reason shown
    const status: IntentStatus = pi.status === "succeeded" ? "succeeded" : pi.status === "requires_capture" ? "authorised" : pi.status === "canceled" ? (pi.last_payment_error ? "failed" : "cancelled") : "waiting";
    return {
      intentId: pi.id,
      status,
      amount: toMajor(pi.amount, pi.currency),
      capturable: toMajor(pi.amount_capturable ?? 0, pi.currency),
      received: toMajor(pi.amount_received ?? 0, pi.currency),
      currency: pi.currency.toUpperCase(),
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      // the reusable card of a card-present payment is its generated card
      // only a generated card can be used again without the guest; a card-present method cannot
      paymentMethodId: present ? (present.generated_card ?? null) : typeof pi.payment_method === "string" ? pi.payment_method : (pi.payment_method?.id ?? null),
      customerId: typeof pi.customer === "string" ? pi.customer : (pi.customer?.id ?? null),
      captureBefore: card?.capture_before ? new Date(card.capture_before * 1000) : null,
      extended: (card as { extended_authorization?: { status?: string } } | null)?.extended_authorization?.status === "enabled",
      error: pi.last_payment_error?.message ?? null,
    };
  }
}

function refundStatus(s: string | null): RefundResult["status"] {
  return s === "succeeded" ? "succeeded" : s === "failed" || s === "canceled" ? "failed" : "pending";
}
