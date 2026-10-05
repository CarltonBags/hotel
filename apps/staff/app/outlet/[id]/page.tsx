import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { findProperty, outletFloor } from "@hoteloftware/db";
import { can, formatCurrency } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { deviceMessages } from "@/lib/device";
import { outletAppContext, outletsModuleOn } from "@/lib/outlets";
import { NewBill } from "./new-bill";
import { PrintAgent } from "./print-agent";

export const dynamic = "force-dynamic";

/** An outlet's table plan (ticket 60): every table with its open bills and totals; a new bill at a table or without one. */
export default async function OutletFloorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await outletAppContext();
  if (!ctx) redirect("/");
  const m = await deviceMessages();
  const floor = await outletFloor(pool(), ctx.tenant.schemaName, (await params).id, { userId: ctx.session.user.id, actor: ctx.actor }).catch(() => null);
  if (!floor || !ctx.propertyIds.includes(floor.outlet.propertyId)) notFound();
  if (!(await outletsModuleOn(ctx.tenant.schemaName, floor.outlet.propertyId))) redirect("/not-allowed");
  const serve = can(ctx.actor, "serve_outlet", floor.outlet.propertyId);
  const property = await findProperty(pool(), ctx.tenant.schemaName, floor.outlet.propertyId);
  const money = (n: number) => formatCurrency(n, property?.currency ?? "EUR", "de", property?.country ?? "DE");
  const bill = (b: (typeof floor.loose)[number]) => (
    <Link key={b.id} href={`/outlet/${floor.outlet.id}/bill/${b.id}`} className="flex justify-between rounded-xl bg-surface px-3 py-2" data-open-bill={b.number}>
      <span>
        #{b.number} {b.label}
        {b.unsent ? <span className="ml-1 text-danger">· {b.unsent} {m["outlet.unsent"]}</span> : null}
      </span>
      <span className="font-medium">{money(b.total)}</span>
    </Link>
  );
  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-4" data-outlet-floor={floor.outlet.name}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-medium">{floor.outlet.name}</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/cash" className="text-accent underline">
            {m["outlet.shift"]}
          </Link>
          <Link href="/outlet" className="text-accent underline">
            {m["outlet.choose"]}
          </Link>
        </div>
      </header>
      <PrintAgent outletId={floor.outlet.id} labels={{ printing: m["outlet.printing"], failed: m["outlet.printFailed"] }} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {floor.tables.map((t) => (
          <section key={t.id} className="grid content-start gap-2 rounded-2xl bg-surface-2 p-3" data-table={t.name}>
            <h2 className="font-medium">
              {t.name} <span className="text-xs text-ink-60">· {t.seats}</span>
            </h2>
            {t.bills.map(bill)}
            {serve ? <NewBill outletId={floor.outlet.id} tableId={t.id} label={m["outlet.newBill"]} /> : null}
          </section>
        ))}
        <section className="grid content-start gap-2 rounded-2xl bg-surface-2 p-3" data-table="">
          <h2 className="font-medium">{m["outlet.walkIn"]}</h2>
          {floor.loose.map(bill)}
          {serve ? <NewBill outletId={floor.outlet.id} tableId={null} label={m["outlet.newBill"]} placeholder={m["outlet.label"]} /> : null}
        </section>
      </div>
    </main>
  );
}
