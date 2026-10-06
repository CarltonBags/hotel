import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listServices, outletSetup, spaSetup } from "@hoteloftware/db";
import { PRINTER_KINDS } from "@hoteloftware/domain";
import { ActionForm, Field, Select } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { outletsModuleOn } from "@/lib/outlets";
import { loadShell } from "@/lib/shell";
import { saveMenuItemAction, savePrinterAction, saveSpaRoomAction, saveTableAction, saveTherapistAction, saveTreatmentAction, spaCancelHoursAction } from "../../settings/outlets/actions";

/** An outlet's menu, printers and tables (ticket 60): the Property Manager, or the outlet's own Outlet Manager. */
export default async function OutletSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const { tenant, session, actor } = shell.principal;
  const setup = await outletSetup(pool(), tenant.schemaName, (await params).id, { userId: session.user.id, actor }).catch(() => null);
  if (!setup) notFound();
  const o = setup.outlet;
  await requireAllowed("manage_own_outlets", o.propertyId);
  if (!setup.canManage || !(await outletsModuleOn(tenant.schemaName, o.propertyId))) redirect("/not-allowed");
  const services = await listServices(pool(), tenant.schemaName, o.propertyId);
  // a spa keeps therapists, treatment rooms and treatments too (ticket 63)
  const spa = o.kind === "spa" ? await spaSetup(pool(), tenant.schemaName, o.id, { userId: session.user.id, actor }) : null;
  const svc = services.map((x) => ({ value: x.id, label: `${x.code} · ${x.name} (${x.taxCodeCode})` }));
  const printers = [{ value: "", label: m["outlet.none"] }, ...setup.printers.map((p) => ({ value: p.id, label: p.name }))];
  const kinds = PRINTER_KINDS.map((k) => ({ value: k, label: m[`outlet.printerKind.${k}`] }));
  const hidden = <input type="hidden" name="outletId" value={o.id} />;
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const row = "flex flex-wrap items-end gap-2";
  const active = (on: boolean) => (
    <label className="flex h-10 items-center gap-2">
      <input type="checkbox" name="active" value="on" defaultChecked={on} />
      {m["outlet.active"]}
    </label>
  );
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6" data-outlet-setup={o.name}>
      <div>
        <Link href="/outlet" className="text-sm text-accent underline">
          {m["module.outlets"]}
        </Link>
        <h1 className="text-xl font-medium">
          {o.name} · {m["outlet.setup"]}
        </h1>
      </div>
      <section className={section} data-printers>
        <h2 className="font-medium">{m["outlet.printers"]}</h2>
        {[...setup.printers, null].map((p) => (
          <ActionForm key={p?.id ?? "new"} action={savePrinterAction} submitLabel={p ? m["action.save"] : m["outlet.add"]} className={row}>
            {hidden}
            <input type="hidden" name="id" value={p?.id ?? ""} />
            <Field label={m["outlet.name"]} name="name" defaultValue={p?.name ?? ""} />
            <Select label={m["outlet.kind"]} name="kind" options={kinds} defaultValue={p?.kind ?? "kitchen"} />
            <Field label={m["outlet.address"]} name="address" defaultValue={p?.address ?? ""} />
            {active(p?.active ?? true)}
          </ActionForm>
        ))}
      </section>
      <section className={section} data-tables>
        <h2 className="font-medium">{m["outlet.tables"]}</h2>
        {[...setup.tables, null].map((t) => (
          <ActionForm key={t?.id ?? "new"} action={saveTableAction} submitLabel={t ? m["action.save"] : m["outlet.add"]} className={row}>
            {hidden}
            <input type="hidden" name="id" value={t?.id ?? ""} />
            <Field label={m["outlet.name"]} name="name" defaultValue={t?.name ?? ""} />
            <Field label={m["outlet.seats"]} name="seats" type="number" defaultValue={String(t?.seats ?? 4)} />
            <Field label={m["outlet.order"]} name="sortOrder" type="number" defaultValue={String(t?.sortOrder ?? setup.tables.length + 1)} />
            {active(t?.active ?? true)}
          </ActionForm>
        ))}
      </section>
      {spa ? (
        <>
          {/* guests book released hours in the Guest Portal and cancel up to this many hours before (ticket 64) */}
          <section className={section} data-spa-cancel-hours>
            <h2 className="font-medium">{m["spa.portal"]}</h2>
            <ActionForm action={spaCancelHoursAction} submitLabel={m["action.save"]} className={row}>
              {hidden}
              <Field label={m["spa.cancelHours"]} name="hours" type="number" defaultValue={String(spa.cancelHours)} />
            </ActionForm>
          </section>
          <section className={section} data-therapists>
            <h2 className="font-medium">{m["spa.therapists"]}</h2>
            {[...spa.therapists, null].map((t) => (
              <ActionForm key={t?.id ?? "new"} action={saveTherapistAction} submitLabel={t ? m["action.save"] : m["outlet.add"]} className={row}>
                {hidden}
                <input type="hidden" name="id" value={t?.id ?? ""} />
                <Field label={m["outlet.name"]} name="name" defaultValue={t?.name ?? ""} />
                {active(t?.active ?? true)}
              </ActionForm>
            ))}
          </section>
          <section className={section} data-spa-rooms>
            <h2 className="font-medium">{m["spa.rooms"]}</h2>
            {[...spa.rooms, null].map((r) => (
              <ActionForm key={r?.id ?? "new"} action={saveSpaRoomAction} submitLabel={r ? m["action.save"] : m["outlet.add"]} className={row}>
                {hidden}
                <input type="hidden" name="id" value={r?.id ?? ""} />
                <Field label={m["outlet.name"]} name="name" defaultValue={r?.name ?? ""} />
                {active(r?.active ?? true)}
              </ActionForm>
            ))}
          </section>
          <section className={section} data-treatments>
            <h2 className="font-medium">{m["spa.treatments"]}</h2>
            {setup.menu.map((i) => {
              const t = spa.treatments.find((x) => x.menuItemId === i.id);
              return (
                <ActionForm key={i.id} action={saveTreatmentAction} submitLabel={m["action.save"]} className={row}>
                  {hidden}
                  <input type="hidden" name="menuItemId" value={i.id} />
                  <span className="h-10 min-w-40 content-center">{i.name}</span>
                  <Field label={m["spa.minutes"]} name="minutes" type="number" defaultValue={String(t?.minutes ?? 60)} />
                  <label className="flex h-10 items-center gap-2">
                    <input type="checkbox" name="needsRoom" value="on" defaultChecked={t?.needsRoom ?? true} />
                    {m["spa.needsRoom"]}
                  </label>
                  {active(t?.active ?? false)}
                </ActionForm>
              );
            })}
          </section>
        </>
      ) : null}
      <section className={section} data-menu>
        <h2 className="font-medium">{m["outlet.menu"]}</h2>
        {[...setup.menu, null].map((i) => (
          <ActionForm key={i?.id ?? "new"} action={saveMenuItemAction} submitLabel={i ? m["action.save"] : m["outlet.add"]} className={row}>
            {hidden}
            <input type="hidden" name="id" value={i?.id ?? ""} />
            <Field label={m["outlet.name"]} name="name" defaultValue={i?.name ?? ""} />
            <Field label={m["outlet.category"]} name="category" defaultValue={i?.category ?? ""} />
            <Select label={m["outlet.service"]} name="serviceId" options={svc} defaultValue={i?.serviceId ?? ""} />
            <Field label={m["outlet.price"]} name="price" defaultValue={i ? String(i.price) : ""} />
            <Select label={m["outlet.printer"]} name="printerId" options={printers} defaultValue={i?.printerId ?? ""} />
            <Field label={m["outlet.modifiers"]} name="modifiers" defaultValue={i ? i.modifiers.map((x) => `${x.name}:${x.price}`).join("; ") : ""} />
            <Field label={m["outlet.order"]} name="sortOrder" type="number" defaultValue={String(i?.sortOrder ?? setup.menu.length + 1)} />
            {active(i?.active ?? true)}
          </ActionForm>
        ))}
      </section>
    </div>
  );
}
