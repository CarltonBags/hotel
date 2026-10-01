import Link from "next/link";
import { ROLE_LABELS, can, formatInPropertyTime } from "@hoteloftware/domain";
import { accessibleProperties, requirePrincipal } from "@/lib/authorize";
import { signOut } from "./sign-in/actions";

export default async function HomePage() {
  const { tenant, session, actor } = await requirePrincipal();
  const properties = await accessibleProperties();
  const now = new Date();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="rounded-3xl bg-surface p-8 shadow-card">
        <p className="text-ink-60">Signed in to</p>
        <h1 className="text-xl font-medium">{tenant.name}</h1>
        <p className="mt-1 text-sm text-ink-60">
          {session.user.name} · {session.user.username ?? session.user.email}{actor.tenantRole ? ` · ${ROLE_LABELS[actor.tenantRole].en}` : ""}
        </p>

        <h2 className="mt-6 font-medium">Your properties</h2>
        {properties.length === 0 ? (
          <p className="text-ink-60">
            No property yet.{" "}
            {can(actor, "manage_properties") ? <Link href="/settings/properties">Create one in settings.</Link> : "Ask your manager for a role."}
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {properties.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-ink-60">
                  {formatInPropertyTime(now, p.timeZone)} ({p.timeZone}) · {p.currency}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex gap-3">
          <Link href="/settings" className="h-10 rounded-full border border-ink-10 px-4 text-sm leading-10">
            Settings
          </Link>
          <form action={signOut}>
            <button type="submit" className="h-10 rounded-full border border-ink-10 px-4 text-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
