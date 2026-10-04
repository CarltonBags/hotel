import { redirect } from "next/navigation";
import { ActionForm } from "@/components/form-fields";
import { deviceMessages } from "@/lib/device";
import { currentTenant } from "@/lib/tenant";
import { enrolAction } from "../actions";

/** Opened from the QR code: enrol this browser as a Device of the property (a button, so a link alone enrols nothing). */
export default async function EnrolPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) redirect("/no-tenant");
  const m = await deviceMessages();
  const { code = "" } = await searchParams;
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-card">
        <h1 className="text-lg font-medium">{m["dev.enrolThis"]}</h1>
        <p className="mt-2 mb-4 text-sm text-ink-60">{m["dev.enrolThisHelp"]}</p>
        <ActionForm action={enrolAction} submitLabel={m["dev.enrol"]} pendingLabel={m["action.saving"]}>
          <input type="hidden" name="code" value={code} />
        </ActionForm>
      </div>
    </main>
  );
}
