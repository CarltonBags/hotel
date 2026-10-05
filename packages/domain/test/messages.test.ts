import { describe, expect, it } from "vitest";
import { SHIPPED_TEXTS, messageLanguage, renderMessage, sendAfter, senderDomainProblem, unknownPlaceholders } from "../src/messages";

describe("guest messages", () => {
  it("a confirmation renders in the guest's language with the branding and the legal footer", () => {
    const m = renderMessage(SHIPPED_TEXTS.confirmation.de, { guest_name: "Aiko Tanaka", hotel_name: "Haus am Ring", confirmation: "R-48220", arrival: "05.10.2026", departure: "07.10.2026" }, { hotelName: "Haus am Ring", accent: "#7c5cff" }, { name: "Ring GmbH", address: "Ring 1, 1010 Wien", vatId: "ATU12345678", register: "FN 123456a" });
    expect(m.subject).toBe("Ihre Buchung R-48220 im Haus am Ring");
    expect(m.html).toContain("background:#7c5cff");
    expect(m.html).toContain("vom 05.10.2026 bis 07.10.2026");
    expect(m.text).toContain("Ring GmbH · Ring 1, 1010 Wien · VAT ATU12345678 · FN 123456a");
    // values are escaped
    expect(renderMessage({ subject: "x", blocks: ["{guest_name}"] }, { guest_name: "<b>" }, { hotelName: "H", accent: "#000000" }, { name: "L", address: "", vatId: null, register: null }).html).toContain("&lt;b&gt;");
  });

  it("a service message triggered at 23:00 waits until Sending Hours; documents go at once", () => {
    const hours = { from: "08:00", to: "20:00" };
    expect(sendAfter("sending_hours", { date: "2026-10-05", time: "23:00" }, hours)).toEqual({ date: "2026-10-06", time: "08:00" });
    expect(sendAfter("sending_hours", { date: "2026-10-05", time: "06:30" }, hours)).toEqual({ date: "2026-10-05", time: "08:00" });
    expect(sendAfter("sending_hours", { date: "2026-10-05", time: "12:00" }, hours)).toEqual({ date: "2026-10-05", time: "12:00" });
    expect(sendAfter("at_once", { date: "2026-10-05", time: "23:00" }, hours)).toEqual({ date: "2026-10-05", time: "23:00" });
  });

  it("language, sender and placeholders", () => {
    expect(messageLanguage("en", true, "de")).toBe("en");
    expect(messageLanguage("fr", true, "de")).toBe("de");
    expect(messageLanguage("en", false, "de")).toBe("de");
    expect(senderDomainProblem("gmx.de")).toBe("free_mail");
    expect(senderDomainProblem("haus-am-ring.at")).toBeNull();
    expect(unknownPlaceholders({ subject: "{hotel_nme}", blocks: ["{guest_name}"] })).toEqual(["hotel_nme"]);
  });
});
