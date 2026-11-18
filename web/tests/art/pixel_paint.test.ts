import { describe, expect, it } from "vitest";
import { assertBlockoutFitsSheet, rasterBlueprintAlbedo } from "../../src/art/blockoutCompiler";
import { topLayerAt } from "../../src/art/infantryMarch";
import {
  documentFromBlueprint,
  duplicateFrameToNext,
  flattenBlockout,
  flattenRgba,
  fromPaintFile,
  paintAt,
  placeGroundOrigin,
  slotHex,
  toPaintFile,
  withEditingLayer,
  withFaction,
} from "../../src/art/pixelPaint";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS } from "../../src/art/starterParts";
import { MILITARY } from "../../src/ui/theme/militaryPalette";
import { authoredUnitRelativePath } from "../../dev/bakeUnitPlugin.mjs";

const infantry = STARTER_BLUEPRINTS.find((blueprint) => blueprint.blueprintId === "ger_infantry_43");
const tank = STARTER_BLUEPRINTS.find((blueprint) => blueprint.blueprintId === "ger_tank_pz4");

function firstOpaque(grid: readonly (readonly (string | null)[])[]): { x: number; y: number } {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y] ?? [];
    for (let x = 0; x < row.length; x++) {
      if (row[x] != null) {
        return { x, y };
      }
    }
  }
  throw new Error("empty frame");
}

describe("pixel painter", () => {
  it("re-skins from the faction mapping and leaves the slot grid alone", () => {
    expect(slotHex(FACTION_MILITARY_MAPPINGS.GER, "primary_uniform_or_hull")).toBe(MILITARY.feldgrau);
    expect(slotHex(FACTION_MILITARY_MAPPINGS.US, "primary_uniform_or_hull")).toBe(MILITARY.olive);
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const german = documentFromBlueprint(infantry);
    const american = withFaction(german, "US");
    expect(american.blueprint.factionId).toBe("US");
    expect(american.blueprint.frames.idle).toEqual(german.blueprint.frames.idle);
    expect(infantry.frames.idle).toEqual(german.blueprint.frames.idle);
  });

  it("paints one cell of the open frame and keeps the fire kick", () => {
    if (!infantry || !tank) {
      throw new Error("missing starter blueprint");
    }
    const figure = documentFromBlueprint(infantry);
    expect(figure.layers).not.toBeNull();
    const cell = firstOpaque(figure.blueprint.frames.idle);
    const owner = figure.layers && topLayerAt(figure.layers.idle, cell.x, cell.y);
    if (!owner) {
      throw new Error("the first pixel has no layer");
    }
    const before = figure.blueprint.frames.idle[cell.y]?.[cell.x];
    const painted = paintAt(withEditingLayer(figure, owner), cell.x, cell.y, "insignia_accent");
    expect(painted.blueprint.frames.idle[cell.y]?.[cell.x]).toBe("insignia_accent");
    expect(painted.blueprint.frames.move_1).toEqual(figure.blueprint.frames.move_1);
    expect(infantry.frames.idle[cell.y]?.[cell.x]).toBe(before);
    expect(painted.blueprint.recoilOffsetPx).toBe(1);

    const armour = documentFromBlueprint(tank);
    expect(armour.layers).toBeNull();
    expect(armour.blueprint.recoilOffsetPx).toBe(2);
    const copied = duplicateFrameToNext(armour);
    expect(copied.editingFrame).toBe("move_1");
    expect(copied.blueprint.frames.move_1).toEqual(armour.blueprint.frames.idle);
  });

  it("keeps the idle pixels when the sheet is already flat", () => {
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const figure = documentFromBlueprint(infantry);
    const mapping = FACTION_MILITARY_MAPPINGS.GER;
    const original = rasterBlueprintAlbedo(figure.blueprint, mapping);
    const flat = flattenBlockout(figure);
    const collapsed = rasterBlueprintAlbedo(flat.blueprint, mapping);
    expect(flat.flat).toBe(true);
    expect(collapsed.albedoKeys).toEqual(original.albedoKeys);
  });

  it("moves the foot pin without sliding the figure, and snaps a candidate colour onto a slot", () => {
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const figure = documentFromBlueprint(infantry);
    const mapping = FACTION_MILITARY_MAPPINGS.GER;
    const before = rasterBlueprintAlbedo(figure.blueprint, mapping);
    const moved = placeGroundOrigin(figure, 24, 46);
    const after = rasterBlueprintAlbedo(moved.blueprint, mapping);
    expect(after.albedoKeys).toEqual(before.albedoKeys);
    expect(moved.blueprint.groundOrigin).toEqual({ x: 24, y: 46 });
    expect(assertBlockoutFitsSheet(moved.blueprint).y).toBe(6);

    const rgba = new Uint8ClampedArray(48 * 48 * 4);
    rgba[0] = 0x7d;
    rgba[1] = 0x7b;
    rgba[2] = 0x62;
    rgba[3] = 255;
    const candidate = flattenRgba(figure, rgba, 48, 48, mapping);
    expect(candidate.blueprint.frames.idle[0]?.[0]).toBe("wood_or_leather");
    expect(candidate.blueprint.frames.idle[0]?.[1]).toBeNull();
    expect(candidate.blueprint.frames.move_1).toEqual(figure.blueprint.frames.move_1);
    expect(() => flattenRgba(figure, rgba, 2, 2, mapping)).toThrow(/does not match/);

    const file = toPaintFile(candidate);
    const imported = fromPaintFile(JSON.parse(JSON.stringify(file)));
    expect(imported.blueprint.frames.idle[0]?.[0]).toBe("wood_or_leather");
    expect(imported.layers?.idle.legs[0]?.[0]).toBe("wood_or_leather");
    const stripped = JSON.parse(JSON.stringify(file)) as { layers?: unknown; editingLayer?: unknown };
    delete stripped.layers;
    delete stripped.editingLayer;
    expect(fromPaintFile(stripped).layers).toBeNull();
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
