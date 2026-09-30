// PROTOTYPE, throwaway. Three structures for the Rates grid inside the chosen shell, switchable via ?variant=, on /prototype/rates.
import { Suspense } from "react";
import { RatesPrototype } from "@/components/prototype/rates/RatesPrototype";

export default function Page() {
  return (
    <Suspense>
      <RatesPrototype />
    </Suspense>
  );
}
