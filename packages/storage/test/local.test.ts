import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeScanner, LocalFileStore, belongsTo, tenantKey } from "../src";

describe("local file store", () => {
  it("keeps files under the tenant prefix and refuses keys outside its root", async () => {
    const store = new LocalFileStore(await mkdtemp(join(tmpdir(), "hs-files-")));
    const t = "11111111-1111-1111-1111-111111111111";
    const key = tenantKey(t, "issue_photo", "22222222-2222-2222-2222-222222222222");
    await store.put(key, new Uint8Array([1, 2, 3]), "image/jpeg");
    expect([...(await store.get(key))!]).toEqual([1, 2, 3]);
    expect(belongsTo(key, t)).toBe(true);
    expect(belongsTo(key, "33333333-3333-3333-3333-333333333333")).toBe(false);
    await expect(store.get("../../etc/passwd")).rejects.toThrow(/Invalid/);
    expect(() => tenantKey("../x", "issue_photo", "22222222-2222-2222-2222-222222222222")).toThrow();
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await store.put(key, new Uint8Array([1]), "image/jpeg");
    expect(await store.deletePrefix(`${t}/`)).toBe(1);
    expect(await store.get(key)).toBeNull();
  });

  it("the fake scanner finds the EICAR test file", async () => {
    const s = new FakeScanner();
    expect(await s.scan(Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"))).toBe("Eicar-Test-Signature");
    expect(await s.scan(new Uint8Array([1]))).toBeNull();
  });
});
