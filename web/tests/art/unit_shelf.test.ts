import { describe, expect, it } from "vitest";
import { POLISHED_WALK_KEY, candidateShelf, groupShelf, preferStamped, shelfUnits, vectorShelf } from "../../src/art/unitShelf";

const MANIFEST = {
  scale: 4,
  units: [
    {
      file: "assets/units/vector/UK/uk_artillery_seed1.svg",
      source: "assets/candidates/UK/uk_artillery_seed1.outlined.quantized.png",
      factionId: "UK",
      unitTypeId: "artillery",
      width: 160,
      height: 80,
      seed: 1,
      polished: false,
    },
    {
      file: "assets/units/vector/UK/uk_artillery_seed1.polished.svg",
      source: "assets/candidates/UK/uk_artillery_seed1.outlined.polished.png",
      factionId: "UK",
      unitTypeId: "artillery",
      width: 160,
      height: 80,
      seed: 1,
      polished: true,
      grade: "polished",
    },
    {
      file: "assets/units/vector/USSR/ussr_tank_t34_seed1.polished.svg",
      source: "assets/candidates/USSR/ussr_tank_t34_seed1.outlined.polished.png",
      factionId: "USSR",
      unitTypeId: "tank",
      width: 192,
      height: 96,
      seed: 1,
      polished: true,
    },
    {
      file: "assets/units/vector/UK/uk_aaa_seed1.polished.svg",
      source: "assets/candidates/UK/uk_aaa_seed1.outlined.polished.png",
      factionId: "UK",
      unitTypeId: "aaa",
      width: 96,
      height: 96,
      seed: 1,
      polished: true,
    },
    {
      file: "assets/units/vector/US/us_bomber_seed1.svg",
      source: "assets/candidates/US/us_bomber_seed1.outlined.quantized.png",
      factionId: "US",
      unitTypeId: "bomber",
      width: 368,
      height: 496,
      seed: 1,
    },
  ],
  clips: [
    {
      dir: "assets/units/vector/frames/jap_infantry_polished",
      source: "public/assets/units/frames/jap_infantry_polished/clips.json",
      unitId: "jap_infantry",
      factionId: "JAP",
      unitTypeId: "infantry",
      width: 80,
      height: 80,
      preview: "assets/units/vector/frames/jap_infantry_polished/idle_0.svg",
      polished: true,
    },
  ],
};

const CANDIDATES = [
  { factionId: "GER", unitTypeId: "tank", seed: 2, quantized: "assets/candidates/GER/ger_tank_pz4_seed2.quantized.png" },
  { factionId: "UK", unitTypeId: "aaa", seed: 1, quantized: "assets/candidates/UK/uk_aaa_seed1.outlined.quantized.png", grade: "outlined" },
];

const library = () => [...vectorShelf(MANIFEST), ...candidateShelf(CANDIDATES)];

describe("unit shelf", () => {
  it("lists only vectorised, polished units by default", () => {
    const shown = shelfUnits(library(), false);
    expect(shown.map((unit) => unit.key)).toEqual([
      "vec:assets/units/vector/UK/uk_artillery_seed1.polished.svg",
      "vec:assets/units/vector/USSR/ussr_tank_t34_seed1.polished.svg",
      "vec:assets/units/vector/UK/uk_aaa_seed1.polished.svg",
      "clips:assets/units/vector/frames/jap_infantry_polished",
    ]);
    expect(shown.every((unit) => unit.vectorised && unit.polished)).toBe(true);
  });

  it("hides unpolished vectors and plain pictures by default", () => {
    const keys = shelfUnits(library(), false).map((unit) => unit.key);
    expect(keys).not.toContain("vec:assets/units/vector/UK/uk_artillery_seed1.svg");
    expect(keys.some((key) => key.startsWith("pic:"))).toBe(false);
  });

  it("treats a row without the polished flag as not polished", () => {
    const bomber = vectorShelf(MANIFEST).find((unit) => unit.unitTypeId === "bomber");
    expect(bomber?.polished).toBe(false);
    expect(shelfUnits(vectorShelf(MANIFEST), false).some((unit) => unit.unitTypeId === "bomber")).toBe(false);
    const truthy = vectorShelf({ units: [{ ...MANIFEST.units[4], polished: "yes" }] });
    expect(truthy[0]?.polished).toBe(false);
  });

  it("returns everything with Show all units", () => {
    const all = library();
    expect(shelfUnits(all, true)).toEqual(all);
    expect(all).toHaveLength(8);
  });

  it("groups by faction order, then unit type label, polished first inside a type", () => {
    const groups = groupShelf(library());
    expect(groups.map((group) => group.factionId)).toEqual(["GER", "USSR", "UK", "US", "JAP"]);
    const uk = groups.find((group) => group.factionId === "UK");
    expect(uk?.types.map((type) => type.unitTypeId)).toEqual(["aaa", "artillery"]);
    expect(uk?.types[0]?.units.map((unit) => unit.kind)).toEqual(["vector", "picture"]);
    expect(uk?.types[1]?.units.map((unit) => unit.polished)).toEqual([true, false]);
  });

  it("opens the polished PNG, not the quantized one, and shows the SVG", () => {
    const tank = vectorShelf(MANIFEST).find((unit) => unit.factionId === "USSR");
    expect(tank?.preview).toBe("/assets/units/vector/USSR/ussr_tank_t34_seed1.polished.svg");
    expect(tank?.fieldPick).toBe("assets/candidates/USSR/ussr_tank_t34_seed1.outlined.polished.png");
    expect(tank?.label).toBe("USSR Tank 1, polished vector");
    const walk = vectorShelf(MANIFEST).find((unit) => unit.kind === "clips");
    expect(walk?.fieldPick).toBe(POLISHED_WALK_KEY);
    const gun = vectorShelf(MANIFEST).find((unit) => unit.unitTypeId === "artillery" && unit.polished);
    expect(gun?.fieldPick).toBe("walk:uk_artillery_seed1_QUICK:vector");
    const aaa = candidateShelf(CANDIDATES).find((unit) => unit.unitTypeId === "aaa");
    expect(aaa?.fieldPick).toBe("walk:uk_aaa_seed1_QUICK:vector");
    expect(walk?.preview).toBe("/assets/units/vector/frames/jap_infantry_polished/idle_0.svg");
  });

  it("skips rows that cannot be served", () => {
    const units = vectorShelf({
      units: [
        { file: "../secret.svg", factionId: "UK", unitTypeId: "aaa", polished: true },
        { file: "assets/units/vector/UK/x.png", factionId: "UK", unitTypeId: "aaa", polished: true },
        { file: "assets/units/vector/UK/x.svg", unitTypeId: "aaa", polished: true },
      ],
    });
    expect(units).toEqual([]);
    expect(vectorShelf(null)).toEqual([]);
  });
});

describe("stamped vectors on the shelf", () => {
  const STAMPED_ROW = {
    file: "assets/units/vector/USSR/ussr_tank_t34_seed1.stamped.svg",
    source: "assets/candidates/USSR/ussr_tank_t34_seed1.outlined.stamped.png",
    factionId: "USSR",
    unitTypeId: "tank",
    width: 192,
    height: 96,
    seed: 1,
    polished: true,
    stamped: true,
    grade: "stamped",
  };
  const withStamped = { ...MANIFEST, units: [...MANIFEST.units, STAMPED_ROW] };

  it("shows the stamped vector in place of the polished one by default", () => {
    const keys = shelfUnits(vectorShelf(withStamped), false).map((unit) => unit.key);
    expect(keys).toContain("vec:assets/units/vector/USSR/ussr_tank_t34_seed1.stamped.svg");
    expect(keys).not.toContain("vec:assets/units/vector/USSR/ussr_tank_t34_seed1.polished.svg");
    expect(keys).toContain("vec:assets/units/vector/UK/uk_artillery_seed1.polished.svg");
    expect(keys).toHaveLength(4);
  });

  it("keeps both with Show all units, stamped first", () => {
    const all = shelfUnits(vectorShelf(withStamped), true);
    expect(all.filter((unit) => unit.factionId === "USSR")).toHaveLength(2);
    const tank = groupShelf(all).find((group) => group.factionId === "USSR")?.types[0]?.units ?? [];
    expect(tank.map((unit) => unit.stamped)).toEqual([true, false]);
  });

  it("labels it, opens the stamped PNG on a battle map, and stamps on the polished PNG", () => {
    const stamped = vectorShelf(withStamped).find((unit) => unit.stamped);
    expect(stamped?.label).toBe("USSR Tank 1, stamped vector");
    expect(stamped?.polished).toBe(true);
    expect(stamped?.fieldPick).toBe("assets/candidates/USSR/ussr_tank_t34_seed1.outlined.stamped.png");
    expect(stamped?.stampSource).toBe("assets/candidates/USSR/ussr_tank_t34_seed1.outlined.polished.png");
    const polished = vectorShelf(withStamped).find((unit) => unit.key === "vec:assets/units/vector/USSR/ussr_tank_t34_seed1.polished.svg");
    expect(polished?.stamped).toBe(false);
    expect(polished?.stampSource).toBe("assets/candidates/USSR/ussr_tank_t34_seed1.outlined.polished.png");
  });

  it("gives no stamp source to an unpolished vector, a walk or a plain picture", () => {
    const units = [...vectorShelf(MANIFEST), ...candidateShelf(CANDIDATES)];
    for (const unit of units.filter((item) => !item.polished || item.kind !== "vector")) {
      expect(unit.stampSource, unit.key).toBeUndefined();
    }
  });

  it("does not take a row as stamped unless its source is a stamped PNG", () => {
    const fake = vectorShelf({ units: [{ ...STAMPED_ROW, source: "assets/candidates/USSR/ussr_tank_t34_seed1.outlined.polished.png" }] });
    expect(fake[0]?.stamped).toBe(false);
  });

  it("does the same for the battle map's raw manifest rows", () => {
    const rows = preferStamped(withStamped.units);
    expect(rows.map((row) => row.file)).toContain(STAMPED_ROW.file);
    expect(rows.map((row) => row.file)).not.toContain("assets/units/vector/USSR/ussr_tank_t34_seed1.polished.svg");
    expect(rows.map((row) => row.file)).toContain("assets/units/vector/UK/uk_artillery_seed1.svg");
    expect(preferStamped(MANIFEST.units)).toEqual(MANIFEST.units);
  });
});
