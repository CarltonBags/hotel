import { describe, expect, it } from "vitest";
import { isUsername, normaliseUsername, suggestUsername } from "../src/username";

describe("Username rules", () => {
  it("accepts short lowercase names with dots, underscores and hyphens", () => {
    for (const u of ["dana", "dana.desk", "front_desk-2", "Maria.Müller".replace("ü", "u"), "ab1"]) expect(isUsername(u)).toBe(true);
  });

  it("refuses too short, too long, spaces, email addresses and leading punctuation", () => {
    for (const u of ["ab", "a".repeat(31), "dana desk", "dana@example.com", ".dana", "-x", ""]) expect(isUsername(u)).toBe(false);
  });

  it("compares case-insensitively", () => {
    expect(normaliseUsername("  Dana.Desk ")).toBe("dana.desk");
    expect(isUsername("DANA")).toBe(true);
  });

  it("suggests a username from a name", () => {
    expect(suggestUsername("Dana Desk")).toBe("dana.desk");
    expect(suggestUsername("Jürgen Groß")).toBe("jurgen.gross");
    expect(suggestUsername("Al")).toBe("al0");
  });
});
