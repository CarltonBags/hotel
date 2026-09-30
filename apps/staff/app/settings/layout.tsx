import Link from "next/link";
import { can } from "@hoteloftware/domain";
import { requirePrincipal } from "@/lib/authorize";

/** Temporary settings navigation; the app shell (ticket 12) replaces it. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { actor, tenant } = await requirePrincipal();
  const tenantLevel = can(actor, "manage_legal_entities");
  return (
    <div className="mx-auto max-w-5xl p-6">
      <nav className="mb-6 flex flex-wrap items-center gap-4 text-sm">
        <Link href="/" className="font-medium">
          {tenant.name}
        </Link>
        <span className="text-ink-40">/</span>
        {tenantLevel ? <Link href="/settings/legal-entities">Legal Entities</Link> : null}
        {tenantLevel ? <Link href="/settings/properties">Properties</Link> : null}
        <Link href="/settings/users">Users</Link>
      </nav>
      {children}
    </div>
  );
}
