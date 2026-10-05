/**
 * Message delivery (ticket 39, "Email, SMS and WhatsApp delivery
 * providers"): email through Mailgun EU, SMS through seven.io. Providers are
 * swappable; tests and development use the fakes.
 */
export interface MailAttachment {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface MailMessage {
  /** Sender address, and the name shown. */
  from: string;
  fromName: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: MailAttachment[];
  /** Carried through the provider and back in its events: which tenant and message an event is about. */
  tags: { tenantId: string; messageId: string };
}

export type MailEventType = "delivered" | "failed" | "complained";

export interface MailEvent {
  /** The provider's id of the event (replays are recognised by it). */
  id: string;
  type: MailEventType;
  /** For a failure: permanent (hard bounce) or temporary. */
  severity: "permanent" | "temporary" | null;
  tenantId: string | null;
  messageId: string | null;
  recipient: string;
  detail: string;
}

export interface MailProvider {
  readonly name: string;
  send(message: MailMessage): Promise<{ providerId: string }>;
  /** Whether an event really comes from the provider. */
  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean;
  parseEvent(rawBody: unknown): MailEvent | null;
  /** A hotel's own sending domain: registered at the provider on first ask; verified once its DNS records are in place. */
  domainStatus(domain: string): Promise<DomainStatus>;
}

export interface DomainStatus {
  verified: boolean;
  /** The DNS records the hotel must publish. */
  records: { type: string; name: string; value: string; valid: boolean }[];
}

export interface SmsProvider {
  readonly name: string;
  send(input: { to: string; text: string; sender: string }): Promise<{ providerId: string }>;
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    /** Worth trying again later (a timeout, a 5xx), or not (a refused address). */
    readonly retry: boolean,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}
