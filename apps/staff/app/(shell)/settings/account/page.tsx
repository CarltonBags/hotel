import { loadShell } from "@/lib/shell";
import { MODULES } from "@/shell/registry";
import { getNotificationChannels } from "@hoteloftware/db";
import { ActionForm, Field } from "@/components/form-fields";
import { pool } from "@/lib/db";
import { AccountForm } from "./account-form";
import { notificationChannelsAction } from "./notification-actions";

export default async function AccountPage() {
  const shell = await loadShell();
  const options = MODULES.map((m) => ({ id: m.id, label: shell.messages[m.label] }));
  const m = shell.messages;
  const support = shell.principal.session.support;
  const channels = support ? null : await getNotificationChannels(pool(), shell.principal.session.user.id);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-medium">{shell.messages["settings.account.title"]}</h1>
      <AccountForm
        language={shell.language}
        theme={shell.theme}
        quickAccess={shell.preferences.quickAccess}
        options={options}
        labels={{
          language: shell.messages["shell.language"],
          theme: shell.messages["shell.theme"],
          light: shell.messages["shell.theme.light"],
          dark: shell.messages["shell.theme.dark"],
          system: shell.messages["shell.theme.system"],
          quickAccess: shell.messages["shell.quickAccess"],
          quickAccessHelp: shell.messages["settings.account.quickAccessHelp"],
          save: shell.messages["action.save"],
          saved: shell.messages["action.saved"],
        }}
      />
      {channels ? (
        <section className="mt-8 grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-notification-channels>
          <h2 className="font-medium">{m["notify.title"]}</h2>
          <p className="text-ink-60">{m["notify.help"]}</p>
          <ActionForm action={notificationChannelsAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-2">
            <label className="flex items-center gap-2">
              <input type="hidden" name="email" value="off" />
              <input type="checkbox" name="email" defaultChecked={channels.email} /> {m["notify.email"]}
            </label>
            <label className="flex items-center gap-2">
              <input type="hidden" name="sms" value="off" />
              <input type="checkbox" name="sms" defaultChecked={channels.sms} /> {m["notify.sms"]}
            </label>
            <Field label={m["notify.phone"]} name="phone" type="tel" defaultValue={channels.phone ?? ""} />
            <label className="flex items-center gap-2">
              <input type="hidden" name="sound" value="off" />
              <input type="checkbox" name="sound" defaultChecked={channels.sound} /> {m["inbox.sound"]}
            </label>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
