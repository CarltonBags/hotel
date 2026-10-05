/**
 * Automatic guest messages (ticket 39, "Notifications model"): the types,
 * when they go, which a property may switch off, the texts we ship in every
 * guest language, and the fixed layout they are rendered in.
 */
export const MESSAGE_TYPES = [
  "confirmation",
  "cancellation",
  "deposit_invoice",
  "payment_receipt",
  "final_invoice",
  "refund_notice",
  "fee_notice",
  "card_request",
  "balance_request",
  "pre_arrival",
  "welcome",
  "departure_eve",
  "thanks",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface MessageTypeInfo {
  /** A document or request goes at once; a service message within Sending Hours. */
  timing: "at_once" | "sending_hours";
  /** The property may switch it off. */
  switchable: boolean;
  /** On by default where switchable. */
  defaultOn: boolean;
  /** A hard bounce of it alerts the desk to call the guest. */
  critical: boolean;
  /** Mandatory content: stops neither for a spam complaint (essential) nor by switch. */
  essential: boolean;
  /** May go more than once per reservation (a changed booking re-sends the confirmation). */
  repeatable: boolean;
}

export const MESSAGE_TYPE_INFO: Record<MessageType, MessageTypeInfo> = {
  confirmation: { timing: "at_once", switchable: false, defaultOn: true, critical: true, essential: true, repeatable: true },
  cancellation: { timing: "at_once", switchable: false, defaultOn: true, critical: false, essential: true, repeatable: false },
  deposit_invoice: { timing: "at_once", switchable: false, defaultOn: true, critical: false, essential: true, repeatable: true },
  payment_receipt: { timing: "at_once", switchable: false, defaultOn: true, critical: false, essential: true, repeatable: true },
  final_invoice: { timing: "at_once", switchable: false, defaultOn: true, critical: false, essential: true, repeatable: true },
  refund_notice: { timing: "at_once", switchable: false, defaultOn: true, critical: false, essential: true, repeatable: true },
  fee_notice: { timing: "at_once", switchable: false, defaultOn: true, critical: false, essential: true, repeatable: false },
  card_request: { timing: "at_once", switchable: false, defaultOn: true, critical: true, essential: true, repeatable: true },
  balance_request: { timing: "at_once", switchable: true, defaultOn: true, critical: true, essential: true, repeatable: true },
  pre_arrival: { timing: "sending_hours", switchable: true, defaultOn: true, critical: false, essential: false, repeatable: false },
  welcome: { timing: "sending_hours", switchable: true, defaultOn: false, critical: false, essential: false, repeatable: false },
  departure_eve: { timing: "sending_hours", switchable: true, defaultOn: false, critical: false, essential: false, repeatable: false },
  thanks: { timing: "sending_hours", switchable: true, defaultOn: false, critical: false, essential: false, repeatable: false },
};

export const MESSAGE_LANGUAGES = ["de", "en"] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];

export interface MessageText {
  subject: string;
  /** Paragraphs; placeholders in {braces}. */
  blocks: string[];
}

/** The placeholders a text may use. The Portal Link and the reply address are wired with tickets 40 and 43. */
export const PLACEHOLDERS = ["guest_name", "hotel_name", "confirmation", "arrival", "departure", "amount", "document_number", "portal_link", "reply_address", "checkout_time"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** The texts we ship, per type and language; a property edits subject and blocks, never layout or footer. */
export const SHIPPED_TEXTS: Record<MessageType, Record<MessageLanguage, MessageText>> = {
  confirmation: {
    de: { subject: "Ihre Buchung {confirmation} im {hotel_name}", blocks: ["Guten Tag {guest_name},", "vielen Dank für Ihre Buchung. Wir freuen uns, Sie vom {arrival} bis {departure} bei uns zu begrüßen.", "Ihre Buchungsnummer: {confirmation}."] },
    en: { subject: "Your booking {confirmation} at {hotel_name}", blocks: ["Dear {guest_name},", "thank you for your booking. We look forward to welcoming you from {arrival} to {departure}.", "Your booking number: {confirmation}."] },
  },
  cancellation: {
    de: { subject: "Stornierung Ihrer Buchung {confirmation}", blocks: ["Guten Tag {guest_name},", "Ihre Buchung {confirmation} vom {arrival} bis {departure} ist storniert."] },
    en: { subject: "Your booking {confirmation} is cancelled", blocks: ["Dear {guest_name},", "your booking {confirmation} from {arrival} to {departure} is cancelled."] },
  },
  deposit_invoice: {
    de: { subject: "Anzahlungsrechnung {document_number}", blocks: ["Guten Tag {guest_name},", "vielen Dank für Ihre Anzahlung von {amount}. Ihre Anzahlungsrechnung {document_number} finden Sie im Anhang."] },
    en: { subject: "Deposit invoice {document_number}", blocks: ["Dear {guest_name},", "thank you for your deposit of {amount}. Your deposit invoice {document_number} is attached."] },
  },
  payment_receipt: {
    de: { subject: "Zahlungsbestätigung {confirmation}", blocks: ["Guten Tag {guest_name},", "wir haben Ihre Zahlung von {amount} erhalten. Vielen Dank."] },
    en: { subject: "Payment received for {confirmation}", blocks: ["Dear {guest_name},", "we have received your payment of {amount}. Thank you."] },
  },
  final_invoice: {
    de: { subject: "Ihre Rechnung {document_number}", blocks: ["Guten Tag {guest_name},", "vielen Dank für Ihren Aufenthalt. Ihre Rechnung {document_number} finden Sie im Anhang."] },
    en: { subject: "Your invoice {document_number}", blocks: ["Dear {guest_name},", "thank you for your stay. Your invoice {document_number} is attached."] },
  },
  refund_notice: {
    de: { subject: "Erstattung zu {confirmation}", blocks: ["Guten Tag {guest_name},", "wir haben Ihnen {amount} erstattet."] },
    en: { subject: "Refund for {confirmation}", blocks: ["Dear {guest_name},", "we have refunded {amount} to you."] },
  },
  fee_notice: {
    de: { subject: "Gebühr zu Ihrer Buchung {confirmation}", blocks: ["Guten Tag {guest_name},", "gemäß unseren Bedingungen berechnen wir eine Gebühr von {amount}."] },
    en: { subject: "Fee for your booking {confirmation}", blocks: ["Dear {guest_name},", "under our terms we charge a fee of {amount}."] },
  },
  card_request: {
    de: { subject: "Bitte hinterlegen Sie Ihre Karte für {confirmation}", blocks: ["Guten Tag {guest_name},", "zur Garantie Ihrer Buchung benötigen wir erneut eine gültige Karte: {portal_link}"] },
    en: { subject: "Please store your card for {confirmation}", blocks: ["Dear {guest_name},", "to guarantee your booking we need a valid card again: {portal_link}"] },
  },
  balance_request: {
    de: { subject: "Offener Betrag zu {confirmation}", blocks: ["Guten Tag {guest_name},", "für Ihre Buchung ist ein Betrag von {amount} offen. Sie können ihn hier bezahlen: {portal_link}"] },
    en: { subject: "Amount due for {confirmation}", blocks: ["Dear {guest_name},", "an amount of {amount} is due for your booking. You can pay it here: {portal_link}"] },
  },
  pre_arrival: {
    de: { subject: "Bald bei uns: Ihre Anreise am {arrival}", blocks: ["Guten Tag {guest_name},", "in Kürze reisen Sie an. Sparen Sie Zeit an der Rezeption und checken Sie vorab ein: {portal_link}"] },
    en: { subject: "See you soon: your arrival on {arrival}", blocks: ["Dear {guest_name},", "your arrival is coming up. Save time at reception and check in ahead: {portal_link}"] },
  },
  welcome: {
    de: { subject: "Willkommen im {hotel_name}", blocks: ["Guten Tag {guest_name},", "herzlich willkommen! Bei Fragen erreichen Sie die Rezeption jederzeit, auch per Antwort auf diese Nachricht."] },
    en: { subject: "Welcome to {hotel_name}", blocks: ["Dear {guest_name},", "welcome! Reception is there for you at any time, also by replying to this message."] },
  },
  departure_eve: {
    de: { subject: "Ihre Abreise morgen", blocks: ["Guten Tag {guest_name},", "morgen ist Ihr Abreisetag. Check-out bis {checkout_time}. Express-Check-out: {portal_link}"] },
    en: { subject: "Your departure tomorrow", blocks: ["Dear {guest_name},", "tomorrow is your departure day. Check-out by {checkout_time}. Express checkout: {portal_link}"] },
  },
  thanks: {
    de: { subject: "Danke für Ihren Besuch im {hotel_name}", blocks: ["Guten Tag {guest_name},", "vielen Dank für Ihren Aufenthalt. Ihre Rechnung finden Sie hier: {portal_link}"] },
    en: { subject: "Thank you for staying at {hotel_name}", blocks: ["Dear {guest_name},", "thank you for your stay. Your invoice is here: {portal_link}"] },
  },
};

export function fillPlaceholders(text: string, values: Partial<Record<Placeholder, string>>): string {
  return text.replace(/\{([a-z_]+)\}/g, (all, key: string) => ((PLACEHOLDERS as readonly string[]).includes(key) ? (values[key as Placeholder] ?? "") : all));
}

/** Placeholders a text uses that do not exist (a typo would stay visible to the guest). */
export function unknownPlaceholders(text: MessageText): string[] {
  const used = [text.subject, ...text.blocks].flatMap((t) => [...t.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!));
  return [...new Set(used.filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k)))];
}

export interface Branding {
  hotelName: string;
  /** Hex colour of the header. */
  accent: string;
}

export interface LegalFooter {
  name: string;
  address: string;
  vatId: string | null;
  register: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The fixed layout: header with the hotel's branding, the blocks, the Legal Entity's legal footer. Text and HTML. */
export function renderMessage(text: MessageText, values: Partial<Record<Placeholder, string>>, branding: Branding, footer: LegalFooter): { subject: string; html: string; text: string } {
  const subject = fillPlaceholders(text.subject, values);
  const blocks = text.blocks.map((b) => fillPlaceholders(b, values));
  const legal = [footer.name, footer.address, footer.vatId ? `VAT ${footer.vatId}` : "", footer.register ?? ""].filter(Boolean);
  const accent = /^#[0-9a-f]{6}$/i.test(branding.accent) ? branding.accent : "#0071e3";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${accent};color:#fff;padding:20px 28px;font-size:20px;font-weight:600">${esc(branding.hotelName)}</td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.5">${blocks.map((b) => `<p style="margin:0 0 12px">${esc(b).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + accent + '">$1</a>')}</p>`).join("")}</td></tr>
<tr><td style="padding:16px 28px;font-size:11px;color:#6e6e73;border-top:1px solid #eee">${legal.map(esc).join(" · ")}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text: `${blocks.join("\n\n")}\n\n--\n${legal.join(" · ")}` };
}

/** When a message may go: at once, or the next moment inside Sending Hours (local times "HH:MM"). */
export function sendAfter(timing: MessageTypeInfo["timing"], localNow: { date: string; time: string }, hours: { from: string; to: string }): { date: string; time: string } {
  if (timing === "at_once") return localNow;
  if (localNow.time < hours.from) return { date: localNow.date, time: hours.from };
  if (localNow.time >= hours.to) {
    const d = new Date(`${localNow.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return { date: d.toISOString().slice(0, 10), time: hours.from };
  }
  return localNow;
}

/** The guest's language if the property uses guest languages and it is one we ship; otherwise the property's fallback. */
export function messageLanguage(guestLanguage: string | null, useGuestLanguage: boolean, fallback: MessageLanguage): MessageLanguage {
  return useGuestLanguage && guestLanguage && (MESSAGE_LANGUAGES as readonly string[]).includes(guestLanguage) ? (guestLanguage as MessageLanguage) : fallback;
}

/** A free-mail domain cannot be the sender. */
const FREE_MAIL = ["gmail.com", "googlemail.com", "gmx.de", "gmx.net", "web.de", "yahoo.com", "yahoo.de", "outlook.com", "hotmail.com", "hotmail.de", "live.com", "icloud.com", "me.com", "t-online.de", "aol.com", "freenet.de", "posteo.de", "proton.me", "protonmail.com"];
export function senderDomainProblem(domain: string): "invalid" | "free_mail" | null {
  const d = domain.trim().toLowerCase();
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) return "invalid";
  return FREE_MAIL.includes(d) ? "free_mail" : null;
}

/** Staff alert kinds sent by SMS too, to Property Manager and Owner only. */
export const URGENT_ALERTS = ["service.outage", "fiscal.outage", "guest_message.escalated", "night_audit.overdue"] as const;
