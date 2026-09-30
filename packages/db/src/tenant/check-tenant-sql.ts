/**
 * CI guard: tenant SQL must never name a schema. drizzle-kit emits
 * `"public"."table"` in foreign keys for unqualified tables; the search path
 * would then be bypassed and every tenant would share one table.
 */
export interface Finding {
  line: number;
  match: string;
}

const ALLOWED_SCHEMAS = new Set(["pg_catalog", "information_schema"]);
/** Unquoted `x.y` is flagged only when `x` is a schema of ours; `t.id` style aliases stay legal. */
const KNOWN_SCHEMA = /^(public|control|t_[a-z0-9_]+)$/i;

// quoted "schema"."name" or unquoted schema.name (identifiers start with a letter or underscore)
const QUALIFIED = /"([A-Za-z_][A-Za-z0-9_]*)"\s*\.\s*"[A-Za-z_][A-Za-z0-9_]*"|\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\b/g;

/** Blank out string literals and comments so their contents cannot match. */
function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, (s) => " ".repeat(s.length))
    .replace(/--[^\n]*/g, (s) => " ".repeat(s.length))
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));
}

export function findSchemaQualifiedNames(sql: string): Finding[] {
  const findings: Finding[] = [];
  stripLiteralsAndComments(sql)
    .split("\n")
    .forEach((text, i) => {
      for (const m of text.matchAll(QUALIFIED)) {
        const schema = (m[1] ?? m[2])!;
        if (ALLOWED_SCHEMAS.has(schema.toLowerCase())) continue;
        if (m[2] !== undefined && !KNOWN_SCHEMA.test(schema)) continue;
        findings.push({ line: i + 1, match: m[0].replace(/\s+/g, "") });
      }
    });
  return findings;
}
