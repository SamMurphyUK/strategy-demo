import { describe, expect, it } from "vitest";
import { clearPaper, clearStrays, spriteIslands, SHEET_LABELS } from "../../scripts/sliceReferenceSheets.mjs";
import {
  AIR_PX_PER_M,
  AIR_UNITS,
  CLASS_BOX,
  FACTIONS,
  LAND_PX_PER_M,
  UNIT_TYPES,
  bakePromptFor,
  fitInside,
  historicalName,
  unitBox,
} from "../../scripts/historicalUnits.mjs";
import {
  INPUT_STRENGTH,
  STYLE_LIMITS,
  buildQueue,
  candidatePaths,
  canvasFor,
  inferenceBody,
  jobKey,
  parseOvernightArgs,
  placeOnCanvas,
  spentUsd,
  styleFor,
  upsertStyled,
} from "../../scripts/overnightBake.mjs";

describe("overnight bake", () => {
  it("defaults to a dry run of 3 seeds under $9.50", () => {
    expect(parseOvernightArgs([])).toEqual({
      run: false,
      seeds: 3,
      maxUsd: 9.5,
      limit: null,
      unit: null,
      faction: null,
      style: null,
    });
    expect(parseOvernightArgs(["--run", "--seeds", "3", "--max-usd", "9.50"])).toEqual({
      run: true,
      seeds: 3,
      maxUsd: 9.5,
      limit: null,
      unit: null,
      faction: null,
      style: null,
    });
    expect(parseOvernightArgs(["--faction", "GER", "--unit", "battleship", "--style", "rd_lite__simple"])).toMatchObject({
      faction: "GER",
      unit: "battleship",
      style: "rd_lite__simple",
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

  it("queues 5 factions × 14 units × the seed count at 45%, land on RD Fast and the rest on Core", () => {
    const jobs = buildQueue(3);
    expect(jobs).toHaveLength(210);
    const tank = jobs.find((job) => job.factionId === "GER" && job.unitTypeId === "tank");
    const battleship = jobs.find((job) => job.factionId === "GER" && job.unitTypeId === "battleship");
    expect(tank?.style).toBe("rd_fast__default");
    expect(battleship?.style).toBe("rd_core__simple");
    const canvas = canvasFor(192, 86, tank!.style);
    const body = inferenceBody({
      style: tank!.style,
      prompt: tank!.prompt,
      width: canvas.width,
      height: canvas.height,
      inputImage: "aaaa",
      seed: 1,
      checkCost: true,
    });
    expect(body.prompt_style).toBe("rd_fast__default");
    expect(body.strength).toBe(INPUT_STRENGTH);
    expect(body.strength).toBe(0.45);
    expect(body.width).toBe(192);
    expect(body.height).toBe(96);
    expect(body.remove_bg).toBe(true);
    expect(body.bypass_prompt_expansion).toBe(true);
    expect(body.check_cost).toBe(true);
    expect("reference_images" in body).toBe(false);
  });

  it("narrows the queue to one faction, unit and model", () => {
    const jobs = buildQueue(1, "battleship", "GER", "rd_lite__simple");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ factionId: "GER", unitTypeId: "battleship", style: "rd_lite__simple", seed: 1 });
    expect(() => buildQueue(1, null, "ITA")).toThrow("Unknown faction ITA");
    expect(() => buildQueue(1, null, null, "rd_pro__default")).toThrow("Unknown style rd_pro__default");
  });

  it("sizes every unit against the 36×56 soldier", () => {
    expect(unitBox("GER", "infantry")).toEqual({ width: 36, height: 56 });
    expect(unitBox("GER", "tank")).toEqual({ width: 192, height: 86 });
    expect(LAND_PX_PER_M).toBe(32);
    expect(AIR_PX_PER_M * 2).toBe(LAND_PX_PER_M);
    expect(unitBox("GER", "fighter")).toEqual({ width: 143, height: 159 });
    expect(unitBox("US", "bomber")).toEqual({ width: 363, height: 506 });
    expect(fitInside(532, 237, unitBox("GER", "tank"))).toEqual({ width: 192, height: 86 });
    expect(fitInside(469, 298, unitBox("US", "tank"))).toEqual({ width: 135, height: 86 });
  });

  it("makes each ship class longer than the last, and every ship longer than a tank", () => {
    const lengths = ["submarine", "destroyer", "transport", "cruiser", "carrier"].map((id) => CLASS_BOX[id].width);
    expect(lengths).toEqual([256, 320, 352, 416, 512]);
    expect(CLASS_BOX.battleship.width).toBe(512);
    expect(CLASS_BOX.submarine.width).toBeGreaterThan(CLASS_BOX.tank.width);
  });

  it("fits every unit inside the model it is sent to", () => {
    for (const factionId of FACTIONS) {
      for (const unitTypeId of UNIT_TYPES) {
        const box = unitBox(factionId, unitTypeId);
        const style = styleFor(unitTypeId);
        const canvas = canvasFor(box.width, box.height, style);
        expect(canvas.width).toBeGreaterThanOrEqual(box.width);
        expect(canvas.height).toBeGreaterThanOrEqual(box.height);
        expect(canvas.width).toBeLessThanOrEqual(STYLE_LIMITS[style].max);
        expect(canvas.height).toBeLessThanOrEqual(STYLE_LIMITS[style].max);
        expect(canvas.width).toBeGreaterThanOrEqual(STYLE_LIMITS[style].min);
        expect(canvas.height).toBeGreaterThanOrEqual(STYLE_LIMITS[style].min);
      }
    }
    expect(styleFor("infantry")).toBe("rd_fast__default");
    expect(styleFor("fighter")).toBe("rd_core__simple");
    expect(canvasFor(36, 53, "rd_fast__default")).toEqual({ width: 64, height: 64 });
    expect(canvasFor(512, 125, "rd_core__simple")).toEqual({ width: 512, height: 128 });
    expect(() => canvasFor(400, 86, "rd_fast__default")).toThrow("does not fit rd_fast__default");
  });

  it("stands the plate on the bottom row of the canvas without scaling it", () => {
    const plate = new Uint8ClampedArray(2 * 1 * 4);
    plate.set([10, 20, 30, 255], 0);
    plate.set([40, 50, 60, 255], 4);
    const placed = placeOnCanvas(plate, 2, 1, { width: 4, height: 3 });
    const opaque = placed.albedoKeys.map((key: string | null, index: number) => (key == null ? -1 : index)).filter((index: number) => index >= 0);
    expect(opaque).toEqual([9, 10]);
    expect(Array.from(placed.rgba.slice(9 * 4, 9 * 4 + 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(placed.rgba.slice(10 * 4, 10 * 4 + 4))).toEqual([40, 50, 60, 255]);
  });

  it("keeps a trial on another model beside the usual picture", () => {
    const [core] = buildQueue(1, "battleship", "GER");
    const [lite] = buildQueue(1, "battleship", "GER", "rd_lite__simple");
    expect(candidatePaths(core).quantized.replace(/\\/g, "/")).toBe("assets/candidates/GER/ger_battleship_seed1.quantized.png");
    expect(candidatePaths(lite).quantized.replace(/\\/g, "/")).toBe(
      "assets/candidates/GER/ger_battleship_seed1.rd_lite__simple.quantized.png",
    );
    const canvas = { width: 512, height: 128 };
    expect(jobKey(core, canvas)).toBe("GER/ger_battleship/seed1/rd_core__simple/512x128");
    expect(jobKey(lite, canvas)).not.toBe(jobKey(core, canvas));
    const row = (promptStyle: string, cost: number) => ({ factionId: "GER", blueprintId: "ger_battleship", seed: 1, promptStyle, cost });
    let manifest = upsertStyled({ candidates: [] }, row("rd_core__simple", 0.1));
    manifest = upsertStyled(manifest, row("rd_lite__simple", 0.05));
    manifest = upsertStyled(manifest, row("rd_core__simple", 0.2));
    expect(manifest.candidates.map((item: { promptStyle: string; cost: number }) => `${item.promptStyle} ${item.cost}`)).toEqual([
      "rd_lite__simple 0.05",
      "rd_core__simple 0.2",
    ]);
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

  it("clears the paper, a neighbour's fragment and shut-in paper, and keeps a white detail", () => {
    // 9×7 of white paper. A dark ring with a white middle sits at the left; a lone dark pixel at the right.
    const width = 9;
    const height = 7;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
    const ink = (x: number, y: number) => rgba.set([20, 20, 20, 255], (y * width + x) * 4);
    for (let x = 1; x <= 5; x++) {
      ink(x, 1);
      ink(x, 5);
    }
    for (let y = 1; y <= 5; y++) {
      ink(1, y);
      ink(5, y);
    }
    ink(7, 3);
    const alpha = (x: number, y: number) => rgba[(y * width + x) * 4 + 3];

    clearPaper(rgba, width, height);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(8, 6)).toBe(0);
    expect(alpha(3, 3)).toBe(255);
    expect(alpha(1, 1)).toBe(255);
    expect(alpha(7, 3)).toBe(255);

    const kept = rgba.slice();
    clearStrays(kept, width, height, 100);
    expect(kept[(3 * width + 7) * 4 + 3]).toBe(0);
    expect(kept[(3 * width + 3) * 4 + 3]).toBe(255);
    expect(kept[(1 * width + 1) * 4 + 3]).toBe(255);

    clearStrays(rgba, width, height, 9);
    expect(alpha(3, 3)).toBe(0);
    expect(alpha(1, 1)).toBe(255);
  });
});
