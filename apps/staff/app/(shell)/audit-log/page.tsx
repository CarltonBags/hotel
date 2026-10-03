import Link from "next/link";
import { can, formatCurrency, todayIn } from "@hoteloftware/domain";
import { auditLog, listTenantUsers, type AuditArea } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { isDate } from "@/lib/periods";
import { fill, type MessageKey } from "@/i18n/messages";

const AREAS: AuditArea[] = ["reservation", "money", "rates", "approval"];
/** Actions to filter by, with their label: money first (what Accounting sees), then the rest. */
const MONEY_ACTIONS = ["charge_post", "charge_void", "charge_move", "payment", "refund", "invoice_issued", "cancellation_issued", "transfer_matched"] as const;
const OTHER_ACTIONS = ["edit", "cancel", "check_in", "cancel_check_in", "check_out", "assign_room", "move_room", "unassign_room", "fee_confirmed", "fee_waived", "price_override", "rate_change", "approval_requested", "approval_approved", "approval_rejected", "approval_granted"] as const;
const labelKey = (action: string): MessageKey =>
  ((MONEY_ACTIONS as readonly string[]).includes(action) || action === "rate_change" || action.startsWith("approval_") ? `audit.action.${action}` : `res.action.${action}`) as MessageKey;

/** The property-wide audit log (ticket 31): Property Manager everything, Accounting the money entries; filters by user, record and area. */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; user?: string; record?: string; area?: string; action?: string }> }) {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.audit_log"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("view_audit_log", property.id);
  const moneyOnly = !can(actor, "view_full_audit_log", property.id);
  const today = todayIn(property.timeZone);
  const q = await searchParams;
  const from = isDate(q.from) ? q.from : today;
  const to = isDate(q.to) && q.to >= from ? q.to : from > today ? from : today;
  const area = AREAS.includes(q.area as AuditArea) ? (q.area as AuditArea) : null;
  const actions: readonly string[] = moneyOnly ? MONEY_ACTIONS : [...MONEY_ACTIONS, ...OTHER_ACTIONS];
  const action = q.action && actions.includes(q.action) ? q.action : null;
  const [entries, users] = await Promise.all([
    auditLog(pool(), tenant.schemaName, property.id, { from, to, userId: q.user || null, record: q.record || null, area, action }, { moneyOnly }),
    listTenantUsers(pool(), tenant.id),
  ]);
  const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : "");
  const when = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: property.timeZone });
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  const label = (a: string) => m[labelKey(a)] ?? a;
  const field = "h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm";
  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.audit_log"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">
          {m["audit.help"]} {moneyOnly ? m["audit.moneyOnly"] : ""}
        </p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="grid gap-1 text-xs text-ink-60">
          {m["ctaxr.from"]}
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="grid gap-1 text-xs text-ink-60">
          {m["ctaxr.to"]}
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <label className="grid gap-1 text-xs text-ink-60">
          {m["audit.user"]}
          <select name="user" defaultValue={q.user ?? ""} className={field}>
            <option value="">{m["audit.anyone"]}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-ink-60">
          {m["audit.record"]}
          <input name="record" defaultValue={q.record ?? ""} className={field} />
        </label>
        {moneyOnly ? null : (
          <label className="grid gap-1 text-xs text-ink-60">
            {m["audit.area"]}
            <select name="area" defaultValue={area ?? ""} className={field}>
              <option value="">{m["audit.area.all"]}</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {m[`audit.area.${a}`]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs text-ink-60">
          {m["audit.what"]}
          <select name="action" defaultValue={action ?? ""} className={field}>
            <option value="">{m["audit.area.all"]}</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-white">
          {m["ctaxr.show"]}
        </button>
      </form>
      {entries.length === 0 ? <p className="text-ink-60">{m["audit.none"]}</p> : null}
      {entries.length >= 1000 ? <p className="text-xs text-ink-60">{m["audit.limit"]}</p> : null}
      {entries.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-ink-60">
            <tr className="border-b border-ink-10">
              <th className="py-2 pr-3 font-normal">{m["audit.when"]}</th>
              <th className="py-2 pr-3 font-normal">{m["audit.user"]}</th>
              <th className="py-2 pr-3 font-normal">{m["audit.what"]}</th>
              <th className="py-2 pr-3 font-normal">{m["audit.record"]}</th>
              <th className="py-2 pr-3 text-right font-normal" />
              <th className="py-2 font-normal">{m["audit.detail"]}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} data-audit={e.action} className="border-b border-ink-5 align-top">
                <td className="whitespace-nowrap py-2 pr-3 text-ink-60">{when.format(e.at)}</td>
                <td className="py-2 pr-3">
                  {name(e.userId)}
                  {e.approvedBy ? <div className="text-xs text-ink-60">{fill(m["res.approvedBy"], { name: name(e.approvedBy) })}</div> : null}
                  {e.requestedBy && e.requestedBy !== e.userId ? <div className="text-xs text-ink-60">{fill(m["audit.for"], { name: name(e.requestedBy) })}</div> : null}
                </td>
                <td className="py-2 pr-3">{label(e.action)}</td>
                <td className="py-2 pr-3">
                  {e.recordType === "reservation" && e.recordId ? (
                    <Link href={`/reservations/${e.recordId}`} className="underline">
                      {e.recordLabel}
                    </Link>
                  ) : e.recordType === "invoice" && e.recordId ? (
                    <a href={`/invoices/${e.recordId}/pdf`} target="_blank" rel="noreferrer" className="underline">
                      {e.recordLabel}
                    </a>
                  ) : (
                    e.recordLabel
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{e.amount === null ? "" : money(e.amount)}</td>
                <td className="py-2 break-words text-xs text-ink-80">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
