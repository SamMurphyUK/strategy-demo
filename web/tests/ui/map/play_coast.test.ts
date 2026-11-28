import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { projectMapJson } from "../../../src/ui/map/map_space";
import { coastFromMap } from "../../../src/ui/map/svgLandLoader";
import type { Dict } from "../../../src/engine/model/types";

const TRANSLATED = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1810 913">
  <g transform="translate(10 20)">
    <path fill-rule="evenodd" d="M0 0 L40 0 L40 30 L0 30 Z" />
  </g>
</svg>`;

describe("a map's own coast", () => {
  it("bakes a transformed SVG into that viewBox, not the campaign sheet", () => {
    const coast = coastFromMap({ sculpted_land_svg: TRANSLATED });
    expect(coast).not.toBeNull();
    expect(coast!.viewBox).toEqual({ x: 0, y: 0, w: 1810, h: 913 });
    const ring = coast!.polygons[0][0];
    expect(ring.some(([x, y]) => x === 10 && y === 20)).toBe(true);
    expect(ring.some(([x, y]) => x === 50 && y === 50)).toBe(true);
  });

  it("leaves a map with no stored coast on the shared campaign file", () => {
    expect(coastFromMap({ name: "final" })).toBeNull();
    expect(coastFromMap(null)).toBeNull();
  });

  it("does not scale a stored coast onto the 800 by 504 sheet", () => {
    const map: Dict = {
      sculpted_land_svg: TRANSLATED,
      regions: [{ polygon: [[100, 200], [110, 200], [110, 210]] }],
    };
    const projected = projectMapJson(map);
    expect(projected.coord_space).toBe("svg");
    expect(projected.regions[0].polygon).toEqual([[100, 200], [110, 200], [110, 210]]);
  });

  it("reads the Global 1940 board at the coast it was cut from", () => {
    const map = JSON.parse(readFileSync(resolve(__dirname, "../../../../data/maps/global_vii_auto.json"), "utf8")) as Dict;
    const coast = coastFromMap(map);
    expect(coast).not.toBeNull();
    expect(coast!.viewBox).toEqual({ x: 0, y: 0, w: 1810, h: 913 });
    expect(coast!.polygons.length).toBeGreaterThan(0);
    const bare = { ...map, coord_space: "" };
    const projected = projectMapJson(bare);
    expect(projected.regions[0].polygon).toEqual((map.regions as Dict[])[0].polygon);
  });
});
