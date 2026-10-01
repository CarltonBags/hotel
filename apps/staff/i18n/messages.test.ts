import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_KEYS, fill, messagesFor } from "./messages";

/** Seam: every shell label exists in both languages and glossary terms use the fixed German word. */
describe("messages", () => {
  it("has English and German for every key", () => {
    const en = messagesFor("en");
    const de = messagesFor("de");
    for (const key of MESSAGE_KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(de[key], key).toBeTruthy();
    }
  });

  it("uses the glossary's German words for glossary terms in the shell", () => {
    const glossary = readFileSync(resolve(import.meta.dirname, "../../../docs/glossary/german-terms.md"), "utf8");
    const german = new Map<string, string>();
    for (const line of glossary.split("\n")) {
      const m = /^\| ([^|]+) \| ([^|]+) \|/.exec(line);
      if (m && m[1] !== "English term") german.set(m[1]!.trim(), m[2]!.trim().split(" (")[0]!);
    }
    const de = messagesFor("de");
    const expectations: [string, string][] = [
      ["shell.mainMenu", german.get("Main Menu")!],
      ["shell.quickAccess", german.get("Quick Access")!],
      ["module.night_audit", german.get("Night Audit")!],
      ["module.guest_inbox", german.get("Guest Inbox")!],
      ["module.cash_book", german.get("Cash Book")!],
      ["module.downtime_reports", german.get("Downtime Reports")!],
      ["module.settings_tenant", german.get("Tenant")!],
      ["field.username", german.get("Username")!],
    ];
    for (const [key, word] of expectations) {
      expect(de[key as keyof typeof de], key).toContain(word);
    }
  });

  it("fills placeholders", () => {
    expect(fill("Arrives with ticket {ticket}.", { ticket: 23 })).toBe("Arrives with ticket 23.");
  });
});
