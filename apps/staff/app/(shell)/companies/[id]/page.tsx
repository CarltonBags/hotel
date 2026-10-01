import { notFound } from "next/navigation";
import Link from "next/link";
import { canAtAnyProperty } from "@hoteloftware/domain";
import { companyHistory, findCompany, listTenantUsers } from "@hoteloftware/db";
import { RecordTab } from "@/shell/RecordTab";
import { requireAllowedAnywhere } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { CompanyForm } from "../company-form";

/** One Company as a record tab. */
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, actor } = await requireAllowedAnywhere("view_companies");
  const { messages: m, language } = await loadShell();
  const { id } = await params;
  const company = await findCompany(pool(), tenant.schemaName, id);
  if (!company) notFound();
  const [history, users] = await Promise.all([companyHistory(pool(), tenant.schemaName, id), listTenantUsers(pool(), tenant.id)]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const fmt = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6">
      <RecordTab module="companies" recordId={id} title={company.name} href={`/companies/${id}`} />
      <div>
        <Link href="/companies" className="text-sm text-ink-60 hover:underline">
          ← {m["module.companies"]}
        </Link>
        <h1 className="mt-1 text-xl font-medium">{company.name}</h1>
      </div>
      <section className="rounded-2xl bg-surface-2 p-5">
        <CompanyForm company={company} readOnly={!canAtAnyProperty(actor, "edit_companies")} m={m} />
      </section>
      <section aria-label={m["guests.history"]} className="rounded-2xl bg-surface-2 p-5">
        <h2 className="font-medium">{m["guests.history"]}</h2>
        {history.length === 0 ? <p className="mt-1 text-sm text-ink-60">{m["guests.noHistory"]}</p> : null}
        <ul className="mt-2 grid gap-1 text-sm">
          {history.map((h, i) => (
            <li key={i}>
              <span className="text-ink-60">{fmt.format(h.at)}</span> · {names.get(h.userId) ?? h.userId} · {h.field}: {h.oldValue ?? "—"} → {h.newValue ?? "—"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
