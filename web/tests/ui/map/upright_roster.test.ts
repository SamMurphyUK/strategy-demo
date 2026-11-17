import { describe, expect, it } from "vitest";
import { drawUprightStack, type UprightPaint } from "../../../src/ui/map/uprightSprites";

const FACTIONS = ["ger", "ussr", "uk", "usa", "jap", ""];
const TYPES = ["infantry", "tank", "fighter", "tactical_bomber", "submarine", "destroyer", "battleship", "carrier"];

function paintOf(unitType: string, factionId: string): UprightPaint {
  return {
    unitType,
    factionId,
    count: 1,
    x: 40,
    y: 40,
    tokenPx: 32,
    dpr: 1,
    selected: false,
    unmoved: false,
    active: true,
    fuel: null,
    loaded: false,
  };
}

/** Records the pixels of one upright figure. The plinth is the same for every faction. */
function figure(unitType: string, factionId: string): string {
  const log: string[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    imageSmoothingEnabled: true,
    font: "",
    textAlign: "left",
    textBaseline: "middle",
    save: () => log.push("save"),
    restore: () => log.push("restore"),
    beginPath: () => log.push("begin"),
    closePath: () => log.push("close"),
    ellipse: () => log.push("ellipse"),
    arc: () => log.push("arc"),
    fill: () => log.push("fill"),
    stroke: () => log.push("stroke"),
    moveTo: (x: number, y: number) => log.push(`m${x},${y}`),
    lineTo: (x: number, y: number) => log.push(`l${x},${y}`),
    fillRect: (x: number, y: number, w: number, h: number) => log.push(`r${x},${y},${w},${h}`),
    strokeRect: () => log.push("sr"),
    translate: () => undefined,
    scale: () => undefined,
    setTransform: () => undefined,
    setLineDash: () => undefined,
    fillText: () => undefined,
    measureText: () => ({ width: 10 }),
  };
  Object.defineProperty(ctx, "fillStyle", {
    set(value: string) {
      log.push(`f${value}`);
    },
  });
  drawUprightStack(ctx as unknown as CanvasRenderingContext2D, paintOf(unitType, factionId));
  return log.join("|");
}

describe("upright faction sprites", () => {
  it.each(TYPES)("draws a different %s for every faction", (unitType) => {
    const drawn = FACTIONS.map((faction) => figure(unitType, faction));
    expect(new Set(drawn).size).toBe(FACTIONS.length);
  });

  it("draws the same faction the same way every time", () => {
    expect(figure("tank", "ger")).toBe(figure("tank", "ger"));
    expect(figure("infantry", "ussr")).not.toBe(figure("infantry", "ger"));
  });
});
