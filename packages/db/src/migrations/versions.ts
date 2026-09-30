export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Versions must be 1..n without gaps or duplicates so "pending" is unambiguous. */
export function assertContiguous(migrations: Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migration versions must be contiguous from 1; found version ${m.version} at position ${i + 1}`);
    }
  });
}
