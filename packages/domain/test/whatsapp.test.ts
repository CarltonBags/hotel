import { describe, expect, it } from "vitest";
import { asMetaTemplate, whatsAppNumber, sensitiveData, WHATSAPP_TYPES, windowOpen } from "../src/whatsapp";

describe("WhatsApp (ticket 44)", () => {
  it("free text only within 24 hours after the guest's last message", () => {
    const last = new Date("2026-10-05T10:00:00Z");
    expect(windowOpen(last, new Date("2026-10-06T09:59:00Z"))).toBe(true);
    expect(windowOpen(last, new Date("2026-10-06T10:00:01Z"))).toBe(false);
    expect(windowOpen(null, new Date())).toBe(false);
  });

  it("numbers compared in international form", () => {
    expect(whatsAppNumber("+49 170 123 4567")).toBe("491701234567");
    expect(whatsAppNumber("0049 (170) 1234567")).toBe("491701234567");
    expect(whatsAppNumber("491701234567")).toBe("491701234567");
    expect(whatsAppNumber("0170 1234567")).toBeNull();
    expect(whatsAppNumber("abc")).toBeNull();
  });

  it("warns of card numbers, bank accounts and document numbers in a message", () => {
    expect(sensitiveData("Please send your card 4111 1111 1111 1111")).toBe("card");
    expect(sensitiveData("IBAN DE89 3704 0044 0532 0130 00 please")).toBe("bank");
    expect(sensitiveData("Your passport number please")).toBe("identity");
    expect(sensitiveData("Room 204 is ready, see you at 15:00")).toBeNull();
  });

  it("turns a text with placeholders into Meta's numbered parameters, in order of first use", () => {
    expect(asMetaTemplate("Hello {guest_name}, your stay {arrival} – {departure}. Bye {guest_name}")).toEqual({
      body: "Hello {{1}}, your stay {{2}} – {{3}}. Bye {{1}}",
      params: ["guest_name", "arrival", "departure"],
    });
  });

  it("only service messages go by WhatsApp; documents stay email", () => {
    expect(WHATSAPP_TYPES).toEqual(["pre_arrival", "welcome", "departure_eve", "card_request", "balance_request"]);
  });
});
