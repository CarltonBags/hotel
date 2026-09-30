import { config } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";
import { findTenantBySlug } from "@hoteloftware/db";
import { createAuth, createStaffUser } from "../index";

/** Usage: pnpm --filter @hoteloftware/auth create-user <tenant-slug> <email> "<name>" <password> */
config({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });
const [slug, email, name, password] = process.argv.slice(2);
if (!slug || !email || !name || !password) {
  console.error('usage: create-user <tenant-slug> <email> "<name>" <password>');
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
  const user = await createStaffUser(auth, { tenantId: tenant.id, email, name, password });
  console.log(`created user ${email} (${user.id}) in tenant ${slug}`);
} finally {
  await pool.end();
}
