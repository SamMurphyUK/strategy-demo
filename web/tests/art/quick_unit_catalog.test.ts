import { describe, expect, it } from "vitest";
import {
  auditQuickCoverage,
  formatQuickAuditMarkdown,
  resolveQuickClip,
} from "../../src/art/quickUnitCatalog";

describe("quick unit catalog", () => {
  it("resolves every shipped vector: tanks, infantry v2, and the German fighter", () => {
    expect(resolveQuickClip("GER", "tank")?.unitId).toBe("ger_tank_seed1_QUICK");
    expect(resolveQuickClip("USSR", "tank")?.fallback).toBe(false);
    expect(resolveQuickClip("UK", "tank")?.width).toBe(176);
    expect(resolveQuickClip("US", "tank")?.height).toBe(96);
    expect(resolveQuickClip("JAP", "tank")?.resolution).toBe(4);

    expect(resolveQuickClip("JAP", "infantry")?.unitId).toBe("jap_infantry_v2");
    expect(resolveQuickClip("JAP", "infantry")?.fallback).toBe(false);
    expect(resolveQuickClip("GER", "infantry")?.unitId).toBe("jap_infantry_v2");
    expect(resolveQuickClip("GER", "infantry")?.fallback).toBe(true);

    expect(resolveQuickClip("GER", "fighter")?.unitId).toBe("ger_fighter_seed1_25D");
    expect(resolveQuickClip("GER", "fighter")?.fallback).toBe(false);
    expect(resolveQuickClip("US", "fighter")?.unitId).toBe("us_fighter_seed1.stamped");
    expect(resolveQuickClip("US", "fighter")?.fallback).toBe(false);
    expect(resolveQuickClip("GER", "tactical_bomber")?.unitId).toBe("ger_tac_bomber_seed1.stamped");
    expect(resolveQuickClip("GER", "strategic_bomber")?.unitId).toBe("ger_bomber_seed1.stamped");
    expect(resolveQuickClip("GER", "artillery")?.unitId).toBe("ger_artillery_seed1.polished");
    expect(resolveQuickClip("GER", "mech_infantry")?.file).toContain("ger_mech_infantry_seed1");
    expect(resolveQuickClip("UK", "aaa")?.unitId).toContain("uk_aaa_seed1");
    expect(resolveQuickClip("JAP", "battleship")?.unitId).toContain("jap_battleship_seed1");
    expect(resolveQuickClip("GER", "carrier")?.unitId).toContain("ger_carrier_seed1");
  });

  it("audits every faction × roster type without inventing missing art", () => {
    const rows = auditQuickCoverage();
    expect(rows.length).toBe(5 * (12 + 2));
    expect(rows.filter((row) => row.unitTypeId === "tank" && row.quick === "yes")).toHaveLength(5);
    expect(rows.filter((row) => row.unitTypeId === "infantry" && row.quick === "yes")).toHaveLength(1);
    expect(rows.filter((row) => row.unitTypeId === "infantry" && row.quick === "fallback")).toHaveLength(4);
    expect(rows.filter((row) => row.unitTypeId === "fighter" && row.quick === "yes")).toHaveLength(5);
    expect(rows.filter((row) => row.unitTypeId === "fighter" && row.quick === "fallback")).toHaveLength(0);
    expect(rows.filter((row) => row.unitTypeId === "artillery" && row.quick === "yes")).toHaveLength(5);
    expect(rows.filter((row) => row.unitTypeId === "carrier" && row.quick === "yes")).toHaveLength(5);

    const markdown = formatQuickAuditMarkdown(rows);
    expect(markdown.split("\n")[0]).toContain("| Faction |");
    expect(markdown).toContain("| GER | tank | yes |");
    expect(markdown).toContain("| GER | fighter | yes |");
    expect(markdown).toContain("| JAP | infantry | yes |");
  });
});
