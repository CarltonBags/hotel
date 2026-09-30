// PROTOTYPE, throwaway. Three structures for the Calendar inside the chosen shell, switchable via ?variant=, on /prototype/calendar.
import { Suspense } from "react";
import { CalendarPrototype } from "@/components/prototype/calendar/CalendarPrototype";

export default function Page() {
  return (
    <Suspense>
      <CalendarPrototype />
    </Suspense>
  );
}
