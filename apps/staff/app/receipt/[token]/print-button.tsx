"use client";

/** Print on request (in Austria a printed receipt must be given when asked). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="mx-auto h-9 rounded-full border border-black px-4 font-sans print:hidden">
      Drucken / Print
    </button>
  );
}
