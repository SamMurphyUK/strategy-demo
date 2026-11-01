import { describe, expect, it } from "vitest";
import { prepareSavedMap, territoryIncome } from "../../../src/content/game_scene_session_builder";
import { GameSessionStub } from "../../../src/engine/session/game_session_stub";
import type { Dict } from "../../../src/engine/model/types";
import type { MapVersion } from "../../../src/ui/map/editor/mapVersions";
import { choiceForStoredId, demoPlayChoice, playChoiceFromVersion, readStoredPlayId } from "../../../src/ui/map/session/play_map";

function land(id: string, faction: string, ipc: number, neighbors: string[] = []): Dict {
  return {
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    neighbors,
    metadata: { region_id: id, name: id, faction, ipc, type: "land", victory: id === "Germany", factory: true },
  };
}

function savedBoard(): Dict {
  return {
    version: 2,
    coord_space: "svg",
    factions: [
      { id: "ger", name: "Germany", color: "#857577", team: "axis", turn_order: 2, starting_ipc: 99 },
      { id: "uk", name: "United Kingdom", color: "#9E7F55", team: "allies", turn_order: 3, starting_ipc: 99 },
      { id: "ussr", name: "Soviet Union", color: "#9A4E48", team: "allies", turn_order: 1, starting_ipc: 99 },
      { id: "jap", name: "Japan", color: "#B77958", team: "axis", turn_order: 4, starting_ipc: 99 },
      { id: "usa", name: "United States", color: "#72745C", team: "allies", turn_order: 5, starting_ipc: 99 },
    ],
    regions: [
      land("Germany", "GER", 10, ["France"]),
      land("France", "GER", 4, ["Germany"]),
      land("Britain", "UK", 8),
      {
        polygon: [
          [0, 20],
          [10, 20],
          [10, 30],
        ],
        neighbors: [],
        metadata: { region_id: "Baltic", name: "Baltic", faction: "GER", ipc: 6, type: "sea" },
      },
    ],
    starting_units: [
      { region_id: "Germany", faction_id: "ger", unit_type_id: "infantry", count: 3 },
      { region_id: "Gone", faction_id: "ger", unit_type_id: "tank", count: 1 },
    ],
  };
}

describe("playing a saved map", () => {
  it("sets opening treasury from owned land and drops a setup line for a missing region", () => {
    const source = savedBoard();
    const ready = prepareSavedMap(source);
    expect(territoryIncome(source)).toEqual({ ger: 14, uk: 8 });
    expect(ready.factions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ger", starting_ipc: 14 }),
        expect.objectContaining({ id: "uk", starting_ipc: 8 }),
        expect.objectContaining({ id: "usa", starting_ipc: 0 }),
      ]),
    );
    expect(source.factions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ger", starting_ipc: 99 })]));
    expect(ready.starting_units).toEqual([
      { region_id: "Germany", faction_id: "ger", unit_type_id: "infantry", count: 3 },
    ]);

    const session = new GameSessionStub();
    session.initializeFromMap(ready, 7);
    expect(session.state.getFactionIpc("ger")).toBe(14);
    expect(session.state.getFactionIpc("uk")).toBe(8);
    expect(session.state.regions.Germany.is_capital).toBe(true);
    expect(session.state.region_units.Germany).toEqual([
      expect.objectContaining({ faction_id: "ger", unit_type_id: "infantry", count: 3 }),
    ]);
    expect(session.state.adjacency.Germany).toContain("France");
  });

  it("resolves a saved version, and an unknown id stays on the demo map", () => {
    const version: MapVersion = { id: "pop", name: "WorldMap_Populated", savedAt: 1, map: savedBoard() };
    const choice = playChoiceFromVersion(version);
    expect(choice).toMatchObject({ id: "pop", name: "WorldMap_Populated" });
    expect(choice.map?.factions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ger", starting_ipc: 14 })]));
    expect(choiceForStoredId([version], "missing")).toEqual(demoPlayChoice());
    expect(choiceForStoredId([version], "pop").name).toBe("WorldMap_Populated");
    expect(readStoredPlayId(null)).toBe("demo");
    expect(readStoredPlayId({ getItem: () => "  ", setItem: () => undefined })).toBe("demo");
    expect(readStoredPlayId({ getItem: () => "pop", setItem: () => undefined })).toBe("pop");
  });
});
