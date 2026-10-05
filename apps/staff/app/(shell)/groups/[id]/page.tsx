import { notFound, redirect } from "next/navigation";
import { groupView, listCompanyNames, listRoomTypes } from "@hoteloftware/db";
import { can, groupStatusAllowed, type GroupStatus } from "@hoteloftware/domain";
import { ActionForm, Field } from "@/components/form-fields";
import { pool } from "@/lib/db";
import { requireAllowed } from "@/lib/authorize";
import { groupsModuleOn } from "@/lib/groups";
import { loadShell } from "@/lib/shell";
import { addHoldingAction, bookFromGroupAction, groupStatusAction, releaseDateAction, seriesAction, updateGroupAction } from "../actions";
import { HoldingGrid } from "./holding-grid";

const STATUS_ACTIONS: { to: GroupStatus; label: string }[] = [
  { to: "definite", label: "group.makeDefinite" },
  { to: "tentative", label: "group.makeTentative" },
  { to: "lapsed", label: "group.lapse" },
  { to: "cancelled", label: "group.cancel" },
];

/** A Group (ticket 58): the contract, its status, its holdings with Held Rooms and prices per room type and night, release dates, a room booked from it. */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const { tenant, session, actor } = shell.principal;
  const viewer = { userId: session.user.id, actor };
  const g = await groupView(pool(), tenant.schemaName, (await params).id, viewer).catch(() => null);
  if (!g) notFound();
  await requireAllowed("view_groups", g.propertyId);
  if (!(await groupsModuleOn(tenant.schemaName, g.propertyId))) redirect("/not-allowed");
  const [types, companies] = await Promise.all([listRoomTypes(pool(), tenant.schemaName, g.propertyId), listCompanyNames(pool(), tenant.schemaName)]);
  const manage = can(actor, "manage_groups", g.propertyId);
  const contract = can(actor, "edit_group_contract", g.propertyId);
  const open = g.status === "tentative" || g.status === "definite";
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const hidden = <input type="hidden" name="groupId" value={g.id} />;
  const roomInputs = (
    <div className="flex flex-wrap gap-3">
      {types.map((t) => (
        <label key={t.id} className="grid gap-1">
          <span className="text-ink-80">
            {m["group.rooms"]} {t.code}
          </span>
          <input type="hidden" name="roomTypeId" value={t.id} />
          <input name="rooms" type="number" min={0} max={999} defaultValue={0} className="h-10 w-24 rounded-xl border border-ink-10 bg-surface px-3" />
        </label>
      ))}
    </div>
  );
  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-6" data-group-page={g.status}>
      <div>
        <h1 className="text-xl font-medium">
          {g.name} <span className="text-ink-60">· {m[`group.status.${g.status}`]}</span>
        </h1>
        <p className="text-sm text-ink-60">
          {g.organiser?.name ?? "–"}
          {g.contact ? ` · ${g.contact}` : ""}
          {g.optionDate && g.status === "tentative" ? ` · ${m["group.optionDate"]}: ${g.optionDate}` : ""}
        </p>
        {manage ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {STATUS_ACTIONS.filter((a) => groupStatusAllowed(g.status, a.to)).map((a) => (
              <ActionForm key={a.to} action={groupStatusAction} submitLabel={m[a.label as keyof typeof m]} className="flex">
                {hidden}
                <input type="hidden" name="status" value={a.to} />
              </ActionForm>
            ))}
          </div>
        ) : null}
      </div>

      {g.holdings.map((h) => (
        <section key={h.id} className={section} data-holding={h.arrival}>
          <h2 className="font-medium">
            {m["group.holding"]} {h.arrival} – {h.departure} · {m["group.release"]} {h.releaseDate}
            {h.released ? ` · ${m["group.released"]}` : ""}
            {h.releaseSoon ? <span className="ml-2 text-danger"> {m["group.releaseSoon"]}</span> : null}
          </h2>
          <HoldingGrid groupId={g.id} holdingId={h.id} roomTypes={h.roomTypes} editRooms={manage && open && !h.released} editPrices={contract && open} m={m} />
          {contract && open && !h.released ? (
            <ActionForm action={releaseDateAction} submitLabel={m["action.save"]} className="flex flex-wrap items-end gap-2">
              {hidden}
              <input type="hidden" name="holdingId" value={h.id} />
              <Field label={m["group.release"]} name="releaseDate" type="date" defaultValue={h.releaseDate} />
            </ActionForm>
          ) : null}
          {manage && open ? (
            <ActionForm action={bookFromGroupAction} submitLabel={m["group.bookSubmit"]} className="flex flex-wrap items-end gap-2">
              {hidden}
              <input type="hidden" name="holdingId" value={h.id} />
              <label className="grid gap-1">
                <span className="text-ink-80">{m["group.book"]}</span>
                <select name="roomTypeId" className="h-10 rounded-xl border border-ink-10 bg-surface px-3">
                  {h.roomTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code}
                    </option>
                  ))}
                </select>
              </label>
              <Field label={m["guests.firstName"]} name="firstName" />
              <Field label={m["guests.lastName"]} name="lastName" />
              <Field label={m["res.adults"]} name="adults" type="number" defaultValue="2" />
            </ActionForm>
          ) : null}
        </section>
      ))}

      {manage && open ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section className={section} data-add-holding>
            <h2 className="font-medium">{m["group.addHolding"]}</h2>
            <ActionForm action={addHoldingAction} submitLabel={m["group.addHolding"]} className="grid gap-3">
              {hidden}
              <div className="flex flex-wrap gap-3">
                <Field label={m["group.arrival"]} name="arrival" type="date" required />
                <Field label={m["group.departure"]} name="departure" type="date" required />
                <Field label={m["group.release"]} name="releaseDate" type="date" />
              </div>
              {roomInputs}
            </ActionForm>
          </section>
          <section className={section} data-series>
            <h2 className="font-medium">{m["group.series"]}</h2>
            <p className="text-ink-60">{m["group.seriesHelp"]}</p>
            <ActionForm action={seriesAction} submitLabel={m["group.createSeries"]} className="grid gap-3">
              {hidden}
              <div className="flex flex-wrap gap-3">
                <Field label={m["group.from"]} name="from" type="date" required />
                <Field label={m["group.to"]} name="to" type="date" required />
                <label className="grid gap-1">
                  <span className="text-ink-80">{m["group.weekday"]}</span>
                  <select name="weekday" defaultValue="6" className="h-10 rounded-xl border border-ink-10 bg-surface px-3">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label={m["group.nights"]} name="nights" type="number" defaultValue="7" />
              </div>
              {roomInputs}
            </ActionForm>
          </section>
        </div>
      ) : null}

      {manage ? (
        <section className={section} data-contract>
          <h2 className="font-medium">{m["group.contract"]}</h2>
          <ActionForm action={updateGroupAction} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3 sm:grid-cols-2">
            {hidden}
            {/* a person organiser stays unless a Company is chosen */}
            {g.organiser && "guestId" in g.organiser ? <input type="hidden" name="organiserGuestId" value={g.organiser.guestId} /> : null}
            <Field label={m["group.name"]} name="name" defaultValue={g.name} />
            <label className="grid gap-1">
              <span className="text-ink-80">{m["group.organiser"]}</span>
              <select name="companyId" defaultValue={g.organiser && "companyId" in g.organiser ? g.organiser.companyId : ""} className="h-10 rounded-xl border border-ink-10 bg-surface px-3">
                <option value="">–</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label={m["group.contact"]} name="contact" defaultValue={g.contact} />
            <Field label={m["group.optionDate"]} name="optionDate" type="date" defaultValue={g.optionDate ?? ""} />
            <Field label={m["group.releaseDays"]} name="releaseDays" type="number" defaultValue={String(g.releaseDays)} />
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-ink-80">{m["group.terms"]}</span>
              <textarea name="terms" rows={3} defaultValue={g.terms} className="w-full rounded-xl border border-ink-10 bg-surface p-3" />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-ink-80">{m["group.reductionRules"]}</span>
              <textarea name="reductionRules" rows={2} defaultValue={g.reductionRules} className="w-full rounded-xl border border-ink-10 bg-surface p-3" />
            </label>
          </ActionForm>
        </section>
      ) : (
        <section className={section}>
          <h2 className="font-medium">{m["group.contract"]}</h2>
          <p className="whitespace-pre-wrap">{g.terms || "–"}</p>
          <p className="whitespace-pre-wrap text-ink-60">{g.reductionRules}</p>
        </section>
      )}
    </div>
  );
}
