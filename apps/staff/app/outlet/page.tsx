import Link from "next/link";
import { redirect } from "next/navigation";
import { listProperties, outletsToWork } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { deviceMessages } from "@/lib/device";
import { outletAppContext, outletsModuleOn } from "@/lib/outlets";

export const dynamic = "force-dynamic";

/** The outlet app (ticket 60) on a phone, tablet or fixed till: the outlets the user works at; one goes straight to its tables. */
export default async function OutletsPage() {
  const ctx = await outletAppContext();
  if (!ctx) redirect("/");
  const m = await deviceMessages();
  const props = await listProperties(pool(), ctx.tenant.schemaName);
  const viewer = { userId: ctx.session.user.id, actor: ctx.actor };
  const outlets = [];
  for (const id of ctx.propertyIds) {
    if (!(await outletsModuleOn(ctx.tenant.schemaName, id))) continue;
    for (const o of await outletsToWork(pool(), ctx.tenant.schemaName, id, viewer)) outlets.push({ ...o, property: props.find((p) => p.id === id)?.name ?? "" });
  }
  if (outlets.length === 1) redirect(`/outlet/${outlets[0]!.id}`);
  return (
    <main className="mx-auto grid max-w-xl gap-4 p-6" data-outlet-list>
      <h1 className="text-xl font-medium">{m["outlet.choose"]}</h1>
      {outlets.length ? (
        outlets.map((o) => (
          <Link key={o.id} href={`/outlet/${o.id}`} className="rounded-2xl bg-surface-2 p-5 text-lg font-medium">
            {o.name} <span className="text-sm text-ink-60">· {o.property}</span>
          </Link>
        ))
      ) : (
        <p className="text-ink-60">{m["outlet.noOutlets"]}</p>
      )}
    </main>
  );
}
