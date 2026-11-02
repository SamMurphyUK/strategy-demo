import { describe, expect, it } from "vitest";
import { battleClothColor } from "../../../src/ui/battle/battleTheme";
import { THEATERS } from "../../../src/ui/battle/combatTypes";
import { FACTION_PALETTE } from "../../../src/ui/theme/factionPalette";

describe("battle cloth", () => {
  it("paints a campaign side with the colour that faction wears on the map", () => {
    expect(battleClothColor("usa", "eastern", "attacker")).toBe(FACTION_PALETTE.US.primary);
    expect(battleClothColor("uk", "eastern", "attacker")).toBe(FACTION_PALETTE.UK.primary);
    expect(battleClothColor("jap", "navy_test", "defender")).toBe(FACTION_PALETTE.JAP.primary);
    expect(battleClothColor("ussr", "normandy", "attacker")).toBe(FACTION_PALETTE.USSR.primary);
    expect(battleClothColor("ger", "pacific", "defender")).toBe(FACTION_PALETTE.GER.primary);
  });

  it("uses the sandbox preset when a battle has no faction id", () => {
    expect(battleClothColor(undefined, "normandy", "attacker")).toBe(FACTION_PALETTE.US.primary);
    expect(battleClothColor(undefined, "normandy", "defender")).toBe(FACTION_PALETTE.GER.primary);
    expect(battleClothColor(undefined, "eastern", "attacker")).toBe(FACTION_PALETTE.USSR.primary);
    expect(battleClothColor(undefined, "north_africa", "attacker")).toBe(FACTION_PALETTE.UK.primary);
    expect(battleClothColor(undefined, "north_africa", "defender")).toBe(FACTION_PALETTE.GER.primary);
    expect(battleClothColor(undefined, "pacific", "defender")).toBe(FACTION_PALETTE.JAP.primary);
  });

  it("keeps every theater preset on that same strip", () => {
    expect(THEATERS.eastern.attackerColor).toBe(FACTION_PALETTE.USSR.primary);
    expect(THEATERS.eastern.defenderColor).toBe(FACTION_PALETTE.GER.primary);
    expect(THEATERS.normandy.attackerColor).toBe(FACTION_PALETTE.US.primary);
    expect(THEATERS.north_africa.attackerColor).toBe(FACTION_PALETTE.UK.primary);
    expect(THEATERS.pacific.attackerColor).toBe(FACTION_PALETTE.US.primary);
    expect(THEATERS.pacific.defenderColor).toBe(FACTION_PALETTE.JAP.primary);
    expect(THEATERS.navy_test.defenderColor).toBe(FACTION_PALETTE.JAP.primary);
    expect(THEATERS.air_strike_test.attackerColor).toBe(FACTION_PALETTE.US.primary);
  });
});
