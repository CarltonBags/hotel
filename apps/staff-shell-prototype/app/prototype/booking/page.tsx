// PROTOTYPE, throwaway. Three looks for the hosted booking page, switchable via ?variant=, on /prototype/booking.
import { Suspense } from "react";
import { BookingPrototype } from "@/components/prototype/booking/BookingPrototype";

export default function Page() {
  return (
    <Suspense>
      <BookingPrototype />
    </Suspense>
  );
}
