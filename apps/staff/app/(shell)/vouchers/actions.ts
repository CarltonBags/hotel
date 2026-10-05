"use server";

import { revalidatePath } from "next/cache";
import { sellVoucher, voucherByCode } from "@hoteloftware/db";
import type { VoucherSaleTender } from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { decimal, field, formAction, type FormState } from "@/lib/form";
import { signIssuedReceipt } from "@/lib/fiscal";

/** Sell a Voucher at the desk (ticket 53): the Receipt is signed at once and its link handed back. */
export async function sellVoucherAction(_prev: FormState & { receipt?: string }, formData: FormData): Promise<FormState & { receipt?: string }> {
  let receipt: string | undefined;
  const state = await formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session, actor } = await authorize("sell_vouchers", propertyId);
    const sold = await sellVoucher(
      pool(),
      tenant.schemaName,
      {
        propertyId,
        amount: decimal(formData, "amount"),
        tender: field(formData, "tender") as VoucherSaleTender,
        reference: field(formData, "reference"),
        buyerName: field(formData, "buyerName"),
        buyerEmail: field(formData, "buyerEmail"),
        recipientName: field(formData, "recipientName"),
        recipientEmail: field(formData, "recipientEmail"),
        message: field(formData, "message"),
      },
      { userId: session.user.id, actor },
    );
    await signIssuedReceipt(tenant, sold.receiptId);
    receipt = sold.receiptToken;
    revalidatePath("/vouchers");
    return { ok: true, message: sold.mailed ? `Voucher sold; the code goes to the recipient by email (ends ${sold.code.slice(-4)}).` : `Voucher sold (code ${sold.code}); in Test Mode no email is sent.` };
  });
  return { ...state, ...(receipt ? { receipt } : {}) };
}

/** What is left on a Voucher, looked up by its code. */
export async function voucherLookupAction(propertyId: string, code: string): Promise<{ balance: number; currency: string; redeemableHere: boolean; code: string } | null> {
  const { tenant } = await authorize("sell_vouchers", propertyId);
  return voucherByCode(pool(), tenant.schemaName, propertyId, code);
}
