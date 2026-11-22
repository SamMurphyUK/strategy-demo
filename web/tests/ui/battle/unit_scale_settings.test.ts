import { describe, expect, it } from "vitest";
import { UNIT_DEFINITIONS } from "../../../src/ui/battle/combatTypes";
import {
  setUnitClassScale,
  UNIT_SCALE_DEFAULT,
  UNIT_SIZE_GROUPS,
  unitClassFactor,
  unitScales,
  unitScalesFromJson,
} from "../../../src/ui/battle/unitScaleSettings";
import { victoryClearsVectors, victoryVectorOpacity } from "../../../src/ui/battle/victoryPresent";

describe("unit class size", () => {
  it("lists every class once, shared by every faction", () => {
    const listed = UNIT_SIZE_GROUPS.flatMap((group) => group.types.map((row) => row.type));
    expect(listed.length).toBe(Object.keys(UNIT_DEFINITIONS).length);
    expect(new Set(listed)).toEqual(new Set(Object.keys(UNIT_DEFINITIONS)));
  });

  it("starts at full size and keeps a saved percentage", () => {
    expect(unitScalesFromJson(null).tank).toBe(UNIT_SCALE_DEFAULT);
    expect(unitScalesFromJson(JSON.stringify({ infantry: 80, tank: 140, fighter: "big" }))).toMatchObject({
      infantry: 80,
      tank: 140,
      fighter: 100,
    });
    expect(unitScalesFromJson(JSON.stringify({ artillery: 10, battleship: 900 })).artillery).toBe(25);
    expect(unitScalesFromJson(JSON.stringify({ battleship: 900 })).battleship).toBe(300);
    expect(unitScalesFromJson("not json").infantry).toBe(100);
  });

  it("applies one factor for that class", () => {
    setUnitClassScale("tank", 150);
    setUnitClassScale("fighter", 50);
    try {
      expect(unitClassFactor("tank")).toBe(1.5);
      expect(unitClassFactor("fighter")).toBe(0.5);
      expect(unitClassFactor("infantry")).toBe(1);
      expect(unitScales().tank).toBe(150);
    } finally {
      setUnitClassScale("tank", 100);
      setUnitClassScale("fighter", 100);
    }
  });
});

describe("victory pictures", () => {
  it("fades the shelf pictures with the black and drops them on the flag", () => {
    expect(victoryVectorOpacity(false, "FADE_TO_BLACK", 1)).toBe("");
    expect(victoryVectorOpacity(true, "CHEERING", 0)).toBe("");
    expect(victoryVectorOpacity(true, "FADE_TO_BLACK", 0.25)).toBe("0.75");
    expect(victoryVectorOpacity(true, "FLAG_SCREEN", 0)).toBe("0");
    expect(victoryClearsVectors(true, "FLAG_SCREEN")).toBe(true);
    expect(victoryClearsVectors(true, "FADE_TO_BLACK")).toBe(false);
  });
});
