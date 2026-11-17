import { describe, expect, it } from "vitest";
import { rasterBlueprintAlbedo } from "../../src/art/blockoutCompiler";
import { MILITARY_STRIP_KEYS, type RosterFactionId } from "../../src/art/skeletonSchema";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS, STARTER_PARTS } from "../../src/art/starterParts";
import { MILITARY } from "../../src/ui/theme/militaryPalette";

const FACTIONS: RosterFactionId[] = ["GER", "USSR", "UK", "US", "JAP", "MINOR"];

function partsMap() {
  return new Map(Object.values(STARTER_PARTS).map((part) => [part.partId, part]));
}

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

  it("keeps every authored grid the size the part declares", () => {
    for (const part of Object.values(STARTER_PARTS)) {
      expect(part.pixelGrid).toHaveLength(part.height);
      for (const row of part.pixelGrid) {
        expect(row).toHaveLength(part.width);
      }
    }
  });

  it("places every starter figure inside the ink margin on the 80×56 sheet", () => {
    const parts = partsMap();
    expect(STARTER_BLUEPRINTS).toHaveLength(12);
    const ids = new Set<string>();
    for (const blueprint of STARTER_BLUEPRINTS) {
      expect(ids.has(blueprint.blueprintId)).toBe(false);
      ids.add(blueprint.blueprintId);
      const { albedoKeys, sheetBlitOffset } = rasterBlueprintAlbedo(
        blueprint,
        parts,
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

  it("gives each faction one rifleman and one tank, with a barrel joint behind the turret paint", () => {
    for (const faction of FACTIONS) {
      const figures = STARTER_BLUEPRINTS.filter((blueprint) => blueprint.factionId === faction);
      expect(figures.map((figure) => figure.unitTypeId).sort()).toEqual(["infantry", "tank"]);
    }
    const panzer = STARTER_BLUEPRINTS.find((blueprint) => blueprint.blueprintId === "ger_tank_pz4");
    const barrel = panzer?.nodes.find((node) => node.nodeId === "barrel");
    const turret = panzer?.nodes.find((node) => node.nodeId === "turret");
    expect(barrel?.parentId).toBe("turret");
    expect(barrel?.zIndex).toBeLessThan(turret?.zIndex ?? 0);
    expect(barrel?.articulation).toEqual({
      role: "barrel",
      pivotOffset: { x: 0, y: 0 },
      minDeg: -12,
      maxDeg: 5,
      recoilPx: 3,
    });
  });
});
