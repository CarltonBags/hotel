import { describe, expect, it } from "vitest";
import { resolveTenantSlug, tenantSchemaFromSlug } from "../src/tenant-slug";

/** Seam: the host header selects the tenant before login. */
describe("resolveTenantSlug", () => {
  const appDomain = "localhost:3000";

  it("returns the subdomain as slug", () => {
    expect(resolveTenantSlug("alpha-hotels.localhost:3000", appDomain)).toBe("alpha-hotels");
  });

  it("ignores case in the host", () => {
    expect(resolveTenantSlug("Alpha.LOCALHOST:3000", appDomain)).toBe("alpha");
  });

  it("returns null for the bare app domain", () => {
    expect(resolveTenantSlug("localhost:3000", appDomain)).toBeNull();
  });

  it("returns null for nested subdomains and unrelated hosts", () => {
    expect(resolveTenantSlug("a.b.localhost:3000", appDomain)).toBeNull();
    expect(resolveTenantSlug("alpha.example.com", appDomain)).toBeNull();
    expect(resolveTenantSlug("evil-localhost:3000", appDomain)).toBeNull();
  });

  it("returns null for slugs that are not valid tenant slugs", () => {
    expect(resolveTenantSlug("-bad.localhost:3000", appDomain)).toBeNull();
    expect(resolveTenantSlug("www.localhost:3000", appDomain)).toBeNull();
    expect(resolveTenantSlug("api.localhost:3000", appDomain)).toBeNull();
  });

  it("works with a production domain that has no port", () => {
    expect(resolveTenantSlug("alpha.app.hoteloftware.eu", "app.hoteloftware.eu")).toBe("alpha");
  });

  it("maps a slug to its schema name", () => {
    expect(tenantSchemaFromSlug("alpha-hotels")).toBe("t_alpha_hotels");
  });
});
