import { describe, expect, it } from "vitest";
import { GEN_KEY, GEN_MIN_SIDE } from "../../src/art/partGen";
import { rectMask, starterDocument } from "../../src/art/pixelPaint";
import { MILITARY } from "../../src/ui/theme/militaryPalette";
import {
  VEHICLE_GEN_ROOMS,
  harvestVehiclePart,
  isVehicleKeyColour,
  planVehiclePart,
  vehicleShownLayers,
} from "../../src/art/vehiclePartGen";
import { TANK_PARTS, partCorners, tankPlate } from "./plateFixture";

function filled(grid: readonly (readonly unknown[])[]): number {
  return grid.flat().filter((cell) => cell != null).length;
}

/** The picture a plan asks for, scaled up by a whole number: every picture pixel becomes a block of them. */
function scaledUp(rgba: Uint8ClampedArray, width: number, height: number, scale: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * scale * height * scale * 4);
  for (let y = 0; y < height * scale; y += 1) {
    for (let x = 0; x < width * scale; x += 1) {
      const from = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
      out.set(rgba.subarray(from, from + 4), (y * width * scale + x) * 4);
    }
  }
  return out;
}

describe("which layers show in the picture", () => {
  it("shows the layer being replaced and everything under it", () => {
    expect(vehicleShownLayers("tank", "tracks")).toEqual(["tracks"]);
    expect(vehicleShownLayers("tank", "hull")).toEqual(["tracks", "hull"]);
    expect(vehicleShownLayers("tank", "turret")).toEqual(["tracks", "hull", "turret"]);
    expect(vehicleShownLayers("tank", "wheels")).toEqual([]);
  });

  it("offers rooms of 0 to 12 pixels, starting with none", () => {
    expect(VEHICLE_GEN_ROOMS[0]).toBe(0);
    expect(VEHICLE_GEN_ROOMS[VEHICLE_GEN_ROOMS.length - 1]).toBe(12);
  });

  it("treats only the key colour as background, and every military colour as ink", () => {
    expect(isVehicleKeyColour(GEN_KEY[0], GEN_KEY[1], GEN_KEY[2])).toBe(true);
    for (const hex of Object.values(MILITARY)) {
      const rgb = Number.parseInt(hex.slice(1, 7), 16);
      expect(isVehicleKeyColour((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)).toBe(false);
    }
  });
});

describe("planning a part", () => {
  it("opens the worn part of the layer, and sends the layers under it in the picture", () => {
    const doc = tankPlate();
    const plan = planVehiclePart(doc, { layer: "hull", room: 0 });
    expect(plan.fromSelection).toBe(false);
    expect(plan.open).toBe(filled(doc.layers!.idle.hull));
    expect(plan.canvas).toEqual({ width: doc.blueprint.canvasSize.width, height: doc.blueprint.canvasSize.height });
    expect(plan.width).toBeGreaterThanOrEqual(GEN_MIN_SIDE);
    expect(plan.height).toBeGreaterThanOrEqual(GEN_MIN_SIDE);
    expect(plan.input).toHaveLength(plan.width * plan.height * 4);
    expect(plan.mask).toHaveLength(plan.width * plan.height * 4);
    expect(plan.box.x + plan.box.width).toBeLessThanOrEqual(plan.canvas.width);
    expect(plan.box.y + plan.box.height).toBeLessThanOrEqual(plan.canvas.height);
    // Every open cell is solid in the mask, and nothing else is.
    let solid = 0;
    for (let index = 3; index < plan.mask.length; index += 4) {
      if (plan.mask[index] === 255) {
        solid += 1;
      }
    }
    expect(solid).toBe(plan.open);
  });

  it("grows the open pixels by the room, one step at a time", () => {
    const doc = tankPlate();
    const tight = planVehiclePart(doc, { layer: "hull", room: 0 });
    const roomy = planVehiclePart(doc, { layer: "hull", room: 2 });
    expect(roomy.open).toBeGreaterThan(tight.open);
    expect(filled(doc.layers!.idle.hull)).toBeLessThan(roomy.open);
  });

  it("opens the selection when there is one, and nothing else", () => {
    const doc = tankPlate();
    const { width, height } = doc.blueprint.canvasSize;
    const selection = rectMask(width, height, ...partCorners(TANK_PARTS.turret));
    const plan = planVehiclePart(doc, { layer: "turret", room: 12, selection });
    expect(plan.fromSelection).toBe(true);
    expect(plan.open).toBe(TANK_PARTS.turret.w * TANK_PARTS.turret.h);
    expect(plan.zone.reduce((sum, cell) => sum + cell, 0)).toBe(plan.open);
  });

  it("refuses an empty layer, a name that is not a layer, and a unit that is not layered", () => {
    expect(() => planVehiclePart(tankPlate(), { layer: "tracks", room: 0 })).toThrow(/Nothing is drawn on the tracks/);
    expect(() => planVehiclePart(tankPlate(), { layer: "wheels", room: 0 })).toThrow(/not a layer/);
    expect(() => planVehiclePart(starterDocument("ger_infantry_43")!, { layer: "hull", room: 0 })).toThrow(/layered vehicle/);
  });
});

describe("reading the picture back", () => {
  it("gives the same drawing back when the picture comes back unchanged", () => {
    const doc = tankPlate();
    const plan = planVehiclePart(doc, { layer: "hull", room: 0 });
    const result = harvestVehiclePart(doc, plan, { rgba: plan.input.slice(), width: plan.width, height: plan.height });
    expect(result.grid).toEqual(doc.layers!.idle.hull);
    expect(result.painted).toBe(plan.open);
    expect(result.cleared).toBe(0);
  });

  it("clears the room that comes back as background", () => {
    const doc = tankPlate();
    const plan = planVehiclePart(doc, { layer: "hull", room: 2 });
    const result = harvestVehiclePart(doc, plan, { rgba: plan.input.slice(), width: plan.width, height: plan.height });
    expect(result.grid).toEqual(doc.layers!.idle.hull);
    expect(result.painted).toBe(filled(doc.layers!.idle.hull));
    expect(result.painted + result.cleared).toBe(plan.open);
  });

  it("reads the middle of each block when the picture comes back scaled up", () => {
    const doc = tankPlate();
    const plan = planVehiclePart(doc, { layer: "hull", room: 0 });
    const big = scaledUp(plan.input, plan.width, plan.height, 2);
    const result = harvestVehiclePart(doc, plan, { rgba: big, width: plan.width * 2, height: plan.height * 2 });
    expect(result.grid).toEqual(doc.layers!.idle.hull);
  });

  it("paints the selection from whatever shows there, and leaves the rest of the layer as it was", () => {
    const doc = tankPlate();
    const { width, height } = doc.blueprint.canvasSize;
    const selection = rectMask(width, height, ...partCorners(TANK_PARTS.turret));
    const plan = planVehiclePart(doc, { layer: "turret", room: 0, selection });
    const result = harvestVehiclePart(doc, plan, { rgba: plan.input.slice(), width: plan.width, height: plan.height });
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inside = selection.cells[y * width + x] !== 0;
        // The turret layer is empty, so the picture shows the hull under the selection. Outside it, the layer keeps what it wore.
        const expected = inside ? doc.layers!.idle.hull[y]![x] : doc.layers!.idle.turret![y]![x];
        expect(result.grid[y]![x]).toBe(expected);
      }
    }
  });

  it("refuses a picture that is not the scale that was sent", () => {
    const doc = tankPlate();
    const plan = planVehiclePart(doc, { layer: "hull", room: 0 });
    expect(() => harvestVehiclePart(doc, plan, { rgba: new Uint8ClampedArray(4), width: 1, height: 1 })).toThrow(/came back/);
  });

  it("refuses a picture with nothing painted where the part goes", () => {
    const doc = tankPlate();
    const plan = planVehiclePart(doc, { layer: "hull", room: 0 });
    const key = new Uint8ClampedArray(plan.width * plan.height * 4);
    for (let index = 0; index < plan.width * plan.height; index += 1) {
      key.set([GEN_KEY[0], GEN_KEY[1], GEN_KEY[2], 255], index * 4);
    }
    expect(() => harvestVehiclePart(doc, plan, { rgba: key, width: plan.width, height: plan.height })).toThrow(/nothing painted/);
  });
});
