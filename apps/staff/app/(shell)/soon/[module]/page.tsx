import { notFound } from "next/navigation";
import { fill } from "@/i18n/messages";
import { loadShell } from "@/lib/shell";
import { MODULE_BY_ID } from "@/shell/registry";

/** Placeholder for modules the Main Menu lists but later tickets build. */
export default async function SoonPage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const m = MODULE_BY_ID.get(module);
  if (!m?.soon) notFound();
  const { messages } = await loadShell();
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-medium">{messages[m.label]}</h1>
        <p className="mt-2 text-ink-60">{fill(messages["shell.soon"], { ticket: m.soon })}</p>
      </div>
    </div>
  );
}
