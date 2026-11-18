import { describe, expect, it } from "vitest";
import { STARTER_BLUEPRINTS } from "../../src/art/starterParts";

function blueprint(id: string) {
  const found = STARTER_BLUEPRINTS.find((item) => item.blueprintId === id);
  if (!found) {
    throw new Error(`missing ${id}`);
  }
  return found;
}

function countSlot(grid: readonly (readonly (string | null)[])[], slot: string, yStart: number): number {
  let count = 0;
  for (let y = yStart; y < grid.length; y++) {
    for (const cell of grid[y] ?? []) {
      if (cell === slot) {
        count += 1;
      }
    }
  }
  return count;
}

describe("four-frame poses", () => {
  it("strides the boots on move 1 and dips the body on move 2", () => {
    const rifle = blueprint("ger_infantry_43");
    const idleBoots = countSlot(rifle.frames.idle, "wood_or_leather", 38);
    const stepBoots = countSlot(rifle.frames.move_1, "wood_or_leather", 38);
    expect(idleBoots).toBeGreaterThan(0);
    expect(stepBoots).toBeGreaterThan(0);
    expect(rifle.frames.move_1).not.toEqual(rifle.frames.idle);
    const dipped = rifle.frames.move_2.some((row, y) => row.some((cell, x) => cell != null && rifle.frames.idle[y - 1]?.[x] === cell));
    expect(dipped).toBe(true);
  });

  it("shifts the tread on move 1 and pulls the barrel on fire", () => {
    const tank = blueprint("ger_tank_pz4");
    expect(tank.frames.move_1).not.toEqual(tank.frames.idle);
    expect(tank.frames.fire).not.toEqual(tank.frames.idle);
    expect(tank.recoilOffsetPx).toBe(2);
    expect(blueprint("ussr_infantry_43").recoilOffsetPx).toBe(1);
  });
});
