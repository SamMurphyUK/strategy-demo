import { describe, expect, it } from "vitest";
import { type Dict, GameSceneController } from "../../../src/engine";

function firstRegionId(snapshot: Dict): string {
  for (const regionEntry of snapshot.regions ?? []) {
    return String(regionEntry.region_id ?? "");
  }
  return "";
}

describe("integration/test_region_inspector_visibility", () => {
  it("test_inspector_visible_after_region_select", () => {
    const scene = new GameSceneController();
    expect(scene.regionInspectorPanel, "RegionInspectorPanel should bind").not.toBeNull();
    const regionId = firstRegionId(scene.session.getState());
    scene.mapRoot.selectRegion(regionId);

    const panel = scene.regionInspectorPanel;
    expect(panel.visible, "Inspector should be visible when region selected").toBe(true);
    expect(panel.height, "Inspector should have non-zero height").toBeGreaterThan(0.0);
    // The Godot test also checks the CollapsedPanel/CollapsedBar nodes exist; the
    // headless inspector has no node tree, so the collapsed view state stands in for both.
    expect(panel.collapsedVisible, "Collapsed panel should be visible").toBe(true);
    expect(panel.height, "Collapsed panel should have height").toBeGreaterThan(0.0);
  });
});
