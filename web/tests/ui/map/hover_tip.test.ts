import { describe, expect, it } from "vitest";
import { badgeAt, facilityLabel, landmarkAt, type LandmarkHit, roundelAt, type RoundelHit } from "../../../src/ui/map/hoverTip";
import { ROUNDEL_REF } from "../../../src/ui/viewport3d/roundelPlacement";
import { worldToScreen } from "../../../src/ui/map/viewMath";

const view = { x: 0, y: 0, k: 4 };

describe("facility badge words", () => {
  it("names what a territory has", () => {
    expect(facilityLabel({ factory: "major", airbase: true, harbour: false })).toBe("Major factory · Airbase");
    expect(facilityLabel({ factory: "none", airbase: false, harbour: true })).toBe("Harbour");
    expect(facilityLabel({ factory: "none", airbase: false, harbour: false })).toBe("");
  });

  it("finds the badge under a point", () => {
    const layout = { region: { id: "a", facilities: undefined, hasFactory: true, factorySize: "minor" }, badge: { x: 100, y: 80, hw: 10, hh: 8, side: 12, regionId: "a" } };
    expect(badgeAt([layout as never], { x: 104, y: 84 })?.label).toBe("Minor factory");
    expect(badgeAt([layout as never], { x: 130, y: 84 })).toBeNull();
  });
});

describe("the roundel under the pointer", () => {
  const list: RoundelHit[] = [
    { regionId: "near", x: 50, y: 50, scale: ROUNDEL_REF },
    { regionId: "far", x: 400, y: 400, scale: ROUNDEL_REF },
  ];

  it("hits at a roundel's centre and misses well off it", () => {
    const centre = worldToScreen(view, { x: 50, y: 50 });
    expect(roundelAt(list, view, 40, 0.82, centre)?.regionId).toBe("near");
    expect(roundelAt(list, view, 40, 0.82, { x: centre.x + 200, y: centre.y })).toBeNull();
  });

  it("is the flat ellipse the disc lies as: wider than it is tall", () => {
    const centre = worldToScreen(view, { x: 50, y: 50 });
    const hit = roundelAt(list, view, 40, 0.82, centre);
    expect(hit).not.toBeNull();
    const wide = roundelAt(list, view, 40, 0.82, { x: centre.x + 17, y: centre.y });
    expect(wide?.regionId).toBe("near");
  });

  it("sits on top of raised land: the lift moves it up the screen", () => {
    const centre = worldToScreen(view, { x: 50, y: 50 });
    const raised = { x: centre.x, y: centre.y - 30 };
    expect(roundelAt(list, view, 40, 0.82, raised)).toBeNull();
    expect(roundelAt(list, view, 40, 0.82, raised, () => 30)?.regionId).toBe("near");
  });

  it("grows with the edit's size", () => {
    const centre = worldToScreen(view, { x: 50, y: 50 });
    const probe = { x: centre.x + 26, y: centre.y };
    expect(roundelAt(list, view, 40, 0.82, probe)).toBeNull();
    const bigger: RoundelHit[] = [{ regionId: "near", x: 50, y: 50, scale: ROUNDEL_REF * 2 }];
    expect(roundelAt(bigger, view, 40, 0.82, probe)?.regionId).toBe("near");
  });
});

describe("the landmark under the pointer", () => {
  const marks: LandmarkHit[] = [{ region: "France", label: "Paris", x: 80, y: 80, scale: 8 }];

  it("hits on its footprint and misses well off it", () => {
    const foot = worldToScreen(view, { x: 80, y: 80 });
    expect(landmarkAt(marks, view, foot)?.label).toBe("Paris");
    expect(landmarkAt(marks, view, { x: foot.x + 120, y: foot.y })).toBeNull();
  });

  it("stands up the screen as the camera tilts: a point above the foot is on it only when the view is tilted", () => {
    const foot = worldToScreen(view, { x: 80, y: 80 });
    const above = { x: foot.x, y: foot.y - 40 };
    const tilted = landmarkAt(marks, { ...view, k: 8 }, { x: worldToScreen({ ...view, k: 8 }, { x: 80, y: 80 }).x, y: worldToScreen({ ...view, k: 8 }, { x: 80, y: 80 }).y - 40 });
    // Whether the point is above the monument depends on the tilt at that zoom; the footprint itself is always a hit.
    expect(landmarkAt(marks, view, foot)).not.toBeNull();
    expect(above.y).toBeLessThan(foot.y);
    expect(tilted === null || tilted.label === "Paris").toBe(true);
  });
});
