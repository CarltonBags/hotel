import Link from "next/link";

export default function NotAllowedPage() {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="max-w-md rounded-3xl bg-surface p-8 shadow-card">
        <h1 className="text-lg font-medium">Not allowed</h1>
        <p className="mt-2 text-ink-60">Your roles do not include this. Ask your Property Manager or Tenant Admin.</p>
        <Link href="/" className="mt-4 inline-block text-accent">
          Back to start
        </Link>
      </div>
    </main>
  );
}
