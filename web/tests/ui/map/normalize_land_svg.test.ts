import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeLandSvg } from "../../../scripts/normalize-land-svg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const landFile = path.resolve(here, "../../../public/assets/ne_110m_land_FINAL_02.svg");

function pathData(svg: string): string[] {
  return [...svg.matchAll(/<path d="([^"]*)"/g)].map((match) => match[1]);
}

describe("normalizeLandSvg", () => {
  it("maps the viewBox onto 800×504 and writes M L Z under ne_110m_land", () => {
    const result = normalizeLandSvg(`<svg viewBox="0 0 1600 1008"><polygon points="0,0 1600,0 1600,1008"/></svg>`);
    expect(result.svg).toContain('viewBox="0 0 800 504"');
    expect(result.svg).toContain('<g id="ne_110m_land">');
    expect(result.polygons).toBe(1);
    const d = pathData(result.svg)[0];
    expect(d).toMatch(/^M /);
    expect(d.endsWith(" Z")).toBe(true);
    expect(d).not.toMatch(/[CQSTAHV]/);
    expect(d).toContain("800 504");
    expect(d).toContain("800 0");
  });

  it("flattens cubics, smooth curves, quadratics, and arcs into line segments", () => {
    const result = normalizeLandSvg(
      `<svg viewBox="0 0 800 504">
        <path d="M0 0 C0 40 40 40 40 0"/>
        <path d="M0 0 S40 40 40 0"/>
        <path d="M0 0 Q20 40 40 0"/>
        <path d="M10 0 A10 10 0 0 1 0 10"/>
        <polyline points="0,0 12,0 12,8"/>
      </svg>`,
    );
    expect(result.curves).toBe(4);
    expect(result.polylines).toBe(1);
    expect(result.paths).toBe(5);
    for (const d of pathData(result.svg)) {
      expect(d).toMatch(/^(?:M [\d.eE+-]+ [\d.eE+-]+(?: L [\d.eE+-]+ [\d.eE+-]+)+)+(?: Z)?$/);
      expect(d).not.toMatch(/[CQSTAHV]/);
    }
    const arc = pathData(result.svg)[3];
    const nums = [...arc.matchAll(/[\d.]+/g)].map(Number);
    const mids = [];
    for (let i = 2; i + 1 < nums.length; i += 2) mids.push([nums[i], nums[i + 1]]);
    expect(mids.some(([x, y]) => Math.hypot(x - 10, y) > 2 && Math.hypot(x - 10, y) < 12)).toBe(true);
    const line = pathData(result.svg)[4];
    expect(line.endsWith(" Z")).toBe(false);
    expect(line).toContain("12 8");
  });

  it("keeps the current land mask as 122 M L Z paths without writing the file", () => {
    const source = readFileSync(landFile, "utf8");
    const result = normalizeLandSvg(source);
    expect(result.paths).toBe(122);
    expect(result.svg).toContain('<g id="ne_110m_land">');
    expect(result.svg).toContain('viewBox="0 0 800 504"');
    expect(pathData(result.svg)).toHaveLength(122);
    expect(pathData(result.svg)[0].startsWith("M 116.82 496.56")).toBe(true);
    for (const d of pathData(result.svg)) {
      expect(d).not.toMatch(/[CQSTAHVcqstahv]/);
      expect(d.endsWith(" Z")).toBe(true);
    }
  });
});
