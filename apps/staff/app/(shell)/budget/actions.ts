"use server";

import { revalidatePath } from "next/cache";
import { setBudget } from "@hoteloftware/db";
import { BUDGET_VERSIONS, parseBudgetCsv, type BudgetMonth, type BudgetVersion } from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { decimalOrNull, field, formAction, type FormState } from "@/lib/form";

function target(formData: FormData): { propertyId: string; year: number; version: BudgetVersion } {
  const version = field(formData, "version") as BudgetVersion;
  if (!BUDGET_VERSIONS.includes(version)) throw new Error("Budget or Forecast");
  return { propertyId: field(formData, "propertyId"), year: Number(field(formData, "year")), version };
}

/** Save the months typed in (ticket 83); a month left empty stays as it was. */
export async function saveBudgetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = target(formData);
    const { tenant, session } = await authorize("manage_budget", t.propertyId);
    const months: BudgetMonth[] = [];
    for (let month = 1; month <= 12; month++) {
      const v = (k: string) => decimalOrNull(formData, `${k}_${month}`);
      const [occupancy, adr, netRoomRevenue, totalRevenue] = [v("occupancy"), v("adr"), v("nrr"), v("total")];
      if ([occupancy, adr, netRoomRevenue, totalRevenue].every((x) => x === null)) continue;
      if ([occupancy, adr, netRoomRevenue, totalRevenue].some((x) => x === null)) throw new Error(`Month ${month}: all four figures, or none`);
      months.push({ month, occupancy: occupancy!, adr: adr!, netRoomRevenue: netRoomRevenue!, totalRevenue: totalRevenue! });
    }
    await setBudget(pool(), tenant.schemaName, t.propertyId, { ...t, months }, session.user.id);
    revalidatePath("/budget");
    return { ok: true, message: "Saved." };
  });
}

/** Import a spreadsheet file: every bad line named, nothing saved until all are right. */
export async function importBudgetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = target(formData);
    const { tenant, session } = await authorize("manage_budget", t.propertyId);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a spreadsheet file (CSV)");
    if (file.size > 100_000) throw new Error("This file is too large for a year's budget");
    const parsed = parseBudgetCsv(await file.text(), t.year);
    if (parsed.errors.length) throw new Error(parsed.errors.join(" · "));
    await setBudget(pool(), tenant.schemaName, t.propertyId, { ...t, months: parsed.months }, session.user.id);
    revalidatePath("/budget");
    return { ok: true, message: `Imported ${parsed.months.length} month(s).` };
  });
}
