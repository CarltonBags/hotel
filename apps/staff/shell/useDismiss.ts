"use client";

import { useEffect, type RefObject } from "react";

/** Close a popover on a click outside or Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}

const FOCUSABLE = '[role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"], button:not([disabled])';

/** Arrow keys move focus between the items of a menu or list; Home and End jump. */
export function onArrowKeys(e: React.KeyboardEvent<HTMLElement>): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  let next = index;
  if (e.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
  if (e.key === "ArrowUp") next = index <= 0 ? items.length - 1 : index - 1;
  if (e.key === "Home") next = 0;
  if (e.key === "End") next = items.length - 1;
  e.preventDefault();
  items[next]?.focus();
}
