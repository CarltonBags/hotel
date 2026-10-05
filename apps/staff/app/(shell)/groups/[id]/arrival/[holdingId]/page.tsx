import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { groupArrival } from "@hoteloftware/db";
import { can } from "@hoteloftware/domain";
import { ActionForm, Field } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { groupsModuleOn } from "@/lib/groups";
import { loadShell } from "@/lib/shell";
import { assignGroupRoomsAction, groupRegistrationAction, registrationSignedAction } from "../../../billing-actions";
import { ArrivalList } from "./arrival-list";

/** The group check-in screen (ticket 59): every reservation of the arrival, rooms assigned together, checked in selected or all; the tour leader's registration in Germany. */
export default async function GroupArrivalPage({ params }: { params: Promise<{ id: string; holdingId: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const { tenant, session, actor } = shell.principal;
  const viewer = { userId: session.user.id, actor };
  const { id, holdingId } = await params;
  const a = await groupArrival(pool(), tenant.schemaName, holdingId, viewer).catch(() => null);
  if (!a || a.groupId !== id) notFound();
  await requireAllowed("view_groups", a.propertyId);
  if (!(await groupsModuleOn(tenant.schemaName, a.propertyId))) redirect("/not-allowed");
  const checkIn = can(actor, "check_in", a.propertyId);
  const manage = can(actor, "manage_groups", a.propertyId);
  const hidden = (
    <>
      <input type="hidden" name="groupId" value={a.groupId} />
      <input type="hidden" name="holdingId" value={a.holdingId} />
    </>
  );
  const section = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  const reg = a.registration;
  const members = [...(reg?.members ?? []), { nationality: "", count: 0 }, { nationality: "", count: 0 }, { nationality: "", count: 0 }];
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6" data-group-arrival={a.arrival}>
      <div>
        <Link href={`/groups/${a.groupId}`} className="text-sm text-accent underline">
          {a.groupName}
        </Link>
        <h1 className="text-xl font-medium">
          {m["group.arrivalCheckIn"]} {a.arrival} – {a.departure}
        </h1>
        <p className="text-sm text-ink-60">
          {a.reservations.length} {m["group.reservations"]} · {a.persons} {m["group.persons"]}
        </p>
      </div>
      {checkIn ? (
        <div data-assign-rooms><ActionForm action={assignGroupRoomsAction} submitLabel={m["group.assignRooms"]} className="flex flex-wrap items-end gap-3">
          {hidden}
          <label className="grid gap-1 text-sm">
            <span className="text-ink-80">{m["group.assignRooms"]}</span>
            <select name="by" className="h-10 rounded-xl border border-ink-10 bg-surface px-3">
              <option value="floor">{m["group.byFloor"]}</option>
              <option value="section">{m["group.bySection"]}</option>
            </select>
          </label>
        </ActionForm></div>
      ) : null}
      <ArrivalList groupId={a.groupId} holdingId={a.holdingId} reservations={a.reservations} canCheckIn={checkIn && a.arrival <= a.businessDate} canRename={manage} m={m} />
      {a.registrationNeeded || reg ? (
        <section className={section} data-group-registration={reg?.signedOnPaperAt ? "signed" : reg ? "filled" : "needed"}>
          <h2 className="font-medium">{m["group.registration"]}</h2>
          <p className="text-ink-60">{m["group.registrationHelp"]}</p>
          {checkIn ? (
            <ActionForm action={groupRegistrationAction} submitLabel={m["action.save"]} className="grid gap-3">
              {hidden}
              <div className="flex flex-wrap gap-3">
                <Field label={m["guests.firstName"]} name="leaderFirstName" defaultValue={reg?.leaderFirstName ?? ""} />
                <Field label={m["guests.lastName"]} name="leaderLastName" defaultValue={reg?.leaderLastName ?? ""} />
                <Field label={m["group.leaderNationality"]} name="leaderNationality" defaultValue={reg?.leaderNationality ?? ""} />
                <Field label={m["group.birthDate"]} name="leaderBirthDate" type="date" defaultValue={reg?.leaderBirthDate ?? ""} />
                <Field label={m["group.address"]} name="leaderAddress" defaultValue={reg?.leaderAddress ?? ""} />
              </div>
              <span className="text-ink-80">{m["group.members"]}</span>
              {members.map((x, i) => (
                <div key={i} className="flex flex-wrap gap-3">
                  <Field label={m["group.leaderNationality"]} name="memberNationality" defaultValue={x.nationality} />
                  <Field label={m["group.persons"]} name="memberCount" type="number" defaultValue={x.count ? String(x.count) : ""} />
                </div>
              ))}
            </ActionForm>
          ) : null}
          {reg ? (
            reg.signedOnPaperAt ? (
              <p>
                {m["group.signed"]} · {reg.signedOnPaperAt.slice(0, 10)}
              </p>
            ) : checkIn ? (
              <ActionForm action={registrationSignedAction} submitLabel={m["group.markSigned"]} className="flex">
                {hidden}
              </ActionForm>
            ) : null
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
