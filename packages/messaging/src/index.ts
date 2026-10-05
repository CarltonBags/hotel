import { FakeMailProvider, FakeSmsProvider } from "./fake";
import { MailgunProvider } from "./mailgun";
import type { MailProvider, SmsProvider } from "./provider";
import { SevenSmsProvider } from "./seven";

export * from "./provider";
export { FakeMailProvider, FakeSmsProvider } from "./fake";
export { MailgunProvider } from "./mailgun";
export { SevenSmsProvider } from "./seven";
export { FakeWhatsAppProvider, MetaCloudProvider, UnconfiguredWhatsAppProvider, parseMetaWebhook, templateParam, type TemplateState, type WhatsAppAccount, type WhatsAppEvent, type WhatsAppProvider, type WhatsAppTemplate } from "./whatsapp";
import { FakeWhatsAppProvider, MetaCloudProvider, UnconfiguredWhatsAppProvider, type WhatsAppProvider } from "./whatsapp";

/** WhatsApp for this process: Meta's Cloud API with META_APP_ID, META_APP_SECRET and META_SYSTEM_TOKEN; without them the fake in development (its webhooks need WEBHOOK_TEST_SECRET), and in production none (the Module cannot send, email is used). */
export function whatsAppProvider(env: NodeJS.ProcessEnv = process.env): WhatsAppProvider {
  const g = globalThis as { __hsWhatsApp?: WhatsAppProvider };
  if (g.__hsWhatsApp) return g.__hsWhatsApp;
  if (!env.META_SYSTEM_TOKEN && env.NODE_ENV === "production") return (g.__hsWhatsApp = new UnconfiguredWhatsAppProvider());
  if (env.META_SYSTEM_TOKEN && (!env.META_APP_ID || !env.META_APP_SECRET)) throw new Error("META_APP_ID and META_APP_SECRET are needed with META_SYSTEM_TOKEN");
  g.__hsWhatsApp = env.META_SYSTEM_TOKEN
    ? new MetaCloudProvider({ appId: env.META_APP_ID!, appSecret: env.META_APP_SECRET!, systemToken: env.META_SYSTEM_TOKEN, verifyToken: env.META_WEBHOOK_VERIFY_TOKEN ?? "" })
    : new FakeWhatsAppProvider(env.WEBHOOK_TEST_SECRET ?? "");
  return g.__hsWhatsApp;
}

/** Mail for this process: Mailgun EU when MAILGUN_API_KEY is set, else the fake (refused in production; its events need WEBHOOK_TEST_SECRET). One per process: the first call's environment decides. */
export function mailProvider(env: NodeJS.ProcessEnv = process.env): MailProvider {
  const g = globalThis as { __hsMail?: MailProvider };
  if (g.__hsMail) return g.__hsMail;
  if (!env.MAILGUN_API_KEY && env.NODE_ENV === "production") throw new Error("MAILGUN_API_KEY is not set");
  if (env.MAILGUN_API_KEY && (!env.MAILGUN_DOMAIN || !env.MAILGUN_WEBHOOK_SIGNING_KEY)) throw new Error("MAILGUN_DOMAIN and MAILGUN_WEBHOOK_SIGNING_KEY are needed with MAILGUN_API_KEY");
  g.__hsMail = env.MAILGUN_API_KEY ? new MailgunProvider(env.MAILGUN_API_KEY, env.MAILGUN_DOMAIN!, env.MAILGUN_WEBHOOK_SIGNING_KEY!) : new FakeMailProvider(env.WEBHOOK_TEST_SECRET ?? "");
  return g.__hsMail;
}

/** SMS for this process: seven.io when SEVEN_API_KEY is set, else the fake (refused in production). */
export function smsProvider(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const g = globalThis as { __hsSms?: SmsProvider };
  if (g.__hsSms) return g.__hsSms;
  if (!env.SEVEN_API_KEY && env.NODE_ENV === "production") throw new Error("SEVEN_API_KEY is not set");
  g.__hsSms = env.SEVEN_API_KEY ? new SevenSmsProvider(env.SEVEN_API_KEY) : new FakeSmsProvider();
  return g.__hsSms;
}

/** What one WhatsApp message costs us at Meta (WHATSAPP_MESSAGE_COST, euro), passed on at cost plus handling. */
export function whatsAppMessageCost(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.WHATSAPP_MESSAGE_COST ?? "0");
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
