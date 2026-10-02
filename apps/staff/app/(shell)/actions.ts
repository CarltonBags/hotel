"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { can, canAtAnyProperty, isAccentId, isLanguage, isTheme } from "@hoteloftware/domain";
import { getPreferences, searchGuests, searchReservations, setPinnedTabs, setPreferences, setTenantAccent, type PinnedTab } from "@hoteloftware/db";
import { MODULE_BY_ID } from "@/shell/registry";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { ACCENT_COOKIE, LANGUAGE_COOKIE, SCOPE_COOKIE, THEME_COOKIE, loadShell } from "@/lib/shell";

const YEAR = 60 * 60 * 24 * 365;

export async function savePinnedTabs(scope: string, tabs: PinnedTab[]): Promise<void> {
  const { principal, properties } = await loadShell();
  if (scope !== "all" && !properties.some((p) => p.id === scope)) return;
  const seen = new Set<string>();
  const clean = tabs
    .filter((t) => t && typeof t.id === "string" && t.id.length < 200 && typeof t.title === "string" && t.title.length < 200)
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
    .slice(0, 20)
    .map((t) => ({ id: t.id, kind: t.kind, module: t.module, title: t.title.slice(0, 120), href: t.href.slice(0, 500) }));
  await setPinnedTabs(pool(), principal.session.user.id, scope, clean);
}

/** Add or remove one module from the user's Quick Access, from the Main Menu. */
export async function toggleQuickAccess(moduleId: string): Promise<void> {
  const shell = await loadShell();
  if (!MODULE_BY_ID.has(moduleId)) return;
  const current = (await getPreferences(pool(), shell.principal.session.user.id)).quickAccess ?? shell.quickAccess;
  const next = current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId].slice(0, 8);
  await setPreferences(pool(), shell.principal.session.user.id, { quickAccess: next });
  revalidatePath("/", "layout");
}

export async function savePreferences(input: { language?: string; theme?: string; quickAccess?: string[] | null }): Promise<void> {
  const { session } = await requirePrincipal();
  const patch: Parameters<typeof setPreferences>[2] = {};
  const jar = await cookies();
  if (input.language !== undefined) {
    if (!isLanguage(input.language)) throw new Error("Unknown language");
    patch.language = input.language;
    jar.set(LANGUAGE_COOKIE, input.language, { path: "/", maxAge: YEAR, sameSite: "lax" });
  }
  if (input.theme !== undefined) {
    if (!isTheme(input.theme)) throw new Error("Unknown theme");
    patch.theme = input.theme;
    jar.set(THEME_COOKIE, input.theme, { path: "/", maxAge: YEAR, sameSite: "lax" });
  }
  if (input.quickAccess !== undefined) {
    patch.quickAccess = input.quickAccess === null ? null : input.quickAccess.filter((id) => MODULE_BY_ID.has(id)).slice(0, 8);
  }
  await setPreferences(pool(), session.user.id, patch);
  revalidatePath("/", "layout");
}

export async function setPropertyScope(scope: string): Promise<void> {
  const { properties, frontOffice, propertyChoices } = await loadShell();
  // the front office changes between its properties only; everyone else may also pick "all"
  const allowed = frontOffice ? propertyChoices : properties;
  const known = allowed.some((p) => p.id === scope) || (!frontOffice && scope === "all");
  if (!known) return;
  (await cookies()).set(SCOPE_COOKIE, scope, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function saveTenantAccent(accent: string): Promise<void> {
  const { tenant } = await authorize("manage_tenant_settings");
  if (!isAccentId(accent)) throw new Error("Unknown accent");
  await setTenantAccent(pool(), tenant.id, accent);
  (await cookies()).set(ACCENT_COOKIE, accent, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export interface SearchHits {
  reservations: { id: string; confirmationNumber: string; guestName: string; arrival: string; departure: string; propertyId: string; propertyName: string }[];
  guests: { id: string; name: string }[];
}

/**
 * Navbar search across properties: reservations by confirmation number or
 * guest name at every property where the user may see reservations, and
 * tenant-wide Guest profiles for users who may see them.
 */
export async function globalSearch(query: string): Promise<SearchHits> {
  const q = String(query ?? "").trim().slice(0, 100);
  if (q.length < 2) return { reservations: [], guests: [] };
  const { principal, properties } = await loadShell();
  const { tenant, actor } = principal;
  const visible = properties.filter((p) => can(actor, "view_reservations", p.id)).map((p) => p.id);
  const [reservations, guests] = await Promise.all([
    searchReservations(pool(), tenant.schemaName, q, visible, 8),
    canAtAnyProperty(actor, "view_guests") ? searchGuests(pool(), tenant.schemaName, q, { limit: 5 }) : Promise.resolve([]),
  ]);
  return {
    reservations: reservations.map((r) => ({
      id: r.id,
      confirmationNumber: r.confirmationNumber,
      guestName: `${r.guestLastName}, ${r.guestFirstName}`,
      arrival: r.arrival,
      departure: r.departure,
      propertyId: r.propertyId,
      propertyName: r.propertyName,
    })),
    guests: guests.map((g) => ({ id: g.id, name: `${g.lastName}, ${g.firstName}` })),
  };
}
