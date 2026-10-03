/**
 * The payment provider behind the PMS (ticket 27; research: Stripe Connect
 * direct charges with Stripe Terminal, Adyen as fallback). Everything the
 * PMS needs goes through this interface, so a second provider is another
 * implementation, not a rewrite. Amounts here are in major units (e.g.
 * euros); implementations convert. No card number ever passes: only
 * provider ids, the card brand and last four digits.
 */

export interface AccountStatus {
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
}

export interface ReaderInfo {
  readerId: string;
  label: string;
  deviceType: string;
}

export type IntentStatus = "waiting" | "authorised" | "succeeded" | "cancelled" | "failed";

/** A payment or hold at the provider, as the PMS needs to know it. */
export interface IntentState {
  intentId: string;
  status: IntentStatus;
  /** Amount asked for (major units). */
  amount: number;
  /** Still capturable on an authorised hold. */
  capturable: number;
  /** Captured so far. */
  received: number;
  currency: string;
  brand: string | null;
  last4: string | null;
  /** Token of the card for later use without the guest (never the number). */
  paymentMethodId: string | null;
  /** The provider's customer the card is saved to, for later merchant-initiated holds. */
  customerId: string | null;
  /** The provider's own capture deadline for a hold, when it reports one. */
  captureBefore: Date | null;
  /** True only when the provider confirms an extended authorisation for this hold. */
  extended: boolean;
  /** The provider's reason when it failed or was declined. */
  error: string | null;
}

export interface RefundResult {
  refundId: string;
  status: "succeeded" | "pending" | "failed" | "insufficient_balance";
  error: string | null;
}

/** A webhook event reduced to what the PMS acts on. */
export interface ProviderEvent {
  id: string;
  /** The connected account the event belongs to (finds the tenant). */
  accountId: string | null;
  type: "intent" | "refund" | "account" | "other";
  /** Intent, refund or account id the event is about. */
  objectId: string | null;
}

export interface TerminalPaymentInput {
  readerId: string;
  amount: number;
  currency: string;
  /** Manual capture: a Card Hold. */
  hold: boolean;
  /** Keyed card-not-present entry (OTA virtual card) on the reader. */
  moto: boolean;
  description: string;
  /** Identifiers only (ADR 0007): payment or hold id, tenant. */
  metadata: Record<string, string>;
  /** Same key, same result: a retried request never charges twice. */
  idempotencyKey: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** Test mode: the desk may simulate a card on a reader. */
  readonly testMode: boolean;

  createAccount(input: { businessName: string; country: string; email: string | null }): Promise<{ accountId: string }>;
  onboardingLink(accountId: string, urls: { returnUrl: string; refreshUrl: string }): Promise<string>;
  accountStatus(accountId: string): Promise<AccountStatus>;

  createLocation(accountId: string, input: { displayName: string; line1: string; city: string; postalCode: string; country: string }): Promise<{ locationId: string }>;
  registerReader(accountId: string, input: { registrationCode: string; label: string; locationId: string }): Promise<ReaderInfo>;

  /** Hand a payment or hold to a reader; the result arrives later (webhook or polling). */
  startTerminalPayment(accountId: string, input: TerminalPaymentInput): Promise<{ intentId: string }>;
  /** Test mode only: a card is presented on the reader. */
  simulateCard(accountId: string, readerId: string): Promise<void>;
  /** Stop waiting on the reader and drop the payment. */
  cancelTerminalPayment(accountId: string, readerId: string, intentId: string): Promise<void>;
  getIntent(accountId: string, intentId: string): Promise<IntentState>;

  incrementHold(accountId: string, intentId: string, newAmount: number, idempotencyKey: string): Promise<IntentState>;
  captureHold(accountId: string, intentId: string, amount: number, idempotencyKey: string): Promise<IntentState>;
  releaseHold(accountId: string, intentId: string): Promise<void>;
  /** A new hold on the saved card without the guest (merchant-initiated): to renew one before it expires, or for incidentals beyond a hold's limits. */
  holdSavedCard(
    accountId: string,
    input: { customerId: string; paymentMethodId: string; amount: number; currency: string; metadata: Record<string, string>; idempotencyKey: string },
  ): Promise<IntentState>;

  refund(accountId: string, input: { intentId: string; amount: number; metadata: Record<string, string>; idempotencyKey: string }): Promise<RefundResult>;
  getRefund(accountId: string, refundId: string): Promise<RefundResult>;

  /** Check a webhook's signature; null when it is not genuine. */
  verifyWebhook(rawBody: string, signature: string): ProviderEvent | null;
  /** The signature header the provider sends its webhooks with (lower case). */
  readonly signatureHeader: string;
  /** An already verified, stored event body reduced to what the PMS acts on. */
  parseEvent(body: unknown): ProviderEvent | null;
}

/** Thrown when the provider declines or cannot be reached; the message is safe to show. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}
