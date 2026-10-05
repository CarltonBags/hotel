import type { MessageType } from "./messages";

/**
 * WhatsApp as a transport (ticket 44, "Guest messaging extensions"): a
 * Module per property with its own business number. Free text only within 24
 * hours after the guest's last message, otherwise approved templates; service
 * messages only (documents stay email); never card, bank or identity data.
 */
export const WINDOW_HOURS = 24;
/** Images and documents on WhatsApp: up to 5 MB. */
export const WHATSAPP_MEDIA_BYTES = 5 * 1024 * 1024;
/** The automatic messages that may go by WhatsApp to a guest who opted in; the rest stays email. */
export const WHATSAPP_TYPES = ["pre_arrival", "welcome", "departure_eve", "card_request", "balance_request"] as const satisfies readonly MessageType[];
export type WhatsAppType = (typeof WHATSAPP_TYPES)[number];

export function isWhatsAppType(type: string): type is WhatsAppType {
  return (WHATSAPP_TYPES as readonly string[]).includes(type);
}

export function windowOpen(lastGuestMessage: Date | null, now: Date): boolean {
  return !!lastGuestMessage && now.getTime() - lastGuestMessage.getTime() <= WINDOW_HOURS * 3_600_000;
}

/** The number to message on WhatsApp, digits only as WhatsApp gives it ("+49 170…" and "0049 170…" alike): unlike a stored phone (normalisePhone), a national number is not enough. */
export function whatsAppNumber(input: string): string | null {
  const s = input.trim();
  const digits = s.replace(/[^\d]/g, "");
  const intl = s.startsWith("+") ? digits : digits.startsWith("00") ? digits.slice(2) : s.startsWith("0") ? "" : digits;
  return /^[1-9]\d{7,14}$/.test(intl) ? intl : null;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** What a message on WhatsApp must not ask for or carry: card numbers, bank accounts, identity documents. The composer warns. */
export function sensitiveData(text: string): "card" | "bank" | "identity" | null {
  for (const m of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && luhn(digits)) return "card";
  }
  if (/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/i.test(text) || /\b(iban|bic|kontonummer|bankverbindung|account number)\b/i.test(text)) return "bank";
  if (/\b(passport|pass(nummer)?|reisepass|personalausweis|ausweisnummer|id card number|document number|card number|kartennummer|cvc|cvv)\b/i.test(text)) return "identity";
  return null;
}

/** A text with {placeholders} as Meta's template body ({{1}}, {{2}} …) and the placeholders behind the numbers. */
export function asMetaTemplate(text: string): { body: string; params: string[] } {
  const params: string[] = [];
  const body = text.replace(/\{([a-z_]+)\}/g, (_all, name: string) => {
    if (!params.includes(name)) params.push(name);
    return `{{${params.indexOf(name) + 1}}}`;
  });
  return { body, params };
}
