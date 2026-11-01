// _load_units / _load_factions / _load_map / _load_setup, shared by game_session.gd and GameSessionStub.gd.
import { Faction } from "../model/faction";
import type { GameState } from "../model/game_state";
import { Region } from "../model/region";
import type { Dict } from "../model/types";
import { Unit } from "../model/unit";

export function loadUnits(state: GameState, data: Dict): void {
  let list: Dict[];
  if ("units" in data) {
    list = data.units;
  } else if ("unit_types" in data) {
    list = data.unit_types;
  } else {
    return;
  }
  for (const ud of list) {
    const u = Unit.fromDict(ud);
    state.unit_types[u.id] = u;
  }
}

export function loadFactions(state: GameState, data: Dict): void {
  for (const fd of data.factions as Dict[]) {
    const f = Faction.fromDict(fd);
    state.factions[f.id] = f;
    state.ipc[f.id] = f.starting_ipc;
    state.pending_purchases[f.id] = [];
  }
}

export function loadMap(state: GameState, data: Dict): void {
  for (const rd of data.regions as Dict[]) {
    const r = Region.fromDict(rd);
    state.regions[r.id] = r;
    state.region_units[r.id] = [];
  }
  for (const edge of data.adjacency as Dict[]) {
    const f = String(edge.from ?? "");
    const t = String(edge.to ?? "");
    if (f === "" || t === "") {
      continue;
    }
    if (!(f in state.adjacency)) {
      state.adjacency[f] = [];
    }
    if (!(t in state.adjacency)) {
      state.adjacency[t] = [];
    }
    if (!state.adjacency[f].includes(t)) {
      state.adjacency[f].push(t);
    }
    if (!state.adjacency[t].includes(f)) {
      state.adjacency[t].push(f);
    }
  }
}

export function loadSetup(state: GameState, data: Dict): void {
  state.turn_order = data.turn_order;
  for (const entry of data.starting_units as Dict[]) {
    const rid: string = entry.region_id;
    const fid: string = entry.faction_id;
    const utid: string = entry.unit_type_id;
    const cnt: number = Math.trunc(Number(entry.count));
    const ut = state.unit_types[utid];
    if (Unit.isContainerUnit(ut)) {
      for (let i = 0; i < cnt; i++) {
        const iid = state.generateInstanceId(utid, fid);
        state.transport_instances[iid] = { instance_id: iid, unit_type_id: utid, cargo: [], region_id: rid };
        state.region_units[rid].push({ faction_id: fid, unit_type_id: utid, instance_id: iid, count: 1 });
      }
    } else {
      let found = false;
      for (const u of state.region_units[rid]) {
        if (u.faction_id === fid && u.unit_type_id === utid && !("instance_id" in u)) {
          u.count += cnt;
          found = true;
          break;
        }
      }
      if (!found) {
        state.region_units[rid].push({ faction_id: fid, unit_type_id: utid, count: cnt });
      }
    }
  }
}
