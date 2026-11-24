import { Faction, GameState, Region, Unit } from "../engine";
import { GameSession } from "../engine/session/game_session";
import { planTurn } from "./planTurn";
import type { AIDifficulty } from "./types/aiTypes";

export interface ArenaGame {
  seed: number;
  winner: string;
  turns: number;
  capitalCaptures: number;
  ioSpent: number;
  botV2: string;
  botV1: string;
}

export interface ArenaReport {
  games: number;
  botV2Wins: number;
  botV1Wins: number;
  draws: number;
  averageTurns: number;
  capitalCaptures: number;
  ioSpent: number;
}

const TURN_CAP = 8;

function land(id: string, owner: string): Region {
  const region = Region.fromDict({
    id,
    name: id,
    type: "land",
    ipc_value: 5,
    owner_faction_id: owner,
    is_capital: true,
    has_factory: true,
  });
  return region;
}

/** Two capitals, one border. Bot_v2 is the first power. Bot_v1 is the second. */
export function arenaBoard(): GameState {
  const state = new GameState();
  state.factions.red = Faction.fromDict({ id: "red", name: "Red", color: "#ff0000", starting_ipc: 12, turn_order: 1, team: "axis" });
  state.factions.blue = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000ff", starting_ipc: 9, turn_order: 2, team: "allies" });
  state.ipc.red = 12;
  state.ipc.blue = 9;
  state.turn_order = ["red", "blue"];
  state.current_faction_id = "red";
  state.current_phase = "purchase";
  state.unit_types.infantry = Unit.fromDict({
    id: "infantry",
    name: "Infantry",
    category: "land",
    attack: 1,
    defense: 2,
    movement: 1,
    cost: 3,
  });
  state.unit_types.tank = Unit.fromDict({
    id: "tank",
    name: "Tank",
    category: "land",
    attack: 3,
    defense: 3,
    movement: 2,
    cost: 6,
  });
  state.regions.redland = land("redland", "red");
  state.regions.blueland = land("blueland", "blue");
  state.adjacency.redland = ["blueland"];
  state.adjacency.blueland = ["redland"];
  state.region_units.redland = [{ faction_id: "red", unit_type_id: "infantry", count: 4 }];
  state.region_units.blueland = [{ faction_id: "blue", unit_type_id: "infantry", count: 2 }];
  return state;
}

export function playArenaGame(seed: number, v2: AIDifficulty = "NORMAL", v1: AIDifficulty = "EASY"): ArenaGame {
  const session = new GameSession();
  session.bindArena(arenaBoard(), seed);
  const botV2 = session.state.turn_order[0] ?? "red";
  const botV1 = session.state.turn_order[1] ?? "blue";
  let turns = 0;
  let issued = 0;
  let capitalCaptures = 0;
  let ioSpent = 0;
  const owned = new Map<string, string>();
  for (const region of Object.values(session.state.regions)) {
    if (region.is_capital) {
      owned.set(region.id, region.owner_faction_id);
    }
  }
  while (!session.state.game_over && turns < TURN_CAP) {
    const faction = session.state.current_faction_id;
    if (session.state.current_phase !== "purchase" && session.state.current_phase !== "collect_income") {
      const skip = session.applyCommand({
        command_id: `skip_${turns}_${++issued}`,
        player_id: faction,
        type: "end_phase",
        payload: {},
      });
      if (skip.result_type !== "ok") {
        break;
      }
      continue;
    }
    const difficulty = faction === botV2 ? v2 : v1;
    const before = session.state.ipc[faction] ?? 0;
    const plan = planTurn(session.state, { difficulty, seed: seed + turns * 17 });
    for (const command of plan.commands) {
      const result = session.applyCommand({
        command_id: `arena_${turns}_${++issued}`,
        player_id: command.player_id,
        type: command.type,
        payload: command.payload,
      });
      if (result.result_type !== "ok" && command.type !== "end_phase" && command.type !== "end_turn") {
        continue;
      }
      if (result.result_type !== "ok") {
        break;
      }
    }
    const after = session.state.ipc[faction] ?? before;
    if (after < before) {
      ioSpent += before - after;
    }
    for (const region of Object.values(session.state.regions)) {
      if (!region.is_capital) {
        continue;
      }
      const prior = owned.get(region.id) ?? "";
      if (prior !== "" && region.owner_faction_id !== prior) {
        capitalCaptures += 1;
        owned.set(region.id, region.owner_faction_id);
      }
    }
    turns += 1;
    if (session.state.game_over) {
      break;
    }
  }
  return {
    seed,
    winner: session.state.winner_faction_id || "",
    turns,
    capitalCaptures,
    ioSpent,
    botV2,
    botV1,
  };
}

export function summarizeArena(games: readonly ArenaGame[]): ArenaReport {
  let botV2Wins = 0;
  let botV1Wins = 0;
  let draws = 0;
  let turns = 0;
  let capitalCaptures = 0;
  let ioSpent = 0;
  for (const game of games) {
    turns += game.turns;
    capitalCaptures += game.capitalCaptures;
    ioSpent += game.ioSpent;
    if (game.winner === "") {
      draws += 1;
    } else if (game.winner === game.botV2) {
      botV2Wins += 1;
    } else if (game.winner === game.botV1) {
      botV1Wins += 1;
    } else {
      draws += 1;
    }
  }
  return {
    games: games.length,
    botV2Wins,
    botV1Wins,
    draws,
    averageTurns: games.length === 0 ? 0 : turns / games.length,
    capitalCaptures,
    ioSpent,
  };
}
