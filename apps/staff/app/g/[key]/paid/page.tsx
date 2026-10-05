import Link from "next/link";
import { finishPortalPayment, listTenantUsers } from "@hoteloftware/db";
import { can, portalLanguage } from "@hoteloftware/domain";
import { notifyStaff } from "@hoteloftware/events";
import { paymentProvider } from "@hoteloftware/payments";
import { portalText } from "@/i18n/portal";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { Glass } from "../../glass";

export const dynamic = "force-dynamic";

/** Back from the payment form (ticket 41): the provider's answer, shown plainly; the desk hears of a decline once. */
export default async function PaidPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ id?: string; lang?: string }> }) {
  const { key } = await params;
  const q = await searchParams;
  const language = portalLanguage(q.lang, null);
  const t = (k: Parameters<typeof portalText>[1], v?: Record<string, string>) => portalText(language, k, v);
  const tenant = await currentTenant();
  let message: string;
  try {
    const r = await finishPortalPayment(pool(), tenant!.schemaName, paymentProvider(), key, String(q.id ?? ""));
    message = r.status === "succeeded" ? t("paid") : r.status === "failed" ? t("declined", { reason: r.error ?? "" }) : t("pending");
    if (r.declinedNow && tenant) {
      const desk = (await listTenantUsers(pool(), tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "take_payments", r.propertyId));
      await notifyStaff(pool(), tenant, desk, { kind: "payments.portal_declined", title: "Online payment declined in the Guest Portal", body: r.error ?? "", href: `/reservations/${r.reservationId}`, propertyId: r.propertyId }).catch(() => undefined);
    }
  } catch {
    message = portalText(language, "notFound");
  }
  return (
    <Glass data-paid>
      <p className="text-lg">{message}</p>
      <Link href={`/g/${key}?lang=${language}`} className="underline">
        {t("back")}
      </Link>
    </Glass>
  );
}
