import type { GameState } from "../engine/model/game_state";
import { convoyDrain } from "../engine/rules/optional/airAndNavalRaiding";
import { globalObjectivePay } from "../engine/rules/optional/global1940Evaluator";
import { guerrillaSurpriseActive } from "../engine/rules/optional/terrainResolver";
import { classifyUnit } from "../engine/types/ruleset";
import { simulateBattleOdds } from "./battleOddsSim";
import { theaterOf } from "./ferryPlanner";

export interface PurchaseMix {
  fodder: number;
  offense: number;
  air: number;
  warship: number;
  transport: number;
}

export interface TuvMark {
  round: number;
  axis: number;
  allies: number;
}

export interface BlocInvasion {
  bloc: string;
  faction: string;
}

export interface SimDiagnostics {
  transportsBuilt: Record<string, number>;
  transportActiveTurns: Record<string, number>;
  transportLoadedTurns: Record<string, number>;
  amphibiousLandings: Record<string, number>;
  landingsByTheater: Record<string, number>;
  unescortedFleetLosses: Record<string, number>;
  mix: Record<string, PurchaseMix>;
  unspentIO: Record<string, number>;
  unspentSamples: Record<string, number>;
  tuvByRound: TuvMark[];
  deadzoneSuicides: number;
  objectiveBonus: Record<string, number>;
  convoyDrained: Record<string, number>;
  guerrillaAmbushes: number;
  burmaRoadOpenRounds: number;
  neutralBlocsInvaded: BlocInvasion[];
}

export function emptyDiagnostics(): SimDiagnostics {
  return {
    transportsBuilt: {},
    transportActiveTurns: {},
    transportLoadedTurns: {},
    amphibiousLandings: {},
    landingsByTheater: {},
    unescortedFleetLosses: {},
    mix: {},
    unspentIO: {},
    unspentSamples: {},
    tuvByRound: [],
    deadzoneSuicides: 0,
    objectiveBonus: {},
    convoyDrained: {},
    guerrillaAmbushes: 0,
    burmaRoadOpenRounds: 0,
    neutralBlocsInvaded: [],
  };
}

function add(rows: Record<string, number>, key: string, amount: number): void {
  if (key === "" || amount === 0) {
    return;
  }
  rows[key] = (rows[key] ?? 0) + amount;
}

function mixOf(rows: Record<string, PurchaseMix>, factionId: string): PurchaseMix {
  const row = rows[factionId] ?? { fodder: 0, offense: 0, air: 0, warship: 0, transport: 0 };
  rows[factionId] = row;
  return row;
}

function bucket(kind: string): keyof PurchaseMix | "" {
  if (kind === "INFANTRY" || kind === "CHINESE_GUERRILLA") {
    return "fodder";
  }
  if (kind === "ARTILLERY" || kind === "ARMOR" || kind === "MECH") {
    return "offense";
  }
  if (kind === "FIGHTER" || kind === "TACTICAL_BOMBER" || kind === "HEAVY_BOMBER") {
    return "air";
  }
  if (kind === "TRANSPORT") {
    return "transport";
  }
  if (kind === "DESTROYER" || kind === "CRUISER" || kind === "BATTLESHIP" || kind === "CARRIER" || kind === "SUBMARINE") {
    return "warship";
  }
  return "";
}

export function notePurchase(diag: SimDiagnostics, state: GameState, factionId: string, payload: Record<string, unknown>): void {
  const purchases: unknown[] = Array.isArray(payload.purchases) ? payload.purchases : [];
  const mix = mixOf(diag.mix, factionId);
  for (const line of purchases) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    const row = line as Record<string, unknown>;
    const id = String(row.unit_type_id ?? "");
    const count = Math.max(0, Math.trunc(Number(row.count ?? 0)));
    const cost = Math.max(0, state.unit_types[id]?.cost ?? 0) * count;
    const kind = classifyUnit(id) ?? "";
    const slot = bucket(kind);
    if (slot !== "") {
      mix[slot] += cost;
    }
    if (kind === "TRANSPORT") {
      add(diag.transportsBuilt, factionId, count);
    }
  }
  add(diag.unspentIO, factionId, Math.max(0, Math.trunc(state.ipc[factionId] ?? 0)));
  add(diag.unspentSamples, factionId, 1);
}

export function noteTransports(diag: SimDiagnostics, state: GameState, factionId: string): void {
  for (const [transportId, transport] of Object.entries(state.transport_instances)) {
    const sea = String(transport.region_id ?? "");
    const owner = state.getUnitsInRegion(sea).find((entry) => String(entry.instance_id ?? "") === transportId);
    if (String(owner?.faction_id ?? "") !== factionId) {
      continue;
    }
    add(diag.transportActiveTurns, factionId, 1);
    const cargo = (transport.cargo ?? []).reduce((sum, line) => sum + Math.max(0, Math.trunc(Number(line.count ?? 0))), 0);
    if (cargo > 0) {
      add(diag.transportLoadedTurns, factionId, 1);
    }
  }
}

export function noteLanding(diag: SimDiagnostics, state: GameState, factionId: string, regionId: string): void {
  add(diag.amphibiousLandings, factionId, 1);
  const theater = theaterOf(regionId, state.regions[regionId]?.name ?? "");
  add(diag.landingsByTheater, theater === "" ? "other" : theater, 1);
}

export function noteIncome(diag: SimDiagnostics, state: GameState, factionId: string): void {
  if (state.scenarioId !== "SCENARIO_GLOBAL_1940") {
    return;
  }
  add(diag.objectiveBonus, factionId, globalObjectivePay(state, factionId));
  add(diag.convoyDrained, factionId, convoyDrain(state, factionId));
}

function teamTuv(state: GameState, team: "axis" | "allies"): number {
  let total = 0;
  for (const entries of Object.values(state.region_units)) {
    for (const entry of entries ?? []) {
      const owner = String(entry.faction_id ?? "");
      if (state.factions[owner]?.team !== team) {
        continue;
      }
      const cost = Math.max(0, state.unit_types[String(entry.unit_type_id ?? "")]?.cost ?? 0);
      total += cost * Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
  }
  return total;
}

export function noteRound(diag: SimDiagnostics, state: GameState, round: number): void {
  if (round < 1 || round > 6 || diag.tuvByRound.some((mark) => mark.round === round)) {
    return;
  }
  diag.tuvByRound.push({ round, axis: teamTuv(state, "axis"), allies: teamTuv(state, "allies") });
  if (state.scenarioId !== "SCENARIO_GLOBAL_1940") {
    return;
  }
  const open = ["india", "burma", "yunnan"].every((id) => {
    const owner = state.regions[id]?.owner_faction_id ?? "";
    return owner !== "" && state.factions[owner]?.team === "allies";
  });
  if (open) {
    diag.burmaRoadOpenRounds += 1;
  }
}

function ranks(state: GameState, regionId: string, factionId: string, friendly: boolean, attack: boolean): { ranks: number[]; cost: number; bodies: number } {
  const out: number[] = [];
  let cost = 0;
  let bodies = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || state.sameTeam(owner, factionId) !== friendly) {
      continue;
    }
    const unit = state.unit_types[String(entry.unit_type_id ?? "")];
    if (unit == null) {
      continue;
    }
    const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    const stat = attack ? unit.attack : unit.defense;
    cost += count * Math.max(0, unit.cost);
    if (stat > 0) {
      bodies += count;
      for (let i = 0; i < count; i += 1) {
        out.push(stat);
      }
    }
  }
  return { ranks: out, cost, bodies };
}

/** Battles opened under 40% that are not a one-unit trade with a positive expected exchange. */
export function noteBattleOdds(diag: SimDiagnostics, state: GameState, factionId: string, regionId: string): void {
  const attack = ranks(state, regionId, factionId, true, true);
  const defense = ranks(state, regionId, factionId, false, false);
  if (attack.bodies === 0) {
    return;
  }
  const odds = simulateBattleOdds(attack.ranks, defense.ranks, 40, 11, state.rulesetConfig);
  if (odds.win < 0.4) {
    const strafe = attack.bodies === 1 && odds.win * defense.cost > attack.cost;
    if (!strafe) {
      diag.deadzoneSuicides += 1;
    }
  }
  if (guerrillaSurpriseActive(state, regionId)) {
    const guerrilla = state.getUnitsInRegion(regionId).some((entry) => classifyUnit(String(entry.unit_type_id ?? "")) === "CHINESE_GUERRILLA");
    if (guerrilla) {
      diag.guerrillaAmbushes += 1;
    }
  }
}

export function noteUnescortedLoss(diag: SimDiagnostics, factionId: string, ships: number): void {
  add(diag.unescortedFleetLosses, factionId, ships);
}

export function seaHasEscort(state: GameState, factionId: string, regionId: string): boolean {
  for (const entry of state.getUnitsInRegion(regionId)) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId)) {
      continue;
    }
    const kind = classifyUnit(String(entry.unit_type_id ?? ""));
    if (kind === "DESTROYER" || kind === "CARRIER") {
      return true;
    }
  }
  return false;
}

export function enemyAirIn(state: GameState, factionId: string, regionId: string): boolean {
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || state.sameTeam(owner, factionId)) {
      continue;
    }
    const kind = classifyUnit(String(entry.unit_type_id ?? ""));
    if (kind === "FIGHTER" || kind === "TACTICAL_BOMBER" || kind === "HEAVY_BOMBER") {
      return true;
    }
  }
  return false;
}

export function friendlySeaCount(state: GameState, factionId: string, regionId: string): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId)) {
      continue;
    }
    if (state.unit_types[String(entry.unit_type_id ?? "")]?.category === "sea") {
      total += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
  }
  return total;
}

export interface DiagnosticReport {
  transportUtilization: Record<string, number>;
  transportsBuilt: Record<string, number>;
  amphibiousLandings: Record<string, number>;
  landingsByTheater: Record<string, number>;
  unescortedFleetLosses: Record<string, number>;
  purchaseMix: Record<string, PurchaseMix & { total: number }>;
  avgUnspentIO: Record<string, number>;
  tuvByRound: TuvMark[];
  deadzoneSuicides: number;
  objectiveBonus: Record<string, number>;
  convoyDrained: Record<string, number>;
  guerrillaAmbushes: number;
  burmaRoadOpenRounds: number;
  neutralBlocsInvaded: BlocInvasion[];
}

function sumMix(into: PurchaseMix, row: PurchaseMix): void {
  into.fodder += row.fodder;
  into.offense += row.offense;
  into.air += row.air;
  into.warship += row.warship;
  into.transport += row.transport;
}

export function summarizeDiagnostics(rows: readonly SimDiagnostics[]): DiagnosticReport {
  const built: Record<string, number> = {};
  const active: Record<string, number> = {};
  const loaded: Record<string, number> = {};
  const landings: Record<string, number> = {};
  const theaters: Record<string, number> = {};
  const losses: Record<string, number> = {};
  const mix: Record<string, PurchaseMix> = {};
  const unspent: Record<string, number> = {};
  const samples: Record<string, number> = {};
  const tuv = new Map<number, { axis: number; allies: number; games: number }>();
  let suicides = 0;
  const bonus: Record<string, number> = {};
  const convoy: Record<string, number> = {};
  let ambushes = 0;
  let burma = 0;
  const blocs: BlocInvasion[] = [];
  for (const row of rows) {
    for (const [factionId, count] of Object.entries(row.transportsBuilt)) {
      add(built, factionId, count);
    }
    for (const [factionId, count] of Object.entries(row.transportActiveTurns)) {
      add(active, factionId, count);
    }
    for (const [factionId, count] of Object.entries(row.transportLoadedTurns)) {
      add(loaded, factionId, count);
    }
    for (const [factionId, count] of Object.entries(row.amphibiousLandings)) {
      add(landings, factionId, count);
    }
    for (const [theater, count] of Object.entries(row.landingsByTheater)) {
      add(theaters, theater, count);
    }
    for (const [factionId, count] of Object.entries(row.unescortedFleetLosses)) {
      add(losses, factionId, count);
    }
    for (const [factionId, spent] of Object.entries(row.mix)) {
      sumMix(mixOf(mix, factionId), spent);
    }
    for (const [factionId, amount] of Object.entries(row.unspentIO)) {
      add(unspent, factionId, amount);
    }
    for (const [factionId, count] of Object.entries(row.unspentSamples)) {
      add(samples, factionId, count);
    }
    for (const mark of row.tuvByRound) {
      const prior = tuv.get(mark.round) ?? { axis: 0, allies: 0, games: 0 };
      prior.axis += mark.axis;
      prior.allies += mark.allies;
      prior.games += 1;
      tuv.set(mark.round, prior);
    }
    suicides += row.deadzoneSuicides;
    for (const [factionId, amount] of Object.entries(row.objectiveBonus)) {
      add(bonus, factionId, amount);
    }
    for (const [factionId, amount] of Object.entries(row.convoyDrained)) {
      add(convoy, factionId, amount);
    }
    ambushes += row.guerrillaAmbushes;
    burma += row.burmaRoadOpenRounds;
    blocs.push(...row.neutralBlocsInvaded);
  }
  const utilization: Record<string, number> = {};
  for (const [factionId, turns] of Object.entries(active)) {
    utilization[factionId] = turns > 0 ? ((loaded[factionId] ?? 0) / turns) * 100 : 0;
  }
  const purchaseMix: DiagnosticReport["purchaseMix"] = {};
  for (const [factionId, spent] of Object.entries(mix)) {
    const total = spent.fodder + spent.offense + spent.air + spent.warship + spent.transport;
    purchaseMix[factionId] = { ...spent, total };
  }
  const avgUnspentIO: Record<string, number> = {};
  for (const [factionId, amount] of Object.entries(unspent)) {
    avgUnspentIO[factionId] = (samples[factionId] ?? 0) > 0 ? amount / (samples[factionId] ?? 1) : 0;
  }
  const tuvByRound = [...tuv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, mark]) => ({
      round,
      axis: mark.games > 0 ? mark.axis / mark.games : 0,
      allies: mark.games > 0 ? mark.allies / mark.games : 0,
    }));
  return {
    transportUtilization: utilization,
    transportsBuilt: built,
    amphibiousLandings: landings,
    landingsByTheater: theaters,
    unescortedFleetLosses: losses,
    purchaseMix,
    avgUnspentIO,
    tuvByRound,
    deadzoneSuicides: suicides,
    objectiveBonus: bonus,
    convoyDrained: convoy,
    guerrillaAmbushes: ambushes,
    burmaRoadOpenRounds: rows.length > 0 ? burma / rows.length : 0,
    neutralBlocsInvaded: blocs,
  };
}

function percent(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(0)}%` : "0%";
}

export function formatDiagnostics(report: DiagnosticReport, scenario1940: boolean): string[] {
  const util = Object.entries(report.transportUtilization)
    .map(([factionId, rate]) => `${factionId} built ${report.transportsBuilt[factionId] ?? 0}, loaded ${rate.toFixed(0)}%, landings ${report.amphibiousLandings[factionId] ?? 0}, unescorted losses ${report.unescortedFleetLosses[factionId] ?? 0}`)
    .join("; ");
  const mix = Object.entries(report.purchaseMix)
    .map(([factionId, row]) => {
      const total = row.total;
      return `${factionId} fodder ${percent(row.fodder, total)} offense ${percent(row.offense, total)} air ${percent(row.air, total)} warships ${percent(row.warship, total)} transports ${percent(row.transport, total)}`;
    })
    .join("; ");
  const unspent = Object.entries(report.avgUnspentIO)
    .map(([factionId, amount]) => `${factionId} ${amount.toFixed(1)}`)
    .join(", ");
  const tuv = report.tuvByRound.map((mark) => `R${mark.round} ${mark.axis.toFixed(0)}/${mark.allies.toFixed(0)}`).join(", ");
  const theaters = Object.entries(report.landingsByTheater)
    .map(([theater, count]) => `${theater} ${count}`)
    .join(", ");
  const lines = [
    `Transports ${util || "none"}`,
    `Landings by theater ${theaters || "none"}`,
    `Purchase mix ${mix || "none"}`,
    `Average unspent IO ${unspent || "none"}`,
    `TUV axis/allies ${tuv || "none"}`,
    `Dead-zone suicides ${report.deadzoneSuicides}`,
  ];
  if (scenario1940) {
    const bonus = Object.entries(report.objectiveBonus)
      .map(([factionId, amount]) => `${factionId} ${amount}`)
      .join(", ");
    const drained = Object.entries(report.convoyDrained)
      .map(([factionId, amount]) => `${factionId} ${amount}`)
      .join(", ");
    const blocs = report.neutralBlocsInvaded.map((row) => `${row.bloc} by ${row.faction}`).join(", ");
    lines.push(`Objective bonus IO ${bonus || "none"}`);
    lines.push(`Convoy IO drained ${drained || "none"}`);
    lines.push(`Guerrilla ambushes ${report.guerrillaAmbushes}  Burma Road open rounds ${report.burmaRoadOpenRounds.toFixed(2)}`);
    lines.push(`Neutral blocs invaded ${blocs || "none"}`);
  }
  return lines;
}
