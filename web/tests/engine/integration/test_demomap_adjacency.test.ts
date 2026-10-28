import { describe, expect, it } from "vitest";
import { GameSessionFactory, SessionMode } from "../../../src/engine";

describe("integration/test_demomap_adjacency", () => {
  it("test_burma_has_polygon_adjacent_neighbors", () => {
    const session = GameSessionFactory.create(SessionMode.STUB);
    const neighbors = session.state.getAdjacentRegions("Burma");
    expect(neighbors.length, "Burma should border at least one region on demomap01").toBeGreaterThan(0);
    expect(neighbors.includes("India") || neighbors.includes("Sea Zone 01")).toBe(true);
  });
});
