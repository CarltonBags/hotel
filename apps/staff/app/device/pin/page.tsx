import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/form-fields";
import { deviceMessages } from "@/lib/device";
import { currentSession } from "@/lib/tenant";
import { changePinAction } from "../actions";

/** Choose your own PIN: required at first sign-in and after a reset. */
export default async function ChangePinPage() {
  const current = await currentSession();
  if (!current) redirect("/device");
  const m = await deviceMessages();
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-card">
        <h1 className="text-lg font-medium">{m["dev.choosePin"]}</h1>
        <p className="mt-2 mb-4 text-sm text-ink-60">{m["dev.choosePinHelp"]}</p>
        <ActionForm action={changePinAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]}>
          <Field label={m["dev.newPin"]} name="pin" type="password" autoComplete="new-password" required />
          <Field label={m["dev.repeatPin"]} name="repeat" type="password" autoComplete="new-password" required />
        </ActionForm>
      </div>
    </main>
  );
}
