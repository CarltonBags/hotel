import { describe, expect, it } from "vitest";
import { renderTourismReportPdf, tourismReportCsv, type TourismReportDocument } from "../src/index";

const doc: TourismReportDocument = {
  variant: "DE",
  month: "2026-07",
  property: { name: "Alpha Berlin", identity: "0037-123" },
  rows: [
    { key: "DE", label: { de: "Deutschland", en: "Germany" }, arrivals: 2, nights: 4 },
    { key: "NL", label: { de: "Niederlande", en: "Netherlands" }, arrivals: 3, nights: 21 },
  ],
  totals: { arrivals: 5, nights: 25 },
  capacity: { bedPlaces: 40, extraBeds: 4, rooms: 26, openingDays: 31, roomDaysOffered: 806, roomDaysOccupied: 300, takingsPerPersonNight: null },
};

describe("tourism statistics export", () => {
  it("writes the form's rows to a spreadsheet file", () => {
    const csv = tourismReportCsv(doc);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("NL;Niederlande;3;21");
    expect(csv).toContain("total;Insgesamt;5;25");
    // 25 rooms or more: room days on the German form
    expect(csv).toContain("Angebotene Zimmertage / Room days offered;806");
  });

  it("renders a PDF", async () => {
    const pdf = await renderTourismReportPdf({ ...doc, version: 1, submittedAt: "2026-08-03" }, "de");
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
