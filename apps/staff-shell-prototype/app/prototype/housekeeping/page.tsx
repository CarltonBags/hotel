// PROTOTYPE, throwaway. Three structures for the housekeeper's phone view, plus supervisor board and maintenance queue, on /prototype/housekeeping.
import { Suspense } from "react";
import { HkPrototype } from "@/components/prototype/housekeeping/HkPrototype";

export default function Page() {
  return (
    <Suspense>
      <HkPrototype />
    </Suspense>
  );
}
