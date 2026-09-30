import { redirect } from "next/navigation";
import { currentSession, currentTenant } from "@/lib/tenant";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const tenant = await currentTenant();
  if (!tenant) redirect("/no-tenant");
  if (await currentSession()) redirect("/");
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-card">
        <SignInForm tenantName={tenant.name} />
      </div>
    </main>
  );
}
