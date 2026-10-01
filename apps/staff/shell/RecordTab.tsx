"use client";

import { useEffect } from "react";
import { useShell } from "./ShellProvider";

/** Rendered by a record page (a Guest, a Company): opens or retitles its record tab in the tab strip. */
export function RecordTab({ module, recordId, title, href }: { module: string; recordId: string; title: string; href: string }) {
  const { registerRecord, ready } = useShell();
  useEffect(() => {
    if (ready) registerRecord(module, recordId, title, href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, module, recordId, title, href]);
  return null;
}
