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

/** Country calling codes of the countries a property may be in, for numbers stored without one. */
const CALLING_CODES: Record<string, string> = {
  DE: "49", AT: "43", CH: "41", LI: "423", IT: "39", FR: "33", NL: "31", BE: "32", LU: "352", DK: "45", PL: "48", CZ: "420", SK: "421", HU: "36", SI: "386", HR: "385",
  ES: "34", PT: "351", GB: "44", IE: "353", SE: "46", NO: "47", FI: "358", GR: "30", US: "1",
};

/**
 * The number to message on WhatsApp, digits only as WhatsApp gives it ("+49
 * 170…" and "0049 170…" alike); a national number ("0170…") counts in the
 * property's country. Null when it cannot be told.
 */
export function whatsAppNumber(input: string, country?: string | null): string | null {
  const s = input.trim();
  const digits = s.replace(/[^\d]/g, "");
  const cc = country ? CALLING_CODES[country.toUpperCase()] : undefined;
  const intl = s.startsWith("+") ? digits : digits.startsWith("00") ? digits.slice(2) : digits.startsWith("0") ? (cc ? cc + digits.slice(1) : "") : digits;
  return /^[1-9]\d{7,14}$/.test(intl) ? intl : null;
}

/** How a guest profile may hold a WhatsApp number of the property's country: international, or national with a leading 0. */
export function storedForms(waNumber: string, country: string | null): string[] {
  const cc = country ? CALLING_CODES[country.toUpperCase()] : undefined;
  return cc && waNumber.startsWith(cc) ? [waNumber, `0${waNumber.slice(cc.length)}`] : [waNumber];
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
