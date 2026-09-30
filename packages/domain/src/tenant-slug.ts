/**
 * Tenant slugs are the subdomain of the staff app: lowercase letters, digits
 * and hyphens, 1 to 40 characters, no leading or trailing hyphen.
 */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Subdomains we keep for ourselves; never a tenant. */
const RESERVED = new Set(["www", "api", "app", "admin", "status", "help", "mail", "guest", "worker"]);

export function isTenantSlug(slug: string): boolean {
  return SLUG.test(slug) && !RESERVED.has(slug);
}

export function assertTenantSlug(slug: string): void {
  if (!isTenantSlug(slug)) throw new Error(`Invalid tenant slug: ${JSON.stringify(slug)}`);
}

/** `alpha-hotels` -> `t_alpha_hotels`. Slugs never contain underscores, so this is injective. */
export function tenantSchemaFromSlug(slug: string): string {
  assertTenantSlug(slug);
  return `t_${slug.replaceAll("-", "_")}`;
}

/**
 * The host header selects the tenant before login: `<slug>.<appDomain>`.
 * Returns null for the bare app domain, nested or foreign hosts, and reserved names.
 */
export function resolveTenantSlug(host: string | null | undefined, appDomain: string): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase();
  const suffix = `.${appDomain.toLowerCase()}`;
  if (!h.endsWith(suffix)) return null;
  const slug = h.slice(0, -suffix.length);
  if (!slug || slug.includes(".")) return null;
  return isTenantSlug(slug) ? slug : null;
}
