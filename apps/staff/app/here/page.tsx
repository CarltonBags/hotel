import { Glass } from "../g/glass";
import GuestLayout from "../g/layout";

/** After the lobby QR code: open the Portal Link to check in on the phone. */
export default async function HerePage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const ok = (await searchParams).ok === "1";
  return (
    <GuestLayout>
      <Glass data-here-page>
        <h1 className="text-2xl font-semibold">{ok ? "Willkommen · Welcome" : "Bitte an der Rezeption melden · Please come to reception"}</h1>
        {ok ? (
          <p className="text-white/80">
            Öffnen Sie den Link aus Ihrer Buchungsbestätigung und tippen Sie auf „Jetzt einchecken“. · Open the link from your booking confirmation and tap “Check in now”.
          </p>
        ) : null}
      </Glass>
    </GuestLayout>
  );
}
