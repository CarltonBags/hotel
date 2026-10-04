import { describe, expect, it } from "vitest";
import type { ReportTable } from "@hoteloftware/domain";
import { renderReportPdf, reportCsv } from "../src/report-table";

const table: ReportTable = {
  title: "Occupancy and revenue",
  notes: ["Period: 2026-11-01 – 2026-11-30"],
  columns: [
    { key: "label", label: "Period", kind: "text" },
    { key: "occupancy", label: "Occupancy", kind: "percent" },
    { key: "adr", label: "Average Daily Rate", kind: "money" },
  ],
  rows: [
    { cells: { label: "2026-11", occupancy: 4.2, adr: 100 } },
    { cells: { label: "=cmd", occupancy: null, adr: 1234.5 }, emphasis: true },
    { cells: { label: "Difference", occupancy: -2.5, adr: -12.5 } },
  ],
};

describe("report table files", () => {
  it("the spreadsheet keeps plain numbers, empty cells for no value, and neutralises formulas", () => {
    const csv = reportCsv(table);
    expect(csv.startsWith("﻿Occupancy and revenue\r\n")).toBe(true);
    expect(csv).toContain("Period;Occupancy;Average Daily Rate\r\n2026-11;4.2;100\r\n'=cmd;;1234.5\r\nDifference;-2.5;-12.5\r\n");
  });

  it("renders a PDF", async () => {
    const bytes = await renderReportPdf(table, "de", "Hoteloftware · Alpha · 2026-12-01");
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
