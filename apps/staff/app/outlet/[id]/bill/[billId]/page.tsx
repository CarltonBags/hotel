import { notFound, redirect } from "next/navigation";
import { findProperty, listCompanyNames, outletBill, outletSetup } from "@hoteloftware/db";
import { can } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { deviceMessages } from "@/lib/device";
import { outletAppContext, outletsModuleOn } from "@/lib/outlets";
import { BillScreen } from "./bill-screen";

export const dynamic = "force-dynamic";

/** A bill at an outlet (ticket 60): items with modifiers, order rounds to the printers, split and move, paid in cash with a Receipt or invoiced on account. */
export default async function OutletBillPage({ params }: { params: Promise<{ id: string; billId: string }> }) {
  const ctx = await outletAppContext();
  if (!ctx) redirect("/");
  const m = await deviceMessages();
  const { id, billId } = await params;
  const viewer = { userId: ctx.session.user.id, actor: ctx.actor };
  const bill = await outletBill(pool(), ctx.tenant.schemaName, billId, viewer).catch(() => null);
  if (!bill || bill.outlet.id !== id || !ctx.propertyIds.includes(bill.outlet.propertyId)) notFound();
  if (!(await outletsModuleOn(ctx.tenant.schemaName, bill.outlet.propertyId))) redirect("/not-allowed");
  const [setup, property, companies] = await Promise.all([outletSetup(pool(), ctx.tenant.schemaName, id, viewer), findProperty(pool(), ctx.tenant.schemaName, bill.outlet.propertyId), listCompanyNames(pool(), ctx.tenant.schemaName)]);
  return (
    <BillScreen
      bill={bill}
      menu={setup.menu.filter((i) => i.active)}
      tables={setup.tables.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))}
      companies={companies.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
      currency={{ code: property?.currency ?? "EUR", country: property?.country ?? "DE" }}
      rights={{ serve: can(ctx.actor, "serve_outlet", bill.outlet.propertyId), cash: can(ctx.actor, "outlet_cash", bill.outlet.propertyId) }}
      m={m}
    />
  );
}
