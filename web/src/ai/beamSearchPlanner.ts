import { canReturnAfter, isAirUnit } from "../engine/air/air_fuel";
import type { GameState } from "../engine/model/game_state";
import { VICTORY_CITIES, globalObjectivePay } from "../engine/rules/optional/global1940Evaluator";
import { objectiveBonus } from "../engine/rules/optional/objectives";
import { assaultError } from "../engine/transport/cargo_rules";
import { simulateBattleOdds } from "./battleOddsSim";
import type { AttackPackage, PackageStack } from "./combatMoveGen";
import type { AIDifficultyProfile, CommanderWeights } from "./types/aiTypes";

export interface TurnPackage {
  attacks: AttackPackage[];
  score: number;
}

interface StackSnap {
  faction: string;
  unitType: string;
  count: number;
  cost: number;
  attack: number;
  defense: number;
}

/** Shallow territory and unit maps. Cloning copies the maps, not the rules engine. */
export interface FastBoardSnapshot {
  owners: Map<string, string>;
  output: Map<string, number>;
  capital: Set<string>;
  stacks: Map<string, StackSnap[]>;
}

interface BeamNode {
  attacks: AttackPackage[];
  used: Map<string, number>;
  board: FastBoardSnapshot;
  score: number;
}

function keyOf(line: PackageStack): string {
  return `${line.from}|${line.unitType}`;
}

function available(state: GameState, factionId: string, line: PackageStack): number {
  return state.movableStackCount(factionId, line.from, line.unitType);
}

function overlaps(state: GameState, factionId: string, used: ReadonlyMap<string, number>, next: AttackPackage): boolean {
  const need = new Map<string, number>();
  for (const line of next.stacks) {
    need.set(keyOf(line), (need.get(keyOf(line)) ?? 0) + line.count);
  }
  for (const [key, count] of need) {
    const [from, unitType] = key.split("|");
    const have = available(state, factionId, { from, unitType, count });
    if ((used.get(key) ?? 0) + count > have) {
      return true;
    }
  }
  return false;
}

export function snapshotBoard(state: GameState): FastBoardSnapshot {
  const owners = new Map<string, string>();
  const output = new Map<string, number>();
  const capital = new Set<string>();
  const stacks = new Map<string, StackSnap[]>();
  for (const region of Object.values(state.regions)) {
    owners.set(region.id, region.owner_faction_id);
    output.set(region.id, region.base_output > 0 ? region.base_output : region.ipc_value);
    if (region.is_capital) {
      capital.add(region.id);
    }
  }
  for (const [regionId, entries] of Object.entries(state.region_units)) {
    const lines: StackSnap[] = [];
    for (const entry of entries ?? []) {
      const unitType = String(entry.unit_type_id ?? "");
      const unit = state.unit_types[unitType];
      const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      if (count <= 0) {
        continue;
      }
      lines.push({
        faction: String(entry.faction_id ?? ""),
        unitType,
        count,
        cost: Math.max(0, unit?.cost ?? 0),
        attack: Math.max(0, unit?.attack ?? 0),
        defense: Math.max(0, unit?.defense ?? 0),
      });
    }
    stacks.set(regionId, lines);
  }
  return { owners, output, capital, stacks };
}

function cloneBoard(board: FastBoardSnapshot): FastBoardSnapshot {
  const stacks = new Map<string, StackSnap[]>();
  for (const [regionId, lines] of board.stacks) {
    stacks.set(regionId, lines.map((line) => ({ ...line })));
  }
  return {
    owners: new Map(board.owners),
    output: board.output,
    capital: board.capital,
    stacks,
  };
}

function pull(board: FastBoardSnapshot, regionId: string, factionId: string, unitType: string, count: number): number {
  const lines = board.stacks.get(regionId) ?? [];
  let left = count;
  for (const line of lines) {
    if (line.faction !== factionId || line.unitType !== unitType || left <= 0) {
      continue;
    }
    const n = Math.min(left, line.count);
    line.count -= n;
    left -= n;
  }
  board.stacks.set(
    regionId,
    lines.filter((line) => line.count > 0),
  );
  return count - left;
}

function push(board: FastBoardSnapshot, regionId: string, factionId: string, unitType: string, count: number, sample: StackSnap | undefined): void {
  if (count <= 0) {
    return;
  }
  const lines = board.stacks.get(regionId) ?? [];
  const found = lines.find((line) => line.faction === factionId && line.unitType === unitType);
  if (found != null) {
    found.count += count;
  } else {
    lines.push({
      faction: factionId,
      unitType,
      count,
      cost: sample?.cost ?? 0,
      attack: sample?.attack ?? 0,
      defense: sample?.defense ?? 0,
    });
  }
  board.stacks.set(regionId, lines);
}

function applyPackage(board: FastBoardSnapshot, factionId: string, attack: AttackPackage): void {
  if (attack.kind === "naval_raid" || attack.kind === "strategic_bomb") {
    return;
  }
  let moved = 0;
  for (const line of attack.stacks) {
    const source = (board.stacks.get(line.from) ?? []).find((stack) => stack.faction === factionId && stack.unitType === line.unitType);
    const taken = pull(board, line.from, factionId, line.unitType, line.count);
    push(board, attack.to, factionId, line.unitType, taken, source);
    moved += taken;
  }
  if (attack.win < 0.5 || moved <= 0) {
    return;
  }
  const keep = Math.max(0, Math.round(attack.survivingAttackers));
  const lines = board.stacks.get(attack.to) ?? [];
  const friendly = lines.filter((line) => line.faction === factionId).reduce((sum, line) => sum + line.count, 0);
  for (const line of lines) {
    if (line.faction !== factionId) {
      line.count = 0;
    }
  }
  let extra = friendly - keep;
  for (const line of lines) {
    if (line.faction !== factionId || extra <= 0) {
      continue;
    }
    const cut = Math.min(line.count, extra);
    line.count -= cut;
    extra -= cut;
  }
  board.stacks.set(
    attack.to,
    lines.filter((line) => line.count > 0 && line.faction === factionId),
  );
  board.owners.set(attack.to, factionId);
}

function ranksOf(lines: readonly StackSnap[], attack: boolean): number[] {
  const out: number[] = [];
  for (const line of lines) {
    const stat = attack ? line.attack : line.defense;
    if (stat <= 0) {
      continue;
    }
    for (let i = 0; i < line.count; i += 1) {
      out.push(stat);
    }
  }
  return out;
}

function enemyFaction(state: GameState, factionId: string): string {
  for (const id of state.turn_order) {
    if (id !== factionId && !state.sameTeam(id, factionId)) {
      return id;
    }
  }
  for (const id of Object.keys(state.factions)) {
    if (id !== factionId && !state.sameTeam(id, factionId)) {
      return id;
    }
  }
  return "";
}

function counterAttack(state: GameState, board: FastBoardSnapshot, factionId: string, profile: AIDifficultyProfile, seed: number): void {
  const enemy = enemyFaction(state, factionId);
  if (enemy === "") {
    return;
  }
  let bestRegion = "";
  let bestValue = 0;
  let bestFrom = "";
  for (const [regionId, owner] of board.owners) {
    if (owner !== factionId) {
      continue;
    }
    const garrison = (board.stacks.get(regionId) ?? []).filter((line) => line.faction === factionId);
    const worth = garrison.reduce((sum, line) => sum + line.cost * line.count, 0) + (board.output.get(regionId) ?? 0);
    if (worth <= bestValue) {
      continue;
    }
    for (const near of state.getAdjacentRegions(regionId)) {
      const hostile = (board.stacks.get(near) ?? []).some((line) => line.faction === enemy && line.attack > 0);
      if (hostile) {
        bestValue = worth;
        bestRegion = regionId;
        bestFrom = near;
      }
    }
  }
  if (bestRegion === "" || bestFrom === "") {
    return;
  }
  const attackers = ranksOf(
    (board.stacks.get(bestFrom) ?? []).filter((line) => line.faction === enemy),
    true,
  );
  const defenders = ranksOf(
    (board.stacks.get(bestRegion) ?? []).filter((line) => line.faction === factionId),
    false,
  );
  const odds = simulateBattleOdds(attackers, defenders, profile.fastOddsIterations, seed, state.rulesetConfig);
  if (odds.win < 0.5) {
    return;
  }
  board.owners.set(bestRegion, enemy);
  board.stacks.set(
    bestRegion,
    (board.stacks.get(bestFrom) ?? []).filter((line) => line.faction === enemy).map((line) => ({ ...line })),
  );
}

export function evaluateBoardState(state: GameState, board: FastBoardSnapshot, factionId: string, weights: CommanderWeights): number {
  let friendlyTuv = 0;
  let enemyTuv = 0;
  let friendlyIo = 0;
  let enemyIo = 0;
  let friendlyCities = 0;
  let enemyCities = 0;
  const global = state.scenarioId === "SCENARIO_GLOBAL_1940";
  const cities = new Set<string>(VICTORY_CITIES);
  for (const lines of board.stacks.values()) {
    for (const line of lines) {
      const mine = line.faction !== "" && state.sameTeam(line.faction, factionId);
      const body = line.cost * line.count;
      if (mine) {
        friendlyTuv += body;
      } else if (line.faction !== "") {
        enemyTuv += body;
      }
    }
  }
  for (const [regionId, owner] of board.owners) {
    const printed = board.output.get(regionId) ?? 0;
    if (owner !== "" && state.sameTeam(owner, factionId)) {
      friendlyIo += printed;
      if (global && cities.has(regionId)) {
        friendlyCities += 1;
      }
    } else if (owner !== "") {
      enemyIo += printed;
      if (global && cities.has(regionId)) {
        enemyCities += 1;
      }
    }
  }
  let objectiveDelta = 0;
  if (state.rulesetConfig.nationalObjectivesAndNeutrals) {
    objectiveDelta = objectiveBonus(state, factionId) + globalObjectivePay(state, factionId);
    const enemy = enemyFaction(state, factionId);
    if (enemy !== "") {
      objectiveDelta -= objectiveBonus(state, enemy) + globalObjectivePay(state, enemy);
    }
  }
  let exposure = 0;
  for (const regionId of board.capital) {
    if ((board.owners.get(regionId) ?? "") === "" || !state.sameTeam(board.owners.get(regionId) ?? "", factionId)) {
      continue;
    }
    let threat = 0;
    let held = 0;
    for (const line of board.stacks.get(regionId) ?? []) {
      if (state.sameTeam(line.faction, factionId)) {
        held += line.defense * line.count;
      }
    }
    for (const near of state.getAdjacentRegions(regionId)) {
      for (const line of board.stacks.get(near) ?? []) {
        if (line.faction !== "" && !state.sameTeam(line.faction, factionId)) {
          threat += line.attack * line.count;
        }
      }
    }
    exposure += Math.max(0, threat - held);
  }
  return (
    (friendlyTuv - enemyTuv) * weights.tuvPreservationWeight +
    (friendlyIo - enemyIo) * 3 +
    (friendlyCities - enemyCities) * 20 * weights.objectiveWeight +
    objectiveDelta * 3.5 * weights.objectiveWeight -
    exposure
  );
}

function legalPackage(state: GameState, factionId: string, attack: AttackPackage): boolean {
  for (const line of attack.stacks) {
    if (
      isAirUnit(state, line.unitType) &&
      line.from !== attack.to &&
      !canReturnAfter(state, factionId, line.unitType, line.from, attack.to, line.count)
    ) {
      return false;
    }
  }
  if (attack.kind === "amphibious" && attack.transportId != null && attack.originSea != null) {
    return assaultError(state, factionId, attack.transportId, attack.originSea, attack.to) == null;
  }
  return true;
}

/**
 * Greedy beam over packages that do not share a stack.
 * The score is the board heuristic against the untouched board.
 */
export function beamSearch(
  state: GameState,
  factionId: string,
  candidates: readonly AttackPackage[],
  _tiles: readonly unknown[],
  profile: AIDifficultyProfile,
  weights: CommanderWeights,
  seed: number,
): { best: TurnPackage; evaluated: number } {
  const ranked = [...candidates].sort((a, b) => {
    const left = (a.expectedTuvSwing + a.value) / Math.max(1, a.committedTuv);
    const right = (b.expectedTuvSwing + b.value) / Math.max(1, b.committedTuv);
    return right - left;
  });
  const baseline = snapshotBoard(state);
  const baseScore = evaluateBoardState(state, baseline, factionId, weights);
  let beam: BeamNode[] = [{ attacks: [], used: new Map(), board: baseline, score: baseScore }];
  let evaluated = 1;
  for (const candidate of ranked) {
    const next: BeamNode[] = [];
    for (const plan of beam) {
      next.push(plan);
      if (overlaps(state, factionId, plan.used, candidate) || !legalPackage(state, factionId, candidate)) {
        continue;
      }
      const board = cloneBoard(plan.board);
      applyPackage(board, factionId, candidate);
      if (profile.lookaheadPly === 2) {
        counterAttack(state, board, factionId, profile, seed + evaluated);
      }
      const used = new Map(plan.used);
      for (const line of candidate.stacks) {
        const key = keyOf(line);
        used.set(key, (used.get(key) ?? 0) + line.count);
      }
      next.push({
        attacks: [...plan.attacks, candidate],
        used,
        board,
        score: evaluateBoardState(state, board, factionId, weights),
      });
      evaluated += 1;
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, Math.max(1, profile.beamWidth));
  }
  const top = beam[0] ?? { attacks: [], used: new Map(), board: baseline, score: baseScore };
  const verified = top.attacks.filter((attack, index) => {
    if (!legalPackage(state, factionId, attack)) {
      return false;
    }
    const attackRanks: number[] = [];
    for (const line of attack.stacks) {
      if (line.assignedToSuppression || line.isEscort) {
        continue;
      }
      const stat = state.unit_types[line.unitType]?.attack ?? 0;
      for (let i = 0; i < line.count; i += 1) {
        if (stat > 0) {
          attackRanks.push(stat);
        }
      }
    }
    const defenders: number[] = [];
    for (const entry of state.getUnitsInRegion(attack.to)) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || state.sameTeam(owner, factionId)) {
        continue;
      }
      const stat = state.unit_types[String(entry.unit_type_id ?? "")]?.defense ?? 0;
      const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      for (let i = 0; i < count; i += 1) {
        if (stat > 0) {
          defenders.push(stat);
        }
      }
    }
    const deep = simulateBattleOdds(attackRanks, defenders, profile.deepOddsIterations, seed + 1000 + index, state.rulesetConfig);
    const bar = attack.cheap ? weights.tradeWinThreshold : weights.holdWinThreshold;
    return deep.win >= bar && (attack.cheap || deep.survival >= weights.holdSurvivalThreshold);
  });
  if (verified.length === 0) {
    const trade = ranked.find((attack) => attack.cheap && attack.deadZone);
    if (trade != null) {
      return { best: { attacks: [trade], score: trade.expectedTuvSwing + trade.value }, evaluated };
    }
    return { best: { attacks: [], score: 0 }, evaluated };
  }
  const board = cloneBoard(baseline);
  for (const attack of verified) {
    applyPackage(board, factionId, attack);
  }
  if (profile.lookaheadPly === 2) {
    counterAttack(state, board, factionId, profile, seed + 900);
  }
  const score = evaluateBoardState(state, board, factionId, weights) - baseScore;
  if (score < 0) {
    const trades = verified.filter((attack) => attack.cheap && attack.deadZone);
    if (trades.length === 0) {
      return { best: { attacks: [], score: 0 }, evaluated };
    }
    return { best: { attacks: trades, score: 0 }, evaluated };
  }
  return { best: { attacks: verified, score }, evaluated };
}
