import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { findProperty, groupView, masterFolio } from "@hoteloftware/db";
import { can, formatCurrency } from "@hoteloftware/domain";
import { ActionForm, Field } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { groupsModuleOn } from "@/lib/groups";
import { loadShell } from "@/lib/shell";
import { groupPaymentAction, masterInvoiceAction } from "../../billing-actions";

/** A group's Master Folio (ticket 59): every Charge with the room and guest it is for, the organiser's payments, its invoices. */
export default async function MasterFolioPage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const { tenant, session, actor } = shell.principal;
  const viewer = { userId: session.user.id, actor };
  const g = await groupView(pool(), tenant.schemaName, (await params).id, viewer).catch(() => null);
  if (!g) notFound();
  await requireAllowed("view_folio", g.propertyId);
  if (!(await groupsModuleOn(tenant.schemaName, g.propertyId))) redirect("/not-allowed");
  const [f, property] = await Promise.all([masterFolio(pool(), tenant.schemaName, g.id, viewer), findProperty(pool(), tenant.schemaName, g.propertyId)]);
  const money = (n: number) => formatCurrency(n, property?.currency ?? "EUR", shell.language, property?.country ?? "DE");
  const hidden = <input type="hidden" name="groupId" value={g.id} />;
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const open = f.charges.filter((c) => !c.voided && !c.invoiced).length;
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6" data-master-folio={f.folioId ?? ""}>
      <div>
        <Link href={`/groups/${g.id}`} className="text-sm text-accent underline">
          {g.name}
        </Link>
        <h1 className="text-xl font-medium">
          {m["group.masterFolio"]}
          {f.billToName ? ` · ${f.billToName}` : ""}
        </h1>
        <p className="text-sm text-ink-60" data-balance={f.balance}>
          {m["group.balance"]} {money(f.balance)}
        </p>
      </div>
      <section className={section}>
        <table className="w-full">
          <tbody>
            {f.charges.map((c) => (
              <tr key={c.id} data-charge={c.description} className={c.voided ? "text-ink-60 line-through" : ""}>
                <td className="pr-3">{c.serviceDate}</td>
                <td className="pr-3">{c.room ?? ""}</td>
                <td className="pr-3">{c.guest ?? "–"}</td>
                <td className="pr-3">{c.description}</td>
                <td className="pr-3 text-ink-60">{c.taxCode}</td>
                <td className="text-right">{money(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {f.charges.length === 0 ? <p className="text-ink-60">–</p> : null}
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <section className={section}>
          <h2 className="font-medium">{m["group.payment"]}</h2>
          <ul className="grid gap-1">
            {f.payments.map((p) => (
              <li key={p.id}>
                {p.postedAt.slice(0, 10)} · {money(p.amount)} · {p.reference}
              </li>
            ))}
          </ul>
          {can(actor, "take_payments", g.propertyId) ? (
            <div data-group-payment>
              <ActionForm action={groupPaymentAction} submitLabel={m["group.recordPayment"]} className="flex flex-wrap items-end gap-2">
                {hidden}
                <Field label={m["group.depositAmount"]} name="amount" />
                <Field label={m["group.reference"]} name="reference" />
              </ActionForm>
            </div>
          ) : null}
        </section>
        <section className={section}>
          <h2 className="font-medium">{m["module.invoices"]}</h2>
          <ul className="grid gap-1">
            {f.invoices.map((i) => (
              <li key={i.id} data-invoice={i.number}>
                <a href={`/invoices/${i.id}/pdf`} className="text-accent underline">
                  {i.number}
                </a>{" "}
                · {i.issueDate} · {money(i.gross)}
                {i.cancelled ? " ✕" : ""}
              </li>
            ))}
          </ul>
          {can(actor, "issue_invoices", g.propertyId) && open > 0 ? (
            <ActionForm action={masterInvoiceAction} submitLabel={m["group.invoiceMaster"]} className="flex">
              {hidden}
            </ActionForm>
          ) : null}
        </section>
      </div>
    </div>
  );
}
