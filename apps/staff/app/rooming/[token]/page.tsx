import { roomingByToken } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { RoomingForm } from "./rooming-form";

export const dynamic = "force-dynamic";

/** The organiser's Rooming List through the group's link (ticket 59), no sign-in: names per reserved room, in German and English. */
export default async function OrganiserRoomingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tenant = await currentTenant();
  const view = tenant ? await roomingByToken(pool(), tenant.schemaName, token) : null;
  return (
    <main className="mx-auto grid min-h-screen max-w-3xl content-start gap-6 bg-white p-6 text-black" data-organiser-rooming>
      {view ? (
        <>
          <header>
            <p className="text-sm text-black/60">{view.propertyName}</p>
            <h1 className="text-2xl font-medium">Rooming-Liste · Rooming List: {view.groupName}</h1>
            <p className="text-sm text-black/60">Bitte tragen Sie je Zimmer den Namen eines Gastes ein; bis zum Check-in können Sie ihn ändern. · Please enter a guest's name per room; you can change it until check-in.</p>
          </header>
          {view.holdings.some((h) => h.rooms.length) ? <RoomingForm token={token} view={view} /> : <p>Die Zimmer werden noch angelegt. · The rooms are not set up yet.</p>}
        </>
      ) : (
        <p>Dieser Link öffnet nichts · This link does not open anything</p>
      )}
    </main>
  );
}
