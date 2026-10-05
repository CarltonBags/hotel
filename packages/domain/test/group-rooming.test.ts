import { describe, expect, it } from "vitest";
import { checkRoomingList, depositStatus, parseRoomingList, roomsTogether, tourLeaderRegisters } from "../src";

describe("rooming lists", () => {
  it("reads the template as Excel saves it: semicolons, quotes, German headers", () => {
    const rows = parseRoomingList('Zimmerkategorie;Vorname;Nachname;Erwachsene;E-Mail\nDBL;Anna;"Müller; geb. Lang";2;anna@example.com\n\nSGL;Ben;Ott;;\n');
    expect(rows).toEqual([
      { line: 2, roomType: "DBL", firstName: "Anna", lastName: "Müller; geb. Lang", adults: 2, email: "anna@example.com" },
      { line: 4, roomType: "SGL", firstName: "Ben", lastName: "Ott", adults: 1, email: "" },
    ]);
    expect(parseRoomingList("Room type,First name,Last name\nDBL,Eve,Kim")[0]).toMatchObject({ roomType: "DBL", lastName: "Kim", adults: 1 });
  });

  it("refuses a file without the template's columns", () => {
    expect(() => parseRoomingList("Name;Zimmer\nAnna;DBL")).toThrow(/template/);
  });

  it("flags a room type not held and a name over the held count", () => {
    const rows = parseRoomingList("Room type;First name;Last name\nDBL;A;One\nDBL;B;Two\nDBL;C;Three\nSUI;D;Four\nSGL;;\n");
    const checked = checkRoomingList(rows, { DBL: 2, SGL: 1 });
    expect(checked.map((r) => r.problem)).toEqual([null, null, "over_held", "type_not_held", "name_missing"]);
  });
});

describe("rooms together", () => {
  const room = (id: string, floor: string, type = "D", sectionId: string | null = null) => ({ id, floor, sectionId, roomTypeId: type });

  it("puts the whole group on one floor when one floor has room for it", () => {
    const free = [room("101", "1"), room("102", "1"), room("201", "2"), room("202", "2"), room("203", "2")];
    expect(roomsTogether(free, ["D", "D", "D"], "floor")).toEqual(["201", "202", "203"]);
  });

  it("fills the floor with most room first, then the next", () => {
    const free = [room("101", "1"), room("201", "2"), room("202", "2"), room("301", "3")];
    const got = roomsTogether(free, ["D", "D", "D"], "floor");
    expect(got.slice(0, 2)).toEqual(["201", "202"]);
    expect(["101", "301"]).toContain(got[2]);
  });

  it("keeps room types apart and leaves a reservation without room when none is free", () => {
    const free = [room("101", "1", "D"), room("102", "1", "S"), room("201", "2", "D")];
    expect(roomsTogether(free, ["S", "D", "S"], "floor")).toEqual(["102", "101", null]);
  });

  it("groups by Section when asked", () => {
    const free = [room("101", "1", "D", "east"), room("201", "2", "D", "east"), room("102", "1", "D", "west")];
    expect(roomsTogether(free, ["D", "D"], "section")).toEqual(["101", "201"]);
  });
});

describe("deposit schedule", () => {
  it("pays the installments in date order; an unpaid one past its date is overdue", () => {
    const s = depositStatus(
      [
        { id: "b", dueDate: "2026-11-01", amount: 500 },
        { id: "a", dueDate: "2026-10-01", amount: 300 },
      ],
      400,
      "2026-11-02",
    );
    expect(s).toEqual([
      { id: "a", dueDate: "2026-10-01", amount: 300, paid: 300, open: 0, overdue: false },
      { id: "b", dueDate: "2026-11-01", amount: 500, paid: 100, open: 400, overdue: true },
    ]);
  });
});

describe("tour leader registration", () => {
  it("in Germany the tour leader registers for a group above ten persons", () => {
    expect(tourLeaderRegisters("DE", 11)).toBe(true);
    expect(tourLeaderRegisters("DE", 10)).toBe(false);
    expect(tourLeaderRegisters("AT", 40)).toBe(false);
  });
});
