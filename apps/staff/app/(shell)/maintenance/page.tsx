import Link from "next/link";
import { listIssues, listRooms, listTenantUsers, seesIssues, type IssueRow } from "@hoteloftware/db";
import { PROBLEM_PICKS, URGENCIES, can } from "@hoteloftware/domain";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { fileLink } from "@/lib/files";
import { loadShell } from "@/lib/shell";
import { fixIssueAction, reportIssueAction, takeIssueAction } from "./actions";

/** Maintenance Issues of the property in the navbar (ticket 36): report one with photo, urgency and perhaps a Room Block; Maintenance works the queue. */
export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.maintenance"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = await requireAllowed("report_maintenance_issues", property.id);
  const viewer = { userId: session.user.id, actor };
  const show = (await searchParams).show === "done" ? "done" : "open";
  const sees = seesIssues(viewer, property.id);
  const works = can(actor, "work_maintenance", property.id);
  const blocks = (["out_of_order", "out_of_service"] as const).filter((k) => can(actor, k === "out_of_order" ? "manage_out_of_order" : "manage_out_of_service", property.id));
  const [rooms, issues, users] = await Promise.all([listRooms(pool(), tenant.schemaName, property.id), sees ? listIssues(pool(), tenant.schemaName, property.id, show, viewer) : Promise.resolve([] as IssueRow[]), listTenantUsers(pool(), tenant.id)]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const when = (d: Date) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone }).format(d);
  const photo = (fileId: string | null, legacy: string | null) =>
    fileId ? fileLink(tenant.id, session.user.id, fileId) : legacy ? `/floor-photo/issue/${legacy}` : null;
  const hidden = <input type="hidden" name="propertyId" value={property.id} />;
  const badge = { now: "bg-danger/15 text-danger", today: "bg-warning/20", later: "bg-ink-10" } as const;
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <h1 className="text-xl font-medium">
        {m["module.maintenance"]} <span className="text-ink-60">· {property.name}</span>
      </h1>

      <details className="rounded-2xl bg-surface-2 p-5 text-sm" open={!sees} data-report>
        <summary className="cursor-pointer font-medium">{m["mi.report"]}</summary>
        <ActionForm action={reportIssueAction} submitLabel={m["mi.reportSubmit"]} pendingLabel={m["action.saving"]} className="mt-3 grid gap-3">
          {hidden}
          <div className="flex flex-wrap items-end gap-3">
            <Select label={m["mi.room"]} name="roomId" options={[{ value: "", label: m["mi.publicArea"] }, ...rooms.map((r) => ({ value: r.id, label: r.number }))]} />
            <Field label={m["mi.place"]} name="place" />
            <Select label={m["mi.pick"]} name="pick" options={PROBLEM_PICKS.map((p) => ({ value: p, label: m[`mi.pick.${p}`] }))} />
            <Select label={m["mi.urgency"]} name="urgency" defaultValue="today" options={URGENCIES.map((u) => ({ value: u, label: m[`mi.urgency.${u}`] }))} />
          </div>
          <Field label={m["mi.note"]} name="note" />
          <label className="grid gap-1">
            <span>{m["mi.photo"]}</span>
            <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" />
          </label>
          {blocks.length ? (
            <div className="flex flex-wrap items-end gap-3" data-block-fields>
              <Select label={m["mi.block"]} name="block" options={[{ value: "", label: m["mi.noBlock"] }, ...blocks.map((k) => ({ value: k, label: m[`mi.block.${k}`] }))]} />
              <Field label={m["mi.nights"]} name="nights" type="number" defaultValue="1" />
            </div>
          ) : null}
        </ActionForm>
      </details>

      {sees ? (
        <section className="grid gap-3" data-queue>
          <nav className="flex gap-2 text-sm">
            {(["open", "done"] as const).map((s) => (
              <Link key={s} href={`/maintenance?show=${s}`} className={`rounded-full px-3 py-1 ${s === show ? "bg-accent text-white" : "bg-surface-2"}`}>
                {m[`mi.show.${s}`]}
              </Link>
            ))}
          </nav>
          {issues.length ? null : <p className="text-ink-60">{m["mi.none"]}</p>}
          {issues.map((i) => {
            const before = photo(i.photoFileId, i.legacyPhoto ? i.id : null);
            const after = photo(i.fixPhotoFileId, null);
            const issueHidden = (
              <>
                {hidden}
                <input type="hidden" name="issueId" value={i.id} />
              </>
            );
            return (
              <article key={i.id} className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm" data-issue={i.roomNumber ?? i.place} data-status={i.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium">{i.roomNumber ? `${m["mi.room"]} ${i.roomNumber}` : i.place}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${badge[i.urgency]}`}>{m[`mi.urgency.${i.urgency}`]}</span>
                  <span className="text-xs text-ink-60">{m[`mi.status.${i.status}`]}</span>
                  {i.block ? <span className="rounded-full bg-ink px-2 py-0.5 text-xs text-canvas" data-block={i.block.inForce ? "in_force" : "over"}>{m[`mi.block.${i.block.kind}`]}{i.block.inForce ? ` · ${i.block.until}` : ""}</span> : null}
                  {i.blockDecision ? <span className="text-xs text-ink-60">{m[`mi.blockDecision.${i.blockDecision}`]}</span> : null}
                </div>
                <p>
                  {m[`mi.pick.${i.pick}`]}
                  {i.note ? ` · ${i.note}` : ""}
                </p>
                <p className="text-xs text-ink-60">
                  {m["mi.reported"]} {name.get(i.reportedBy) ?? "?"} · {when(i.reportedAt)}
                  {i.takenBy ? ` · ${m["mi.takenBy"]} ${name.get(i.takenBy) ?? "?"}` : ""}
                  {i.fixedAt ? ` · ${m["mi.fixed"]} ${name.get(i.fixedBy ?? "") ?? "?"} ${when(i.fixedAt)}` : ""}
                </p>
                {i.fixNote ? <p>{i.fixNote}</p> : null}
                <div className="flex gap-2">
                  {before ? <img src={before} alt={m["mi.photo"]} className="max-h-40 rounded-xl object-cover" data-photo /> : null}
                  {after ? <img src={after} alt={m["mi.fixPhoto"]} className="max-h-40 rounded-xl object-cover" data-fix-photo /> : null}
                </div>
                {works && i.status !== "done" ? (
                  <div className="grid gap-2">
                    {i.status === "open" ? (
                      <ActionForm action={takeIssueAction} submitLabel={m["mi.take"]} pendingLabel={m["action.saving"]} className="contents">
                        {issueHidden}
                      </ActionForm>
                    ) : null}
                    <ActionForm action={fixIssueAction} submitLabel={m["mi.markFixed"]} pendingLabel={m["action.saving"]} className="grid gap-2" >
                      {issueHidden}
                      <Field label={m["mi.fixNote"]} name="note" />
                      <label className="grid gap-1">
                        <span>{m["mi.fixPhoto"]}</span>
                        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" />
                      </label>
                      {i.block?.inForce ? (
                        <label className="flex items-center gap-2" data-end-block>
                          <input type="hidden" name="endBlock" value="off" />
                          <input type="checkbox" name="endBlock" defaultChecked /> {m["mi.endBlock"]}
                        </label>
                      ) : null}
                    </ActionForm>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
