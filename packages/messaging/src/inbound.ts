import type { InboundMail } from "./provider";

/**
 * The notice of an incoming mail as Mailgun's store-and-notify route sends it
 * (form fields; the fake uses the same): recipient, sender, subject, the
 * stripped reply text, the headers as JSON pairs and the stored attachments.
 */
export function inboundFromFields(f: Record<string, string>): InboundMail | null {
  const recipient = f.recipient ?? "";
  const id = f["Message-Id"] ?? f["message-id"] ?? f.token ?? "";
  if (!recipient || !id) return null;
  const headers: Record<string, string> = {};
  try {
    for (const [k, v] of JSON.parse(f["message-headers"] ?? "[]") as [string, string][]) headers[String(k).toLowerCase()] = String(v);
  } catch {
    // no headers: judged by the subject alone
  }
  let attachments: InboundMail["attachments"] = [];
  try {
    attachments = (JSON.parse(f.attachments ?? "[]") as { url?: string; "content-type"?: string; name?: string; size?: number }[])
      .filter((a) => a.url)
      .map((a) => ({ name: a.name ?? "attachment", type: a["content-type"] ?? "application/octet-stream", size: Number(a.size ?? 0), url: a.url! }));
  } catch {
    attachments = [];
  }
  return { id, recipient, sender: f.sender ?? f.from ?? "", subject: f.subject ?? "", text: f["stripped-text"] ?? f["body-plain"] ?? "", headers, attachments };
}
