/**
 * Names the hotel writes (room types, rooms, services): one main-language
 * name for staff, versions per guest language. A missing version falls back
 * to the main name and is marked (decided in "Staff app languages and time zones").
 */
export type Names = Record<string, string>;

export interface LocalizedName {
  text: string;
  missing: boolean;
}

export function localizedName(mainName: string, names: Names, language: string): LocalizedName {
  const text = names[language]?.trim();
  return text ? { text, missing: false } : { text: mainName, missing: true };
}

/** Merge edited versions into the stored ones; an empty string removes that language. */
export function mergeNames(current: Names, patch: Names): Names {
  const out = { ...current };
  for (const [lang, value] of Object.entries(patch)) {
    const v = value.trim();
    if (v) out[lang] = v;
    else delete out[lang];
  }
  return out;
}

/** Guest languages a property may enable; the property-level switch arrives with the Guest Portal. */
export const GUEST_LANGUAGES = ["de", "en"] as const;
