import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-file-links";
});

describe("signed file links", async () => {
  const { fileLink, validFileLink } = await import("./files");
  const parse = (link: string) => {
    const u = new URL(link, "http://x");
    return { id: u.pathname.split("/").pop()!, e: u.searchParams.get("e"), s: u.searchParams.get("s") };
  };

  it("hold for five minutes, for the tenant and user they were made for", () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-for-file-links";
    const now = Date.parse("2026-10-05T10:00:00Z");
    const l = parse(fileLink("tenant-a", "user-1", "file-1", now));
    expect(validFileLink("tenant-a", "user-1", l.id, l.e, l.s, now + 299_000)).toBe(true);
    expect(validFileLink("tenant-a", "user-1", l.id, l.e, l.s, now + 301_000)).toBe(false);
    // another tenant or user, another file, a changed expiry: nothing
    expect(validFileLink("tenant-b", "user-1", l.id, l.e, l.s, now)).toBe(false);
    expect(validFileLink("tenant-a", "user-2", l.id, l.e, l.s, now)).toBe(false);
    expect(validFileLink("tenant-a", "user-1", "file-2", l.e, l.s, now)).toBe(false);
    expect(validFileLink("tenant-a", "user-1", l.id, String(Number(l.e) + 600), l.s, now)).toBe(false);
  });
});
