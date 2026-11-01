import { describe, expect, it } from "vitest";
import { type GameState, RegionUnitDisplay } from "../../../src/engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

function minimalState(): GameState {
  return new TestStateBuilder()
    .withRegion("west_russia", true, "allies")
    .withRegion("ukraine", true, "axis")
    .withAdjacent("west_russia", "ukraine")
    .buildState();
}

describe("integration/test_region_unit_display", () => {
  it("test_build_display_entries_splits_factions", () => {
    const units = [
      { unit_type_id: "infantry", faction_id: "allies", count: 2 },
      { unit_type_id: "infantry", faction_id: "axis", count: 3 },
    ];
    const entries = RegionUnitDisplay.buildDisplayEntries(units);
    expect(entries.length).toBe(2);
    let alliesCount = 0;
    let axisCount = 0;
    for (const entry of entries) {
      if (entry.faction_id === "allies") {
        alliesCount = Math.trunc(entry.count);
      }
      if (entry.faction_id === "axis") {
        axisCount = Math.trunc(entry.count);
      }
    }
    expect(alliesCount).toBe(2);
    expect(axisCount).toBe(3);
  });

  it("test_owned_region_reads_live_state_after_units_leave", () => {
    const state = minimalState();
    state.current_phase = "combat_move";
    state.current_faction_id = "allies";
    state.setRegionOwner("west_russia", "allies");
    state.region_units["west_russia"] = [{ unit_type_id: "infantry", faction_id: "allies", count: 3 }];
    const before = RegionUnitDisplay.entriesForRegionInspector(state, "west_russia", "allies");
    expect(Math.trunc(before[0].count)).toBe(3);
    state.region_units["west_russia"] = [{ unit_type_id: "infantry", faction_id: "allies", count: 1 }];
    const after = RegionUnitDisplay.entriesForRegionInspector(state, "west_russia", "allies");
    expect(Math.trunc(after[0].count)).toBe(1);
  });

  it("test_combat_pool_detects_attackers_in_hostile_region", () => {
    const state = minimalState();
    state.current_phase = "combat_move";
    state.current_faction_id = "allies";
    state.setRegionOwner("ukraine", "axis");
    state.region_units["ukraine"] = [
      { unit_type_id: "infantry", faction_id: "axis", count: 2 },
      { unit_type_id: "infantry", faction_id: "allies", count: 4 },
    ];
    expect(RegionUnitDisplay.combatPoolUnitCount(state, "ukraine", "allies")).toBe(4);
    expect(RegionUnitDisplay.regionsWithCombatPools(state, "allies").includes("ukraine")).toBe(true);
  });

  it("test_hostile_region_shows_owner_units_not_merged_friendly", () => {
    const state = minimalState();
    state.setRegionOwner("ukraine", "axis");
    state.region_units["ukraine"] = [
      { unit_type_id: "infantry", faction_id: "axis", count: 2 },
      { unit_type_id: "infantry", faction_id: "allies", count: 4 },
    ];
    const entries = RegionUnitDisplay.entriesForRegionInspector(state, "ukraine", "allies");
    expect(entries.length).toBe(1);
    expect(String(entries[0].faction_id)).toBe("axis");
    expect(Math.trunc(entries[0].count)).toBe(2);
  });
});
