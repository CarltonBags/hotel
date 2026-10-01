import { config } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";
import { findTenantBySlug, setTenantRole } from "@hoteloftware/db";
import { createAuth, createStaffUser } from "../index";

/** Usage: pnpm --filter @hoteloftware/auth create-user <tenant-slug> <email> <username> "<name>" <password> [owner|tenant_admin] */
config({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });
const [slug, email, username, name, password, tenantRole] = process.argv.slice(2);
if (!slug || !email || !username || !name || !password) {
  console.error('usage: create-user <tenant-slug> <email> <username> "<name>" <password> [owner|tenant_admin]');
  process.exit(2);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const tenant = await findTenantBySlug(pool, slug);
  if (!tenant) throw new Error(`tenant ${slug} not found`);
  const auth = createAuth({
    pool,
    appDomain: process.env.APP_DOMAIN!,
    secret: process.env.BETTER_AUTH_SECRET!,
    baseURL: process.env.BETTER_AUTH_URL!,
  });
  const user = await createStaffUser(auth, pool, { tenantId: tenant.id, email, username, name, password });
  if (tenantRole === "owner" || tenantRole === "tenant_admin") {
    await setTenantRole(pool, { tenantId: tenant.id, userId: user.id, role: tenantRole });
  }
  console.log(`created user ${email} (${user.id}) in tenant ${slug}${tenantRole ? ` as ${tenantRole}` : ""}`);
} finally {
  await pool.end();
}
