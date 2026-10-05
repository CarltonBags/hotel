/** One dark glass card of the guest side. */
export function Glass({ children, className = "", ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`grid gap-3 rounded-3xl border border-white/15 bg-black/45 p-6 shadow-2xl backdrop-blur-xl ${className}`} {...rest}>
      {children}
    </section>
  );
}

export const guestInput = "h-11 w-full rounded-xl border border-white/20 bg-white/10 px-3 text-white placeholder:text-white/50 focus:border-white/60 focus:outline-none";
export const guestButton = "h-11 rounded-full bg-white px-5 font-medium text-black disabled:opacity-50";
