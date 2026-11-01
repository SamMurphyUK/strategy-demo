import { describe, expect, it } from "vitest";
import { type Dict, GameSceneController } from "../../../src/engine";

function firstRegionWithUnits(snapshot: Dict): string {
  for (const regionEntry of snapshot.regions ?? []) {
    const units: unknown[] = regionEntry.units ?? [];
    if (units.length === 0) {
      continue;
    }
    return String(regionEntry.region_id ?? "");
  }
  return "";
}

describe("integration/test_region_stack_counts", () => {
  it("test_region_stack_has_rows_for_selected_region", () => {
    const scene = new GameSceneController();
    const regionId = firstRegionWithUnits(scene.session.getState());
    scene.onRegionSelected(regionId);
    expect(scene.regionStackRows).not.toBeNull();
    expect(scene.regionStackRows.length >= 1).toBe(true);
  });
});
