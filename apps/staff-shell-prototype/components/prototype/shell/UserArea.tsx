"use client";
// PROTOTYPE shared control: user chip with theme toggle and accent swatches (to pick the colour personality).
import { Moon, Sun } from "lucide-react";
import { ACCENTS } from "./mock";
import type { Workspace } from "./useWorkspace";

export function AccentSwatches({ ws }: { ws: Workspace }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Accent colour">
      {ACCENTS.map((a) => (
        <button key={a.id} role="radio" aria-checked={ws.accent === a.id} aria-label={a.label} title={a.label} onClick={() => ws.setAccent(a.id)}
          className={`size-5 rounded-full ring-offset-2 ring-offset-surface ${ws.accent === a.id ? "ring-2 ring-ink-40" : ""}`} style={{ background: ws.theme === "light" ? a.light : a.dark }} />
      ))}
    </div>
  );
}

export function ThemeButton({ ws }: { ws: Workspace }) {
  return (
    <button aria-label="Toggle light and dark" onClick={ws.toggleTheme} className="grid size-11 shrink-0 place-items-center rounded-full bg-surface shadow-pill hover:bg-surface-2">
      {ws.theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
