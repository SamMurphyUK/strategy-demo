import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFactionsData,
  buildMapData,
  GLOBAL_1940_FACTION_IDS,
  playableFactionIds,
} from "../../src/content/game_scene_session_builder";
import {
  editorFromMapJson,
  editorToMapJson,
  updateRegion,
} from "../../src/ui/map/editor/editorModel";
import { WORLD_COORD_SPACE } from "../../src/ui/map/map_space";

function regionJson(id: string, meta: Record<string, unknown>, sea = false) {
  return {
    anchors: [{ capacity: 5, type: "unit", x: 50, y: 50 }],
    metadata: { region_id: id, name: id, ipc: sea ? 0 : 3, type: sea ? "sea" : "land", ...meta },
    polygon: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
    neighbors: [],
  };
}

const mapOf = (...regions: unknown[]) => ({ version: 2, coord_space: WORLD_COORD_SPACE, regions });

describe("Global 1940 factions live on the map file", () => {
  it("loads the authored records instead of the classic five", () => {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), "..", "demomap_global_1940.json"), "utf8")) as {
      factions: { id: string; color: string; team: string; turn_order: number }[];
    };
    const ids = raw.factions.map((faction) => faction.id);
    expect(ids).toEqual([...GLOBAL_1940_FACTION_IDS]);
    expect(buildFactionsData(raw).factions).toEqual(raw.factions);
    expect(playableFactionIds(raw)).toEqual([...GLOBAL_1940_FACTION_IDS]);
    expect(raw.factions.find((faction) => faction.id === "united_kingdom")?.name).toBe("United Kingdom (Europe)");
    expect(raw.factions.find((faction) => faction.id === "uk_pacific")?.color).toMatch(/^#/);
  });

  it("keeps the classic five when a map has no factions list", () => {
    expect(playableFactionIds({})).toEqual(["ussr", "ger", "uk", "jap", "usa"]);
    expect((buildFactionsData({}).factions as { id: string }[]).map((faction) => faction.id)).toEqual([
      "ussr",
      "ger",
      "uk",
      "jap",
      "usa",
    ]);
  });
});

describe("editor terrain fields", () => {
  it("round-trips land cover and convoy, and omits them when unset", () => {
    const land = editorFromMapJson(mapOf(regionJson("Forest", { land_cover: "FOREST" })));
    const sea = editorFromMapJson(mapOf(regionJson("Convoy", { type: "sea", is_sea: true, is_convoy_zone: true }, true)));
    const landMeta = (editorToMapJson(land) as { regions: { metadata: Record<string, unknown> }[] }).regions[0].metadata;
    const seaMeta = (editorToMapJson(sea) as { regions: { metadata: Record<string, unknown> }[] }).regions[0].metadata;
    expect(landMeta.land_cover).toBe("FOREST");
    expect(landMeta).not.toHaveProperty("is_convoy_zone");
    expect(seaMeta.is_convoy_zone).toBe(true);
    expect(seaMeta).not.toHaveProperty("land_cover");

    const plain = editorToMapJson(editorFromMapJson(mapOf(regionJson("Plain", {})))) as {
      regions: { metadata: Record<string, unknown> }[];
    };
    expect(plain.regions[0].metadata).not.toHaveProperty("land_cover");
    expect(plain.regions[0].metadata).not.toHaveProperty("is_convoy_zone");
  });

  it("feeds land cover and convoy into the engine map dict", () => {
    const json = editorToMapJson(
      updateRegion(editorFromMapJson(mapOf(regionJson("City", {}))), "City", { land_cover: "URBAN" }),
    );
    const seaJson = editorToMapJson(
      updateRegion(editorFromMapJson(mapOf(regionJson("Lane", { type: "sea", is_sea: true }, true))), "Lane", {
        is_convoy_zone: true,
      }),
    );
    expect(buildMapData(json).regions[0]).toMatchObject({ id: "City", land_cover: "URBAN" });
    expect(buildMapData(seaJson).regions[0]).toMatchObject({ id: "Lane", is_convoy_zone: true });
  });
});
