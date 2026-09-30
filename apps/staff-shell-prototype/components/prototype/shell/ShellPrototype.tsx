"use client";
// PROTOTYPE, throwaway. Five variants (A-C round 1, D-E round 2) of the staff app shell, switchable via ?variant=, on /prototype/shell.
import { useSearchParams } from "next/navigation";
import { PrototypeSwitcher } from "../PrototypeSwitcher";
import { useWorkspace } from "./useWorkspace";
import { VariantA, name as nameA } from "./VariantA";
import { VariantB, name as nameB } from "./VariantB";
import { VariantC, name as nameC } from "./VariantC";
import { VariantD, name as nameD } from "./VariantD";
import { VariantE, name as nameE } from "./VariantE";

const VARIANTS = [
  { key: "A", name: nameA },
  { key: "B", name: nameB },
  { key: "C", name: nameC },
  { key: "D", name: nameD },
  { key: "E", name: nameE },
];

export function ShellPrototype() {
  const raw = useSearchParams().get("variant") ?? "A";
  const variant = VARIANTS.some((v) => v.key === raw) ? raw : "A";
  const ws = useWorkspace(); // state survives variant switches, so the same open tabs are compared across shells

  return (
    <>
      {variant === "A" && <VariantA ws={ws} />}
      {variant === "B" && <VariantB ws={ws} />}
      {variant === "C" && <VariantC ws={ws} />}
      {variant === "D" && <VariantD ws={ws} />}
      {variant === "E" && <VariantE ws={ws} />}
      <PrototypeSwitcher
        variants={VARIANTS}
        current={variant}
        state={{ variant, theme: ws.theme, propertyId: ws.propertyId, accent: ws.accent, activeId: ws.activeId, pinned: ws.pinned, splitId: ws.splitId, tabs: ws.tabs }}
      />
    </>
  );
}
