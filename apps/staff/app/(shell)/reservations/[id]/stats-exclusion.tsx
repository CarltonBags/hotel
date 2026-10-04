import { can, type Actor } from "@hoteloftware/domain";
import { statsExclusionOf } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { pool } from "@/lib/db";
import { ActionForm, Field } from "@/components/form-fields";
import { statsExclusionAction } from "./stats-exclusion-actions";

/** Leave the stay out of the official tourism statistics with a reason, or count it again (ticket 85). */
export async function StatsExclusion({ schema, reservationId, propertyId, actor, m }: { schema: string; reservationId: string; propertyId: string; actor: Actor; m: Messages }) {
  if (!can(actor, "exclude_from_statistics", propertyId)) return null;
  const reason = await statsExclusionOf(pool(), schema, reservationId);
  return (
    <details className="rounded-2xl bg-surface-2 p-5 text-sm" open={reason !== null}>
      <summary className="cursor-pointer font-medium">{reason ? fill(m["stats.excludedBecause"], { reason }) : m["stats.exclude"]}</summary>
      <ActionForm action={statsExclusionAction} submitLabel={reason ? m["stats.include"] : m["stats.exclude"]} pendingLabel={m["action.saving"]} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="reservationId" value={reservationId} />
        {reason ? <input type="hidden" name="include" value="on" /> : <Field label={m["stats.excludeReason"]} name="reason" required />}
      </ActionForm>
    </details>
  );
}
