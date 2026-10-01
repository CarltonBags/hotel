"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { signOut } from "@/app/sign-in/actions";
import { useShell } from "./ShellProvider";
import { onArrowKeys, useDismiss } from "./useDismiss";

export function ThemeToggle() {
  const { t, effectiveTheme, setTheme } = useShell();
  const next = effectiveTheme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      aria-label={`${t("shell.theme")}: ${t(`shell.theme.${next}`)}`}
      title={t(`shell.theme.${next}`)}
      onClick={() => setTheme(next)}
      className="grid size-12 shrink-0 place-items-center rounded-full bg-surface shadow-pill hover:bg-surface-2"
    >
      {effectiveTheme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function UserMenu() {
  const { t, user, language, theme, setLanguage, setTheme, openModule } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const row = "flex h-10 w-full items-center justify-between rounded-[10px] px-3 text-left text-[14px] hover:bg-ink-5";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={user.name}
        className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-medium text-white shadow-pill"
      >
        {initials(user.name)}
      </button>
      {open && (
        <div role="menu" onKeyDown={onArrowKeys} className="absolute right-0 top-14 z-30 w-64 rounded-[14px] bg-surface p-1 shadow-pop">
          <div className="px-3 py-2">
            <div className="text-[14px] font-medium">{user.name}</div>
            <div className="text-[12px] text-ink-60">{user.username ?? user.email}</div>
          </div>
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-40">{t("shell.language")}</div>
          {(["de", "en"] as const).map((l) => (
            <button type="button" key={l} role="menuitemradio" aria-checked={language === l} onClick={() => setLanguage(l)} className={row}>
              {l === "de" ? "Deutsch" : "English"}
              {language === l && <Check size={16} className="text-accent" />}
            </button>
          ))}
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-40">{t("shell.theme")}</div>
          {(["light", "dark", "system"] as const).map((th) => (
            <button type="button" key={th} role="menuitemradio" aria-checked={theme === th} onClick={() => setTheme(th)} className={row}>
              {t(`shell.theme.${th}`)}
              {theme === th && <Check size={16} className="text-accent" />}
            </button>
          ))}
          <div className="my-1 border-t border-ink-10" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              openModule("settings_account");
              setOpen(false);
            }}
            className={row}
          >
            {t("shell.account")}
          </button>
          <form action={signOut}>
            <button type="submit" role="menuitem" className={row}>
              {t("shell.signOut")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
