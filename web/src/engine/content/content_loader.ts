import { Faction } from "../model/faction";
import { GameState } from "../model/game_state";
import { Region } from "../model/region";
import { type Dict, deepCopy } from "../model/types";
import type { Unit } from "../model/unit";
import { type JsonLoader, loadJson } from "./res";
import { UnitDatabase } from "./unit_database";

export class ContentLoader {
  readonly unitDb: UnitDatabase;

  constructor(private readonly load: JsonLoader = loadJson) {
    this.unitDb = new UnitDatabase(load);
  }

  loadScenario(path: string): GameState | null {
    const scenario = this.load(path);
    if (Object.keys(scenario).length === 0) {
      return null;
    }

    const state = new GameState();

    // content_loader.gd copies the raw unit dictionaries, not Unit instances.
    this.unitDb.loadFromJson(scenario.units_file);
    state.unit_types = deepCopy(this.unitDb.units) as unknown as Record<string, Unit>;

    const factionsData = this.load(scenario.factions_file);
    for (const f of factionsData.factions as Dict[]) {
      const faction = Faction.fromDict(f);
      const fid = String(f.id);
      state.factions[fid] = faction;
      state.ipc[fid] = Math.trunc(Number(f.starting_ipc));
    }

    const regionsData = this.load(scenario.regions_file);
    for (const r of regionsData.regions as Dict[]) {
      const region = Region.fromDict(r);
      const rid = String(r.id);
      state.regions[rid] = region;
      state.adjacency[rid] = r.adjacent;
    }

    state.region_units = {};
    for (const regionId of Object.keys(state.regions)) {
      state.region_units[regionId] = [];
    }

    const suData = this.load(scenario.starting_units_file);
    for (const entry of suData.starting_units as Dict[]) {
      const regionId = String(entry.region_id);
      if (!(regionId in state.region_units)) {
        continue;
      }
      state.region_units[regionId].push({
        faction_id: entry.faction_id,
        unit_type_id: entry.unit_type_id,
        count: Math.trunc(Number(entry.count)),
      });
    }

    state.rules = scenario.rules;
    state.current_faction_id = this.getFirstFactionInTurnOrder(state);
    state.current_phase = scenario.starting_phase ?? "purchase";
    state.turn_number = 1;
    state.game_round = scenario.starting_round ?? 1;
    state.game_over = false;
    state.winner_faction_id = "";

    return state;
  }

  private getFirstFactionInTurnOrder(state: GameState): string {
    let bestId = "";
    let bestOrder = 9999;
    for (const fId of Object.keys(state.factions)) {
      const f = state.factions[fId];
      if (f.turn_order == null) {
        continue;
      }
      if (f.turn_order < bestOrder) {
        bestOrder = f.turn_order;
        bestId = fId;
      }
    }
    return bestId;
  }
}
