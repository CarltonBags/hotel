import Link from "next/link";
import { claimDeclineNotice, finishPortalPayment } from "@hoteloftware/db";
import { portalLanguage } from "@hoteloftware/domain";
import { notifyPortalDecline } from "@hoteloftware/events";
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
    // whoever sees the decline first tells the desk (this page or the provider's webhook), once
    const declined = r.status === "failed" ? await claimDeclineNotice(pool(), tenant!.schemaName, String(q.id)) : null;
    if (declined) await notifyPortalDecline(pool(), tenant!, { ...declined, reason: declined.error ?? "" }).catch((err) => console.error("decline not told", err));
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
