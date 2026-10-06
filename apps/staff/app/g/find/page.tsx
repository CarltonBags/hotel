import { headers } from "next/headers";
import { portalLanguage } from "@hoteloftware/domain";
import { portalText } from "@/i18n/portal";
import { requestCodeAction, verifyCodeAction } from "../actions";
import { FindForm } from "../forms";
import { Glass } from "../glass";

export const dynamic = "force-dynamic";

/** Without the link: booking number and last name, then a code by email (ticket 40). */
export default async function FindPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const language = portalLanguage((await searchParams).lang, (await headers()).get("accept-language"));
  return (
    <Glass>
      <h1 className="text-2xl font-semibold">{portalText(language, "findTitle")}</h1>
      <p className="text-sm text-white/70">{portalText(language, "findHelp")}</p>
      <FindForm request={requestCodeAction} verify={verifyCodeAction} language={language} />
    </Glass>
  );
}
