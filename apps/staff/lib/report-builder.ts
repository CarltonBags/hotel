import { DATA_SETS, DATA_SET_RIGHT, FILTER_OPS, allowedColumns, checkDefinition, type BuilderDefinition, type DataSet, type FilterOp } from "@hoteloftware/domain";
import type { Property } from "@hoteloftware/db";
import { allowedAmong } from "./authorize";
import { loadShell } from "./shell";

export type BuilderQuery = Record<string, string | string[] | undefined>;

/** A query string as the builder reads it: repeated keys kept. */
export function queryMap(params: URLSearchParams): BuilderQuery {
  const out: Record<string, string[]> = {};
  for (const [k, v] of params) (out[k] ??= []).push(v);
  return out;
}
const all = (q: BuilderQuery, k: string) => (Array.isArray(q[k]) ? (q[k] as string[]) : q[k] ? [q[k] as string] : []);
const one = (q: BuilderQuery, k: string) => all(q, k)[0] ?? "";

/** The builder's definition and scope from the page's query, checked against the user's rights at the properties in the navbar's scope. */
export async function builderFrom(q: BuilderQuery): Promise<{ dataSet: DataSet; def: BuilderDefinition | null; problem: string | null; properties: Property[]; from: string; to: string; language: "en" | "de"; available: DataSet[] }> {
  const shell = await loadShell();
  const { actor } = shell.principal;
  const language = shell.language === "de" ? "de" : "en";
  // a saved report opens at its own property (prop), else the navbar's scope
  const requested = shell.properties.find((p) => p.id === one(q, "prop"));
  const inScope = requested ? [requested] : shell.scope === "all" || !shell.scope ? shell.properties : shell.properties.filter((p) => p.id === shell.scope);
  // the data sets the user may open at every property in scope
  const available: DataSet[] = [];
  for (const d of DATA_SETS) if ((await allowedAmong(DATA_SET_RIGHT[d], inScope)).length === inScope.length && inScope.length) available.push(d);
  const dataSet = (available as string[]).includes(one(q, "set")) ? (one(q, "set") as DataSet) : (available[0] ?? "reservations");
  const today = inScope[0]?.businessDate ?? new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(one(q, "from")) ? one(q, "from") : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(one(q, "to")) ? one(q, "to") : today;
  const columns = all(q, "col");
  if (!columns.length) return { dataSet, def: null, problem: null, properties: inScope, from, to, language, available };
  const filters = [1, 2, 3]
    .map((i) => ({ column: one(q, `fc${i}`), op: (FILTER_OPS as readonly string[]).includes(one(q, `fo${i}`)) ? (one(q, `fo${i}`) as FilterOp) : "eq", value: one(q, `fv${i}`) }))
    .filter((f) => f.column && f.value);
  const groupBy = [one(q, "g1"), one(q, "g2")].filter(Boolean);
  const checked = checkDefinition(actor, { dataSet, columns, filters, groupBy, totals: one(q, "totals") === "on" }, inScope.map((p) => p.id));
  return "ok" in checked ? { dataSet, def: checked.ok, problem: null, properties: inScope, from, to, language, available } : { dataSet, def: null, problem: checked.problem, properties: inScope, from, to, language, available };
}

/** The columns offered for the data set at these properties. */
export async function offeredColumns(dataSet: DataSet, properties: Property[]) {
  const { actor } = (await loadShell()).principal;
  return allowedColumns(actor, dataSet, properties.map((p) => p.id));
}

/** The query that reopens a definition. */
export function builderQuery(def: BuilderDefinition, range: { from: string; to: string }, propertyId?: string): string {
  const q = new URLSearchParams({ set: def.dataSet, from: range.from, to: range.to, ...(propertyId ? { prop: propertyId } : {}) });
  for (const c of def.columns) q.append("col", c);
  def.filters.forEach((f, i) => {
    q.set(`fc${i + 1}`, f.column);
    q.set(`fo${i + 1}`, f.op);
    q.set(`fv${i + 1}`, f.value);
  });
  def.groupBy.forEach((g, i) => q.set(`g${i + 1}`, g));
  if (def.totals) q.set("totals", "on");
  return q.toString();
}
