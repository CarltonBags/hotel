import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { findProperty, outletProperty, spaDay } from "@hoteloftware/db";
import { DATA_KINDS, addDays, todayIn } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { deviceLanguage, deviceMessages } from "@/lib/device";
import { outletAppContext, outletsModuleOn } from "@/lib/outlets";
import { DataStream } from "@/shell/DataStream";
import { LiveRefresh } from "@/shell/LiveRefresh";
import { SpaBook } from "./spa-book";

export const dynamic = "force-dynamic";

/** The spa's appointment book of a day (ticket 63): therapists with their hours and appointments, booking, cancelling, billing. */
export default async function SpaBookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> }) {
  const ctx = await outletAppContext();
  if (!ctx) redirect("/");
  const m = await deviceMessages();
  const { id } = await params;
  const asked = (await searchParams).date;
  const propertyId = await outletProperty(pool(), ctx.tenant.schemaName, { outletId: id });
  if (!propertyId || !ctx.propertyIds.includes(propertyId)) notFound();
  if (!(await outletsModuleOn(ctx.tenant.schemaName, propertyId))) redirect("/not-allowed");
  const tz = (await findProperty(pool(), ctx.tenant.schemaName, propertyId))?.timeZone ?? "Europe/Berlin";
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : todayIn(tz);
  const day = await spaDay(pool(), ctx.tenant.schemaName, id, date, { userId: ctx.session.user.id, actor: ctx.actor }).catch(() => null);
  if (!day) notFound();
  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4" data-spa-book={date}>
      {/* an Appointment a guest takes in the Portal shows at once (ticket 64) */}
      <DataStream offlineText={m["outlet.liveOff"]} />
      <LiveRefresh kind={DATA_KINDS.spa} propertyIds={[propertyId]} />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-medium">
          {day.outlet.name} · {m["spa.book"]}
        </h1>
        <nav className="flex items-center gap-3 text-sm">
          <Link href={`/outlet/${id}/spa?date=${addDays(date, -1)}`} className="text-accent underline">
            ←
          </Link>
          <span>{date}</span>
          <Link href={`/outlet/${id}/spa?date=${addDays(date, 1)}`} className="text-accent underline">
            →
          </Link>
          <Link href={`/outlet/${id}`} className="text-accent underline">
            {m["outlet.back"]}
          </Link>
        </nav>
      </header>
      <SpaBook outletId={id} date={date} timeZone={tz} language={await deviceLanguage()} day={day} m={m} />
    </main>
  );
}
