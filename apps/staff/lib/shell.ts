import { cache } from "react";
import { cookies } from "next/headers";
import { ACCENTS, defaultQuickAccess, type Language, type Theme } from "@hoteloftware/domain";
import { getPreferences, getWorkspace, type PinnedTab, type Preferences, type Property } from "@hoteloftware/db";
import { messagesFor, type Messages } from "@/i18n/messages";
import { accessibleProperties, requirePrincipal, type Principal } from "./authorize";
import { pool } from "./db";

export const SCOPE_COOKIE = "hs_scope";
export const THEME_COOKIE = "hs_theme";
export const ACCENT_COOKIE = "hs_accent";
export const LANGUAGE_COOKIE = "hs_lang";

export interface ShellData {
  principal: Principal;
  properties: Property[];
  /** "all" or a property id the user may open. */
  scope: string;
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
  const properties = await accessibleProperties();
  const jar = await cookies();
  const requested = jar.get(SCOPE_COOKIE)?.value;
  const scope =
    properties.length === 1
      ? properties[0]!.id
      : requested && (requested === "all" || properties.some((p) => p.id === requested))
        ? requested
        : "all";
  const [preferences, workspace] = await Promise.all([
    getPreferences(pool(), principal.session.user.id),
    getWorkspace(pool(), principal.session.user.id, scope),
  ]);
  const accentId = principal.tenant.accent;
  return {
    principal,
    properties,
    scope,
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
