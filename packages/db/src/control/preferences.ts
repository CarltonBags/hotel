import type { Pool, PoolClient } from "pg";
import { isLanguage, isTheme, type Language, type Theme } from "@hoteloftware/domain";

type Queryable = Pool | PoolClient;

export interface Preferences {
  language: Language;
  theme: Theme;
  /** Module ids in order, or null to use the defaults for the user's roles. */
  quickAccess: string[] | null;
}

const DEFAULTS: Preferences = { language: "en", theme: "system", quickAccess: null };

export async function getPreferences(db: Queryable, userId: string): Promise<Preferences> {
  const { rows } = await db.query<{ language: Language; theme: Theme; quick_access: string[] | null }>(
    "select language, theme, quick_access from control.user_preferences where user_id = $1",
    [userId],
  );
  const r = rows[0];
  return r ? { language: r.language, theme: r.theme, quickAccess: r.quick_access } : { ...DEFAULTS };
}

export async function setPreferences(db: Queryable, userId: string, patch: Partial<Preferences>): Promise<Preferences> {
  if (patch.language !== undefined && !isLanguage(patch.language)) throw new Error(`Unknown language: ${patch.language}`);
  if (patch.theme !== undefined && !isTheme(patch.theme)) throw new Error(`Unknown theme: ${patch.theme}`);
  // One statement: fields not in the patch keep their stored value, so concurrent patches never drop each other.
  const quick = patch.quickAccess === undefined ? undefined : patch.quickAccess === null ? null : JSON.stringify(patch.quickAccess);
  const { rows } = await db.query<{ language: Language; theme: Theme; quick_access: string[] | null }>(
    `insert into control.user_preferences (user_id, language, theme, quick_access)
     values ($1, coalesce($2, 'en'), coalesce($3, 'system'), $4)
     on conflict (user_id) do update set
       language = coalesce($2, control.user_preferences.language),
       theme = coalesce($3, control.user_preferences.theme),
       quick_access = case when $5 then $4::jsonb else control.user_preferences.quick_access end,
       updated_at = now()
     returning language, theme, quick_access`,
    [userId, patch.language ?? null, patch.theme ?? null, quick ?? null, quick !== undefined],
  );
  const r = rows[0]!;
  return { language: r.language, theme: r.theme, quickAccess: r.quick_access };
}

/** A Pinned Tab as stored: enough to rebuild the tab on any device, record tabs included. */
export interface PinnedTab {
  id: string;
  kind: "module" | "record";
  module: string;
  title: string;
  href: string;
}

export interface Workspace {
  pinnedTabs: PinnedTab[];
}

function isPinnedTab(value: unknown): value is PinnedTab {
  const v = value as Partial<PinnedTab> | null;
  return (
    typeof v?.id === "string" &&
    (v.kind === "module" || v.kind === "record") &&
    typeof v.module === "string" &&
    typeof v.title === "string" &&
    typeof v.href === "string" &&
    v.href.startsWith("/")
  );
}

export async function getWorkspace(db: Queryable, userId: string, propertyScope: string): Promise<Workspace> {
  const { rows } = await db.query<{ pinned_tabs: unknown[] }>(
    "select pinned_tabs from control.user_workspace where user_id = $1 and property_scope = $2",
    [userId, propertyScope],
  );
  return { pinnedTabs: (rows[0]?.pinned_tabs ?? []).filter(isPinnedTab) };
}

export async function setPinnedTabs(db: Queryable, userId: string, propertyScope: string, pinnedTabs: PinnedTab[]): Promise<void> {
  if (!pinnedTabs.every(isPinnedTab)) throw new Error("Invalid pinned tab");
  await db.query(
    `insert into control.user_workspace (user_id, property_scope, pinned_tabs) values ($1, $2, $3)
     on conflict (user_id, property_scope) do update set pinned_tabs = excluded.pinned_tabs, updated_at = now()`,
    [userId, propertyScope, JSON.stringify(pinnedTabs)],
  );
}
