import Link from "next/link";
import { finishCardSetup } from "@hoteloftware/db";
import { portalLanguage } from "@hoteloftware/domain";
import { paymentProvider } from "@hoteloftware/payments";
import { portalText } from "@/i18n/portal";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { Glass } from "../../glass";

export const dynamic = "force-dynamic";

/** Back from storing a card (ticket 41). */
export default async function CardPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ id?: string; lang?: string }> }) {
  const { key } = await params;
  const q = await searchParams;
  const language = portalLanguage(q.lang, null);
  const tenant = await currentTenant();
  let message: string;
  try {
    const r = await finishCardSetup(pool(), tenant!.schemaName, paymentProvider(), key, String(q.id ?? ""));
    message = r.status === "succeeded" ? portalText(language, "cardStored") : r.status === "failed" ? portalText(language, "cardDeclined", { reason: r.error ?? "" }) : portalText(language, "pending");
  } catch {
    message = portalText(language, "notFound");
  }
  return (
    <Glass data-card-result>
      <p className="text-lg">{message}</p>
      <Link href={`/g/${key}?lang=${language}`} className="underline">
        {portalText(language, "back")}
      </Link>
    </Glass>
  );
}
