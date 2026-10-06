import Link from "next/link";
import { redirect } from "next/navigation";
import { deviceSignInList } from "@hoteloftware/auth";
import { pool } from "@/lib/db";
import { currentDevice, deviceMessages } from "@/lib/device";
import { currentTenant } from "@/lib/tenant";
import { PinPad } from "./pin-pad";
import { Wipe } from "./wipe";

/** The lock screen of an enrolled Device: tap your name, enter your PIN (ticket 14). */
export default async function DevicePage() {
  const tenant = await currentTenant();
  if (!tenant) redirect("/no-tenant");
  const m = await deviceMessages();
  const device = await currentDevice();
  const card = (body: React.ReactNode) => (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-card">{body}</div>
    </main>
  );
  if (!device || device.tenantId !== tenant.id) {
    return card(
      <>
        <h1 className="text-lg font-medium">{m["dev.notEnrolled"]}</h1>
        <p className="mt-2 text-sm text-ink-60">{m["dev.notEnrolledHelp"]}</p>
        <Link href="/sign-in" className="mt-4 inline-block text-accent">
          {m["dev.passwordSignIn"]}
        </Link>
      </>,
    );
  }
  if (device.revoked) {
    return card(
      <>
        <Wipe />
        <h1 className="text-lg font-medium">{m["dev.revoked"]}</h1>
        <p role="alert" className="mt-2 text-sm text-ink-60">
          {m["dev.wiped"]}
        </p>
      </>,
    );
  }
  // a guest tablet shows only what the desk sends it (ticket 45)
  if (device.kind !== "staff") redirect(device.guestMode === "kiosk" ? "/kiosk" : "/tablet");
  const people = await deviceSignInList(pool(), device);
  return card(
    <div className="grid gap-4">
      <p className="text-sm text-ink-60">
        {tenant.name} · {device.name}
      </p>
      {people.length ? (
        <PinPad people={people} labels={{ who: m["dev.who"], pin: m["dev.enterPin"], signIn: m["dev.signIn"], back: m["dev.otherPerson"], pending: m["action.saving"] }} />
      ) : (
        <p className="text-sm">{m["dev.noUsers"]}</p>
      )}
      <Link href="/sign-in" className="text-sm text-accent">
        {m["dev.passwordSignIn"]}
      </Link>
    </div>,
  );
}
