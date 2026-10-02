import { cache } from "react";
import { cookies } from "next/headers";
import { ACCENTS, defaultQuickAccess, isFrontOfficeOnly, type Language, type Theme } from "@hoteloftware/domain";
import { getPreferences, getWorkspace, type PinnedTab, type Preferences, type Property } from "@hoteloftware/db";
import { messagesFor, type Messages } from "@/i18n/messages";
import { SCOPE_COOKIE, accessibleProperties, requirePrincipal, workingPropertyId, type Principal } from "./authorize";
import { pool } from "./db";

export { SCOPE_COOKIE };
export const THEME_COOKIE = "hs_theme";
export const ACCENT_COOKIE = "hs_accent";
export const LANGUAGE_COOKIE = "hs_lang";

export interface ShellData {
  principal: Principal;
  /** The properties the shell shows: for front-office users only the one they work in. */
  properties: Property[];
  /** "all", a property id the user may open, or "" while a front-office user has yet to choose one. */
  scope: string;
  /** Front-office roles only: one property at a time, no "All properties" (ticket 96). */
  frontOffice: boolean;
  /** Properties a front-office user may change to, from the user menu (empty with one property or for other users). */
  propertyChoices: Property[];
  preferences: Preferences;
  quickAccess: string[];
  pinnedTabs: PinnedTab[];
  messages: Messages;
  language: Language;
  theme: Theme;
  accent: { id: string; light: string; dark: string };
}

/** Everything the shell needs for one request, loaded once. */
export const loadShell = cache(async (): Promise<ShellData> => {
  const principal = await requirePrincipal();
  const available = await accessibleProperties();
  const jar = await cookies();
  const requested = jar.get(SCOPE_COOKIE)?.value;
  const frontOffice = isFrontOfficeOnly(principal.actor);
  let properties = available;
  let scope: string;
  if (frontOffice) {
    // the front office sees the property it works in, chosen after sign-in when it has several
    const working = await workingPropertyId();
    const current = available.find((p) => p.id === working);
    properties = current ? [current] : [];
    scope = current?.id ?? "";
  } else {
    scope =
      available.length === 1
        ? available[0]!.id
        : requested && (requested === "all" || available.some((p) => p.id === requested))
          ? requested
          : "all";
  }
  const [preferences, workspace] = await Promise.all([
    getPreferences(pool(), principal.session.user.id),
    getWorkspace(pool(), principal.session.user.id, scope),
  ]);
  const accentId = principal.tenant.accent;
  return {
    principal,
    properties,
    scope,
    frontOffice,
    propertyChoices: frontOffice && available.length > 1 ? available : [],
    preferences,
    quickAccess: preferences.quickAccess ?? defaultQuickAccess(principal.actor, properties.map((p) => p.id)),
    pinnedTabs: workspace.pinnedTabs,
    messages: messagesFor(preferences.language),
    language: preferences.language,
    theme: preferences.theme,
    accent: { id: accentId, ...ACCENTS[accentId] },
  };
});

/** Messages in the user's language, for server components outside the shell data. */
export async function messages(): Promise<Messages> {
  return (await loadShell()).messages;
}
