import { describe, expect, it } from "vitest";
import { compileBlueprintFrame } from "../../src/art/blockoutCompiler";
import { buildMarch, topLayerAt } from "../../src/art/infantryMarch";
import {
  blankDocument,
  buildMarchDocument,
  documentFromBlueprint,
  duplicateLayerToNext,
  paintAt,
  withEditingFrame,
  withEditingLayer,
} from "../../src/art/pixelPaint";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS, STARTER_INFANTRY_LAYERS } from "../../src/art/starterParts";
import { SPRITE_FRAME_KEYS, type SpriteFrameGrid } from "../../src/art/skeletonSchema";

const rifle = STARTER_BLUEPRINTS.find((blueprint) => blueprint.blueprintId === "ger_infantry_43");
const layers = STARTER_INFANTRY_LAYERS.ger_infantry_43;

function cell(grid: SpriteFrameGrid, x: number, y: number): string | null {
  return grid[y]?.[x] ?? null;
}

function topLeft(grid: SpriteFrameGrid, slot: string): { x: number; y: number } {
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y] ?? [];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === slot) {
        return { x, y };
      }
    }
  }
  throw new Error(`missing ${slot}`);
}

function rightmost(grid: SpriteFrameGrid, slot: string): { x: number; y: number } {
  let best: { x: number; y: number } | null = null;
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y] ?? [];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== slot) {
        continue;
      }
      if (!best || x > best.x || (x === best.x && y < best.y)) {
        best = { x, y };
      }
    }
  }
  if (!best) {
    throw new Error(`missing ${slot}`);
  }
  return best;
}

function leatherBoots(grid: SpriteFrameGrid): { x: number; y: number }[][] {
  const seen = new Set<string>();
  const boots: { x: number; y: number }[][] = [];
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y] ?? [];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== "wood_or_leather" || seen.has(`${x},${y}`)) {
        continue;
      }
      const cells: { x: number; y: number }[] = [];
      const stack = [{ x, y }];
      seen.add(`${x},${y}`);
      while (stack.length > 0) {
        const point = stack.pop();
        if (!point) {
          break;
        }
        cells.push(point);
        for (const next of [
          { x: point.x + 1, y: point.y },
          { x: point.x - 1, y: point.y },
          { x: point.x, y: point.y + 1 },
          { x: point.x, y: point.y - 1 },
        ]) {
          const key = `${next.x},${next.y}`;
          if (seen.has(key) || grid[next.y]?.[next.x] !== "wood_or_leather") {
            continue;
          }
          seen.add(key);
          stack.push(next);
        }
      }
      boots.push(cells);
    }
  }
  return boots;
}

function pointsRight(boot: readonly { x: number; y: number }[]): boolean {
  const minY = Math.min(...boot.map((point) => point.y));
  const maxY = Math.max(...boot.map((point) => point.y));
  const ankle = boot.filter((point) => point.y === minY);
  const sole = boot.filter((point) => point.y === maxY);
  const ankleMin = Math.min(...ankle.map((point) => point.x));
  const ankleMax = Math.max(...ankle.map((point) => point.x));
  const soleMin = Math.min(...sole.map((point) => point.x));
  const soleMax = Math.max(...sole.map((point) => point.x));
  return soleMax - ankleMax >= ankleMin - soleMin;
}

function centerX(boot: readonly { x: number; y: number }[]): number {
  return boot.reduce((sum, point) => sum + point.x, 0) / boot.length;
}

function pair(grid: SpriteFrameGrid): [{ x: number; y: number }[], { x: number; y: number }[]] {
  const boots = leatherBoots(grid).sort((a, b) => centerX(a) - centerX(b));
  expect(boots).toHaveLength(2);
  const left = boots[0];
  const right = boots[1];
  if (!left || !right) {
    throw new Error("missing boot");
  }
  expect(pointsRight(left)).toBe(true);
  expect(pointsRight(right)).toBe(true);
  return [left, right];
}

describe("soldier march", () => {
  it("keeps both boots pointing right and changes the stride", () => {
    if (!layers || !rifle) {
      throw new Error("missing german rifleman");
    }
    for (const frame of ["idle", "move_1", "move_2", "fire"] as const) {
      pair(layers[frame].legs);
    }
    const [idleLeft, idleRight] = pair(layers.idle.legs);
    const [reachLeft, reachRight] = pair(layers.move_1.legs);
    const [passLeft, passRight] = pair(layers.move_2.legs);
    const [fireLeft, fireRight] = pair(layers.fire.legs);

    expect(Math.max(...reachLeft.map((point) => point.y))).toBeLessThan(Math.max(...reachRight.map((point) => point.y)));
    expect(Math.max(...reachRight.map((point) => point.x)) - Math.min(...reachRight.map((point) => point.x))).toBeGreaterThan(
      Math.max(...reachLeft.map((point) => point.x)) - Math.min(...reachLeft.map((point) => point.x)),
    );
    expect(Math.abs(centerX(passRight) - centerX(passLeft))).toBeLessThan(Math.abs(centerX(idleRight) - centerX(idleLeft)));
    expect(Math.max(...passLeft.map((point) => point.y))).not.toBe(Math.max(...passRight.map((point) => point.y)));
    expect(centerX(fireLeft)).toBeLessThan(centerX(idleLeft));
    expect(centerX(fireRight)).toBeGreaterThan(centerX(idleRight));

    const mapping = FACTION_MILITARY_MAPPINGS.GER;
    for (const frame of SPRITE_FRAME_KEYS) {
      expect(() => compileBlueprintFrame(rifle, frame, mapping)).not.toThrow();
    }
  });

  it("shifts the tunic forward of the head, and pulls the rifle on the shot", () => {
    if (!layers) {
      throw new Error("missing german rifleman");
    }
    const webbing = topLeft(layers.idle.torso, "secondary_trim_or_webbing");
    const face = topLeft(layers.idle.head, "skin_stand_in");
    const muzzle = rightmost(layers.idle.hands_weapon, "metallic_steel");
    expect(cell(layers.move_1.torso, webbing.x + 1, webbing.y - 1)).toBe("secondary_trim_or_webbing");
    expect(cell(layers.move_1.head, face.x, face.y - 1)).toBe("skin_stand_in");
    expect(cell(layers.move_2.torso, webbing.x, webbing.y + 1)).toBe("secondary_trim_or_webbing");
    expect(cell(layers.move_2.head, face.x, face.y + 1)).toBe("skin_stand_in");
    expect(cell(layers.move_1.hands_weapon, muzzle.x - 1, muzzle.y - 1)).toBe("metallic_steel");
    expect(cell(layers.move_2.hands_weapon, muzzle.x + 1, muzzle.y + 1)).toBe("metallic_steel");
    expect(cell(layers.fire.hands_weapon, muzzle.x - 2, muzzle.y)).toBe("metallic_steel");
    expect(cell(layers.fire.head, face.x, face.y)).toBe("skin_stand_in");
    expect(cell(layers.fire.torso, webbing.x - 1, webbing.y)).toBe("secondary_trim_or_webbing");
  });

  it("keeps a leg drawing you already painted and rebuilds the body from idle", () => {
    const fresh = blankDocument("GER");
    const marked = paintAt(paintAt(fresh, 20, 40, "wood_or_leather"), 30, 40, "wood_or_leather");
    const withBody = paintAt(
      paintAt(withEditingLayer(marked, "torso"), 24, 30, "secondary_trim_or_webbing"),
      24,
      20,
      "skin_stand_in",
    );
    const headed = withEditingLayer(withBody, "head");
    const posed = paintAt(headed, 24, 20, "skin_stand_in");
    const armed = paintAt(withEditingLayer(posed, "hands_weapon"), 36, 24, "metallic_steel");
    const marched = buildMarchDocument(armed);
    expect(marched.layers?.move_1.legs).toEqual(marched.layers?.idle.legs);
    expect(marched.layers?.move_1.torso[29]?.[25]).toBe("secondary_trim_or_webbing");
    expect(marched.layers?.move_1.head[19]?.[24]).toBe("skin_stand_in");
    expect(marched.layers?.move_1.hands_weapon[23]?.[35]).toBe("metallic_steel");
    expect(marched.layers?.fire.legs[40]?.[19]).toBe("wood_or_leather");
    expect(marched.layers?.fire.legs[40]?.[31]).toBe("wood_or_leather");
    expect(marched.layers?.fire.hands_weapon[24]?.[34]).toBe("metallic_steel");
    expect(marched.layers?.fire.head[20]?.[24]).toBe("skin_stand_in");

    const customLegs = paintAt(withEditingFrame(withEditingLayer(marched, "legs"), "move_1"), 12, 44, "insignia_accent");
    const again = buildMarchDocument(customLegs);
    expect(again.layers?.move_1.legs[44]?.[12]).toBe("insignia_accent");
    expect(again.layers?.idle.legs[44]?.[12]).toBeNull();
    expect(topLayerAt(again.layers?.move_1 ?? customLegs.layers!.move_1, 12, 44)).toBe("legs");
  });

  it("copies one layer onto the next pose", () => {
    const doc = documentFromBlueprint(rifle ?? STARTER_BLUEPRINTS[0]);
    const painted = paintAt(withEditingLayer(doc, "legs"), 8, 44, "insignia_accent");
    const copied = duplicateLayerToNext(painted);
    expect(copied.editingFrame).toBe("move_1");
    expect(copied.layers?.move_1.legs[44]?.[8]).toBe("insignia_accent");
    expect(copied.layers?.move_1.torso).toEqual(doc.layers?.move_1.torso);
    expect(copied.layers?.idle.legs[44]?.[8]).toBe("insignia_accent");
    expect(buildMarch(copied.layers ?? doc.layers!, doc.blueprint.groundOrigin.x).move_1.legs[44]?.[8]).toBe("insignia_accent");
  });
});
