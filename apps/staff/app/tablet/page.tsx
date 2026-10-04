import { currentTablet } from "@/lib/tablet";
import { TabletApp } from "./tablet-app";

export const dynamic = "force-dynamic";

/** The guest tablet (ticket 45): only what reception sends; nothing kept on the device. */
export default async function TabletPage() {
  const t = await currentTablet();
  if (!t) {
    return (
      <main className="grid min-h-full place-items-center p-6">
        <p className="text-ink-60">Bitte an der Rezeption melden · Please come to reception</p>
      </main>
    );
  }
  return <TabletApp deviceName={t.device.name} />;
}
