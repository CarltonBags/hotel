import { describe, expect, it } from "vitest";
import { conversationExpired, deskMinutesBetween, deskNight, fillQuickReply, inDeskHours, isAutoReply, isConversationFile, parseReplyAddress, replyAddress } from "../src/conversations";

const TZ = "Europe/Berlin";
// 2026-10-05 is summer time in Berlin: UTC+2
const at = (local: string) => new Date(`${local}:00+02:00`);
const DAY = { opens: "07:00", closes: "22:00" };

describe("Desk Hours", () => {
  it("knows when the desk is staffed, also across midnight and around the clock", () => {
    expect(inDeskHours(at("2026-10-05T07:00"), DAY, TZ)).toBe(true);
    expect(inDeskHours(at("2026-10-05T21:59"), DAY, TZ)).toBe(true);
    expect(inDeskHours(at("2026-10-05T22:00"), DAY, TZ)).toBe(false);
    expect(inDeskHours(at("2026-10-05T03:00"), DAY, TZ)).toBe(false);
    const late = { opens: "06:00", closes: "02:00" };
    expect(inDeskHours(at("2026-10-05T01:30"), late, TZ)).toBe(true);
    expect(inDeskHours(at("2026-10-05T03:00"), late, TZ)).toBe(false);
    expect(inDeskHours(at("2026-10-05T03:00"), { opens: "00:00", closes: "00:00" }, TZ)).toBe(true);
  });

  it("counts waiting time only while the desk is staffed: the timer pauses at night", () => {
    expect(deskMinutesBetween(at("2026-10-05T10:00"), at("2026-10-05T10:15"), DAY, TZ)).toBe(15);
    // written at 21:50, nobody there from 22:00 to 07:00: ten minutes by 07:05 the next morning... plus five
    expect(deskMinutesBetween(at("2026-10-05T21:50"), at("2026-10-06T07:05"), DAY, TZ)).toBe(15);
    expect(deskMinutesBetween(at("2026-10-05T23:00"), at("2026-10-06T06:59"), DAY, TZ)).toBe(0);
  });

  it("names the night a message came in, once per night; none while the desk is staffed", () => {
    expect(deskNight(at("2026-10-05T12:00"), DAY, TZ)).toBeNull();
    expect(deskNight(at("2026-10-05T23:00"), DAY, TZ)).toBe("2026-10-06");
    expect(deskNight(at("2026-10-06T03:00"), DAY, TZ)).toBe("2026-10-06");
    expect(deskNight(at("2026-10-05T03:00"), { opens: "06:00", closes: "02:00" }, TZ)).toBe("2026-10-05");
  });
});

describe("quick replies and attachments", () => {
  it("fills the placeholders it knows and leaves others as typed", () => {
    expect(fillQuickReply("Hello {firstName}, room {room} is ready. {unknown}", { firstName: "Lea", room: "204" })).toBe("Hello Lea, room 204 is ready. {unknown}");
  });

  it("takes images and PDFs up to 10 MB", () => {
    expect(isConversationFile("application/pdf", 10 * 1024 * 1024)).toBe(true);
    expect(isConversationFile("application/pdf", 10 * 1024 * 1024 + 1)).toBe(false);
    expect(isConversationFile("image/png", 1000)).toBe(true);
    expect(isConversationFile("application/zip", 1000)).toBe(false);
  });
});

describe("replies by email and retention (ticket 43)", () => {
  it("a reply address names the tenant and the Conversation's token, and reads back", () => {
    const a = replyAddress("alpha", "0123456789abcdef0123", "replies.example.com");
    expect(a).toBe("alpha.0123456789abcdef0123@replies.example.com");
    expect(parseReplyAddress(`"Guest" <${a.toUpperCase()}>`)).toEqual({ slug: "alpha", token: "0123456789abcdef0123", domain: "replies.example.com" });
    expect(parseReplyAddress(`mail.${a}`)).toBeNull();
    expect(parseReplyAddress("someone@example.com")).toBeNull();
  });

  it("recognises out-of-office and other automatic replies", () => {
    expect(isAutoReply({ "auto-submitted": "auto-replied" }, "Re: your stay")).toBe(true);
    expect(isAutoReply({ "auto-submitted": "no" }, "Re: your stay")).toBe(false);
    expect(isAutoReply({ "x-autoreply": "yes" }, "Hello")).toBe(true);
    expect(isAutoReply({ precedence: "bulk" }, "Hello")).toBe(true);
    // Exchange sets this on ordinary mail too
    expect(isAutoReply({ "x-auto-response-suppress": "All" }, "Re: Your booking")).toBe(false);
    expect(isAutoReply({}, "Abwesenheitsnotiz: Re: Ihre Buchung")).toBe(true);
    expect(isAutoReply({}, "Out of Office: Re: Your booking")).toBe(true);
    expect(isAutoReply({}, "Automatic reply: Re: Your booking")).toBe(true);
    expect(isAutoReply({}, "Re: Your booking")).toBe(false);
  });

  it("a Conversation goes after its months past departure, unless kept for a dispute", () => {
    expect(conversationExpired("2025-09-01", 12, "2026-09-01", false)).toBe(false);
    expect(conversationExpired("2025-09-01", 12, "2026-09-02", false)).toBe(true);
    expect(conversationExpired("2025-09-01", 6, "2026-03-02", false)).toBe(true);
    expect(conversationExpired("2025-09-01", 12, "2026-11-01", true)).toBe(false);
  });
});
