import { nonPaymentStatus, tenantEnd } from "@hoteloftware/db";
import { todayIn } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { deleteNowAction, endContractAction } from "./actions";

/** Leaving (ticket 89), the Owner's: the self-service export in open formats, ending the contract, deleting the data. */
export default async function ExitPage() {
  const { messages: m } = await loadShell();
  const { tenant } = await requireAllowed("delete_tenant");
  const ended = await tenantEnd(pool(), tenant.id);
  const status = await nonPaymentStatus(pool(), tenant.id, todayIn("Europe/Berlin"));
  const input = "h-9 rounded-xl border border-ink-10 bg-surface px-2";
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6" data-exit>
      <h1 className="text-xl font-medium">{m["module.settings_exit"]}</h1>
      <section className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm">
        <h2 className="font-medium">{m["exit.export"]}</h2>
        <p className="text-ink-60">{m["exit.exportHelp"]}</p>
        <a href="/exit-export" className="justify-self-start rounded-full bg-accent px-4 py-2 font-medium text-white" data-export-all>
          {m["exit.download"]}
        </a>
      </section>
      {ended ? (
        <section className="grid gap-2 rounded-2xl bg-danger/10 p-4 text-sm" data-ended>
          <p>{fill(m["exit.ended"], { date: ended.deletionDue })}</p>
          <ActionForm action={deleteNowAction} submitLabel={m["exit.deleteNow"]} className="flex flex-wrap items-center gap-2">
            <input name="confirm" placeholder={`delete ${tenant.slug}`} className={input} />
          </ActionForm>
        </section>
      ) : (
        <section className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm">
          <h2 className="font-medium">{m["exit.end"]}</h2>
          <p className="text-ink-60">{m["exit.endHelp"]}</p>
          {status.unpaid.length ? <p className="text-danger">{fill(m["exit.unpaid"], { n: status.unpaid.length })}</p> : null}
          <ActionForm action={endContractAction} submitLabel={m["exit.endButton"]} className="flex flex-wrap items-center gap-2">
            <input name="confirm" placeholder={tenant.slug} className={input} />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
