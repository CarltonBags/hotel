// PROTOTYPE, throwaway. Meldeschein desk-to-tablet flow, three legal completion paths via ?variant=, on /prototype/meldeschein.
import { Suspense } from "react";
import { MeldescheinPrototype } from "@/components/prototype/meldeschein/MeldescheinPrototype";

export default function Page() {
  return (
    <Suspense>
      <MeldescheinPrototype />
    </Suspense>
  );
}
