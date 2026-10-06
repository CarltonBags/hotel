import { DeliveryError, type SmsProvider } from "./provider";

/** seven.io (Germany): SMS for urgent staff alerts, from our own sender name. */
export class SevenSmsProvider implements SmsProvider {
  readonly name = "seven";
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(input: { to: string; text: string; sender: string }): Promise<{ providerId: string }> {
    let res: Response;
    try {
      res = await this.fetcher("https://gateway.seven.io/api/sms", {
        method: "POST",
        headers: { "x-api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ to: input.to, text: input.text.slice(0, 480), from: input.sender.slice(0, 11) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new DeliveryError(`seven.io not reached: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    if (!res.ok) throw new DeliveryError(`seven.io refused the SMS (${res.status})`, res.status >= 500);
    const body = (await res.json()) as { success?: string; messages?: { id?: string | number | null }[] };
    // seven.io answers 100 for success
    if (body.success !== "100") throw new DeliveryError(`seven.io did not send (code ${body.success ?? "?"})`, false);
    return { providerId: String(body.messages?.[0]?.id ?? "") };
  }
}
