import { loadShell } from "@/lib/shell";
import { env } from "@/lib/env";

/** The help centre (ticket 93): support channels and hours, response times, the status page. */
export default async function HelpPage() {
  const { messages: m } = await loadShell();
  const rows = (["critical", "high", "normal", "question"] as const).map((k) => [m[`help.severity.${k}`], m[`help.example.${k}`], m[`help.response.${k}`]]);
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6 text-sm">
      <h1 className="text-xl font-medium">{m["module.help_centre"]}</h1>
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-5">
        <h2 className="font-medium">{m["help.channels"]}</h2>
        <p>{m["help.hours"]}</p>
        <p>
          {m["help.email"]}:{" "}
          <a href={`mailto:${env.supportEmail}`} className="text-accent underline">
            {env.supportEmail}
          </a>
        </p>
        <p>
          {m["help.emergency"]}: {env.supportPhone ? <a href={`tel:${env.supportPhone.replace(/\s/g, "")}`} className="text-accent underline">{env.supportPhone}</a> : m["help.phoneInContract"]}
        </p>
      </section>
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-5">
        <h2 className="font-medium">{m["help.responseTimes"]}</h2>
        <table className="w-full text-left">
          <tbody>
            {rows.map(([sev, ex, resp]) => (
              <tr key={sev} className="border-t border-ink-5">
                <td className="py-1 font-medium">{sev}</td>
                <td className="text-ink-60">{ex}</td>
                <td>{resp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-5">
        <h2 className="font-medium">{m["status.title"]}</h2>
        <p>
          {m["help.statusText"]}{" "}
          <a href="/status" target="_blank" rel="noreferrer" className="text-accent underline">
            {m["status.title"]}
          </a>
        </p>
      </section>
    </div>
  );
}
