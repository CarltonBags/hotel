import Link from "next/link";
import { canAtAnyProperty } from "@hoteloftware/domain";
import { searchCompanies } from "@hoteloftware/db";
import { requireAllowedAnywhere } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { CompanyForm } from "./company-form";

/** Companies of the whole tenant: search, list, create. */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { tenant, actor } = await requireAllowedAnywhere("view_companies");
  const { messages: m } = await loadShell();
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const companies = await searchCompanies(pool(), tenant.schemaName, q);
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6">
      <h1 className="text-xl font-medium">{m["module.companies"]}</h1>
      <form role="search" className="flex gap-2">
        <input name="q" defaultValue={q} placeholder={m["companies.searchHint"]} aria-label={m["guests.search"]} className="h-10 flex-1 rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm" />
        <button type="submit" className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-white">
          {m["guests.search"]}
        </button>
      </form>
      {companies.length === 0 ? (
        <p className="text-ink-60">{m["companies.none"]}</p>
      ) : (
        <ul className="divide-y divide-ink-5 rounded-2xl bg-surface-2">
          {companies.map((c) => (
            <li key={c.id}>
              <Link href={`/companies/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-ink-5">
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-ink-60">{[c.city, c.vatId, `${c.paymentTermsDays} d`].filter(Boolean).join(" · ")}</span>
                {c.active ? null : <span className="text-xs text-ink-40">{m["services.inactive"]}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canAtAnyProperty(actor, "edit_companies") ? (
        <section className="rounded-2xl bg-surface-2 p-5">
          <h2 className="mb-3 font-medium">{m["companies.new"]}</h2>
          <CompanyForm readOnly={false} m={m} />
        </section>
      ) : null}
    </div>
  );
}
