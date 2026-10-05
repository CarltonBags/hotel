import { cashBook, cashSettings, listCashRegisters, listOutlets, listTenantUsers, myOpenShift } from "@hoteloftware/db";
import { can, denominationsFor } from "@hoteloftware/domain";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { CashDesk } from "./cash-desk";

/** The cash desk (ticket 50): your Shift, its Cash Book, and for Property Manager and Accounting every register. */
export default async function CashPage({ searchParams }: { searchParams: Promise<{ register?: string }> }) {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.cash_book"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, session, actor } = shell.principal;
  if (!can(actor, "view_cash_desk", property.id)) redirect("/not-allowed");
  const s = tenant.schemaName;
  const userId = session.user.id;
  const viewer = { userId, actor };
  const desk = can(actor, "handle_cash", property.id);
  const rights = { handle: desk || can(actor, "outlet_cash", property.id), paidOut: can(actor, "paid_out", property.id), manage: can(actor, "manage_cash", property.id) };
  const [settings, allRegisters, shift, users, outlets] = await Promise.all([cashSettings(pool(), s, property.id), listCashRegisters(pool(), s, property.id), myOpenShift(pool(), s, property.id, userId), listTenantUsers(pool(), tenant.id), listOutlets(pool(), s, property.id)]);
  // outlet staff see their outlets' registers only (ticket 60)
  const registers = desk || rights.manage ? allRegisters : allRegisters.filter((r) => outlets.some((o) => o.cashRegisterId === r.id));
  if (!settings.enabled) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.cash_book"]}</h1>
        <p className="mt-2 text-ink-60">{m["cash.off"]}</p>
      </div>
    );
  }
  const requested = (await searchParams).register;
  // the desk sees its own Shift's Cash Book; Property Manager and Accounting any register's
  const shown = rights.manage ? (registers.find((r) => r.id === requested) ?? registers.find((r) => r.id === shift?.registerId) ?? registers[0]) : registers.find((r) => r.id === shift?.registerId);
  const book = shown ? await cashBook(pool(), s, shown.id, viewer) : null;
  return (
    <CashDesk
      property={{ id: property.id, name: property.name, currency: settings.currency, country: property.country, timeZone: property.timeZone }}
      denominations={denominationsFor(settings.currency)}
      paidOutLimit={settings.paidOutLimit}
      rights={rights}
      shift={shift ? { ...shift, openedAt: shift.openedAt.toISOString() } : null}
      // balances only for those who see every Cash Book: the desk's count is blind
      registers={registers.map((r) => ({ id: r.id, name: r.name, active: r.active, balance: rights.manage ? r.balance : null, openBy: r.openShift ? (users.find((u) => u.id === r.openShift!.userId)?.name ?? "?") : null }))}
      book={book ? { registerId: book.registerId, name: book.name, balance: book.balance, ownShiftOnly: book.ownShiftOnly, rows: book.rows.map((r) => ({ ...r, at: r.at.toISOString(), byUser: users.find((u) => u.id === r.byUser)?.name ?? r.byUser })) } : null}
      language={language}
      m={m}
    />
  );
}
