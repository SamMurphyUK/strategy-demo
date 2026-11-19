import { describe, expect, it } from "vitest";
import { clearPaper, clearStrays, spriteIslands, SHEET_LABELS } from "../../scripts/sliceReferenceSheets.mjs";
import { activePalette } from "../../dev/militaryStrip.mjs";
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
  LANDED_AIR_STRENGTH,
  LANDED_AIRCRAFT,
  LANDED_CANVAS,
  STYLE_LIMITS,
  airborneQuantizedPath,
  buildLandedQueue,
  buildQueue,
  candidatePaths,
  biasGreysToHull,
  dropInkOutlines,
  liftEdgeShadow,
  canvasFor,
  inferenceBody,
  jobKey,
  landedPrompt,
  paintTailDragger,
  parseOvernightArgs,
  placeOnCanvas,
  sampleAirframeColours,
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
      except: null,
      landedAir: false,
      only: null,
    });
    expect(parseOvernightArgs(["--run", "--seeds", "3", "--max-usd", "9.50"])).toEqual({
      run: true,
      seeds: 3,
      maxUsd: 9.5,
      limit: null,
      unit: null,
      faction: null,
      style: null,
      except: null,
      landedAir: false,
      only: null,
    });
    expect(parseOvernightArgs(["--faction", "GER", "--unit", "battleship", "--style", "rd_lite__simple"])).toMatchObject({
      faction: "GER",
      unit: "battleship",
      style: "rd_lite__simple",
    });
  });

  it("uses the side-profile prompt for ships and the T-shape prompt for aircraft", () => {
    const tank = bakePromptFor("GER", "tank");
    expect(tank).toContain("retro blocky sprite");
    expect(tank).toContain("facing right");
    expect(tank).toContain("no fine detail");
    expect(tank).toContain("Panzer IV Ausf. H tank");
    expect(tank).toContain("feldgrau hull");
    expect(tank).toContain("no black outline");
    expect(bakePromptFor("UK", "tank")).toContain("khaki hull");
    expect(bakePromptFor("US", "tank")).toContain("olive hull");
    expect(bakePromptFor("USSR", "tank")).toContain("crimson hull");
    expect(tank).not.toContain("reference");
    const fighter = bakePromptFor("GER", "fighter");
    expect(fighter.startsWith("top-down pixel art game sprite, nose pointing right")).toBe(true);
    expect(fighter).toContain("retro blocky sprite");
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
    const withoutInfantry = buildQueue(1, null, "UK", null, "infantry");
    expect(withoutInfantry).toHaveLength(13);
    expect(withoutInfantry.some((job) => job.unitTypeId === "infantry")).toBe(false);
    expect(() => buildQueue(1, null, "UK", null, "horse")).toThrow("Unknown unit horse");
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

  it("peels a near-black outline and leaves the hull pixel", () => {
    const width = 3;
    const height = 3;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([0, 0, 0, 255], i * 4);
    rgba.set([168, 138, 94, 255], (1 * width + 1) * 4);
    const peeled = dropInkOutlines(rgba, width, height);
    expect(peeled[3]).toBe(0);
    expect(Array.from(peeled.slice(4 * 4, 4 * 4 + 4))).toEqual([168, 138, 94, 255]);
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });

  it("moves a grey hull onto the faction colour and leaves a saturated pixel", () => {
    const palette = activePalette("UK");
    const rgba = new Uint8ClampedArray(8);
    rgba.set([70, 72, 74, 255], 0);
    rgba.set([180, 40, 40, 255], 4);
    const biased = biasGreysToHull(rgba, palette, "khaki");
    expect(Array.from(biased.slice(0, 4))).toEqual([168, 138, 94, 255]);
    expect(Array.from(biased.slice(4, 8))).toEqual([180, 40, 40, 255]);
    const shadow = new Uint8ClampedArray([20, 20, 22, 255]);
    expect(Array.from(biasGreysToHull(shadow, palette, "khaki").slice(0, 3))).toEqual([75, 61, 68]);
  });

  it("turns a charcoal edge into the hull colour", () => {
    const palette = activePalette("US");
    const rgba = new Uint8ClampedArray(8);
    rgba.set([75, 61, 68, 255], 0);
    rgba.set([125, 123, 98, 255], 4);
    const lifted = liftEdgeShadow(rgba, 2, 1, palette, "olive");
    expect(Array.from(lifted.slice(0, 3))).toEqual([125, 123, 98, 255].slice(0, 3));
    expect(Array.from(lifted.slice(4, 7))).toEqual([125, 123, 98]);
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
    const outlined = { ...row("rd_core__simple", 0.2), grade: "outlined" };
    manifest = upsertStyled(manifest, outlined);
    expect(manifest.candidates).toHaveLength(3);
    manifest = upsertStyled(manifest, { ...outlined, cost: 0.3 });
    expect(manifest.candidates.map((item: { grade?: string; cost: number }) => `${item.grade ?? "peeled"} ${item.cost}`)).toEqual([
      "peeled 0.05",
      "peeled 0.2",
      "outlined 0.3",
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

    const holes = rgba.slice();
    clearStrays(holes, width, height);
    expect(holes[(3 * width + 3) * 4 + 3]).toBe(0);
    expect(holes[(1 * width + 1) * 4 + 3]).toBe(255);

    clearStrays(rgba, width, height, 9);
    expect(alpha(3, 3)).toBe(0);
    expect(alpha(1, 1)).toBe(255);
  });
});

describe("landed air", () => {
  const landedWrapper = (name: string) =>
    `side-profile pixel art game sprite, PLATFORMER STYLE, facing right, flat orthographic side view, parked on ground on extended main landing gear wheels and rear tailwheel, tail-dragger stance angled slightly nose-up, single isolated aircraft on transparent background, PLATFORMER STYLE POSE, ${name}, crisp 1px pixel clusters, flat cel shading, limited color palette, no anti-aliasing, no drop shadow, no ground floor, no text`;

  it("prices a dry run of two seeds, and one airframe when asked", () => {
    expect(parseOvernightArgs(["--landed-air"])).toMatchObject({
      run: false,
      seeds: 2,
      maxUsd: 9.5,
      landedAir: true,
      only: null,
    });
    expect(parseOvernightArgs(["--landed-air", "--seeds", "1", "--only", "US:fighter", "--max-usd", "1"])).toEqual({
      run: false,
      seeds: 1,
      maxUsd: 1,
      limit: null,
      unit: null,
      faction: null,
      style: null,
      except: null,
      landedAir: true,
      only: "US:fighter",
    });
    expect(() => parseOvernightArgs(["--only", "US:fighter"])).toThrow(/--landed-air/);
    expect(() => parseOvernightArgs(["--landed-air", "--faction", "US"])).toThrow(/--only/);
  });

  it("asks for the historical airframe in a side-profile tail-dragger prompt", () => {
    expect(landedPrompt("US", "fighter")).toBe(landedWrapper("North American P-51D Mustang fighter"));
    expect(landedPrompt("UK", "tac_bomber")).toContain("Fairey Barracuda torpedo dive bomber");
    expect(landedPrompt("GER", "bomber")).toContain("Heinkel He 111 twin-engine bomber");
    const prompt = landedPrompt("JAP", "fighter");
    expect(prompt).toContain("PLATFORMER STYLE");
    expect(prompt).toContain("tail-dragger");
    expect(prompt).not.toContain("top-down");
    expect(prompt).not.toContain("T shape");
    const jobs = buildLandedQueue(1);
    expect(jobs.map((job) => job.prompt)).toEqual(
      FACTIONS.flatMap((factionId) =>
        (["fighter", "tac_bomber", "bomber"] as const).map((unitTypeId) => landedWrapper(LANDED_AIRCRAFT[factionId][unitTypeId])),
      ),
    );
  });

  it("queues the fifteen airframes and can stop at one", () => {
    expect(buildLandedQueue(2)).toHaveLength(30);
    const jobs = buildLandedQueue(2, "US:fighter");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      factionId: "US",
      unitTypeId: "fighter_landed",
      airType: "fighter",
      blueprintId: "us_fighter_landed",
      seed: 1,
      style: "rd_fast__default",
      strength: LANDED_AIR_STRENGTH,
      landed: true,
    });
    expect(jobs[1].seed).toBe(2);
    expect(() => buildLandedQueue(1, "US:tank")).toThrow(/fighter, tac_bomber, and bomber/);
    expect(() => buildLandedQueue(1, "ITA:fighter")).toThrow(/Unknown faction ITA/);
  });

  it("sends a 48×48 tail-dragger to RD Fast at strength 0.62", () => {
    const [job] = buildLandedQueue(1, "us:fighter");
    const body = inferenceBody({
      style: job.style,
      prompt: job.prompt,
      width: LANDED_CANVAS.width,
      height: LANDED_CANVAS.height,
      inputImage: "aaaa",
      seed: job.seed,
      checkCost: true,
      strength: job.strength,
    });
    expect(body).toMatchObject({
      prompt_style: "rd_fast__default",
      strength: 0.62,
      width: 48,
      height: 48,
      num_images: 1,
      remove_bg: true,
      upscale_output_factor: 1,
      bypass_prompt_expansion: true,
      check_cost: true,
      seed: 1,
    });
    expect(body.prompt).toContain("North American P-51D Mustang fighter");
    expect("reference_images" in body).toBe(false);
    expect(body.input_image).toBe("aaaa");
  });

  it("saves the landed picture beside the airborne one and leaves that row alone", () => {
    const [landed] = buildLandedQueue(1, "US:fighter");
    const [airborne] = buildQueue(1, "fighter", "US");
    expect(candidatePaths(landed).raw.replace(/\\/g, "/")).toBe("assets/candidates/US/us_fighter_landed_seed1.raw.png");
    expect(candidatePaths(landed).quantized.replace(/\\/g, "/")).toBe("assets/candidates/US/us_fighter_landed_seed1.quantized.png");
    expect(candidatePaths(airborne).quantized.replace(/\\/g, "/")).toBe("assets/candidates/US/us_fighter_seed1.quantized.png");
    expect(jobKey(landed, LANDED_CANVAS)).not.toBe(jobKey(airborne, { width: 160, height: 176 }));
    const airborneRow = {
      factionId: "US",
      unitTypeId: "fighter",
      blueprintId: "us_fighter",
      seed: 1,
      promptStyle: "rd_core__simple",
      cost: 0.1,
    };
    let manifest = upsertStyled({ candidates: [] }, airborneRow);
    manifest = upsertStyled(manifest, {
      factionId: "US",
      unitTypeId: "fighter_landed",
      blueprintId: "us_fighter_landed",
      seed: 1,
      promptStyle: "rd_fast__default",
      cost: 0.03,
    });
    expect(manifest.candidates).toHaveLength(2);
    expect(manifest.candidates[0]).toMatchObject(airborneRow);
  });

  it("copies colours from the outlined airborne sprite, not a landed one", () => {
    const manifest = {
      candidates: [
        {
          factionId: "US",
          unitTypeId: "fighter",
          blueprintId: "us_fighter",
          quantized: "assets/candidates/US/us_fighter_seed1.quantized.png",
          silhouetteIoU: 0.9,
        },
        {
          factionId: "US",
          unitTypeId: "fighter",
          blueprintId: "us_fighter",
          quantized: "assets/candidates/US/us_fighter_seed1.outlined.quantized.png",
          silhouetteIoU: 0.4,
          grade: "outlined",
        },
        {
          factionId: "US",
          unitTypeId: "fighter_landed",
          blueprintId: "us_fighter_landed",
          quantized: "assets/candidates/US/us_fighter_landed_seed1.quantized.png",
          promoted: true,
          promotedPath: "assets/units/us_fighter_landed.png",
          silhouetteIoU: 1,
        },
      ],
    };
    expect(airborneQuantizedPath(manifest, "US", "fighter")).toBe(
      "assets/candidates/US/us_fighter_seed1.outlined.quantized.png",
    );
    const promoted = {
      candidates: [
        {
          factionId: "US",
          unitTypeId: "fighter",
          blueprintId: "us_fighter",
          promoted: true,
          promotedPath: "assets/units/us_fighter.png",
          quantized: "assets/candidates/US/us_fighter_seed1.quantized.png",
        },
      ],
    };
    expect(airborneQuantizedPath(promoted, "US", "fighter")).toBe("assets/units/us_fighter.png");
  });

  it("paints a right-facing tail-dragger with the sampled colours and no ground", () => {
    const painted = paintTailDragger({ hull: "olive", trim: "khaki", canopy: "steel", accent: "crimson" });
    expect(painted.width).toBe(48);
    expect(painted.height).toBe(48);
    const keys = painted.albedoKeys;
    const meanY = (pick: (x: number) => boolean) => {
      let sum = 0;
      let count = 0;
      keys.forEach((key, index) => {
        if (!key || !pick(index % 48)) return;
        sum += Math.floor(index / 48);
        count += 1;
      });
      return sum / count;
    };
    expect(meanY((x) => x >= 40)).toBeLessThan(meanY((x) => x <= 12));
    let maxX = -1;
    let wheel = false;
    const used = new Set<string>();
    keys.forEach((key, index) => {
      if (!key) return;
      used.add(key);
      const x = index % 48;
      const y = Math.floor(index / 48);
      if (x > maxX) maxX = x;
      if (y >= 40) wheel = true;
    });
    expect(maxX).toBeGreaterThanOrEqual(44);
    expect(wheel).toBe(true);
    expect(keys[0]).toBeNull();
    expect(keys[47]).toBeNull();
    expect(keys[47 * 48]).toBeNull();
    expect(keys[47 * 48 + 47]).toBeNull();
    for (let y = 44; y < 48; y++) {
      for (let x = 0; x < 48; x++) expect(keys[y * 48 + x]).toBeNull();
    }
    expect([...used].sort()).toEqual(["crimson", "khaki", "olive", "steel"]);
    const oliveAt = painted.rgba.findIndex(
      (_, index) => index % 4 === 0 && painted.rgba[index] === 125 && painted.rgba[index + 1] === 123 && painted.rgba[index + 2] === 98,
    );
    expect(oliveAt).toBeGreaterThanOrEqual(0);
    expect(painted.rgba[oliveAt + 3]).toBe(255);
  });

  it("reads an olive hull and a red spinner off the airborne picture", () => {
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 48; i++) rgba.set([125, 123, 98, 255], i * 4);
    for (let i = 48; i < 64; i++) rgba.set([156, 82, 78, 255], i * 4);
    expect(sampleAirframeColours(rgba, 8, 8, "US")).toMatchObject({ hull: "olive", accent: "crimson" });
  });
});
