import { goLiveChecklistOf, tenantLifecycle, testRecordCounts, type TestRecordCounts } from "@hoteloftware/db";
import { can, goLiveBlockers } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill, type MessageKey } from "@/i18n/messages";
import { goLiveAction, markCheckedAction } from "./actions";

/** The setup guide (ticket 87): the go-live checklist, our staff's check, the preview of what is cleared, and Go-live. */
export default async function GoLivePage() {
  const { messages: m, language } = await loadShell();
  const { tenant, session, actor } = await requireAllowed("manage_tenant_settings");
  const life = await tenantLifecycle(pool(), tenant.id);
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);
  if (life.liveAt) {
    return (
      <div className="mx-auto grid max-w-3xl gap-4 p-6">
        <h1 className="text-xl font-medium">{m["module.settings_go_live"]}</h1>
        <p data-live>{fill(m["golive.liveSince"], { date: when(life.liveAt) })}</p>
      </div>
    );
  }
  const [items, counts] = await Promise.all([goLiveChecklistOf(pool(), tenant.schemaName, tenant.id), testRecordCounts(pool(), tenant.schemaName)]);
  const blockers = goLiveBlockers(items);
  const ready = blockers.length === 0 && life.checkedAt !== null && life.trialKind !== "demo";
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">{m["module.settings_go_live"]}</h1>
        <p className="text-sm text-ink-60">{life.trialKind === "demo" ? m["golive.demoNoGoLive"] : m["golive.help"]}</p>
      </div>
      <section className="grid gap-2">
        <h2 className="font-medium">{m["golive.checklist"]}</h2>
        <ul className="grid gap-1 rounded-2xl bg-surface-2 p-3 text-sm">
          {items.map((i) => {
            const state = i.level === "if_used" && !i.used ? "notUsed" : i.done ? "done" : "missing";
            return (
              <li key={i.id} data-item={i.id} data-state={state} className="flex flex-wrap items-baseline gap-2">
                <span aria-hidden className={state === "missing" ? (i.level === "optional" ? "text-ink-60" : "text-danger") : "text-success"}>
                  {state === "missing" ? "○" : "●"}
                </span>
                <span className="font-medium">{m[`golive.item.${i.id}` as MessageKey]}</span>
                <span className="text-xs text-ink-60">{m[`golive.level.${i.level}`]}</span>
                <span className="text-xs">{m[`golive.${state}`]}</span>
                {state === "missing" && i.missing[0] !== "—" ? <span className="text-xs text-ink-60">{i.missing.join(", ")}</span> : null}
              </li>
            );
          })}
        </ul>
        <p className="text-sm" data-checked={life.checkedAt ? "yes" : "no"}>
          {life.checkedAt ? fill(m["golive.checked"], { name: life.checkedBy ?? "—", date: when(life.checkedAt) }) : m["golive.notChecked"]}
        </p>
        {session.support ? (
          <ActionForm action={markCheckedAction} submitLabel={life.checkedAt ? m["golive.unmark"] : m["golive.markChecked"]}>
            <input type="hidden" name="checked" value={life.checkedAt ? "off" : "on"} />
          </ActionForm>
        ) : null}
      </section>
      <section className="grid gap-2">
        <h2 className="font-medium">{m["golive.preview"]}</h2>
        <p className="text-sm text-ink-60">{m["golive.previewHelp"]}</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-2xl bg-surface-2 p-3 text-sm sm:grid-cols-4" data-preview>
          {(Object.keys(counts) as (keyof TestRecordCounts)[]).map((k) => (
            <div key={k} data-count={k}>
              <dt className="text-xs text-ink-60">{m[`golive.count.${k}`]}</dt>
              <dd className="font-medium tabular-nums">{counts[k]}</dd>
            </div>
          ))}
        </dl>
      </section>
      {can(actor, "go_live") ? (
        ready ? (
          <ActionForm action={goLiveAction} submitLabel={m["golive.go"]}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirm" className="mt-1" required />
              <span>{m["golive.confirm"]}</span>
            </label>
          </ActionForm>
        ) : (
          <p role="status" data-go-live-blocked className="rounded-2xl bg-warning/20 p-3 text-sm">
            {life.trialKind === "demo" ? m["golive.demoNoGoLive"] : m["golive.blocked"]}
          </p>
        )
      ) : null}
    </div>
  );
}
