import { describe, expect, it } from "vitest";
import { FLOOR_LANGUAGES, HOUSEKEEPING_NOTE_CODES, LOST_PICKS, PROBLEM_PICKS } from "@hoteloftware/domain";
import { fillFloor, floorMessages, type FloorKey } from "./floor";

describe("phone view languages", () => {
  it("all ten languages load with every word", () => {
    for (const lang of FLOOR_LANGUAGES) {
      const m = floorMessages(lang);
      for (const [key, text] of Object.entries(m)) expect(text.trim(), `${lang} ${key}`).not.toBe("");
      // the fixed lists are all covered
      for (const code of HOUSEKEEPING_NOTE_CODES) expect(m[`hknote.${code}` as FloorKey]).toBeTruthy();
      for (const p of PROBLEM_PICKS) expect(m[`pick.${p}` as FloorKey]).toBeTruthy();
      for (const p of LOST_PICKS) expect(m[`lost.${p}` as FloorKey]).toBeTruthy();
    }
  });

  it("keeps the placeholders in every language", () => {
    const en = floorMessages("en");
    for (const lang of FLOOR_LANGUAGES) {
      const m = floorMessages(lang);
      for (const key of Object.keys(en) as FloorKey[]) {
        const want = (en[key].match(/\{\w+\}/g) ?? []).sort();
        expect((m[key].match(/\{\w+\}/g) ?? []).sort(), `${lang} ${key}`).toEqual(want);
      }
    }
    expect(fillFloor(floorMessages("ar").people, { n: 2 })).toBe("2 أشخاص");
  });
});
