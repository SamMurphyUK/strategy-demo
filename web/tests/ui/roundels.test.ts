import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUNDEL_IDS, ROUNDEL_PX, roundelFor } from "../../src/components/ui/RoundelBadge";

const dir = path.resolve(__dirname, "../../public/assets/roundels");

describe("roundel SVGs (scripts/generate_roundels.py)", () => {
  it("writes all twelve and a contact sheet", () => {
    expect(ROUNDEL_IDS).toHaveLength(12);
    for (const id of ROUNDEL_IDS) {
      expect(existsSync(path.join(dir, `${id}.svg`)), id).toBe(true);
    }
    expect(existsSync(path.join(dir, "contact_sheet.html"))).toBe(true);
  });

  it.each([...ROUNDEL_IDS])("%s follows the strict SVG rules", (id) => {
    const svg = readFileSync(path.join(dir, `${id}.svg`), "utf8");
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toMatch(/<circle cx="128" cy="128" r="122"/); // the dark bezel
    expect(svg).toMatch(/<clipPath id="[^"]+"><circle cx="128" cy="128" r="114"\/><\/clipPath>/);
    expect(svg).toContain('<g id="face">');
    expect(svg).toContain('<g id="emblem">');
    expect(svg).not.toMatch(/Gradient|<filter|<text|filter=/i);
  });
});

describe("RoundelBadge", () => {
  it("has the three sizes", () => {
    expect(ROUNDEL_PX).toEqual({ sm: 20, md: 32, lg: 48 });
  });

  it("maps game factions and roundel ids to a roundel", () => {
    expect(roundelFor("ussr")).toBe("ussr");
    expect(roundelFor("germany")).toBe("ger");
    expect(roundelFor("france")).toBe("fra");
    expect(roundelFor("neutral_axis")).toBe("neutral_axis");
    expect(roundelFor("nobody")).toBe("neutral_true");
    expect(roundelFor(undefined)).toBe("neutral_true");
  });
});
