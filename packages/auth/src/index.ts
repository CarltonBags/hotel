import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Pool } from "pg";
import { controlDb, controlSchema, emailForUsername, findTenantBySlug, setUsername } from "@hoteloftware/db";
import { resolveTenantSlugFromHeaders } from "@hoteloftware/domain";

export interface AuthConfig {
  pool: Pool;
  /** The staff app domain, e.g. `localhost:3000` or `app.hoteloftware.eu`. Tenants live on subdomains. */
  appDomain: string;
  secret: string;
  baseURL: string;
}

/**
 * Better Auth, self-hosted in the control schema (ADR 0008). Email and password
 * only in this ticket. Public sign-up is off: staff users are created by their
 * tenant (see createStaffUser). A user belongs to exactly one tenant (ADR 0001);
 * the email is unique across the platform in v1.
 */
export function createAuth(config: AuthConfig) {
  const scheme = config.baseURL.startsWith("https") ? "https" : "http";
  return betterAuth({
    database: drizzleAdapter(controlDb(config.pool), { provider: "pg", schema: controlSchema }),
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    trustedOrigins: [`${scheme}://*.${config.appDomain}`, `${scheme}://${config.appDomain}`],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
    },
    user: {
      additionalFields: {
        tenantId: { type: "string", required: true, input: false },
        username: { type: "string", required: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 12, // a shift, not a week: 12 hours
      updateAge: 60 * 15,
    },
    advanced: {
      // No `domain` attribute: the session cookie is host-only, so a session on
      // alpha.<domain> is never sent to beta.<domain>.
      useSecureCookies: scheme === "https",
    },
    hooks: {
      // The HTTP endpoint is public, so scope password sign-in to the tenant of the
      // host here, not only in the server action: a user may sign in only at their
      // own tenant's subdomain, and the answer never reveals where they belong.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const slug = ctx.headers ? resolveTenantSlugFromHeaders(ctx.headers, config.appDomain) : null;
        const tenant = slug ? await findTenantBySlug(config.pool, slug) : null;
        const email = normaliseEmail((ctx.body as { email?: unknown } | undefined)?.email);
        if (!(await isTenantMember(ctx.context.password.hash, config.pool, tenant?.id ?? null, email))) {
          throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface StaffUserInput {
  tenantId: string;
  email: string;
  username: string;
  name: string;
  password: string;
}

/** Create a staff user for a tenant with a password credential. Server-side only. */
export async function createStaffUser(auth: Auth, pool: Pool, input: StaffUserInput): Promise<{ id: string }> {
  const ctx = await auth.$context;
  const email = normaliseEmail(input.email);
  const user = await ctx.internalAdapter.createUser(
    { email, name: input.name, emailVerified: true, tenantId: input.tenantId },
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  });
  await setUsername(pool, input.tenantId, user.id, input.username);
  return { id: user.id };
}

/**
 * True when a user with this email belongs to the tenant. When false, the same
 * time a password check would take is burned first, so neither the HTTP endpoint
 * nor the server action reveals through timing where an email belongs.
 */
async function isTenantMember(
  hash: (password: string) => Promise<string>,
  pool: Pool,
  tenantId: string | null,
  email: string,
): Promise<boolean> {
  const member = tenantId
    ? await pool.query("select 1 from control.\"user\" where email = $1 and tenant_id = $2", [email, tenantId])
    : null;
  if (member?.rowCount) return true;
  await hash("burn the same time a real check takes").catch(() => undefined);
  return false;
}

function normaliseEmail(email: unknown): string {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

/** The email behind what a user typed: their Username at the tenant, or an email. */
async function emailFor(pool: Pool, tenantId: string, typed: string): Promise<string | null> {
  const value = typed.trim();
  return value.includes("@") ? normaliseEmail(value) : emailForUsername(pool, tenantId, value);
}

export type SignInResult = { ok: true; response: Response } | { ok: false; error: "invalid_credentials" };

/**
 * Sign in scoped to the tenant the request arrived at, by Username (daily use)
 * or by email. A user of another tenant gets the same "invalid credentials" as
 * a wrong password, and no session is ever created for the wrong tenant.
 */
export async function signInToTenant(
  auth: Auth,
  pool: Pool,
  input: { tenantId: string; login: string; password: string; headers: Headers },
): Promise<SignInResult> {
  const { password } = await auth.$context;
  const email = await emailFor(pool, input.tenantId, input.login);
  if (!email) {
    await password.hash("burn the same time a real check takes").catch(() => undefined);
    return { ok: false, error: "invalid_credentials" };
  }
  if (!(await isTenantMember(password.hash, pool, input.tenantId, email))) {
    return { ok: false, error: "invalid_credentials" };
  }
  try {
    const response = await auth.api.signInEmail({
      body: { email, password: input.password },
      headers: input.headers,
      asResponse: true,
    });
    if (!response.ok) return { ok: false, error: "invalid_credentials" };
    return { ok: true, response };
  } catch {
    return { ok: false, error: "invalid_credentials" };
  }
}

/**
 * Check a user's credentials at a tenant without signing them in: a
 * Property Manager approving on another user's screen. Returns the user's id,
 * or null for wrong credentials or a user of another tenant (in the same time).
 */
export async function verifyTenantCredentials(auth: Auth, pool: Pool, input: { tenantId: string; username: string; password: string }): Promise<string | null> {
  const ctx = await auth.$context;
  const email = await emailFor(pool, input.tenantId, input.username);
  const row = email
    ? (
        await pool.query<{ id: string; password: string | null }>(
          `select u.id, a.password from control."user" u join control.account a on a.user_id = u.id and a.provider_id = 'credential'
           where u.email = $1 and u.tenant_id = $2`,
          [email, input.tenantId],
        )
      ).rows[0]
    : undefined;
  if (!row?.password) {
    await ctx.password.hash("burn the same time a real check takes").catch(() => undefined);
    return null;
  }
  return (await ctx.password.verify({ hash: row.password, password: input.password })) ? row.id : null;
}

export interface TenantSession {
  user: { id: string; email: string; username: string | null; name: string; tenantId: string };
  session: { id: string; expiresAt: Date };
}

/**
 * Read the session from the request and accept it only if the user belongs
 * to the tenant of the host. Anything else counts as signed out.
 */
export async function getTenantSession(auth: Auth, headers: Headers, tenantId: string): Promise<TenantSession | null> {
  const result = await auth.api.getSession({ headers });
  if (!result) return null;
  const user = result.user as typeof result.user & { tenantId?: string; username?: string | null };
  if (user.tenantId !== tenantId) return null;
  return {
    user: { id: user.id, email: user.email, username: user.username ?? null, name: user.name, tenantId: user.tenantId },
    session: { id: result.session.id, expiresAt: result.session.expiresAt },
  };
}
