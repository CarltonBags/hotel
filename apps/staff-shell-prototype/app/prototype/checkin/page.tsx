// PROTOTYPE, throwaway. Three looks for the guest self check-in flow, switchable via ?variant=, on /prototype/checkin.
import { Suspense } from "react";
import { CheckinPrototype } from "@/components/prototype/checkin/CheckinPrototype";

export default function Page() {
  return (
    <Suspense>
      <CheckinPrototype />
    </Suspense>
  );
}
