"use client";

/** Print the set as one job; the day's printing ends the shift reminder (ticket 86). */
export function PrintButton({ label, propertyId }: { label: string; propertyId: string }) {
  return (
    <button
      type="button"
      data-print
      onClick={() => {
        try {
          localStorage.setItem(`hs-downtime-printed:${propertyId}`, new Date().toISOString().slice(0, 10));
        } catch {
          // a reminder that shows again is no harm
        }
        window.print();
      }}
      className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-white shadow-pill"
    >
      {label}
    </button>
  );
}
