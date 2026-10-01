/**
 * Username: 3 to 30 characters, letters, digits, dot, underscore or hyphen,
 * starting with a letter or digit. Compared case-insensitively.
 */
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export function normaliseUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isUsername(value: string): boolean {
  return USERNAME.test(normaliseUsername(value));
}

/** Suggest a username from a name: "Dana Desk" -> "dana.desk". */
export function suggestUsername(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return base.slice(0, 30).padEnd(3, "0");
}
