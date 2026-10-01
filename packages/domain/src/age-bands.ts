/**
 * Age Bands per property (decided in "Rates and restrictions model"): for
 * example 0 to 2 infant, 3 to 11 child, 12 and over adult. They must cover
 * every age exactly once, starting at 0 and ending open.
 */
export interface AgeBandInput {
  name: string;
  minAge: number;
  /** null = open-ended (the last band) */
  maxAge: number | null;
}

export type AgeBandProblem = "empty" | "start" | "gap" | "overlap" | "inverted" | "end";

export interface AgeBandIssue {
  index: number;
  problem: AgeBandProblem;
}

export function validateAgeBands(bands: AgeBandInput[]): AgeBandIssue[] {
  if (bands.length === 0) return [{ index: -1, problem: "empty" }];
  const issues: AgeBandIssue[] = [];
  const sorted = [...bands].map((b, index) => ({ ...b, index })).sort((a, b) => a.minAge - b.minAge);
  if (sorted[0]!.minAge !== 0) issues.push({ index: sorted[0]!.index, problem: "start" });
  let expected = 0;
  sorted.forEach((b, i) => {
    if (b.maxAge !== null && b.maxAge < b.minAge) issues.push({ index: b.index, problem: "inverted" });
    if (i > 0) {
      if (b.minAge > expected) issues.push({ index: b.index, problem: "gap" });
      else if (b.minAge < expected) issues.push({ index: b.index, problem: "overlap" });
    }
    const last = i === sorted.length - 1;
    if (last && b.maxAge !== null) issues.push({ index: b.index, problem: "end" });
    if (!last && b.maxAge === null) issues.push({ index: b.index, problem: "end" });
    expected = b.maxAge === null ? Number.POSITIVE_INFINITY : b.maxAge + 1;
  });
  return issues;
}

export function ageBandFor<T extends AgeBandInput>(bands: T[], age: number): T | undefined {
  return bands.find((b) => age >= b.minAge && (b.maxAge === null || age <= b.maxAge));
}
