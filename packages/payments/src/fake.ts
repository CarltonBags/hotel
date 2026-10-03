import { randomUUID } from "node:crypto";
import type { AccountStatus, IntentState, PaymentProvider, ProviderEvent, RefundResult, TerminalPaymentInput } from "./provider";
import { ProviderError } from "./provider";

interface FakeIntent extends IntentState {
  accountId: string;
  readerId: string | null;
  hold: boolean;
  refunded: number;
}

/**
 * An in-memory provider for tests and for development without provider keys.
 * Behaves like the real flow: a reader payment waits until a card is
 * presented (simulateCard); a hold authorises, increments, captures and
 * releases. Amount 0.13 on a reader is declined, like a provider test card.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly testMode = true;
  readonly accounts = new Map<string, AccountStatus & { businessName: string }>();
  readonly readers = new Map<string, { accountId: string; label: string; pending: string | null }>();
  readonly intents = new Map<string, FakeIntent>();
  readonly refunds = new Map<string, RefundResult & { accountId: string }>();
  /** Idempotency: a key seen before returns what it returned then. */
  private readonly byKey = new Map<string, string>();
  /** Set to make refunds fail for lack of balance (provider debits the hotel's balance). */
  insufficientBalance = false;
  /** Set to make holds on the saved card decline. */
  declineSavedCard = false;
  /** Set to make refunds time out without an answer (the refund may or may not exist). */
  refundNoAnswer = false;

  async createAccount(input: { businessName: string }): Promise<{ accountId: string }> {
    const accountId = `acct_fake_${randomUUID().slice(0, 8)}`;
    this.accounts.set(accountId, { businessName: input.businessName, chargesEnabled: false, detailsSubmitted: false, payoutsEnabled: false });
    return { accountId };
  }

  async onboardingLink(accountId: string, urls: { returnUrl: string }): Promise<string> {
    // the fake onboarding is complete at once: the link leads straight back
    const a = this.account(accountId);
    Object.assign(a, { chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true });
    return urls.returnUrl;
  }

  async accountStatus(accountId: string): Promise<AccountStatus> {
    const { chargesEnabled, detailsSubmitted, payoutsEnabled } = this.account(accountId);
    return { chargesEnabled, detailsSubmitted, payoutsEnabled };
  }

  async createLocation(): Promise<{ locationId: string }> {
    return { locationId: `tml_fake_${randomUUID().slice(0, 8)}` };
  }

  async registerReader(accountId: string, input: { registrationCode: string; label: string }) {
    this.account(accountId);
    if (!/^[a-z0-9-]{3,}$/i.test(input.registrationCode)) throw new ProviderError("The registration code is not valid");
    const readerId = `tmr_fake_${input.registrationCode.toLowerCase()}`;
    this.readers.set(readerId, { accountId, label: input.label, pending: null });
    return { readerId, label: input.label, deviceType: "simulated_wisepos_e" };
  }

  async startTerminalPayment(accountId: string, input: TerminalPaymentInput): Promise<{ intentId: string }> {
    const known = this.byKey.get(input.idempotencyKey);
    if (known) return { intentId: known };
    this.revive(accountId, input.readerId);
    const reader = this.readers.get(input.readerId);
    if (!reader || reader.accountId !== accountId) throw new ProviderError("Reader not found");
    if (reader.pending) throw new ProviderError("The reader is busy with another payment");
    const intentId = `pi_fake_${randomUUID().slice(0, 12)}`;
    this.intents.set(intentId, {
      intentId,
      accountId,
      readerId: input.readerId,
      hold: input.hold,
      status: "waiting",
      amount: input.amount,
      capturable: 0,
      received: 0,
      currency: input.currency,
      brand: null,
      last4: null,
      paymentMethodId: null,
      customerId: null,
      captureBefore: null,
      extended: false,
      error: null,
      refunded: 0,
    });
    reader.pending = intentId;
    this.byKey.set(input.idempotencyKey, intentId);
    return { intentId };
  }

  async simulateCard(accountId: string, readerId: string): Promise<void> {
    this.revive(accountId, readerId);
    const reader = this.readers.get(readerId);
    if (!reader || reader.accountId !== accountId || !reader.pending) throw new ProviderError("Nothing is waiting on this reader");
    const intent = this.intents.get(reader.pending)!;
    reader.pending = null;
    if (Math.round(intent.amount * 100) === 13) {
      Object.assign(intent, { status: "failed", error: "Card declined" });
      return;
    }
    Object.assign(intent, {
      brand: "visa",
      last4: "4242",
      paymentMethodId: `pm_fake_${randomUUID().slice(0, 8)}`,
      customerId: intent.hold ? `cus_fake_${randomUUID().slice(0, 8)}` : null,
      ...(intent.hold ? { status: "authorised", capturable: intent.amount, captureBefore: new Date(Date.now() + 5 * 86_400_000) } : { status: "succeeded", received: intent.amount }),
    });
  }

  async cancelTerminalPayment(accountId: string, readerId: string, intentId: string): Promise<void> {
    const reader = this.readers.get(readerId);
    if (reader?.pending === intentId) reader.pending = null;
    const intent = this.intent(accountId, intentId);
    if (intent.status === "waiting") intent.status = "cancelled";
  }

  async getIntent(accountId: string, intentId: string): Promise<IntentState> {
    return this.view(this.intent(accountId, intentId));
  }

  async incrementHold(accountId: string, intentId: string, newAmount: number): Promise<IntentState> {
    // a repeated request repeats the result: the new total is set, not added
    const i = this.intent(accountId, intentId);
    if (i.status !== "authorised") throw new ProviderError("The hold is not active");
    Object.assign(i, { amount: newAmount, capturable: newAmount });
    return this.view(i);
  }

  async captureHold(accountId: string, intentId: string, amount: number): Promise<IntentState> {
    const i = this.intent(accountId, intentId);
    // a repeated capture returns the earlier result
    if (i.status === "succeeded" && i.hold) return this.view(i);
    if (i.status !== "authorised") throw new ProviderError("The hold is not active");
    if (amount > i.capturable + 0.005) throw new ProviderError("Cannot capture more than held");
    Object.assign(i, { status: "succeeded", received: amount, capturable: 0 });
    return this.view(i);
  }

  async releaseHold(accountId: string, intentId: string): Promise<void> {
    const i = this.intent(accountId, intentId);
    if (i.status === "authorised" || i.status === "waiting") Object.assign(i, { status: "cancelled", capturable: 0 });
  }

  async holdSavedCard(accountId: string, input: { customerId: string; paymentMethodId: string; amount: number; currency: string; idempotencyKey: string }): Promise<IntentState> {
    const known = this.byKey.get(input.idempotencyKey);
    if (known) return this.view(this.intent(accountId, known));
    if (this.declineSavedCard) throw new ProviderError("The card was declined");
    const intentId = `pi_fake_${randomUUID().slice(0, 12)}`;
    this.byKey.set(input.idempotencyKey, intentId);
    const i: FakeIntent = {
      intentId,
      accountId,
      readerId: null,
      hold: true,
      status: "authorised",
      amount: input.amount,
      capturable: input.amount,
      received: 0,
      currency: input.currency,
      brand: "visa",
      last4: "4242",
      paymentMethodId: input.paymentMethodId,
      customerId: input.customerId,
      captureBefore: new Date(Date.now() + 5 * 86_400_000),
      extended: false,
      error: null,
      refunded: 0,
    };
    this.intents.set(intentId, i);
    return this.view(i);
  }

  async refund(accountId: string, input: { intentId: string; amount: number; idempotencyKey: string }): Promise<RefundResult> {
    const known = this.byKey.get(input.idempotencyKey);
    if (known) {
      const r = this.refunds.get(known)!;
      return { refundId: r.refundId, status: r.status, error: r.error };
    }
    if (this.refundNoAnswer) throw new Error("timeout");
    const i = this.intent(accountId, input.intentId);
    if (i.status !== "succeeded") throw new ProviderError("Only a received payment can be refunded; a hold is released instead");
    if (input.amount > i.received - i.refunded + 0.005) throw new ProviderError("Cannot refund more than was received");
    const refundId = `re_fake_${randomUUID().slice(0, 10)}`;
    const result: RefundResult = this.insufficientBalance ? { refundId, status: "insufficient_balance", error: "Insufficient balance" } : { refundId, status: "succeeded", error: null };
    if (result.status !== "insufficient_balance") i.refunded += input.amount;
    this.refunds.set(refundId, { ...result, accountId });
    this.byKey.set(input.idempotencyKey, refundId);
    return result;
  }

  async getRefund(accountId: string, refundId: string): Promise<RefundResult> {
    const r = this.refunds.get(refundId);
    if (!r || r.accountId !== accountId) throw new ProviderError("Refund not found");
    return { refundId: r.refundId, status: r.status, error: r.error };
  }

  readonly signatureHeader = "x-fake-signature";

  parseEvent(body: unknown): ProviderEvent | null {
    const e = body as Partial<ProviderEvent> | null;
    return e && typeof e.id === "string" && typeof e.type === "string" ? { id: e.id, accountId: e.accountId ?? null, type: e.type, objectId: e.objectId ?? null } : null;
  }

  verifyWebhook(rawBody: string, signature: string): ProviderEvent | null {
    // the fake signs with the literal "fake-signature"
    if (signature !== "fake-signature") return null;
    try {
      return JSON.parse(rawBody) as ProviderEvent;
    } catch {
      return null;
    }
  }

  /**
   * Development across restarts: the database still knows accounts and
   * readers this in-memory fake made before; its own ids come back to life.
   */
  private revive(accountId: string, readerId?: string) {
    if (accountId.startsWith("acct_fake_") && !this.accounts.has(accountId)) {
      this.accounts.set(accountId, { businessName: "", chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true });
    }
    if (readerId?.startsWith("tmr_fake_") && !this.readers.has(readerId)) this.readers.set(readerId, { accountId, label: "", pending: null });
  }

  private account(accountId: string) {
    this.revive(accountId);
    const a = this.accounts.get(accountId);
    if (!a) throw new ProviderError("Payment account not found");
    return a;
  }

  private intent(accountId: string, intentId: string): FakeIntent {
    const i = this.intents.get(intentId);
    if (!i || i.accountId !== accountId) throw new ProviderError("Payment not found at the provider");
    return i;
  }

  private view(i: FakeIntent): IntentState {
    const { intentId, status, amount, capturable, received, currency, brand, last4, paymentMethodId, customerId, captureBefore, extended, error } = i;
    return { intentId, status, amount, capturable, received, currency, brand, last4, paymentMethodId, customerId, captureBefore, extended, error };
  }
}
