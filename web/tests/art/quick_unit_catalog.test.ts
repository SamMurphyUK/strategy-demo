import { describe, expect, it } from "vitest";
import {
  auditQuickCoverage,
  formatQuickAuditMarkdown,
  resolveQuickClip,
} from "../../src/art/quickUnitCatalog";

describe("quick unit catalog", () => {
  it("resolves every faction's tank _QUICK clip and falls back when a type has none", () => {
    expect(resolveQuickClip("GER", "tank")?.unitId).toBe("ger_tank_seed1_QUICK");
    expect(resolveQuickClip("USSR", "tank")?.fallback).toBe(false);
    expect(resolveQuickClip("UK", "tank")?.width).toBe(176);
    expect(resolveQuickClip("US", "tank")?.height).toBe(96);
    expect(resolveQuickClip("JAP", "tank")?.resolution).toBe(4);

    expect(resolveQuickClip("GER", "fighter")).toBeNull();
    expect(resolveQuickClip("GER", "infantry")).toBeNull();
    expect(resolveQuickClip("GER", "carrier")).toBeNull();
  });

  it("audits every faction × roster type without inventing missing art", () => {
    const rows = auditQuickCoverage();
    expect(rows.length).toBe(5 * (12 + 2));
    expect(rows.filter((row) => row.unitTypeId === "tank" && row.quick === "yes")).toHaveLength(5);
    expect(rows.filter((row) => row.unitTypeId === "fighter" && row.quick === "missing").length).toBe(5);
    expect(rows.some((row) => row.unitTypeId === "infantry" && row.notes.includes("_v2"))).toBe(true);

    const markdown = formatQuickAuditMarkdown(rows);
    expect(markdown.split("\n")[0]).toContain("| Faction |");
    expect(markdown).toContain("| GER | tank | yes |");
    expect(markdown).toContain("| GER | fighter | missing |");
  });
});
