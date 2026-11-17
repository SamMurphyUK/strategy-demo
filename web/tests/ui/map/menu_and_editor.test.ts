import { describe, expect, it } from "vitest";
import { blankEditorMap } from "../../../src/ui/map/editor/blankMap";
import type { EditorRegion } from "../../../src/ui/map/editor/editorModel";
import { validateEditorMap } from "../../../src/ui/map/editor/validateMap";
import { parseCampaignSave } from "../../../src/ui/map/menu/campaignSave";
import { campaignVolume, setCampaignVolume } from "../../../src/ui/map/campaignMusic";

function region(id: string, polygon: { x: number; y: number }[], sea: boolean, name = id): EditorRegion {
  return {
    id,
    name,
    ipc_value: 0,
    starting_owner: "Neutral",
    is_sea: sea,
    factory: "none",
    capital: false,
    polygon,
    cx: polygon[0]?.x ?? 0,
    cy: polygon[0]?.y ?? 0,
  };
}

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe("blank map and validation", () => {
  it("starts with an empty board of the requested size", () => {
    const map = blankEditorMap(800, 504);
    expect(map.regions).toEqual([]);
    expect(map.meta.board).toEqual({ x: 0, y: 0, w: 800, h: 504 });
    expect(map.meta.starting_units).toEqual([]);
    expect(map.meta.no_landmass).toBe(true);
    expect(blankEditorMap(800, 504, true).meta.no_landmass).toBeUndefined();
  });

  it("flags an untagged polygon and seas that do not touch", () => {
    const map = blankEditorMap(200, 200);
    map.regions = [
      region("land_1", square(0, 0, 10), false),
      region("sea_1", square(0, 20, 10), true, "North Sea"),
      region("sea_2", square(40, 20, 10), true, "South Sea"),
    ];
    const issues = validateEditorMap(map, null);
    expect(issues.some((line) => line.includes("land_1") && line.includes("no territory name"))).toBe(true);
    expect(issues.some((line) => line.includes("do not share a border"))).toBe(true);
  });

  it("accepts two seas that share the cut", () => {
    const map = blankEditorMap(200, 200);
    map.regions = [
      region("sea_1", square(0, 0, 10), true, "North Sea"),
      region("sea_2", square(10, 0, 10), true, "South Sea"),
    ];
    expect(validateEditorMap(map, null)).toEqual([]);
  });
});

describe("campaign saves", () => {
  it("reads a save and rejects a file that is not one", () => {
    const save = parseCampaignSave({
      version: 1,
      savedAt: 10,
      label: "Demo map · round 1",
      mapId: "demo",
      mapName: "Demo map",
      seed: 5,
      map: null,
      snapshot: { game_round: 1, turn_info: { current_faction_id: "ussr", current_phase: "purchase", turn_number: 1 } },
    });
    expect(save?.seed).toBe(5);
    expect(save?.snapshot.game_round).toBe(1);
    expect(parseCampaignSave({ version: 1 })).toBeNull();
  });
});

describe("music volume", () => {
  it("clamps the bed level", () => {
    setCampaignVolume(0.4);
    expect(campaignVolume()).toBe(0.4);
    setCampaignVolume(2);
    expect(campaignVolume()).toBe(1);
    setCampaignVolume(-1);
    expect(campaignVolume()).toBe(0);
    setCampaignVolume(1);
  });
});
