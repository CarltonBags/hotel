import { redirect } from "next/navigation";
import { withTenant } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { currentSession } from "@/lib/tenant";
import { signOut } from "./sign-in/actions";

export default async function HomePage() {
  const current = await currentSession();
  if (!current) redirect("/sign-in");
  const { tenant, session } = current;

  // Proves the request runs inside the tenant's schema.
  const settingsCount = await withTenant(pool(), tenant.schemaName, async (tx) => {
    const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from tenant_settings");
    return rows[0]?.n ?? 0;
  });

  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-surface p-8 shadow-card">
        <p className="text-ink-60">Signed in to</p>
        <h1 className="text-xl font-medium">{tenant.name}</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-60">User</dt>
          <dd>
            {session.user.name} ({session.user.email})
          </dd>
          <dt className="text-ink-60">Tenant</dt>
          <dd className="font-mono">{tenant.slug}</dd>
          <dt className="text-ink-60">Schema</dt>
          <dd className="font-mono">{tenant.schemaName}</dd>
          <dt className="text-ink-60">Settings rows</dt>
          <dd>{settingsCount}</dd>
        </dl>
        <form action={signOut} className="mt-6">
          <button type="submit" className="h-10 rounded-full border border-ink-10 px-4 text-sm">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
