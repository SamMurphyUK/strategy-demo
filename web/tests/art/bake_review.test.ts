import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { evaluateCandidateAgainstBlockout } from "../../src/art/blockoutCompiler";
import { referencePlatesFor } from "../../src/art/bakeReview";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS } from "../../src/art/starterParts";
import { MILITARY } from "../../src/ui/theme/militaryPalette";
import {
  creditCost,
  parseBakeArgs,
  selectBlueprints,
  totalCreditCost,
} from "../../scripts/bakeCandidates.mjs";
import {
  FACTION_MILITARY_MAPPINGS as STRIP_MAPPINGS,
  activePalette,
} from "../../dev/militaryStrip.mjs";
import { decodeRgbaPng, encodeRgbaPng } from "../../dev/pngRgba.mjs";
import {
  markPromoted,
  promotedRelativePath,
  quantizeToActiveKeys,
  quantizedRelativePath,
  upsertCandidate,
  emptyManifest,
} from "../../dev/bakeUnitPlugin.mjs";

describe("candidate quantization", () => {
  it("keeps the node palette copy identical to the authored mappings", () => {
    expect(STRIP_MAPPINGS).toEqual(FACTION_MILITARY_MAPPINGS);
  });

  it("snaps a German candidate onto German keys only, and matches the blockout scorer", () => {
    const palette = activePalette("GER");
    expect(palette.map((entry: { key: string }) => entry.key)).not.toContain("olive");
    const rgba = new Uint8ClampedArray([0x7d, 0x7b, 0x62, 255, 0x9c, 0x52, 0x4e, 10]);
    const albedo = ["feldgrau", null];
    const scored = quantizeToActiveKeys(rgba, 2, 1, albedo, palette);
    const strip = Object.fromEntries(palette.map((entry: { key: string }) => [entry.key, MILITARY[entry.key as keyof typeof MILITARY]]));
    const ts = evaluateCandidateAgainstBlockout(
      { width: 2, height: 1, data: rgba } as ImageData,
      2,
      1,
      albedo,
      strip,
    );
    expect(scored.quantizedKeys).toEqual(["brown", null]);
    expect(scored.quantizedKeys).toEqual(ts.quantizedKeys);
    expect(scored.silhouetteIoU).toBeCloseTo(ts.silhouetteIoU);
    expect(scored.rgba[0]).toBe(0x84);
    expect(scored.rgba[3]).toBe(255);
    expect(scored.rgba[7]).toBe(0);
    expect(() => quantizeToActiveKeys(rgba, 2, 2, albedo, palette)).toThrow(/does not match/);
  });

  it("round-trips RGBA and undoes a Sub filter", () => {
    const pixels = Uint8ClampedArray.from([10, 20, 30, 255, 0, 0, 0, 0]);
    const decoded = decodeRgbaPng(encodeRgbaPng(2, 1, pixels));
    expect(Array.from(decoded.data)).toEqual(Array.from(pixels));

    const raw = Buffer.from([1, 10, 20, 30, 255, 246, 236, 226, 1]);
    const png = pngWithRaw(2, 1, raw);
    const sub = decodeRgbaPng(png);
    expect(Array.from(sub.data)).toEqual([10, 20, 30, 255, 0, 0, 0, 0]);
  });
});

describe("candidate manifest", () => {
  it("writes the quantized name beside the raw file and promotes one seed", () => {
    expect(quantizedRelativePath("GER", "ger_tank_a", 7).replaceAll("\\", "/")).toBe(
      "assets/candidates/GER/ger_tank_a_seed7.quantized.png",
    );
    expect(promotedRelativePath("USSR", "ussr_tank_t34").replaceAll("\\", "/")).toBe(
      "public/assets/units/promoted/USSR/ussr_tank_t34.png",
    );
    expect(() => promotedRelativePath("GER", "../outside")).toThrow(/blueprintId/);

    let manifest = upsertCandidate(emptyManifest(), {
      factionId: "GER",
      blueprintId: "ger_infantry_43",
      seed: 2,
      promoted: false,
    });
    manifest = upsertCandidate(manifest, {
      factionId: "GER",
      blueprintId: "ger_infantry_43",
      seed: 2,
      silhouetteIoU: 0.5,
      promoted: false,
    });
    manifest = upsertCandidate(manifest, {
      factionId: "GER",
      blueprintId: "ger_infantry_43",
      seed: 3,
      promoted: false,
    });
    expect(manifest.candidates).toHaveLength(2);
    const promoted = markPromoted(manifest, "GER", "ger_infantry_43", 2);
    expect(promoted.candidates.find((item: { seed: number }) => item.seed === 2)?.promoted).toBe(true);
    expect(promoted.candidates.find((item: { seed: number }) => item.seed === 2)?.promotedPath).toBe(
      "public/assets/units/promoted/GER/ger_infantry_43.png",
    );
    expect(promoted.candidates.find((item: { seed: number }) => item.seed === 3)?.promoted).toBe(false);
  });
});

describe("bake candidate batch", () => {
  it("prices matching blueprints until --confirm, and puts the faction hero first", () => {
    expect(parseBakeArgs(["--faction", "ger", "--unit", "tank", "--seeds", "3", "--confirm"])).toEqual({
      faction: "ger",
      unit: "tank",
      seeds: 3,
      confirm: true,
    });
    expect(parseBakeArgs([])).toMatchObject({ seeds: 1, confirm: false, faction: null, unit: null });
    expect(() => parseBakeArgs(["--seeds", "0"])).toThrow(/1 to 12/);
    const tanks = selectBlueprints(STARTER_BLUEPRINTS, { faction: "GER", unit: "tank" });
    expect(tanks.map((blueprint) => blueprint.blueprintId)).toEqual(["ger_tank_pz4"]);
    expect(selectBlueprints(STARTER_BLUEPRINTS, { faction: null, unit: "infantry" })).toHaveLength(6);

    const blueprint = {
      ...STARTER_BLUEPRINTS[0],
      referencePlatePaths: ["assets/plates/a.png", "assets/plates/b.png"],
    };
    expect(referencePlatesFor(blueprint, true)[0]).toBe("public/assets/units/promoted/GER/ger_infantry_43.png");
    expect(referencePlatesFor(blueprint, true)).toEqual([
      "public/assets/units/promoted/GER/ger_infantry_43.png",
      "assets/plates/a.png",
      "assets/plates/b.png",
    ]);
    expect(referencePlatesFor(blueprint, false)).toEqual(["assets/plates/a.png", "assets/plates/b.png"]);
    expect(totalCreditCost([1, { credits: 2 }, { cost: 0.5 }, "n/a"])).toBe(3.5);
    expect(creditCost("n/a")).toBeNull();
  });
});

function pngWithRaw(width: number, height: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  let c = 0xffffffff;
  for (let i = 0; i < body.length; i++) {
    c = CRC_TABLE[(c ^ body[i]) & 0xff] ^ (c >>> 8);
  }
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, crc]);
}
