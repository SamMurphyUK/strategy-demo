import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../../src/ui/map/geometry";
import {
  APPROACH_GAP,
  ATTACK_WIDTH,
  arrowPolygons,
  battleIconRadius,
  clusterApproachAngles,
  MAX_MASTER_ARROWS,
  planOperationalArrows,
  spineThrough,
  tributaryJoinT,
  type OperationalOrder,
} from "../../../src/ui/map/operationalArrows";

function clusterDegrees(degrees: number[], gap = APPROACH_GAP, maxClusters = MAX_MASTER_ARROWS) {
  return clusterApproachAngles(
    degrees.map((angle, item) => ({ angle: (angle * Math.PI) / 180, item })),
    gap,
    maxClusters,
  );
}

function idsOf(cluster: { members: { item: number }[] }): number[] {
  return cluster.members.map((member) => member.item).sort((a, b) => a - b);
}

describe("approach clustering", () => {
  it("merges neighbours under 95 degrees and keeps flanks and opposites apart", () => {
    expect(clusterDegrees([0, 40])).toHaveLength(1);
    expect(clusterDegrees([0, 94])).toHaveLength(1);
    expect(idsOf(clusterDegrees([0, 94])[0])).toEqual([0, 1]);

    expect(clusterDegrees([0, 96])).toHaveLength(2);
    expect(clusterDegrees([0, 120])).toHaveLength(2);
    expect(clusterDegrees([0, 180])).toHaveLength(2);

    const wrapped = clusterDegrees([350, 10, 180]);
    expect(wrapped).toHaveLength(2);
    expect(wrapped.map(idsOf)).toContainEqual([0, 1]);

    const three = clusterDegrees([0, 20, 130, 250]);
    expect(three).toHaveLength(3);
    expect(three.map(idsOf)).toContainEqual([0, 1]);

    const pairs = clusterDegrees([0, 15, 120, 125, 240, 250]);
    expect(pairs.map(idsOf).sort((a, b) => a[0] - b[0])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("never keeps a fourth arrow when four gaps would otherwise survive", () => {
    const capped = clusterApproachAngles(
      [0, 90, 180, 270].map((angle, item) => ({ angle: (angle * Math.PI) / 180, item })),
      (80 * Math.PI) / 180,
      3,
    );
    expect(capped).toHaveLength(3);
    expect(capped.some((cluster) => idsOf(cluster).length === 2)).toBe(true);
  });

  it("aims a multi-hop order along its final border and bends the trunk through that region", () => {
    const anchors = new Map<string, Vec2>([
      ["a", { x: -100, y: 0 }],
      ["b", { x: 100, y: 0 }],
      ["t", { x: 0, y: 0 }],
    ]);
    const orders: OperationalOrder[] = [
      { id: "long", fromRegionId: "a", toRegionId: "t", path: [0, 1, 2], faction: "ger" },
      { id: "direct", fromRegionId: "b", toRegionId: "t", path: [1, 2], faction: "ger" },
    ];
    const plans = planOperationalArrows(orders, ["a", "b", "t"], anchors);
    expect(plans).toHaveLength(1);
    expect(plans[0].originIds.sort()).toEqual(["b", "b"]);

    expect(plans[0].spine.project({ x: -100, y: 0 }).distance).toBeLessThan(1);
    expect(plans[0].spine.project({ x: 100, y: 0 }).distance).toBeLessThan(1);
  });
});

describe("tributary joins", () => {
  it("clamps the junction to the early and middle shaft", () => {
    const spine = spineThrough([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(tributaryJoinT(spine, { x: 2, y: 30 })).toBeCloseTo(0.2, 5);
    expect(tributaryJoinT(spine, { x: -30, y: 10 })).toBeCloseTo(0.2, 5);
    expect(tributaryJoinT(spine, { x: 98, y: -25 })).toBeCloseTo(0.65, 5);
    expect(tributaryJoinT(spine, { x: 140, y: 8 })).toBeCloseTo(0.65, 5);
    expect(tributaryJoinT(spine, { x: 40, y: 12 })).toBeCloseTo(0.4, 5);

    const anchors = new Map<string, Vec2>([
      ["p", { x: -200, y: 0 }],
      ["tail", { x: -210 * Math.cos(Math.PI / 12), y: 210 * Math.sin(Math.PI / 12) }],
      ["head", { x: -24 * Math.cos(Math.PI / 12), y: -24 * Math.sin(Math.PI / 12) }],
      ["t", { x: 0, y: 0 }],
    ]);
    const plans = planOperationalArrows(
      [
        { id: "trunk", fromRegionId: "p", toRegionId: "t", path: [0, 0, 3], faction: "ger" },
        { id: "tail", fromRegionId: "tail", toRegionId: "t", path: [1, 3], faction: "ger" },
        { id: "head", fromRegionId: "head", toRegionId: "t", path: [2, 3], faction: "ger" },
      ],
      ["p", "tail", "head", "t"],
      anchors,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].neckScale).toBeCloseTo(1.24, 5);
    expect(plans[0].tributaries.map((tributary) => tributary.sourceId).sort()).toEqual(["head", "tail"]);
    const bySource = new Map(plans[0].tributaries.map((tributary) => [tributary.sourceId, tributary]));
    expect(bySource.get("tail")?.joinT).toBeCloseTo(0.2, 5);
    expect(bySource.get("head")?.joinT).toBeCloseTo(0.65, 5);
    for (const tributary of plans[0].tributaries) {
      expect(tributary.joinT).toBeGreaterThanOrEqual(0.2);
      expect(tributary.joinT).toBeLessThanOrEqual(0.65);
      const dx = tributary.c2.x - tributary.join.x;
      const dy = tributary.c2.y - tributary.join.y;
      const cross = dx * tributary.tangent.y - dy * tributary.tangent.x;
      const along = dx * tributary.tangent.x + dy * tributary.tangent.y;
      expect(Math.abs(cross)).toBeLessThan(1e-6);
      expect(along).toBeLessThan(0);
    }
  });
});

describe("battle icon and attacking arrows", () => {
  it("shrinks the battle icon as the map zooms out", () => {
    expect(battleIconRadius(0.05)).toBeLessThan(battleIconRadius(1.5));
    expect(battleIconRadius(1.5)).toBeLessThan(battleIconRadius(4));
    expect(battleIconRadius(4)).toBeCloseTo(Math.hypot(22, 11), 5);
  });

  it("draws an attacking arrow a third thinner", () => {
    const anchors = new Map<string, Vec2>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 200, y: 0 }],
    ]);
    const order: OperationalOrder = { id: "1", fromRegionId: "a", toRegionId: "b", path: [0, 1], faction: "ger" };
    const [arrow] = planOperationalArrows([order], ["a", "b"], anchors);
    const view = { k: 1, x: 0, y: 0 };
    const span = (scale: number) => {
      const poly = arrowPolygons(arrow, view, false, scale)[0];
      return Math.max(...poly.map((point) => Math.abs(point.y)));
    };
    expect(span(ATTACK_WIDTH)).toBeCloseTo(span(1) * ATTACK_WIDTH, 5);
  });
});
