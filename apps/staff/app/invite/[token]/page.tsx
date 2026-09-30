import { redirect } from "next/navigation";
import { invitationByToken } from "@hoteloftware/auth/invitations";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { ActionForm, Field } from "@/components/form-fields";
import { accept } from "./actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) redirect("/no-tenant");
  const { token } = await params;
  const invitation = await invitationByToken(pool(), token);
  const valid = invitation && invitation.tenantId === tenant.id;
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-card">
        <h1 className="text-xl font-medium">{tenant.name}</h1>
        {!valid ? (
          <p className="mt-2 text-ink-60">This invitation is invalid, already used or expired. Ask your manager for a new one.</p>
        ) : (
          <>
            <p className="mt-1 text-ink-60">Welcome, {invitation.name}. Choose your password to finish.</p>
            <div className="mt-4">
              <ActionForm action={accept} submitLabel="Set password and continue">
                <input type="hidden" name="token" value={token} />
                <Field label="Your name" name="name" defaultValue={invitation.name} required />
                <p className="text-sm text-ink-60">Email: {invitation.email}</p>
                <Field label="Password (at least 10 characters)" name="password" type="password" autoComplete="new-password" required />
                <Field label="Repeat password" name="passwordRepeat" type="password" autoComplete="new-password" required />
              </ActionForm>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
