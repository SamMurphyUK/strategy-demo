import { describe, expect, it } from "vitest";
import { GameSessionFactory, MovementValidator, type Ruleset, SessionMode } from "../../../src/engine";

describe("integration/test_demomap_adjacency", () => {
  it("test_germany_borders_france", () => {
    const session = GameSessionFactory.create(SessionMode.STUB);
    const neighbors = session.state.getAdjacentRegions("Germany");
    expect(neighbors.length, "Germany should border at least one region on demomap01").toBeGreaterThan(0);
    expect(neighbors).toContain("France");
  });

  it("links the world both ways, including coasts and the canals", () => {
    const session = GameSessionFactory.create(SessionMode.STUB);
    const state = session.state;

    const ids = Object.keys(state.regions);
    expect(ids).toHaveLength(52);
    for (const id of ids) {
      for (const neighbor of state.getAdjacentRegions(id)) {
        expect(state.getAdjacentRegions(String(neighbor)), `${neighbor} should link back to ${id}`).toContain(id);
      }
    }

    const seaIds = ids.filter((id) => state.regions[id].isSeaRegion());
    expect(seaIds.length).toBeGreaterThanOrEqual(15);
    const seen = new Set<string>();
    const queue = [seaIds[0]];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      for (const neighbor of state.getAdjacentRegions(id)) {
        if (state.regions[String(neighbor)]?.isSeaRegion()) {
          queue.push(String(neighbor));
        }
      }
    }
    expect(seen.size, "sea zones should be one connected web").toBe(seaIds.length);

    expect(state.getAdjacentRegions("Moscow")).toContain("Eastern Europe");
    expect(state.getAdjacentRegions("United Kingdom")).toContain("English Channel");
    expect(state.getAdjacentRegions("Japan")).toContain("Sea of Japan");
    expect(state.getAdjacentRegions("Eastern United States")).toContain("East US Coast");
    expect(state.getAdjacentRegions("Western United States")).toContain("West US Coast");
    expect(state.getAdjacentRegions("India")).toContain("Indian Ocean");
    expect(state.getAdjacentRegions("Australia")).toContain("East Indies Sea");
    expect(state.getAdjacentRegions("Scandinavia")).toContain("North Sea");
    expect(state.getAdjacentRegions("West US Coast")).toContain("Central Pacific");
    expect(state.getAdjacentRegions("Caribbean")).toContain("West US Coast");
    expect(state.getAdjacentRegions("Mediterranean")).toContain("Indian Ocean");

    expect(state.turn_order).toEqual(["ussr", "ger", "uk", "jap", "usa"]);
    expect(state.regions.Germany.is_capital && state.regions.Germany.has_factory).toBe(true);
    expect(state.regions.Moscow.is_capital && state.regions.Moscow.has_factory).toBe(true);
    expect(state.regions["United Kingdom"].is_capital).toBe(true);
    expect(state.regions.Japan.is_capital).toBe(true);
    expect(state.regions["Eastern United States"].is_capital).toBe(true);
    expect(state.regions.India.has_factory).toBe(true);
    expect(state.regions["Western United States"].has_factory).toBe(true);
    expect(state.regions.Spain.owner_faction_id).toBe("");
    expect(state.regions["South America"].owner_faction_id).toBe("");

    state.current_phase = "combat_move";
    const rules = session.ruleset as Ruleset;
    const validator = new MovementValidator();
    expect(validator.getLegalDestinationsForStack("Moscow", "infantry", "ussr", state, rules)).toContain("Eastern Europe");
    expect(validator.getLegalDestinationsForStack("North Sea", "battleship", "ger", state, rules)).toContain("English Channel");
    expect(validator.getLegalDestinationsForStack("East US Coast", "battleship", "usa", state, rules).length).toBeGreaterThan(0);
    expect(session.getLegalLoadDestinations("United Kingdom", "infantry", "uk")).toContain("English Channel");
    expect(session.getLegalLoadDestinations("Scandinavia", "infantry", "ger")).toContain("North Sea");
    expect(session.getLegalLoadDestinations("Japan", "infantry", "jap")).toContain("Sea of Japan");
  });
});
