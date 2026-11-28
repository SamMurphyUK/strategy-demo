import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GameSession } from "../../src/engine/session/game_session";
import { launchForScenario } from "../../src/engine/types/ruleset";
import { buildGlobal1940 } from "../../src/ui/map/editor/global1940/buildBoard";
import { GLOBAL_LINKS, GLOBAL_ZONES } from "../../src/ui/map/editor/global1940/catalog";
import { pointInMultiPolygon, polygonsFromSvg } from "../../src/ui/map/regionClip";

const svg = readFileSync(resolve(__dirname, "../../../data/maps/global_vii_land.svg"), "utf8");

function project(lon: number, lat: number, view: { x: number; y: number; w: number; h: number }) {
  return { x: view.x + ((lon + 180) / 360) * view.w, y: view.y + ((90 - lat) / 180) * view.h };
}

describe("the global coast", () => {
  it("bakes a group matrix and keeps the group's fill rule on the path", () => {
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><g transform="matrix(1,0,0,1,10,0)" fill-rule="evenodd"><path d="M0 0 L20 0 L20 20 L0 20 Z M6 6 L14 6 L14 14 L6 14 Z"/></g></svg>`;
    const { polygons } = polygonsFromSvg(sheet);
    expect(pointInMultiPolygon({ x: 12, y: 2 }, polygons)).toBe(true);
    expect(pointInMultiPolygon({ x: 2, y: 2 }, polygons)).toBe(false);
    expect(pointInMultiPolygon({ x: 20, y: 10 }, polygons)).toBe(false);
  });

  it("puts London, Tokyo, and New York on the 1810 by 913 sheet", () => {
    const { viewBox, polygons } = polygonsFromSvg(svg);
    expect(viewBox).toMatchObject({ x: 0, y: 0, w: 1810, h: 913 });
    expect(pointInMultiPolygon(project(-0.1, 51.5, viewBox), polygons)).toBe(true);
    expect(pointInMultiPolygon(project(-74, 40.7, viewBox), polygons)).toBe(true);
    expect(pointInMultiPolygon(project(172, 35.7, viewBox), polygons)).toBe(true);
    expect(pointInMultiPolygon(project(-142, -25, viewBox), polygons)).toBe(true);
  });
});

describe("Global 1940", () => {
  const built = buildGlobal1940(svg);

  it("binds every catalog zone and leaves no orphan in the link graph", () => {
    const ids = new Set(
      (built.map.regions as { metadata: { region_id: string } }[]).map((region) => region.metadata.region_id),
    );
    for (const zone of GLOBAL_ZONES) {
      expect(ids.has(zone.id), zone.id).toBe(true);
    }
    for (const [a, b] of GLOBAL_LINKS) {
      expect(ids.has(a), a).toBe(true);
      expect(ids.has(b), b).toBe(true);
    }
    const degree = new Map<string, number>();
    for (const id of ids) {
      degree.set(id, 0);
    }
    for (const region of built.map.regions as { metadata: { region_id: string }; neighbors: string[] }[]) {
      degree.set(region.metadata.region_id, region.neighbors.length);
    }
    const alone = [...degree.entries()].filter(([, n]) => n === 0).map(([id]) => id);
    expect(alone).toEqual([]);

    const sea = new Set(GLOBAL_ZONES.filter((zone) => zone.sea).map((zone) => zone.id));
    const seen = new Set<string>();
    const start = sea.values().next().value as string;
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const current = queue.pop()!;
      const neighbors = (built.map.regions as { metadata: { region_id: string }; neighbors: string[] }[]).find(
        (region) => region.metadata.region_id === current,
      )!.neighbors;
      for (const next of neighbors) {
        if (!sea.has(next) || seen.has(next)) {
          continue;
        }
        seen.add(next);
        queue.push(next);
      }
    }
    expect([...sea].filter((id) => !seen.has(id))).toEqual([]);
    for (const capital of ["berlin", "london", "moscow", "tokyo", "washington", "rome", "paris"]) {
      expect(built.placeholders, capital).not.toContain(capital);
    }
    expect(built.map.board).toEqual({ x: 0, y: 0, w: 1810, h: 913 });
    expect(built.map.scenario).toBe("SCENARIO_GLOBAL_1940");
  }, 180000);

  it("plays a full turn for every Global 1940 power", () => {
    const session = new GameSession();
    session.initializeFromMap(built.map, 12345);
    session.state.applyCampaignLaunch(launchForScenario("SCENARIO_GLOBAL_1940"));
    const order = [...session.state.turn_order];
    expect(order).toEqual(["germany", "soviet_union", "japan", "united_kingdom", "italy", "china", "united_states"]);
    const phases = ["purchase", "combat_move", "combat", "noncombat_move", "mobilize", "collect_income"];
    for (const factionId of order) {
      expect(session.state.current_faction_id).toBe(factionId);
      const before = session.state.ipc[factionId] ?? 0;
      for (const phase of phases) {
        expect(session.state.current_phase).toBe(phase);
        const result = session.applyCommand({
          command_id: `${factionId}-${phase}`,
          player_id: factionId,
          type: phase === "collect_income" ? "end_turn" : "end_phase",
          payload: {},
        });
        expect(result.result_type, `${factionId} ${phase} ${result.error?.message ?? ""}`).toBe("ok");
      }
      if (factionId === "germany") {
        expect(session.state.ipc.germany).toBeGreaterThan(before);
      }
    }
    expect(session.state.current_faction_id).toBe("germany");
    expect(session.state.game_round).toBe(2);
  }, 180000);
});
