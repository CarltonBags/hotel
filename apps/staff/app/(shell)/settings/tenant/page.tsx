import { ACCENTS } from "@hoteloftware/domain";
import { fill } from "@/i18n/messages";
import { requireAllowed } from "@/lib/authorize";
import { loadShell } from "@/lib/shell";
import { AccentPicker } from "./accent-picker";

export default async function TenantSettingsPage() {
  const { tenant } = await requireAllowed("manage_tenant_settings");
  const { messages } = await loadShell();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-medium">{messages["settings.tenant.title"]}</h1>
      <section className="mt-6 rounded-2xl bg-surface-2 p-5">
        <h2 className="font-medium">{messages["settings.tenant.accent"]}</h2>
        <p className="mb-3 text-sm text-ink-60">{fill(messages["settings.tenant.accentHelp"], { tenant: tenant.name })}</p>
        <AccentPicker current={tenant.accent} label={messages["settings.tenant.accent"]} accents={Object.entries(ACCENTS).map(([id, a]) => ({ id, ...a }))} />
      </section>
    </div>
  );
}
