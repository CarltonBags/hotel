import { resolve } from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** The address of a tenant's subdomain. */
export function tenantUrl(slug: string, path = "/"): string {
  const scheme = env.authUrl.startsWith("https") ? "https" : "http";
  return `${scheme}://${slug}.${env.appDomain}${path}`;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get appDomain() {
    return required("APP_DOMAIN");
  },
  get authSecret() {
    return required("BETTER_AUTH_SECRET");
  },
  get authUrl() {
    return required("BETTER_AUTH_URL");
  },
  /** The platform's own tenant: its users listed as support staff may open customers' tenants (ticket 93). */
  get platformSlug() {
    return process.env.PLATFORM_TENANT_SLUG ?? "platform";
  },
  /** Where the database migrations lie: a new trial tenant gets its schema from them (ticket 87). */
  get migrationsDir() {
    return process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), "../../packages/db/migrations");
  },
  /** Self-service trial signup on the bare domain; "off" closes it. */
  get trialSignup() {
    return process.env.TRIAL_SIGNUP !== "off";
  },
  /** Trials that may start per hour, platform-wide. */
  get trialsPerHour() {
    return Number(process.env.TRIALS_PER_HOUR ?? 20);
  },
  /** Support contacts shown in the help centre (ticket 93); set them for production. */
  get supportEmail() {
    return process.env.SUPPORT_EMAIL ?? "support@hoteloftware.eu";
  },
  get supportPhone() {
    return process.env.SUPPORT_PHONE ?? "";
  },
};

/** The platform's mail domain: guest mail goes from it until a hotel's own domain is verified (the worker uses the same). */
export function platformMailDomain(): string {
  return process.env.MAIL_FROM_DOMAIN ?? process.env.MAILGUN_DOMAIN ?? "mail.hoteloftware.test";
}

/** Where a tenant's Guest Portal answers (no trailing slash): links in guest messages start with it. */
export function portalBaseUrl(slug: string): string {
  return tenantUrl(slug, "").replace(/\/$/, "");
}
