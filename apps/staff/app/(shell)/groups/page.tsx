import Link from "next/link";
import { redirect } from "next/navigation";
import { listCompanyNames, listGroups, listRatePlans, modulePeriods } from "@hoteloftware/db";
import { can, moduleState, moduleVisible, todayIn } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { NewGroupForm } from "./new-group-form";

/** Groups of the property (ticket 58): Tentative and Definite first, by arrival; a new group. */
export default async function GroupsPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.groups"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = shell.principal;
  if (!can(actor, "view_groups", property.id)) redirect("/not-allowed");
  const s = tenant.schemaName;
  // the Groups Module of the subscription
  const periods = await modulePeriods(pool(), s, [property.id]);
  if (!moduleVisible(moduleState(periods.get(property.id) ?? [], "groups", todayIn(property.timeZone)))) redirect("/not-allowed");
  const [groups, companies, plans] = await Promise.all([listGroups(pool(), s, property.id, { userId: session.user.id, actor }), listCompanyNames(pool(), s), listRatePlans(pool(), s, property.id)]);
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.groups"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["group.help"]}</p>
      </div>
      <section className="rounded-2xl bg-surface-2 p-5 text-sm" data-groups>
        {groups.length ? (
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-ink-60">
                <th className="py-1">{m["group.name"]}</th>
                <th>{m["group.status"]}</th>
                <th>{m["group.organiser"]}</th>
                <th>{m["group.dates"]}</th>
                <th className="text-right">{m["group.heldPicked"]}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className="border-t border-ink-10" data-group={g.name}>
                  <td className="py-1.5">
                    <Link href={`/groups/${g.id}`} className="font-medium hover:underline">
                      {g.name}
                    </Link>
                  </td>
                  <td>{m[`group.status.${g.status}`]}</td>
                  <td>{g.organiser ?? "–"}</td>
                  <td>{g.firstArrival ? `${g.firstArrival} – ${g.lastDeparture}${g.holdings > 1 ? ` (${g.holdings})` : ""}` : "–"}</td>
                  <td className="text-right tabular-nums">
                    {g.held} / {g.pickedUp}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-ink-60">{m["group.none"]}</p>
        )}
      </section>
      {can(actor, "manage_groups", property.id) ? (
        <NewGroupForm propertyId={property.id} companies={companies.filter((c) => c.active)} plans={plans.map((p) => ({ id: p.id, name: `${p.code} · ${p.name}` }))} m={m} />
      ) : null}
    </div>
  );
}
