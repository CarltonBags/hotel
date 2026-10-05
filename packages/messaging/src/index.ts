import { FakeMailProvider, FakeSmsProvider } from "./fake";
import { MailgunProvider } from "./mailgun";
import type { MailProvider, SmsProvider } from "./provider";
import { SevenSmsProvider } from "./seven";

export * from "./provider";
export { FakeMailProvider, FakeSmsProvider } from "./fake";
export { MailgunProvider } from "./mailgun";
export { SevenSmsProvider } from "./seven";

/** Mail for this process: Mailgun EU when MAILGUN_API_KEY is set, else the fake (refused in production). One per process. */
export function mailProvider(env: NodeJS.ProcessEnv = process.env): MailProvider {
  const g = globalThis as { __hsMail?: MailProvider };
  if (g.__hsMail) return g.__hsMail;
  if (!env.MAILGUN_API_KEY && env.NODE_ENV === "production") throw new Error("MAILGUN_API_KEY is not set");
  if (env.MAILGUN_API_KEY && (!env.MAILGUN_DOMAIN || !env.MAILGUN_WEBHOOK_SIGNING_KEY)) throw new Error("MAILGUN_DOMAIN and MAILGUN_WEBHOOK_SIGNING_KEY are needed with MAILGUN_API_KEY");
  g.__hsMail = env.MAILGUN_API_KEY ? new MailgunProvider(env.MAILGUN_API_KEY, env.MAILGUN_DOMAIN!, env.MAILGUN_WEBHOOK_SIGNING_KEY!) : new FakeMailProvider();
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
