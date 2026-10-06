/**
 * The guest side's look ("Self check-in guest interface", variant A): a
 * full-bleed landscape, one dark glass card. No tracking, no cookies.
 */
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-[#0b1520] text-white">
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "radial-gradient(ellipse at 20% 10%, #3b6e8f 0%, transparent 55%), radial-gradient(ellipse at 80% 90%, #c27a4a 0%, transparent 50%), linear-gradient(160deg, #1d3b52 0%, #0b1520 70%)" }}
      />
      <main className="relative z-10 mx-auto grid min-h-dvh max-w-xl content-center gap-4 px-4 py-10">{children}</main>
    </div>
  );
}
