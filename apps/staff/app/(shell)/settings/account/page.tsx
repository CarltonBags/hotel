import { loadShell } from "@/lib/shell";
import { MODULES } from "@/shell/registry";
import { AccountForm } from "./account-form";

export default async function AccountPage() {
  const shell = await loadShell();
  const options = MODULES.map((m) => ({ id: m.id, label: shell.messages[m.label] }));
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
    </div>
  );
}
