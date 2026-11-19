import { describe, expect, it } from "vitest";
import { spriteIslands, SHEET_LABELS } from "../../scripts/sliceReferenceSheets.mjs";
import { AIR_UNITS, FACTIONS, UNIT_TYPES, bakePromptFor, historicalName } from "../../scripts/historicalUnits.mjs";
import {
  INPUT_STRENGTH,
  PROMPT_STYLE,
  buildQueue,
  inferenceBody,
  parseOvernightArgs,
  spentUsd,
} from "../../scripts/overnightBake.mjs";

describe("overnight bake", () => {
  it("defaults to a dry run of 3 seeds under $9.50", () => {
    expect(parseOvernightArgs([])).toEqual({ run: false, seeds: 3, maxUsd: 9.5, limit: null, unit: null });
    expect(parseOvernightArgs(["--run", "--seeds", "3", "--max-usd", "9.50"])).toEqual({
      run: true,
      seeds: 3,
      maxUsd: 9.5,
      limit: null,
      unit: null,
    });
  });

  it("uses the side-profile prompt for ships and the T-shape prompt for aircraft", () => {
    const tank = bakePromptFor("GER", "tank");
    expect(tank).toContain("PLATFORMER STYLE");
    expect(tank).toContain("Panzer IV Ausf. H tank");
    expect(tank).not.toContain("reference");
    const fighter = bakePromptFor("GER", "fighter");
    expect(fighter.startsWith("top-down pixel art game sprite, nose pointing right")).toBe(true);
    expect(fighter).toContain("Messerschmitt Bf 109G fighter");
    expect(historicalName("JAP", "battleship")).toBe("Yamato battleship");
  });

  it("queues 5 factions × 14 units × the seed count on RD Fast at 45%", () => {
    const jobs = buildQueue(3);
    expect(jobs).toHaveLength(210);
    const body = inferenceBody(jobs[0].prompt, "aaaa", 1, true);
    expect(body.prompt_style).toBe(PROMPT_STYLE);
    expect(body.prompt_style).toBe("rd_fast__default");
    expect(body.strength).toBe(INPUT_STRENGTH);
    expect(body.strength).toBe(0.45);
    expect(body.width).toBe(96);
    expect(body.remove_bg).toBe(true);
    expect(body.bypass_prompt_expansion).toBe(true);
    expect(body.check_cost).toBe(true);
    expect("reference_images" in body).toBe(false);
  });

  it("counts only succeeded ledger rows toward the cap", () => {
    expect(
      spentUsd({
        jobs: {
          a: { status: "succeeded", cost: 0.02 },
          b: { status: "failed", cost: 0.02 },
          c: { status: "succeeded", cost: 0.03 },
        },
      }),
    ).toBeCloseTo(0.05);
  });

  it("labels every faction sheet onto the 14 unit types", () => {
    for (const factionId of FACTIONS) {
      const labels = SHEET_LABELS[factionId].filter((label): label is string => label != null);
      const unique = new Set(labels);
      expect(unique.size).toBe(labels.length);
      for (const unitTypeId of labels) {
        expect(UNIT_TYPES).toContain(unitTypeId);
      }
    }
    expect(SHEET_LABELS.GER.filter((label) => label != null)).toHaveLength(13);
    expect(SHEET_LABELS.GER).not.toContain("destroyer");
    expect(SHEET_LABELS.UK.filter((label) => label == null)).toHaveLength(1);
    expect(new Set(SHEET_LABELS.US.filter((label) => label != null)).size).toBe(14);
    expect(AIR_UNITS.has("fighter")).toBe(true);
    expect(AIR_UNITS.has("tank")).toBe(false);
  });

  it("finds two islands and ignores a white gap", () => {
    const width = 8;
    const height = 4;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const paint = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      rgba[offset] = 20;
      rgba[offset + 1] = 20;
      rgba[offset + 2] = 20;
      rgba[offset + 3] = 255;
    };
    paint(0, 0);
    paint(1, 0);
    paint(6, 2);
    rgba.fill(255, 0, 0);
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [6, 2],
    ] as const) {
      paint(x, y);
    }
    const islands = spriteIslands(rgba, width, height, 1);
    expect(islands).toHaveLength(2);
    expect(islands[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 1 });
    expect(islands[1]).toMatchObject({ x: 6, y: 2, w: 1, h: 1 });
  });
});
