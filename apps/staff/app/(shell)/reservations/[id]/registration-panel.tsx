import { listDevices } from "@hoteloftware/auth";
import { findRegistration } from "@hoteloftware/db";
import { isRegistrationCountry } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { pool } from "@/lib/db";
import type { Messages } from "@/i18n/messages";
import { addPersonAction, completeAction, idCheckAction, openRegistrationAction, sendToTabletAction, signedOnPaperAction, takeBackAction } from "../registration-actions";
import { AutoRefresh } from "./auto-refresh";

/** The reservation's Meldeschein (ticket 45): who needs what, the tablet, the ID Check, completion. */
export async function RegistrationPanel({ reservationId, propertyId, propertyCountry, schema, tenantId, canRegister, m }: { reservationId: string; propertyId: string; propertyCountry: string; schema: string; tenantId: string; canRegister: boolean; m: Messages }) {
  if (!isRegistrationCountry(propertyCountry)) return null;
  const reg = await findRegistration(pool(), schema, reservationId);
  const hidden = <input type="hidden" name="reservationId" value={reservationId} />;
  const box = "grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm";
  if (!reg) {
    return (
      <section aria-label={m["reg.title"]} className={box} data-registration>
        <h2 className="font-medium">{m["reg.title"]}</h2>
        {canRegister ? (
          <ActionForm action={openRegistrationAction} submitLabel={m["reg.open"]}>
            {hidden}
          </ActionForm>
        ) : null}
      </section>
    );
  }
  const tablets = (await listDevices(pool(), tenantId, propertyId)).filter((d) => d.kind === "guest" && !d.revokedAt);
  const onTablet = tablets.find((d) => d.id === reg.deviceId);
  const input = "h-9 rounded-xl border border-ink-10 bg-surface px-2";
  return (
    <section aria-label={m["reg.title"]} className={box} data-registration>
      <AutoRefresh active={reg.deviceId !== null} />
      <h2 className="font-medium">{m["reg.title"]}</h2>
      <p className="rounded-xl bg-accent/10 px-3 py-2">{m[`reg.rule.${reg.country}`]}</p>
      <ul className="grid gap-2">
        {reg.persons.map((p) => (
          <li key={p.id} className="grid gap-2 rounded-xl bg-surface p-3" data-person={p.firstName} data-need={p.need} data-step={p.step}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-ink-5 px-1 text-xs">{p.nationality || "–"}</span>
              <span className="font-medium">
                {p.firstName} {p.lastName}
              </span>
              <span className="text-xs text-ink-60">{m[`reg.role.${p.role}`]}</span>
              <span className="ml-auto text-xs">
                {p.need === "own_form"
                  ? p.completed
                    ? m["reg.completed"]
                    : reg.queue[0] === p.id
                      ? `${m["reg.onTablet"]}: ${m[`reg.step.${p.step}`]}`
                      : p.guestDone
                        ? m["reg.guestDone"]
                        : m["reg.notStarted"]
                  : m[`reg.need.${p.need}`]}
              </span>
            </div>
            {p.need === "own_form" && p.guestDone && !p.completed && canRegister ? (
              <div className="grid gap-2">
                <p className="text-xs text-ink-60">
                  {m["reg.entered"]}: {p.firstName} {p.lastName}, {p.dateOfBirth}, {p.addressLine1}, {p.postalCode} {p.city}, {p.country} · {p.documentNumber}
                </p>
                {!p.idChecked ? (
                  <ActionForm action={idCheckAction} submitLabel={m["reg.recordIdCheck"]} className="flex flex-wrap items-center gap-2">
                    {hidden}
                    <input type="hidden" name="personId" value={p.id} />
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="compared" /> {m["reg.compared"]}
                    </label>
                    <input name="note" placeholder={m["reg.discrepancy"]} className={`${input} min-w-64`} />
                  </ActionForm>
                ) : (
                  <p className="text-xs">✓ {m["reg.idChecked"]}{p.idCheckNote ? ` · ${p.idCheckNote}` : ""}</p>
                )}
                {reg.country === "DE" && !p.confirmation ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/registration/${p.id}`} target="_blank" className="rounded-full bg-surface-2 px-3 py-2 font-medium" data-print-form>
                      {m["reg.printForm"]}
                    </a>
                    <ActionForm action={signedOnPaperAction} submitLabel={m["reg.signedOnPaper"]} className="contents">
                      {hidden}
                      <input type="hidden" name="personId" value={p.id} />
                    </ActionForm>
                  </div>
                ) : null}
                {p.idChecked && p.confirmation ? (
                  <ActionForm action={completeAction} submitLabel={m["reg.complete"]}>
                    {hidden}
                    <input type="hidden" name="personId" value={p.id} />
                  </ActionForm>
                ) : (
                  <p className="text-xs text-ink-60">{m["reg.needs"]}</p>
                )}
              </div>
            ) : null}
            {p.completed ? (
              <a href={`/registration/${p.id}`} target="_blank" className="text-xs text-accent underline">
                {m["reg.form"]}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {canRegister ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            {onTablet ? (
              <ActionForm action={takeBackAction} submitLabel={`${m["reg.takeBack"]} (${onTablet.name})`} className="contents">
                {hidden}
              </ActionForm>
            ) : (
              <ActionForm action={sendToTabletAction} submitLabel={m["reg.send"]} className="flex flex-wrap items-end gap-2">
                {hidden}
                <select name="deviceId" className={input} aria-label={m["reg.tablet"]}>
                  {tablets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </ActionForm>
            )}
          </div>
          <details>
            <summary className="cursor-pointer text-ink-60">{m["reg.addPerson"]}</summary>
            <ActionForm action={addPersonAction} submitLabel={m["reg.add"]} className="mt-2 flex flex-wrap items-end gap-2">
              {hidden}
              <select name="role" className={input}>
                {(["spouse", "partner", "child", "other"] as const).map((r) => (
                  <option key={r} value={r}>
                    {m[`reg.role.${r}`]}
                  </option>
                ))}
              </select>
              <input name="firstName" required placeholder={m["reg.firstName"]} className={input} />
              <input name="lastName" required placeholder={m["reg.lastName"]} className={input} />
              <input name="dateOfBirth" type="date" className={input} />
              <input name="nationality" required placeholder="DE" className={`${input} w-16`} />
            </ActionForm>
          </details>
        </>
      ) : null}
    </section>
  );
}
