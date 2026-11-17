import { describe, expect, it } from "vitest";
import { assertBlockoutFitsSheet, rasterBlueprintAlbedo, resolveNodeTransforms } from "../../src/art/blockoutCompiler";
import {
  documentFromBlueprint,
  flattenBlockout,
  flattenRgba,
  fromPaintFile,
  paintAt,
  partCellAt,
  placeGroundOrigin,
  slotHex,
  toPaintFile,
  withFaction,
} from "../../src/art/pixelPaint";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS, STARTER_PARTS } from "../../src/art/starterParts";
import { MILITARY } from "../../src/ui/theme/militaryPalette";
import { authoredUnitRelativePath } from "../../dev/bakeUnitPlugin.mjs";

const infantry = STARTER_BLUEPRINTS.find((blueprint) => blueprint.blueprintId === "ger_infantry_43");
const tank = STARTER_BLUEPRINTS.find((blueprint) => blueprint.blueprintId === "ger_tank_pz4");

describe("pixel painter", () => {
  it("re-skins from the faction mapping and leaves the slot grid alone", () => {
    expect(slotHex(FACTION_MILITARY_MAPPINGS.GER, "primary_uniform_or_hull")).toBe(MILITARY.feldgrau);
    expect(slotHex(FACTION_MILITARY_MAPPINGS.US, "primary_uniform_or_hull")).toBe(MILITARY.olive);
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const german = documentFromBlueprint(infantry, STARTER_PARTS);
    const american = withFaction(german, "US");
    expect(american.blueprint.factionId).toBe("US");
    expect(american.parts.inf_legs_stride.pixelGrid).toEqual(german.parts.inf_legs_stride.pixelGrid);
    expect(STARTER_PARTS.inf_legs_stride.pixelGrid[10][0]).toBe("wood_or_leather");
  });

  it("paints one part cell and keeps the tank barrel joint", () => {
    if (!infantry || !tank) {
      throw new Error("missing starter blueprint");
    }
    const figure = documentFromBlueprint(infantry, STARTER_PARTS);
    expect(partCellAt(figure, "legs", 19, 45)).toEqual({ x: 0, y: 10 });
    const painted = paintAt({ ...figure, editingNodeId: "legs" }, 19, 45, "insignia_accent");
    expect(painted.parts.inf_legs_stride.pixelGrid[10][0]).toBe("insignia_accent");
    expect(painted.parts.inf_torso_tunic.pixelGrid).toEqual(figure.parts.inf_torso_tunic.pixelGrid);
    expect(STARTER_PARTS.inf_legs_stride.pixelGrid[10][0]).toBe("wood_or_leather");

    const armour = documentFromBlueprint(tank, STARTER_PARTS);
    const touched = paintAt({ ...armour, editingNodeId: "hull" }, 24, 36, "insignia_accent");
    expect(touched.blueprint.nodes.find((node) => node.nodeId === "barrel")?.articulation).toEqual({
      role: "barrel",
      pivotOffset: { x: 0, y: 0 },
      minDeg: -12,
      maxDeg: 5,
      recoilPx: 3,
    });
    expect(touched.blueprint.nodes.find((node) => node.nodeId === "turret")?.articulation?.role).toBe("turret");
  });

  it("flattens the blockout onto the same pixels and drops articulation", () => {
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const figure = documentFromBlueprint(infantry, STARTER_PARTS);
    const mapping = FACTION_MILITARY_MAPPINGS.GER;
    const original = rasterBlueprintAlbedo(figure.blueprint, new Map(Object.entries(figure.parts)), mapping);
    const flat = flattenBlockout(figure);
    const collapsed = rasterBlueprintAlbedo(flat.blueprint, new Map(Object.entries(flat.parts)), mapping);
    expect(flat.flat).toBe(true);
    expect(flat.blueprint.nodes).toHaveLength(1);
    expect(collapsed.albedoKeys).toEqual(original.albedoKeys);
  });

  it("moves the foot pin without sliding the figure, and snaps a candidate colour onto a slot", () => {
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const figure = documentFromBlueprint(infantry, STARTER_PARTS);
    const mapping = FACTION_MILITARY_MAPPINGS.GER;
    const before = rasterBlueprintAlbedo(figure.blueprint, new Map(Object.entries(figure.parts)), mapping);
    const moved = placeGroundOrigin(figure, 24, 46);
    const after = rasterBlueprintAlbedo(moved.blueprint, new Map(Object.entries(moved.parts)), mapping);
    expect(after.albedoKeys).toEqual(before.albedoKeys);
    expect(moved.blueprint.groundOrigin).toEqual({ x: 24, y: 46 });
    expect(assertBlockoutFitsSheet(moved.blueprint).y).toBe(6);
    expect(resolveNodeTransforms(moved.blueprint).get("legs")?.worldPivot).toEqual(
      resolveNodeTransforms(figure.blueprint).get("legs")?.worldPivot,
    );

    const rgba = new Uint8ClampedArray(48 * 48 * 4);
    rgba[0] = 0x7d;
    rgba[1] = 0x7b;
    rgba[2] = 0x62;
    rgba[3] = 255;
    const candidate = flattenRgba(figure, rgba, 48, 48, mapping);
    expect(candidate.parts.ger_infantry_43_flat.pixelGrid[0][0]).toBe("wood_or_leather");
    expect(candidate.parts.ger_infantry_43_flat.pixelGrid[0][1]).toBeNull();
    expect(() => flattenRgba(figure, rgba, 2, 2, mapping)).toThrow(/does not match/);

    const file = toPaintFile(candidate);
    const imported = fromPaintFile(JSON.parse(JSON.stringify(file)));
    expect(imported.parts.ger_infantry_43_flat.pixelGrid[0][0]).toBe("wood_or_leather");
    expect(() => fromPaintFile({ kind: "other" })).toThrow(/unit paint/);
  });
});

describe("authored unit path", () => {
  it("keeps a saved unit inside assets/units/authored", () => {
    expect(authoredUnitRelativePath("GER", "custom_unit").replaceAll("\\", "/")).toBe(
      "assets/units/authored/GER/custom_unit.json",
    );
    expect(() => authoredUnitRelativePath("GER", "../outside")).toThrow(/blueprintId/);
    expect(() => authoredUnitRelativePath("NEUTRAL", "custom_unit")).toThrow(/roster/);
  });
});
