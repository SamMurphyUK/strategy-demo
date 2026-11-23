import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GameEventType } from "../engine/model/event";
import { deepCopy, type Dict } from "../engine/model/types";
import { advanceGlobalRound, VICTORY_CITIES, globalObjectivePay } from "../engine/rules/optional/global1940Evaluator";
import { GameSessionStub } from "../engine/session/game_session_stub";
import { launchForScenario, type ScenarioId } from "../engine/types/ruleset";
import { plannerSeed } from "./planAITurn";
import { planTurn } from "./planTurn";
import {
  emptyDiagnostics,
  enemyAirIn,
  friendlySeaCount,
  noteBattleOdds,
  noteIncome,
  noteLanding,
  notePurchase,
  noteRound,
  noteTransports,
  noteUnescortedLoss,
  seaHasEscort,
  summarizeDiagnostics,
  type SimDiagnostics,
} from "./simDiagnostics";
import type { AIDifficulty } from "./types/aiTypes";

export interface ScenarioRequest {
  seed: number;
  scenario: ScenarioId;
  /** Bot_v2, the candidate. Bot_v1 stays on Easy. */
  difficulty?: AIDifficulty;
  maxRounds?: number;
}

export interface FactionIndustry {
  spent: number;
  destroyed: number;
}

export interface FightRecord {
  fought: number;
  won: number;
  lost: number;
  draws: number;
}

export interface FactionBattles {
  team: "axis" | "allies" | "";
  offense: FightRecord;
  defense: FightRecord;
}

export interface BattleSides {
  offense: FightRecord;
  defense: FightRecord;
}

export interface RejectionNote {
  faction: string;
  phase: string;
  round: number;
  type: string;
  code: string;
  message: string;
  count: number;
}

export interface ScenarioGame {
  seed: number;
  scenario: ScenarioId;
  winner: string;
  winnerTeam: "axis" | "allies" | "";
  winReason: "" | "victory_cities" | "capital_capture";
  rounds: number;
  turnMs: number[];
  capitalCaptures: number;
  victoryCityCaptures: number;
  io: Record<string, FactionIndustry>;
  battles: Record<string, FactionBattles>;
  combatMoves: Record<string, number>;
  raids: Record<string, number>;
  roundsPlayed: number;
  rejections: number;
  rejectionNotes: RejectionNote[];
  stalled: boolean;
  factionsWithUnits: string[];
  objectivesCompleted: number;
  objectivesPossible: number;
  blocInvasions: number;
  diagnostics: SimDiagnostics;
}

export interface ScenarioReport {
  games: number;
  axisWins: number;
  alliesWins: number;
  draws: number;
  axisWinPercent: number;
  alliesWinPercent: number;
  wins: { victoryCities: number; capitalCaptures: number };
  averageRounds: number;
  averageTurnMs: number;
  ioEfficiency: Record<string, number>;
  ioLedger: Record<string, FactionIndustry>;
  battles: { axis: BattleSides; allies: BattleSides; byFaction: Record<string, BattleSides> };
  combatMoves: Record<string, number>;
  raids: Record<string, number>;
  averageRoundsPlayed: number;
  illegalRejections: number;
  rejectionReasons: RejectionNote[];
  stalledGames: number;
  nationalObjectiveCompletionRate: number;
  neutralBlocInvasionFrequency: number;
  scenario1940: boolean;
  diagnostics: ReturnType<typeof summarizeDiagnostics>;
}

const NAMED_OBJECTIVES = 9;

let cachedGlobalMap: Dict | null = null;

/** Copy of demomap01 with the 1940 powers. The live demo file stays on the five-power roster. */
function global1940Map(): Dict {
  if (cachedGlobalMap == null) {
    const path = join(dirname(fileURLToPath(import.meta.url)), "../../../demomap_global_1940.json");
    cachedGlobalMap = JSON.parse(readFileSync(path, "utf8")) as Dict;
  }
  return deepCopy(cachedGlobalMap);
}

function factionsWithUnits(session: GameSessionStub): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(session.state.region_units)) {
    for (const entry of entries ?? []) {
      const owner = String(entry.faction_id ?? "");
      if (owner !== "" && Math.max(0, Math.trunc(Number(entry.count ?? 0))) > 0) {
        found.add(owner);
      }
    }
  }
  return [...found].sort();
}

function emptyFight(): FightRecord {
  return { fought: 0, won: 0, lost: 0, draws: 0 };
}

function markFight(row: FightRecord, outcome: "won" | "lost" | "draws"): void {
  row.fought += 1;
  row[outcome] += 1;
}

function addFight(into: FightRecord, row: FightRecord): void {
  into.fought += row.fought;
  into.won += row.won;
  into.lost += row.lost;
  into.draws += row.draws;
}

function battleRow(battles: Record<string, FactionBattles>, factionId: string, team: FactionBattles["team"]): FactionBattles | null {
  if (factionId === "") {
    return null;
  }
  const row = battles[factionId] ?? { team, offense: emptyFight(), defense: emptyFight() };
  battles[factionId] = row;
  return row;
}

function recordBattles(
  session: GameSessionStub,
  battles: Record<string, FactionBattles>,
  attacker: string,
  defenders: ReadonlyMap<string, string>,
  events: { type: string; payload: Dict }[],
): void {
  const attackerTeam = teamOf(session, attacker);
  for (const event of events) {
    if (event.type !== "battlefinished") {
      continue;
    }
    const outcome = String(event.payload.result ?? "");
    const defender = defenders.get(String(event.payload.region_id ?? "")) ?? "";
    const defenderTeam = teamOf(session, defender);
    const attack = battleRow(battles, attacker, attackerTeam);
    const defense = battleRow(battles, defender, defenderTeam);
    if (outcome === "attacker_won") {
      if (attack != null) {
        markFight(attack.offense, "won");
      }
      if (defense != null) {
        markFight(defense.defense, "lost");
      }
    } else if (outcome === "defender_won" || outcome === "attacker_retreated") {
      if (attack != null) {
        markFight(attack.offense, "lost");
      }
      if (defense != null) {
        markFight(defense.defense, "won");
      }
    } else {
      if (attack != null) {
        markFight(attack.offense, "draws");
      }
      if (defense != null) {
        markFight(defense.defense, "draws");
      }
    }
  }
}

function teamOf(session: GameSessionStub, factionId: string): "axis" | "allies" | "" {
  const team = session.state.factions[factionId]?.team ?? "";
  return team === "axis" || team === "allies" ? team : "";
}

function unitValue(session: GameSessionStub, factionId: string, friendly: boolean): number {
  let total = 0;
  for (const entries of Object.values(session.state.region_units)) {
    for (const entry of entries ?? []) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || session.state.sameTeam(owner, factionId) !== friendly) {
        continue;
      }
      const cost = Math.max(0, session.state.unit_types[String(entry.unit_type_id ?? "")]?.cost ?? 0);
      total += cost * Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
  }
  return total;
}

function noteIndustry(io: Record<string, FactionIndustry>, factionId: string): FactionIndustry {
  const row = io[factionId] ?? { spent: 0, destroyed: 0 };
  io[factionId] = row;
  return row;
}

function spendOf(session: GameSessionStub, payload: Record<string, unknown>): number {
  let total = 0;
  const purchases: unknown[] = Array.isArray(payload.purchases) ? payload.purchases : [];
  for (const line of purchases) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    const row = line as Record<string, unknown>;
    const id = String(row.unit_type_id ?? "");
    const count = Math.max(0, Math.trunc(Number(row.count ?? 0)));
    total += count * Math.max(0, session.state.unit_types[id]?.cost ?? 0);
  }
  const repairs: unknown[] = Array.isArray(payload.repairs) ? payload.repairs : [];
  for (const line of repairs) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    total += Math.max(0, Math.trunc(Number((line as Record<string, unknown>).tokens ?? 0)));
  }
  const research: unknown[] = Array.isArray(payload.research) ? payload.research : [];
  for (const line of research) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    total += Math.max(0, Math.trunc(Number((line as Record<string, unknown>).count ?? 0))) * 5;
  }
  return total;
}

function winReason(session: GameSessionStub, explicit: string): ScenarioGame["winReason"] {
  const state = session.state;
  if (!state.game_over || state.winner_faction_id === "") {
    return "";
  }
  if (explicit === "victory_cities") {
    return "victory_cities";
  }
  if (explicit === "axis_capitals" || explicit === "all_enemy_capitals_captured" || state.scenarioId !== "SCENARIO_GLOBAL_1940") {
    return "capital_capture";
  }
  const held = ["berlin", "rome", "tokyo"].every((id) => {
    const owner = state.regions[id]?.owner_faction_id ?? "";
    return owner !== "" && state.sameTeam(owner, state.winner_faction_id);
  });
  return held ? "capital_capture" : "victory_cities";
}

function objectives(session: GameSessionStub): { completed: number; possible: number } {
  const state = session.state;
  if (!state.rulesetConfig.nationalObjectivesAndNeutrals) {
    return { completed: 0, possible: 0 };
  }
  let completed = 0;
  for (const factionId of state.turn_order) {
    completed += Math.trunc(globalObjectivePay(state, factionId) / 5);
  }
  for (const goal of state.nationalObjectives) {
    if (goal.holds.length > 0 && goal.holds.every((id) => state.regions[id]?.owner_faction_id === goal.factionId)) {
      completed += 1;
    }
  }
  return { completed, possible: NAMED_OBJECTIVES + state.nationalObjectives.length };
}

function blocOwners(session: GameSessionStub): Map<string, string> {
  const owners = new Map<string, string>();
  for (const bloc of session.state.neutralBlocs) {
    for (const id of bloc.members) {
      owners.set(id, session.state.regions[id]?.owner_faction_id ?? "");
    }
  }
  return owners;
}

/** 1942 uses the live demo map. 1940 uses the copied map whose powers own that land. */
export function playScenarioMatch(request: ScenarioRequest): ScenarioGame {
  const session = new GameSessionStub();
  if (request.scenario === "SCENARIO_GLOBAL_1940") {
    session.initializeFromMap(global1940Map(), request.seed);
  } else {
    session.initializeDemo(request.seed);
  }
  session.state.applyCampaignLaunch(launchForScenario(request.scenario));
  const maxRounds = Math.max(1, request.maxRounds ?? 8);
  const openedAt = session.state.game_round;
  const v2 = request.difficulty ?? "NORMAL";
  const cities = new Set<string>(VICTORY_CITIES);
  const cityOwners = new Map<string, string>();
  const capitals = new Map<string, string>();
  for (const region of Object.values(session.state.regions)) {
    if (region.is_capital) {
      capitals.set(region.id, region.owner_faction_id);
    }
    if (cities.has(region.id)) {
      cityOwners.set(region.id, region.owner_faction_id);
    }
  }
  const blocs = blocOwners(session);
  const ownersAtStart = factionsWithUnits(session);
  const io: Record<string, FactionIndustry> = {};
  const diagnostics = emptyDiagnostics();
  const battles: Record<string, FactionBattles> = {};
  const combatMoves: Record<string, number> = {};
  const raids: Record<string, number> = {};
  const rejectionNotes: RejectionNote[] = [];
  const turnMs: number[] = [];
  let capitalCaptures = 0;
  let victoryCityCaptures = 0;
  let roundsPlayed = 0;
  let rejections = 0;
  let stalled = false;
  let winDetail = "";
  let issued = 0;
  let guard = 0;
  const apply = (playerId: string, type: string, payload: Record<string, unknown>) => {
    issued += 1;
    const defenders = new Map<string, string>();
    if (type === "end_phase" && session.state.current_phase === "combat") {
      for (const battle of session.getPendingBattles(playerId)) {
        defenders.set(battle.region_id, battle.defender_faction_id);
      }
    }
    if (type === "end_turn" && session.state.current_phase === "collect_income") {
      const finished = session.victory.checkVictory().find((event) => event.type === GameEventType.GAME_FINISHED);
      if (finished != null) {
        winDetail = String(finished.payload.reason ?? "");
      }
      if (session.state.game_over) {
        return null;
      }
    }
    const roundBefore = session.state.game_round;
    const phaseBefore = session.state.current_phase;
    const seaBefore = new Map<string, { ships: number; escort: boolean; air: boolean }>();
    if (type === "end_phase" && phaseBefore === "combat") {
      for (const [regionId] of defenders) {
        noteBattleOdds(diagnostics, session.state, playerId, regionId);
        if (session.state.regions[regionId]?.isSeaRegion() === true) {
          seaBefore.set(regionId, {
            ships: friendlySeaCount(session.state, playerId, regionId),
            escort: seaHasEscort(session.state, playerId, regionId),
            air: enemyAirIn(session.state, playerId, regionId),
          });
        }
      }
    }
    const result = session.applyCommand({
      command_id: `sim_${guard}_${issued}`,
      player_id: playerId,
      type,
      payload,
    });
    if (result.result_type !== "ok") {
      rejections += 1;
      if (rejectionNotes.length < 40) {
        rejectionNotes.push({
          faction: playerId,
          phase: phaseBefore,
          round: roundBefore,
          type,
          code: result.error?.code ?? "",
          message: result.error?.message ?? "",
          count: 1,
        });
      }
    } else if (type === "end_turn") {
      noteIncome(diagnostics, session.state, playerId);
      if (session.state.game_round > roundBefore) {
        roundsPlayed += session.state.game_round - roundBefore;
        noteRound(diagnostics, session.state, roundBefore);
        advanceGlobalRound(session.state);
      }
    } else if (type === "purchase_units") {
      notePurchase(diagnostics, session.state, playerId, payload);
    } else if (type === "designate_amphibious") {
      noteLanding(diagnostics, session.state, playerId, String(payload.target_region_id ?? ""));
    } else if (type === "unload_transport") {
      noteLanding(diagnostics, session.state, playerId, String(payload.region_id ?? payload.to_region_id ?? ""));
    } else if (type === "move_units" && phaseBefore === "combat_move") {
      combatMoves[playerId] = (combatMoves[playerId] ?? 0) + 1;
    } else if (type === "strategic_bomb") {
      raids[playerId] = (raids[playerId] ?? 0) + 1;
    }
    if (result.result_type === "ok" && type === "end_phase" && phaseBefore === "combat") {
      for (const [regionId, prior] of seaBefore) {
        if (prior.escort || !prior.air) {
          continue;
        }
        const left = friendlySeaCount(session.state, playerId, regionId);
        noteUnescortedLoss(diagnostics, playerId, Math.max(0, prior.ships - left));
      }
    }
    recordBattles(session, battles, playerId, defenders, result.events);
    return result;
  };
  while (!session.state.game_over && session.state.game_round < openedAt + maxRounds && guard < 400) {
    guard += 1;
    const faction = session.state.current_faction_id;
    const stamp = `${faction}|${session.state.current_phase}|${session.state.turn_number}|${session.state.game_round}`;
    if (session.state.current_phase !== "purchase" && session.state.current_phase !== "collect_income") {
      const skip = apply(faction, "end_phase", {});
      const moved = stamp !== `${faction}|${session.state.current_phase}|${session.state.turn_number}|${session.state.game_round}`;
      if (skip == null || skip.result_type !== "ok" || !moved) {
        stalled = !session.state.game_over;
        break;
      }
      continue;
    }
    const difficulty: AIDifficulty = teamOf(session, faction) === "axis" ? v2 : "EASY";
    const enemyBefore = unitValue(session, faction, false);
    const plan = planTurn(session.state, {
      difficulty,
      seed: plannerSeed(request.seed, session.state.game_round, faction),
    });
    noteTransports(diagnostics, session.state, faction);
    turnMs.push(plan.elapsedMs);
    for (const command of plan.commands) {
      const result = apply(command.player_id, command.type, command.payload);
      if (result == null) {
        break;
      }
      if (result.result_type === "ok" && command.type === "purchase_units") {
        noteIndustry(io, faction).spent += spendOf(session, command.payload);
      }
      if (result.result_type !== "ok" && command.type !== "end_phase" && command.type !== "end_turn") {
        continue;
      }
      if (result.result_type !== "ok") {
        break;
      }
    }
    const destroyed = enemyBefore - unitValue(session, faction, false);
    if (destroyed > 0) {
      noteIndustry(io, faction).destroyed += destroyed;
    }
    for (const [id, prior] of capitals) {
      const owner = session.state.regions[id]?.owner_faction_id ?? "";
      if (prior !== "" && owner !== prior) {
        capitalCaptures += 1;
        capitals.set(id, owner);
      }
    }
    for (const [id, prior] of cityOwners) {
      const owner = session.state.regions[id]?.owner_faction_id ?? "";
      if (owner !== prior) {
        victoryCityCaptures += 1;
        cityOwners.set(id, owner);
      }
    }
    const now = `${session.state.current_faction_id}|${session.state.current_phase}|${session.state.turn_number}|${session.state.game_round}`;
    if (now === stamp && !session.state.game_over) {
      stalled = true;
      break;
    }
  }
  let blocInvasions = 0;
  for (const [id, prior] of blocs) {
    const owner = session.state.regions[id]?.owner_faction_id ?? "";
    if (owner !== prior) {
      blocInvasions += 1;
      const bloc = session.state.neutralBlocs.find((row) => row.members.includes(id));
      if (bloc != null && !diagnostics.neutralBlocsInvaded.some((row) => row.bloc === bloc.id)) {
        diagnostics.neutralBlocsInvaded.push({ bloc: bloc.id, faction: owner });
      }
    }
  }
  const scored = objectives(session);
  const winner = session.state.winner_faction_id || "";
  return {
    seed: request.seed,
    scenario: request.scenario,
    winner,
    winnerTeam: winner === "" ? "" : teamOf(session, winner),
    winReason: winReason(session, winDetail),
    rounds: session.state.game_round,
    turnMs,
    capitalCaptures,
    victoryCityCaptures,
    io,
    battles,
    combatMoves,
    raids,
    roundsPlayed,
    rejections,
    rejectionNotes,
    stalled,
    factionsWithUnits: ownersAtStart,
    objectivesCompleted: scored.completed,
    objectivesPossible: scored.possible,
    blocInvasions,
    diagnostics,
  };
}

export function summarizeScenario(games: readonly ScenarioGame[]): ScenarioReport {
  let axisWins = 0;
  let alliesWins = 0;
  let draws = 0;
  let victoryCities = 0;
  let capitalCaptures = 0;
  let rounds = 0;
  let turnMs = 0;
  let turnCount = 0;
  let objectiveRate = 0;
  let objectiveGames = 0;
  let blocInvasions = 0;
  let illegalRejections = 0;
  let stalledGames = 0;
  let roundsPlayed = 0;
  const spent = new Map<string, number>();
  const destroyed = new Map<string, number>();
  const axisBattles: BattleSides = { offense: emptyFight(), defense: emptyFight() };
  const alliesBattles: BattleSides = { offense: emptyFight(), defense: emptyFight() };
  const byFaction: Record<string, BattleSides> = {};
  const combatMoves: Record<string, number> = {};
  const raids: Record<string, number> = {};
  const rejectionReasons: RejectionNote[] = [];
  for (const game of games) {
    rounds += game.rounds;
    roundsPlayed += game.roundsPlayed;
    blocInvasions += game.blocInvasions;
    illegalRejections += game.rejections;
    if (game.stalled) {
      stalledGames += 1;
    }
    if (game.winnerTeam === "axis") {
      axisWins += 1;
    } else if (game.winnerTeam === "allies") {
      alliesWins += 1;
    } else {
      draws += 1;
    }
    if (game.winReason === "victory_cities") {
      victoryCities += 1;
    } else if (game.winReason === "capital_capture") {
      capitalCaptures += 1;
    }
    for (const ms of game.turnMs) {
      turnMs += ms;
      turnCount += 1;
    }
    if (game.objectivesPossible > 0) {
      objectiveRate += game.objectivesCompleted / game.objectivesPossible;
      objectiveGames += 1;
    }
    for (const [factionId, row] of Object.entries(game.io)) {
      spent.set(factionId, (spent.get(factionId) ?? 0) + row.spent);
      destroyed.set(factionId, (destroyed.get(factionId) ?? 0) + row.destroyed);
    }
    for (const [factionId, row] of Object.entries(game.battles)) {
      if (row.team === "axis" || row.team === "allies") {
        const side = row.team === "axis" ? axisBattles : alliesBattles;
        addFight(side.offense, row.offense);
        addFight(side.defense, row.defense);
      }
      const prior = byFaction[factionId] ?? { offense: emptyFight(), defense: emptyFight() };
      addFight(prior.offense, row.offense);
      addFight(prior.defense, row.defense);
      byFaction[factionId] = prior;
    }
    for (const [factionId, count] of Object.entries(game.combatMoves)) {
      combatMoves[factionId] = (combatMoves[factionId] ?? 0) + count;
    }
    for (const [factionId, count] of Object.entries(game.raids)) {
      raids[factionId] = (raids[factionId] ?? 0) + count;
    }
    for (const note of game.rejectionNotes) {
      const key = `${note.faction}|${note.phase}|${note.type}|${note.code}|${note.message}`;
      const prior = rejectionReasons.find((row) => `${row.faction}|${row.phase}|${row.type}|${row.code}|${row.message}` === key);
      if (prior != null) {
        prior.count += note.count;
        continue;
      }
      rejectionReasons.push({ ...note });
    }
  }
  const ioEfficiency: Record<string, number> = {};
  const ioLedger: Record<string, FactionIndustry> = {};
  for (const [factionId, paid] of spent) {
    const destroyedValue = destroyed.get(factionId) ?? 0;
    ioEfficiency[factionId] = paid > 0 ? destroyedValue / paid : 0;
    ioLedger[factionId] = { spent: paid, destroyed: destroyedValue };
  }
  const gamesPlayed = games.length;
  return {
    games: gamesPlayed,
    axisWins,
    alliesWins,
    draws,
    axisWinPercent: gamesPlayed === 0 ? 0 : (axisWins / gamesPlayed) * 100,
    alliesWinPercent: gamesPlayed === 0 ? 0 : (alliesWins / gamesPlayed) * 100,
    wins: { victoryCities, capitalCaptures },
    averageRounds: gamesPlayed === 0 ? 0 : rounds / gamesPlayed,
    averageRoundsPlayed: gamesPlayed === 0 ? 0 : roundsPlayed / gamesPlayed,
    averageTurnMs: turnCount === 0 ? 0 : turnMs / turnCount,
    ioEfficiency,
    ioLedger,
    battles: { axis: axisBattles, allies: alliesBattles, byFaction },
    combatMoves,
    raids,
    illegalRejections,
    rejectionReasons,
    stalledGames,
    nationalObjectiveCompletionRate: objectiveGames === 0 ? 0 : objectiveRate / objectiveGames,
    neutralBlocInvasionFrequency: gamesPlayed === 0 ? 0 : blocInvasions / gamesPlayed,
    scenario1940: games.some((game) => game.scenario === "SCENARIO_GLOBAL_1940"),
    diagnostics: summarizeDiagnostics(games.map((game) => game.diagnostics)),
  };
}
