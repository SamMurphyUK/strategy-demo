import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRgbaPng } from "../../dev/pngRgba.mjs";
import { assertBlockoutFitsSheet, rasterBlueprintAlbedo } from "../../src/art/blockoutCompiler";
import { topLayerAt } from "../../src/art/infantryMarch";
import {
  documentFromBlueprint,
  duplicateFrameToNext,
  flattenBlockout,
  flattenRgba,
  fromPaintFile,
  loadFrameOntoCurrent,
  nudgeLayer,
  paintAt,
  placeGroundOrigin,
  placeRigFrame,
  stampWalkStance,
  solidTorsoUnderWeapon,
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
    const fromStep = loadFrameOntoCurrent(figure, "move_1");
    expect(fromStep.editingFrame).toBe("idle");
    expect(fromStep.layers?.idle).toEqual(figure.layers?.move_1);
    expect(fromStep.layers?.move_1).toEqual(figure.layers?.move_1);
    expect(fromStep.layers?.fire).toEqual(figure.layers?.fire);

    const armour = documentFromBlueprint(tank);
    expect(armour.layers).toBeNull();
    expect(armour.blueprint.recoilOffsetPx).toBe(2);
    const copied = duplicateFrameToNext(armour);
    expect(copied.editingFrame).toBe("move_1");
    expect(copied.blueprint.frames.move_1).toEqual(armour.blueprint.frames.idle);
    const loaded = loadFrameOntoCurrent(armour, "fire");
    expect(loaded.editingFrame).toBe("idle");
    expect(loaded.blueprint.frames.idle).toEqual(armour.blueprint.frames.fire);
    expect(loaded.blueprint.frames.move_1).toEqual(armour.blueprint.frames.move_1);
    expect(loadFrameOntoCurrent(armour, "idle")).toBe(armour);
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

  it("puts walk frame 0 on the open pose and clears a pixel on every layer", () => {
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const figure = documentFromBlueprint(infantry);
    const png = decodeRgbaPng(readFileSync("public/assets/units/jap_walk.png"));
    const stamped = stampWalkStance(figure, png.data, png.width, png.height);
    expect(stamped.editingFrame).toBe("idle");
    expect(stamped.blueprint.groundOrigin).toEqual(figure.blueprint.groundOrigin);
    expect(stamped.layers?.move_1).toEqual(figure.layers?.move_1);
    const idle = stamped.layers?.idle;
    if (!idle) {
      throw new Error("missing layers");
    }
    const ink = (key: "head" | "torso" | "legs" | "hands_weapon") =>
      idle[key].reduce((count, row) => count + row.filter((cell) => cell != null).length, 0);
    expect(ink("head")).toBeGreaterThan(10);
    expect(ink("torso")).toBeGreaterThan(10);
    expect(ink("legs")).toBeGreaterThan(10);
    expect(ink("hands_weapon")).toBeGreaterThan(10);
    const foot = stamped.blueprint.groundOrigin;
    expect(stamped.blueprint.frames.idle[foot.y]?.some((cell) => cell != null)).toBe(true);
    const muzzle = stamped.blueprint.muzzlePoint;
    expect(idle.hands_weapon[muzzle.y]?.[muzzle.x]).not.toBeNull();
    expect(muzzle.x).toBeGreaterThan(foot.x);
    let px = -1;
    let py = -1;
    for (let y = 0; y < stamped.blueprint.frames.idle.length && px < 0; y += 1) {
      const row = stamped.blueprint.frames.idle[y] ?? [];
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] != null) {
          px = x;
          py = y;
          break;
        }
      }
    }
    const erased = paintAt(withEditingLayer(stamped, "head"), px, py, "eraser");
    expect(erased.layers?.idle.head[py]?.[px]).toBeNull();
    expect(erased.layers?.idle.torso[py]?.[px]).toBeNull();
    expect(erased.layers?.idle.legs[py]?.[px]).toBeNull();
    expect(erased.layers?.idle.hands_weapon[py]?.[px]).toBeNull();
    expect(paintAt(erased, px, py, "eraser")).toBe(erased);
  });

  it("draws every rig part and keeps the tunic under the rifle", () => {
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const figure = documentFromBlueprint(infantry);
    const width = 6;
    const height = 8;
    const blank = () => new Array<number>(width * height).fill(0);
    const at = (x: number, y: number) => y * width + x;
    const legs = blank();
    const torso = blank();
    const head = blank();
    const weapon = blank();
    legs[at(1, 7)] = 6;
    legs[at(4, 7)] = 6;
    torso[at(2, 3)] = 2;
    torso[at(2, 5)] = 2;
    weapon[at(2, 4)] = 12;
    weapon[at(5, 4)] = 12;
    const placed = placeRigFrame(figure, { width, height, layers: { legs, torso, head, weapon } });
    expect(placed.editingFrame).toBe("idle");
    expect(placed.layers?.move_1).toEqual(figure.layers?.move_1);
    const stack = placed.layers?.idle;
    if (!stack) {
      throw new Error("missing layers");
    }
    expect(stack.torso[42]?.[23]).toBe("primary_uniform_or_hull");
    expect(stack.hands_weapon[42]?.[23]).toBe("metallic_steel");
    expect(stack.hands_weapon[42]?.[26]).toBe("metallic_steel");
    expect(stack.torso[42]?.[26]).toBeNull();
    expect(solidTorsoUnderWeapon(placed)).toBe(placed);
  });

  it("slides one layer on the open pose and leaves the others put", () => {
    if (!infantry) {
      throw new Error("missing infantry blueprint");
    }
    const figure = documentFromBlueprint(infantry);
    const cell = firstOpaque(figure.blueprint.frames.idle);
    const owner = figure.layers && topLayerAt(figure.layers.idle, cell.x, cell.y);
    if (!owner || !figure.layers) {
      throw new Error("the first pixel has no layer");
    }
    const slot = figure.layers.idle[owner][cell.y]?.[cell.x];
    const nudged = nudgeLayer(withEditingLayer(figure, owner), 1, 0);
    expect(nudged.layers?.idle[owner][cell.y]?.[cell.x]).toBeNull();
    expect(nudged.layers?.idle[owner][cell.y]?.[cell.x + 1]).toBe(slot);
    expect(nudged.layers?.move_1).toEqual(figure.layers.move_1);
    for (const layer of ["legs", "torso", "head", "hands_weapon"] as const) {
      if (layer !== owner) {
        expect(nudged.layers?.idle[layer]).toEqual(figure.layers.idle[layer]);
      }
    }
    expect(nudgeLayer(figure, 0, 0)).toBe(figure);
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
