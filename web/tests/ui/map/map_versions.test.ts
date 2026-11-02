import { describe, expect, it } from "vitest";
import { editorFromMapJson, editorToMapJson } from "../../../src/ui/map/editor/editorModel";
import {
  parseVersionLibrary,
  removeVersion,
  freshMapName,
  upsertVersion,
  versionNameError,
  type MapVersion,
} from "../../../src/ui/map/editor/mapVersions";

const square = (x: number, y: number, s: number) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

function region(id: string, x: number) {
  return {
    metadata: { region_id: id, name: id, faction: "Neutral", ipc: 1, type: "land", is_sea: false },
    polygon: square(x, 0, 10),
    neighbors: [],
  };
}

describe("map versions", () => {
  const europe = { regions: [region("Territory 1", 0)] };
  const pacific = { regions: [region("Territory 1", 40)] };

  it("picks a free Map N name so a shortcut save does not replace one", () => {
    expect(freshMapName([])).toBe("Map 1");
    expect(freshMapName([{ name: "Europe" }, { name: "Pacific" }])).toBe("Map 3");
    expect(freshMapName([{ name: "Map 1" }])).toBe("Map 2");
  });

  it("rejects a blank name and a name past the limit", () => {
    expect(versionNameError("  ")).toBe("Name the version before saving.");
    expect(versionNameError("a".repeat(81))).toMatch(/80/);
    expect(versionNameError("  Europe  ")).toBeNull();
  });

  it("keeps several versions, newest first, and replaces one when the name matches", () => {
    const first = upsertVersion([], "  Europe  ", europe, 1_000, "a");
    expect(first.replaced).toBe(false);
    expect(first.version).toMatchObject({ id: "a", name: "Europe", savedAt: 1_000 });
    const second = upsertVersion(first.versions, "Pacific", pacific, 2_000, "b");
    expect(second.versions.map((v) => v.name)).toEqual(["Pacific", "Europe"]);
    const replaced = upsertVersion(second.versions, "Europe", pacific, 3_000, "c");
    expect(replaced.replaced).toBe(true);
    expect(replaced.versions.map((v) => v.id)).toEqual(["a", "b"]);
    expect(replaced.versions[0]).toMatchObject({ name: "Europe", savedAt: 3_000, map: pacific });
  });

  it("drops a version by id and ignores a corrupt library", () => {
    const versions: MapVersion[] = [
      { id: "a", name: "Europe", savedAt: 1, map: europe },
      { id: "b", name: "Pacific", savedAt: 2, map: pacific },
    ];
    expect(removeVersion(versions, "a").map((v) => v.id)).toEqual(["b"]);
    expect(parseVersionLibrary("not json")).toEqual([]);
    expect(parseVersionLibrary(JSON.stringify({ versions }))).toEqual([]);
    const parsed = parseVersionLibrary(
      JSON.stringify([
        ...versions,
        { id: "a", name: "Again", savedAt: 3, map: europe },
        { id: "c", name: "Pacific", savedAt: 4, map: europe },
        { id: "", name: "Nope", savedAt: 5, map: europe },
        { id: "d", name: "Broken", savedAt: "yesterday", map: europe },
      ]),
    );
    expect(parsed.map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("loads a saved snapshot back into an editor map", () => {
    const saved = editorToMapJson(
      editorFromMapJson({
        regions: [region("Territory 1", 0), region("Territory 2", 20)],
      }),
      { round: false },
    );
    const stored = parseVersionLibrary(JSON.stringify(upsertVersion([], "Two regions", saved, 10, "a").versions));
    const loaded = editorFromMapJson(stored[0].map);
    expect(loaded.regions.map((r) => r.id)).toEqual(["Territory 1", "Territory 2"]);
  });
});
