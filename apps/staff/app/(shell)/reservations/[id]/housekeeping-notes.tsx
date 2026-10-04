import { HOUSEKEEPING_NOTE_CODES, can, type Actor } from "@hoteloftware/domain";
import { listHousekeepingNotes } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { ActionForm, Field } from "@/components/form-fields";
import { addHousekeepingNoteAction, removeHousekeepingNoteAction } from "./housekeeping-notes-actions";

/** Housekeeping Notes for floor staff: from the property's fixed list or free text (ticket 35). */
export async function HousekeepingNotes({ schema, reservationId, propertyId, actor, m }: { schema: string; reservationId: string; propertyId: string; actor: Actor; m: Messages }) {
  const notes = await listHousekeepingNotes(pool(), schema, reservationId);
  const edit = can(actor, "manage_housekeeping_notes", propertyId);
  if (!edit && !notes.length) return null;
  const used = new Set(notes.map((n) => n.code));
  return (
    <section aria-label={m["hknotes.title"]} className="grid gap-2 rounded-2xl bg-surface-2 p-5 text-sm">
      <h2 className="font-medium">{m["hknotes.title"]}</h2>
      <p className="text-xs text-ink-60">{m["hknotes.help"]}</p>
      <ul className="flex flex-wrap gap-2">
        {notes.map((n) => (
          <li key={n.id} className="flex items-center gap-1 rounded-full bg-surface px-3 py-1">
            {n.code ? m[`hknotes.${n.code}`] : n.text}
            {edit ? (
              <ActionForm action={removeHousekeepingNoteAction} submitLabel="×" className="inline">
                <input type="hidden" name="reservationId" value={reservationId} />
                <input type="hidden" name="noteId" value={n.id} />
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
      {edit ? (
        <div className="flex flex-wrap gap-2">
          {HOUSEKEEPING_NOTE_CODES.filter((c) => !used.has(c)).map((c) => (
            <ActionForm key={c} action={addHousekeepingNoteAction} submitLabel={`+ ${m[`hknotes.${c}`]}`} className="inline">
              <input type="hidden" name="reservationId" value={reservationId} />
              <input type="hidden" name="code" value={c} />
            </ActionForm>
          ))}
          <ActionForm action={addHousekeepingNoteAction} submitLabel={m["hknotes.add"]} className="flex items-end gap-2">
            <input type="hidden" name="reservationId" value={reservationId} />
            <Field label={m["hknotes.free"]} name="text" />
          </ActionForm>
        </div>
      ) : null}
    </section>
  );
}
