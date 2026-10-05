import { can, type Actor } from "@hoteloftware/domain";
import { cardGuaranteeOf } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { ActionForm, Field } from "@/components/form-fields";
import { chargeStoredCardAction } from "./stored-card-actions";

/** The card the guest stored (portal or desk, ticket 41): staff charge it without the guest present. */
export async function StoredCard({ schema, reservationId, propertyId, actor, m }: { schema: string; reservationId: string; propertyId: string; actor: Actor; m: Messages }) {
  if (!can(actor, "view_folio", propertyId)) return null;
  const card = await cardGuaranteeOf(pool(), schema, reservationId);
  if (!card) return null;
  return (
    <section className="grid gap-2 rounded-2xl bg-surface-2 p-5 text-sm" data-stored-card>
      <p>{fill(m["card.stored"], { card: [card.brand, card.last4 ? `•••• ${card.last4}` : ""].filter(Boolean).join(" "), source: m[`card.source.${card.source}` as keyof Messages] ?? card.source })}</p>
      {can(actor, "take_payments", propertyId) ? (
        <ActionForm action={chargeStoredCardAction} submitLabel={m["card.charge"]} pendingLabel={m["action.saving"]} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="reservationId" value={reservationId} />
          <Field label={m["card.amount"]} name="amount" type="number" step="0.01" required />
        </ActionForm>
      ) : null}
    </section>
  );
}
