import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { currentTenant } from "@/lib/tenant";
import { SignupForm } from "./signup-form";

/** The public trial signup on the bare app domain (ticket 87). */
export default async function SignupPage() {
  // on a tenant's own address there is nothing to sign up for
  if (await currentTenant()) redirect("/sign-in");
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-surface p-8 shadow-card">
        {env.trialSignup ? <SignupForm appDomain={env.appDomain} /> : <p>Trials are not open at the moment.</p>}
      </div>
    </main>
  );
}
