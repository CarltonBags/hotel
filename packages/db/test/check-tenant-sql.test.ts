import { describe, expect, it } from "vitest";
import { findSchemaQualifiedNames } from "../src/tenant/check-tenant-sql";

/**
 * Seam: the CI check that fails on any schema-qualified name in tenant SQL.
 * Tenant tables must be unqualified so the same SQL runs in every tenant
 * schema through the search path (see the schema-per-tenant research).
 */
describe("findSchemaQualifiedNames", () => {
  it("finds a quoted public reference emitted by drizzle-kit in a foreign key", () => {
    const sql = `ALTER TABLE "booking" ADD CONSTRAINT "booking_guest_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guest"("id");`;
    expect(findSchemaQualifiedNames(sql)).toEqual([{ line: 1, match: '"public"."guest"' }]);
  });

  it("finds unquoted schema-qualified names", () => {
    const sql = "create table x (id int);\ninsert into public.x values (1);\nselect * from control.tenants;";
    expect(findSchemaQualifiedNames(sql)).toEqual([
      { line: 2, match: "public.x" },
      { line: 3, match: "control.tenants" },
    ]);
  });

  it("ignores pg_catalog and information_schema, decimals, and dotted words inside strings and comments", () => {
    const sql = [
      "select set_config('search_path', 'x', true);",
      "-- public.note in a comment",
      "insert into t values ('mail@example.com', 1.5, 'public.x');",
      "select * from pg_catalog.pg_tables, information_schema.columns;",
    ].join("\n");
    expect(findSchemaQualifiedNames(sql)).toEqual([]);
  });
});
