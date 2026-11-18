import { describe, expect, it } from "vitest";
import { rasterBlueprintAlbedo } from "../../src/art/blockoutCompiler";
import { MILITARY_STRIP_KEYS, SPRITE_FRAME_KEYS, type RosterFactionId } from "../../src/art/skeletonSchema";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS } from "../../src/art/starterParts";
import { MILITARY } from "../../src/ui/theme/militaryPalette";

const FACTIONS: RosterFactionId[] = ["GER", "USSR", "UK", "US", "JAP", "MINOR"];

describe("starter parts", () => {
  it("maps every roster faction onto the sixteen military keys", () => {
    expect(Object.keys(FACTION_MILITARY_MAPPINGS).sort()).toEqual([...FACTIONS].sort());
    for (const faction of FACTIONS) {
      const mapping = FACTION_MILITARY_MAPPINGS[faction];
      for (const key of Object.values(mapping)) {
        expect(MILITARY_STRIP_KEYS).toContain(key);
        expect(MILITARY[key]).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("keeps every frame the size of the canvas", () => {
    for (const blueprint of STARTER_BLUEPRINTS) {
      const { width, height } = blueprint.canvasSize;
      for (const key of SPRITE_FRAME_KEYS) {
        const frame = blueprint.frames[key];
        expect(frame).toHaveLength(height);
        for (const row of frame) {
          expect(row).toHaveLength(width);
        }
      }
    }
  });

  it("places every starter figure inside the ink margin on the 80×56 sheet", () => {
    expect(STARTER_BLUEPRINTS).toHaveLength(12);
    const ids = new Set<string>();
    for (const blueprint of STARTER_BLUEPRINTS) {
      expect(ids.has(blueprint.blueprintId)).toBe(false);
      ids.add(blueprint.blueprintId);
      const { albedoKeys, sheetBlitOffset } = rasterBlueprintAlbedo(
        blueprint,
        FACTION_MILITARY_MAPPINGS[blueprint.factionId],
      );
      expect(sheetBlitOffset).toEqual({ x: 16, y: 7 });
      const { width } = blueprint.canvasSize;
      let opaque = 0;
      for (let index = 0; index < albedoKeys.length; index++) {
        if (albedoKeys[index] == null) {
          continue;
        }
        opaque += 1;
        const sheetX = (index % width) + sheetBlitOffset.x;
        const sheetY = Math.floor(index / width) + sheetBlitOffset.y;
        expect(sheetX).toBeGreaterThanOrEqual(1);
        expect(sheetX).toBeLessThanOrEqual(78);
        expect(sheetY).toBeGreaterThanOrEqual(1);
        expect(sheetY).toBeLessThanOrEqual(54);
      }
      expect(opaque).toBeGreaterThan(20);
    }
  });

  it("gives each faction one rifleman and one tank, with a kick on the fire pose", () => {
    for (const faction of FACTIONS) {
      const figures = STARTER_BLUEPRINTS.filter((blueprint) => blueprint.factionId === faction);
      expect(figures.map((figure) => figure.unitTypeId).sort()).toEqual(["infantry", "tank"]);
    }
    const rifle = STARTER_BLUEPRINTS.find((blueprint) => blueprint.blueprintId === "ger_infantry_43");
    const panzer = STARTER_BLUEPRINTS.find((blueprint) => blueprint.blueprintId === "ger_tank_pz4");
    expect(rifle?.recoilOffsetPx).toBe(1);
    expect(panzer?.recoilOffsetPx).toBe(2);
    expect(rifle?.frames.move_1).not.toEqual(rifle?.frames.idle);
    expect(rifle?.frames.move_2).not.toEqual(rifle?.frames.move_1);
    expect(rifle?.frames.fire).not.toEqual(rifle?.frames.idle);
    expect(panzer?.frames.move_1).not.toEqual(panzer?.frames.idle);
    expect(panzer?.frames.move_2).not.toEqual(panzer?.frames.idle);
    expect(panzer?.frames.fire).not.toEqual(panzer?.frames.idle);
  });
});
