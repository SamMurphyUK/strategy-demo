import { describe, expect, it } from "vitest";
import { normalizeUnitTypeAndFaction, resolveUnitArtPath } from "../../../src/ui/map/unit_art";

const files = new Set([
  "res://texture/units/us/infantry.png",
  "res://texture/units/us/fighter.png",
  "res://texture/units/ger/battleship.png",
  "res://texture/units/neutral/infantry.png",
]);
const exists = (p: string) => files.has(p);

describe("unit art", () => {
  it("maps factions to folders", () => {
    expect(resolveUnitArtPath("infantry", "allies", exists)).toBe("res://texture/units/us/infantry.png");
    expect(resolveUnitArtPath("battleship", "axis", exists)).toBe("res://texture/units/ger/battleship.png");
  });

  it("falls back through aliases", () => {
    expect(resolveUnitArtPath("strategic_bomber", "allies", exists)).toBe("res://texture/units/us/fighter.png");
    expect(resolveUnitArtPath("submarine", "axis", exists)).toBe("res://texture/units/ger/battleship.png");
    expect(resolveUnitArtPath("mech_infantry", "us", exists)).toBe("res://texture/units/us/infantry.png");
  });

  it("uses neutral art, then nothing", () => {
    expect(resolveUnitArtPath("infantry", "axis", exists)).toBe("res://texture/units/neutral/infantry.png");
    expect(resolveUnitArtPath("tank", "axis", exists)).toBe("");
    expect(resolveUnitArtPath("", "axis", exists)).toBe("");
  });

  it("strips faction suffixes from unit ids", () => {
    expect(normalizeUnitTypeAndFaction("InfantryAxis", "")).toEqual({ unitTypeId: "infantry", factionId: "axis" });
    expect(normalizeUnitTypeAndFaction("tank", "German")).toEqual({ unitTypeId: "tank", factionId: "axis" });
  });
});
