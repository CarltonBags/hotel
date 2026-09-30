"use client";
// PROTOTYPE switcher bar. Not part of any design being judged. Hidden in production builds.
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PrototypeSwitcher({ variants, current, state }: { variants: { key: string; name: string }[]; current: string; state: unknown }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [showState, setShowState] = useState(false);
  const idx = Math.max(0, variants.findIndex((v) => v.key === current));

  const go = (d: number) => {
    const next = variants[(idx + d + variants.length) % variants.length];
    const p = new URLSearchParams(params.toString());
    p.set("variant", next.key);
    router.replace(`${pathname}?${p.toString()}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 font-mono text-[12px] text-white">
      {showState && (
        <pre className="mb-2 max-h-72 w-[420px] overflow-auto rounded-xl bg-black/90 p-3 text-[11px] leading-snug text-lime-300">{JSON.stringify(state, null, 2)}</pre>
      )}
      <div className="mx-auto flex w-fit items-center gap-1 rounded-full bg-black px-1.5 py-1.5 shadow-2xl ring-2 ring-fuchsia-500">
        <button aria-label="Previous variant" onClick={() => go(-1)} className="grid size-7 place-items-center rounded-full hover:bg-white/20"><ChevronLeft size={16} /></button>
        <span className="px-2">PROTOTYPE · {variants[idx].key} — {variants[idx].name}</span>
        <button aria-label="Next variant" onClick={() => go(1)} className="grid size-7 place-items-center rounded-full hover:bg-white/20"><ChevronRight size={16} /></button>
        <button onClick={() => setShowState(!showState)} className="ml-1 rounded-full px-2 py-1 hover:bg-white/20">{showState ? "hide state" : "state"}</button>
      </div>
    </div>
  );
}
