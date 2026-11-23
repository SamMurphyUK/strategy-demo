import type { GameState } from "../../model/game_state";
import type { UnitStackEntry } from "../../model/types";
import { classifyUnit, type RulesetUnitType } from "../../types/ruleset";
import { facilitiesActive, operationalAirbase } from "./facilitiesResolver";

const RAIDER: ReadonlySet<RulesetUnitType> = new Set(["CARRIER", "CRUISER", "DESTROYER"]);
const WARSHIP: ReadonlySet<RulesetUnitType> = new Set(["BATTLESHIP", "CARRIER", "CRUISER", "DESTROYER"]);

export interface PatrolZone {
  regionId: string;
  kind: "air";
}

export interface PatrolIntel {
  regionId: string;
  units: { factionId: string; unitTypeId: string; count: number }[];
  cargo: { unitTypeId: string; count: number }[];
}

export interface NavalRaidResult {
  ok: boolean;
  error: string;
  pinned: boolean;
  harborDisabled: boolean;
  raiderLosses: number;
  defenderLosses: number;
}

export interface TransitIntercept {
  ok: boolean;
  error: string;
  fighterLosses: number;
  transitLosses: number;
}

export interface PatrolLift {
  from: string;
  factionId: string;
  unitTypeId: string;
  count: number;
}

function keyOf(factionId: string, regionId: string): string {
  return `${factionId}|${regionId}`;
}

function splitKey(key: string): [string, string] {
  const cut = key.indexOf("|");
  if (cut < 0) {
    return [key, ""];
  }
  return [key.slice(0, cut), key.slice(cut + 1)];
}

function stackCount(entry: UnitStackEntry): number {
  return Math.max(0, Math.trunc(Number(entry.count ?? 0)));
}

function classOf(unitTypeId: string): RulesetUnitType | null {
  return classifyUnit(unitTypeId);
}

function fighterCount(state: GameState, factionId: string, regionId: string): number {
  let total = 0;
  for (const entry of state.region_units[regionId] ?? []) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId) || entry.instance_id) {
      continue;
    }
    if (classOf(String(entry.unit_type_id ?? "")) !== "FIGHTER") {
      continue;
    }
    total += stackCount(entry);
  }
  return total;
}

function stationReady(state: GameState, factionId: string, regionId: string): boolean {
  if (operationalAirbase(state, regionId, factionId)) {
    return true;
  }
  for (const entry of state.region_units[regionId] ?? []) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId)) {
      continue;
    }
    if (classOf(String(entry.unit_type_id ?? "")) === "CARRIER" && stackCount(entry) > 0) {
      return true;
    }
  }
  return false;
}

/** Home tile, plus every adjacent sea zone. */
export function zoneCoveredBy(state: GameState, station: string, zone: string): boolean {
  if (station === zone) {
    return true;
  }
  const region = state.regions[zone];
  return region != null && region.isSeaRegion() && state.isAdjacent(station, zone);
}

function patrolEntries(state: GameState): { owner: string; station: string; count: number }[] {
  const rows: { owner: string; station: string; count: number }[] = [];
  for (const key of Object.keys(state.patrolCounts)) {
    const count = Math.max(0, Math.trunc(state.patrolCounts[key] ?? 0));
    if (count <= 0) {
      continue;
    }
    const [owner, station] = splitKey(key);
    rows.push({ owner, station, count });
  }
  return rows;
}

export function hasActivePatrols(state: GameState): boolean {
  return facilitiesActive(state) && patrolEntries(state).length > 0;
}

function covers(state: GameState, zone: string, factionId: string, friendly: boolean): boolean {
  if (!facilitiesActive(state)) {
    return false;
  }
  for (const row of patrolEntries(state)) {
    const same = state.sameTeam(row.owner, factionId);
    if (friendly ? !same : same) {
      continue;
    }
    if (Math.min(row.count, fighterCount(state, row.owner, row.station)) <= 0) {
      continue;
    }
    if (zoneCoveredBy(state, row.station, zone)) {
      return true;
    }
  }
  return false;
}

export function friendlyPatrolCovers(state: GameState, zone: string, factionId: string): boolean {
  return covers(state, zone, factionId, true);
}

export function enemyPatrolCovers(state: GameState, zone: string, factionId: string): boolean {
  return covers(state, zone, factionId, false);
}

export function subSurpriseBlocked(state: GameState, zone: string, subFactionId: string): boolean {
  return enemyPatrolCovers(state, zone, subFactionId);
}

export function patrolGrounded(state: GameState, factionId: string, regionId: string, unitTypeId: string): boolean {
  if (!facilitiesActive(state) || state.patrolLock[factionId] !== true) {
    return false;
  }
  if (classOf(unitTypeId) !== "FIGHTER") {
    return false;
  }
  return Math.min(state.patrolCounts[keyOf(factionId, regionId)] ?? 0, fighterCount(state, factionId, regionId)) > 0;
}

/**
 * During noncombat, up to three fighters on an operational airbase or a carrier
 * may set isPatrolling. They stay up through the owner's next turn.
 */
export function togglePatrol(state: GameState, factionId: string, regionId: string, count: number): string | null {
  if (!facilitiesActive(state)) {
    return "Facilities are off.";
  }
  if (state.current_phase !== "noncombat_move" || state.current_faction_id !== factionId) {
    return "Patrols are set in noncombat.";
  }
  if (state.patrolLock[factionId] === true) {
    return "Patrols stay up until purchase.";
  }
  const want = Math.trunc(count);
  if (want < 0 || want > 3) {
    return "A patrol is three fighters.";
  }
  if (!stationReady(state, factionId, regionId)) {
    return "Patrols fly from an airbase or a carrier.";
  }
  if (want > fighterCount(state, factionId, regionId)) {
    return "Not enough fighters.";
  }
  const key = keyOf(factionId, regionId);
  if (want === 0) {
    delete state.patrolCounts[key];
  } else {
    state.patrolCounts[key] = want;
  }
  return null;
}

/** Noncombat end may carry `{ patrols: [{ region_id, count }] }`. A bad line is skipped. */
export function applyPatrolOrders(state: GameState, factionId: string, payload: Record<string, unknown>): void {
  if (state.current_phase !== "noncombat_move") {
    return;
  }
  const lines: unknown[] = Array.isArray(payload.patrols) ? payload.patrols : [];
  for (const line of lines) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    const row = line as Record<string, unknown>;
    togglePatrol(state, factionId, String(row.region_id ?? ""), Math.trunc(Number(row.count ?? 0)));
  }
}

/** Purchase stand-down. The fighters can move again on this turn. */
export function standDownPatrols(state: GameState, factionId: string): string | null {
  if (!facilitiesActive(state)) {
    return "Facilities are off.";
  }
  if (state.current_phase !== "purchase" || state.current_faction_id !== factionId) {
    return "Stand patrols down during purchase.";
  }
  const prefix = `${factionId}|`;
  for (const key of Object.keys(state.patrolCounts)) {
    if (key.startsWith(prefix)) {
      delete state.patrolCounts[key];
    }
  }
  delete state.patrolLock[factionId];
  return null;
}

/** Called when this faction ends its turn, so the patrol is still up next purchase. */
export function lockPatrols(state: GameState, factionId: string): void {
  if (!facilitiesActive(state) || factionId === "") {
    return;
  }
  const prefix = `${factionId}|`;
  for (const key of Object.keys(state.patrolCounts)) {
    if (key.startsWith(prefix) && (state.patrolCounts[key] ?? 0) > 0) {
      state.patrolLock[factionId] = true;
      return;
    }
  }
}

export function patrolZones(state: GameState, factionId: string): PatrolZone[] {
  if (!facilitiesActive(state)) {
    return [];
  }
  const seen: Record<string, boolean> = {};
  const zones: PatrolZone[] = [];
  const add = (regionId: string) => {
    if (regionId === "" || seen[regionId]) {
      return;
    }
    seen[regionId] = true;
    zones.push({ regionId, kind: "air" });
  };
  for (const row of patrolEntries(state)) {
    if (!state.sameTeam(row.owner, factionId)) {
      continue;
    }
    if (Math.min(row.count, fighterCount(state, row.owner, row.station)) <= 0) {
      continue;
    }
    add(row.station);
    for (const neighbor of state.getAdjacentRegions(row.station)) {
      if (state.regions[neighbor]?.isSeaRegion()) {
        add(neighbor);
      }
    }
  }
  return zones;
}

function landingSea(state: GameState, battleRegion: string, station: string): boolean {
  for (const landing of state.amphibious_landings) {
    if (landing.region_id !== battleRegion) {
      continue;
    }
    if (zoneCoveredBy(state, station, landing.sea_zone_id)) {
      return true;
    }
  }
  return false;
}

/** Patrolling fighters that join a battle in the home tile, an adjacent sea, or a landing from one. */
export function patrolInterceptLifts(state: GameState, battleRegion: string, defenderFactionId: string): PatrolLift[] {
  if (!facilitiesActive(state) || defenderFactionId === "") {
    return [];
  }
  const lifts: PatrolLift[] = [];
  for (const row of patrolEntries(state)) {
    if (!state.sameTeam(row.owner, defenderFactionId) || row.station === battleRegion) {
      continue;
    }
    if (!zoneCoveredBy(state, row.station, battleRegion) && !landingSea(state, battleRegion, row.station)) {
      continue;
    }
    const have = fighterCount(state, row.owner, row.station);
    const count = Math.min(row.count, have);
    if (count <= 0) {
      continue;
    }
    lifts.push({ from: row.station, factionId: row.owner, unitTypeId: fighterType(state, row.owner, row.station), count });
  }
  lifts.sort((a, b) => a.from.localeCompare(b.from));
  return lifts;
}

function fighterType(state: GameState, factionId: string, regionId: string): string {
  for (const entry of state.region_units[regionId] ?? []) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId) || entry.instance_id) {
      continue;
    }
    if (classOf(String(entry.unit_type_id ?? "")) === "FIGHTER") {
      return String(entry.unit_type_id);
    }
  }
  return "fighter";
}

/** Fighters on patrol whose station covers this raid, capped by the fighters still there. */
export function interceptingFighters(state: GameState, defenderFactionId: string, regionId: string): number {
  if (!facilitiesActive(state) || defenderFactionId === "") {
    return 0;
  }
  let total = 0;
  for (const row of patrolEntries(state)) {
    if (!state.sameTeam(row.owner, defenderFactionId)) {
      continue;
    }
    if (!zoneCoveredBy(state, row.station, regionId)) {
      continue;
    }
    total += Math.min(row.count, fighterCount(state, row.owner, row.station));
  }
  return total;
}

export function consumeInterceptFighters(state: GameState, defenderFactionId: string, regionId: string, losses: number): void {
  let left = Math.max(0, Math.trunc(losses));
  const stations = patrolEntries(state)
    .filter((row) => state.sameTeam(row.owner, defenderFactionId) && zoneCoveredBy(state, row.station, regionId))
    .sort((a, b) => a.station.localeCompare(b.station));
  for (const row of stations) {
    if (left <= 0) {
      break;
    }
    const key = keyOf(row.owner, row.station);
    const onPatrol = Math.min(state.patrolCounts[key] ?? 0, fighterCount(state, row.owner, row.station));
    const take = Math.min(left, onPatrol);
    if (take <= 0) {
      continue;
    }
    removeFighters(state, row.station, row.owner, take);
    const next = (state.patrolCounts[key] ?? 0) - take;
    if (next <= 0) {
      delete state.patrolCounts[key];
    } else {
      state.patrolCounts[key] = next;
    }
    left -= take;
  }
}

function removeFighters(state: GameState, regionId: string, factionId: string, count: number): void {
  let left = count;
  const units = state.region_units[regionId] ?? [];
  for (let i = units.length - 1; i >= 0 && left > 0; i -= 1) {
    const entry = units[i];
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId) || entry.instance_id) {
      continue;
    }
    if (classOf(String(entry.unit_type_id ?? "")) !== "FIGHTER") {
      continue;
    }
    const have = stackCount(entry);
    if (have > left) {
      entry.count = have - left;
      left = 0;
    } else {
      left -= have;
      units.splice(i, 1);
    }
  }
}

export function patrolReveals(state: GameState, factionId: string, regionId: string): boolean {
  if (!facilitiesActive(state)) {
    return false;
  }
  for (const row of patrolEntries(state)) {
    if (!state.sameTeam(row.owner, factionId)) {
      continue;
    }
    if (Math.min(row.count, fighterCount(state, row.owner, row.station)) <= 0) {
      continue;
    }
    if (row.station === regionId || state.isAdjacent(row.station, regionId)) {
      return true;
    }
  }
  return false;
}

/** Exact unit and cargo counts for a zone a friendly patrol can see. */
export function patrolIntel(state: GameState, factionId: string, regionId: string): PatrolIntel | null {
  if (!patrolReveals(state, factionId, regionId)) {
    return null;
  }
  const units: PatrolIntel["units"] = [];
  for (const entry of state.getUnitsInRegion(regionId)) {
    const count = stackCount(entry);
    if (count <= 0) {
      continue;
    }
    units.push({
      factionId: String(entry.faction_id ?? ""),
      unitTypeId: String(entry.unit_type_id ?? ""),
      count,
    });
  }
  const cargo: PatrolIntel["cargo"] = [];
  for (const instance of Object.values(state.transport_instances)) {
    if (instance.region_id !== regionId) {
      continue;
    }
    for (const line of instance.cargo ?? []) {
      const count = Math.max(0, Math.trunc(Number(line.count ?? 0)));
      if (count > 0) {
        cargo.push({ unitTypeId: String(line.unit_type_id ?? ""), count });
      }
    }
  }
  return { regionId, units, cargo };
}

function waived(state: GameState, factionId: string, regionId: string): boolean {
  return state.patrolBypassWaived[keyOf(factionId, regionId)] === true;
}

interface AirNode {
  region: string;
  dist: number;
  paid: number;
}

/** Shortest air cost. Entering one enemy patrol costs one extra move unless that zone was intercepted. */
function searchAir(state: GameState, factionId: string, start: string): Record<string, number> {
  const best: Record<string, number> = { [start]: 0 };
  const seen: Record<string, number> = { [`${start}|0`]: 0 };
  const frontier: AirNode[] = [{ region: start, dist: 0, paid: 0 }];
  let guard = 0;
  while (frontier.length > 0 && guard < 20000) {
    guard += 1;
    let pick = 0;
    for (let i = 1; i < frontier.length; i += 1) {
      if (frontier[i].dist < frontier[pick].dist) {
        pick = i;
      }
    }
    const current = frontier.splice(pick, 1)[0];
    const stateKey = `${current.region}|${current.paid}`;
    if (seen[stateKey] !== current.dist) {
      continue;
    }
    if (best[current.region] == null || current.dist < best[current.region]) {
      best[current.region] = current.dist;
    }
    for (const next of state.getAdjacentRegions(current.region)) {
      let paid = current.paid;
      let step = 1;
      if (paid === 0 && enemyPatrolCovers(state, next, factionId) && !waived(state, factionId, next)) {
        step = 2;
        paid = 1;
      }
      const dist = current.dist + step;
      const nextKey = `${next}|${paid}`;
      if (seen[nextKey] != null && seen[nextKey] <= dist) {
        continue;
      }
      seen[nextKey] = dist;
      frontier.push({ region: next, dist, paid });
    }
  }
  return best;
}

/** Null when no patrol is up, so callers keep the plain hop count. */
export function airTransitCost(state: GameState, factionId: string, from: string, to: string): number | null {
  if (!hasActivePatrols(state)) {
    return null;
  }
  if (from === "" || to === "") {
    return Number.POSITIVE_INFINITY;
  }
  if (from === to) {
    return 0;
  }
  const best = searchAir(state, factionId, from);
  return best[to] ?? Number.POSITIVE_INFINITY;
}

export function patrolAirReach(state: GameState, factionId: string, start: string, fuel: number): string[] {
  if (!hasActivePatrols(state) || fuel <= 0 || start === "") {
    return [];
  }
  const best = searchAir(state, factionId, start);
  const reached: string[] = [];
  for (const regionId of Object.keys(best)) {
    if (regionId !== start && best[regionId] <= fuel) {
      reached.push(regionId);
    }
  }
  return reached;
}

function stat(state: GameState, unitTypeId: string, side: "attack" | "defense"): number {
  return Math.max(0, Math.trunc(Number(state.unit_types[unitTypeId]?.[side] ?? 0)));
}

/**
 * One intercept round against air that is still in `from` and about to enter `to`.
 * Survivors then pay the normal hop cost into that zone.
 */
export function resolveTransitIntercept(
  state: GameState,
  factionId: string,
  from: string,
  to: string,
  roll: () => number,
): TransitIntercept {
  const empty = { ok: false, error: "", fighterLosses: 0, transitLosses: 0 };
  if (!facilitiesActive(state)) {
    return { ...empty, error: "Facilities are off." };
  }
  if (!enemyPatrolCovers(state, to, factionId)) {
    return { ...empty, error: "No patrol covers that zone." };
  }
  const air = airStacks(state, from, factionId);
  if (air.total <= 0) {
    return { ...empty, error: "No aircraft." };
  }
  const fighters = interceptingFighters(state, defenderOf(state, factionId, to), to);
  let transitHits = 0;
  for (const line of air.lines) {
    const attack = stat(state, line.unitTypeId, "attack");
    for (let i = 0; i < line.count; i += 1) {
      if (face(roll) <= attack) {
        transitHits += 1;
      }
    }
  }
  let fighterHits = 0;
  const fighterTypeId = firstPatrolType(state, factionId, to);
  const defense = stat(state, fighterTypeId, "defense");
  for (let i = 0; i < fighters; i += 1) {
    if (face(roll) <= defense) {
      fighterHits += 1;
    }
  }
  const transitLosses = Math.min(air.total, fighterHits);
  const fighterLosses = Math.min(fighters, transitHits);
  removeAir(state, from, factionId, transitLosses);
  consumeInterceptFighters(state, defenderOf(state, factionId, to), to, fighterLosses);
  state.patrolBypassWaived[keyOf(factionId, to)] = true;
  return { ok: true, error: "", fighterLosses, transitLosses };
}

function face(roll: () => number): number {
  const value = Math.trunc(Number(roll()));
  if (value < 1) {
    return 1;
  }
  return value > 6 ? 6 : value;
}

function defenderOf(state: GameState, attacker: string, regionId: string): string {
  const owner = state.regions[regionId]?.owner_faction_id ?? "";
  if (owner !== "" && !state.sameTeam(owner, attacker)) {
    return owner;
  }
  for (const row of patrolEntries(state)) {
    if (!state.sameTeam(row.owner, attacker) && zoneCoveredBy(state, row.station, regionId)) {
      return row.owner;
    }
  }
  return owner;
}

function firstPatrolType(state: GameState, attacker: string, regionId: string): string {
  for (const row of patrolEntries(state)) {
    if (state.sameTeam(row.owner, attacker) || !zoneCoveredBy(state, row.station, regionId)) {
      continue;
    }
    return fighterType(state, row.owner, row.station);
  }
  return "fighter";
}

function airStacks(state: GameState, regionId: string, factionId: string): { total: number; lines: { unitTypeId: string; count: number }[] } {
  const lines: { unitTypeId: string; count: number }[] = [];
  let total = 0;
  for (const entry of state.region_units[regionId] ?? []) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId) || entry.instance_id) {
      continue;
    }
    const kind = classOf(String(entry.unit_type_id ?? ""));
    if (kind !== "FIGHTER" && kind !== "TACTICAL_BOMBER" && kind !== "HEAVY_BOMBER") {
      continue;
    }
    const count = stackCount(entry);
    if (count <= 0) {
      continue;
    }
    lines.push({ unitTypeId: String(entry.unit_type_id), count });
    total += count;
  }
  return { total, lines };
}

function removeAir(state: GameState, regionId: string, factionId: string, losses: number): void {
  let left = losses;
  const units = state.region_units[regionId] ?? [];
  const order = units
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => state.sameTeam(String(entry.faction_id ?? ""), factionId) && !entry.instance_id)
    .filter(({ entry }) => {
      const kind = classOf(String(entry.unit_type_id ?? ""));
      return kind === "FIGHTER" || kind === "TACTICAL_BOMBER" || kind === "HEAVY_BOMBER";
    })
    .sort((a, b) => {
      const cost = (state.unit_types[a.entry.unit_type_id]?.cost ?? 0) - (state.unit_types[b.entry.unit_type_id]?.cost ?? 0);
      return cost !== 0 ? cost : a.index - b.index;
    });
  for (const { entry } of order) {
    if (left <= 0) {
      break;
    }
    const have = stackCount(entry);
    const take = Math.min(have, left);
    entry.count = have - take;
    left -= take;
  }
  state.region_units[regionId] = units.filter((entry) => stackCount(entry) > 0 || entry.instance_id);
}

function isCoastalGun(state: GameState, unitTypeId: string): boolean {
  if (classOf(unitTypeId) === "ARTILLERY") {
    return true;
  }
  const id = unitTypeId.toLowerCase();
  if (id === "aa" || id === "aaa" || id === "aa_gun" || id === "anti_aircraft") {
    return true;
  }
  return Boolean(state.unit_types[unitTypeId]?.special?.is_aa);
}

function printedOutput(region: { base_output: number; ipc_value: number }): number {
  return region.base_output > 0 ? region.base_output : region.ipc_value;
}

interface PieceLine {
  regionId: string;
  factionId: string;
  unitTypeId: string;
  count: number;
  cost: number;
}

function collectPieces(state: GameState, regionId: string, factionId: string, accept: (unitTypeId: string) => boolean, hostile: boolean): PieceLine[] {
  const lines: PieceLine[] = [];
  for (const entry of state.region_units[regionId] ?? []) {
    const owner = String(entry.faction_id ?? "");
    const enemy = owner !== "" && !state.sameTeam(owner, factionId);
    if (hostile ? !enemy : owner !== factionId) {
      continue;
    }
    const unitTypeId = String(entry.unit_type_id ?? "");
    if (!accept(unitTypeId) || entry.instance_id) {
      continue;
    }
    const count = stackCount(entry);
    if (count <= 0) {
      continue;
    }
    lines.push({
      regionId,
      factionId: owner,
      unitTypeId,
      count,
      cost: Math.max(0, Math.trunc(state.unit_types[unitTypeId]?.cost ?? 0)),
    });
  }
  return lines;
}

/**
 * One combat round from an adjacent sea into an enemy sea or coastal port.
 * Unopposed raiders disable one harbor and withdraw. A destroyer or a patrol pins them.
 */
export function resolveNavalRaid(
  state: GameState,
  factionId: string,
  from: string,
  to: string,
  roll: () => number,
): NavalRaidResult {
  const fail = (error: string): NavalRaidResult => ({
    ok: false,
    error,
    pinned: false,
    harborDisabled: false,
    raiderLosses: 0,
    defenderLosses: 0,
  });
  if (!facilitiesActive(state)) {
    return fail("Facilities are off.");
  }
  if (state.current_phase !== "combat_move" || state.current_faction_id !== factionId) {
    return fail("Naval raids are declared in combat move.");
  }
  if (!state.isAdjacent(from, to)) {
    return fail("A raid strikes an adjacent zone.");
  }
  const target = state.regions[to];
  if (target == null || !raidTarget(state, factionId, to)) {
    return fail("That is not an enemy sea zone or coastal port.");
  }
  const raiders = collectPieces(state, from, factionId, (id) => RAIDER.has(classOf(id) ?? ("" as RulesetUnitType)), false);
  if (raiders.reduce((sum, line) => sum + line.count, 0) <= 0) {
    return fail("No surface warships.");
  }
  const sea = defendingSea(state, from, to);
  const pinned = enemyDestroyers(state, factionId, sea) > 0 || enemyPatrolCovers(state, to, factionId);
  if (pinned) {
    if (target.isSeaRegion()) {
      moveRaiders(state, factionId, from, to);
    }
    noteCombatRaid(state, from);
    return { ok: true, error: "", pinned: true, harborDisabled: false, raiderLosses: 0, defenderLosses: 0 };
  }
  const guns = coastalGuns(state, factionId, to);
  const ships = collectPieces(state, sea, factionId, (id) => WARSHIP.has(classOf(id) ?? ("" as RulesetUnitType)), true);
  let raiderHits = 0;
  for (const line of raiders) {
    const attack = stat(state, line.unitTypeId, "attack");
    for (let i = 0; i < line.count; i += 1) {
      if (face(roll) <= attack) {
        raiderHits += 1;
      }
    }
  }
  let gunHits = 0;
  for (const line of guns) {
    for (let i = 0; i < line.count; i += 1) {
      if (face(roll) === 1) {
        gunHits += 1;
      }
    }
  }
  const defenderLosses = applyLosses(state, [...ships, ...guns], raiderHits);
  const raiderLosses = applyLosses(state, raiders, gunHits);
  const harborDisabled = ships.reduce((sum, line) => sum + line.count, 0) === 0 && disableHarbor(state, factionId, to);
  noteCombatRaid(state, from);
  return { ok: true, error: "", pinned: false, harborDisabled, raiderLosses, defenderLosses };
}

function noteCombatRaid(state: GameState, seaZoneId: string): void {
  if (seaZoneId !== "" && !state.combatRaids.includes(seaZoneId)) {
    state.combatRaids.push(seaZoneId);
  }
}

function raidTarget(state: GameState, factionId: string, regionId: string): boolean {
  const region = state.regions[regionId];
  if (region == null) {
    return false;
  }
  if (region.isSeaRegion()) {
    if (state.isRegionHostileTo(regionId, factionId)) {
      return true;
    }
    return state.getAdjacentRegions(regionId).some((id) => {
      const land = state.regions[id];
      return land?.isLandRegion() === true && land.owner_faction_id !== "" && !state.sameTeam(land.owner_faction_id, factionId);
    });
  }
  if (!region.isLandRegion() || region.owner_faction_id === "" || state.sameTeam(region.owner_faction_id, factionId)) {
    return false;
  }
  return region.harbor || state.getAdjacentRegions(regionId).some((id) => state.regions[id]?.isSeaRegion() === true);
}

function defendingSea(state: GameState, from: string, to: string): string {
  if (state.regions[to]?.isSeaRegion()) {
    return to;
  }
  if (state.regions[from]?.isSeaRegion()) {
    return from;
  }
  for (const id of [...state.getAdjacentRegions(to)].sort()) {
    if (state.regions[id]?.isSeaRegion()) {
      return id;
    }
  }
  return to;
}

function enemyDestroyers(state: GameState, factionId: string, sea: string): number {
  return collectPieces(state, sea, factionId, (id) => classOf(id) === "DESTROYER", true).reduce((sum, line) => sum + line.count, 0);
}

function coastalGuns(state: GameState, factionId: string, target: string): PieceLine[] {
  const lands: string[] = [];
  if (state.regions[target]?.isLandRegion()) {
    lands.push(target);
  } else {
    for (const id of state.getAdjacentRegions(target)) {
      const land = state.regions[id];
      if (land?.isLandRegion() && land.owner_faction_id !== "" && !state.sameTeam(land.owner_faction_id, factionId)) {
        lands.push(id);
      }
    }
  }
  const guns: PieceLine[] = [];
  for (const id of lands.sort()) {
    guns.push(...collectPieces(state, id, factionId, (unitTypeId) => isCoastalGun(state, unitTypeId), true));
  }
  return guns;
}

function applyLosses(state: GameState, lines: PieceLine[], hits: number): number {
  const queue = [...lines].sort((a, b) => a.cost - b.cost || a.unitTypeId.localeCompare(b.unitTypeId));
  let left = Math.max(0, hits);
  let taken = 0;
  for (const line of queue) {
    if (left <= 0) {
      break;
    }
    const take = Math.min(line.count, left);
    trimStack(state, line.regionId, line.factionId, line.unitTypeId, take);
    left -= take;
    taken += take;
  }
  return taken;
}

function trimStack(state: GameState, regionId: string, factionId: string, unitTypeId: string, count: number): void {
  let left = count;
  const units = state.region_units[regionId] ?? [];
  for (let i = units.length - 1; i >= 0 && left > 0; i -= 1) {
    const entry = units[i];
    if (String(entry.faction_id ?? "") !== factionId || String(entry.unit_type_id ?? "") !== unitTypeId || entry.instance_id) {
      continue;
    }
    const have = stackCount(entry);
    if (have > left) {
      entry.count = have - left;
      left = 0;
    } else {
      left -= have;
      units.splice(i, 1);
    }
  }
}

function moveRaiders(state: GameState, factionId: string, from: string, to: string): void {
  const moving = collectPieces(state, from, factionId, (id) => RAIDER.has(classOf(id) ?? ("" as RulesetUnitType)), false);
  for (const line of moving) {
    trimStack(state, from, line.factionId, line.unitTypeId, line.count);
    const units = state.region_units[to] ?? [];
    state.region_units[to] = units;
    const found = units.find((entry) => entry.faction_id === factionId && entry.unit_type_id === line.unitTypeId && !entry.instance_id);
    if (found) {
      found.count = stackCount(found) + line.count;
    } else {
      units.push({ faction_id: factionId, unit_type_id: line.unitTypeId, count: line.count });
    }
  }
}

function disableHarbor(state: GameState, factionId: string, target: string): boolean {
  const candidates: string[] = [];
  if (state.regions[target]?.harbor) {
    candidates.push(target);
  }
  for (const id of [...state.getAdjacentRegions(target)].sort()) {
    const land = state.regions[id];
    if (land?.isLandRegion() && land.harbor && land.owner_faction_id !== "" && !state.sameTeam(land.owner_faction_id, factionId)) {
      candidates.push(id);
    }
  }
  for (const id of candidates) {
    const land = state.regions[id];
    if (land?.harbor) {
      land.harbor_disabled_until = state.game_round + 1;
      return true;
    }
  }
  return false;
}

/**
 * Each enemy submarine in an isConvoyZone next to this faction's coast takes 1 Industrial Output.
 * A sea zone cannot take more than the highest adjacent coast that faction owns. No dice.
 */
export function convoyDrain(state: GameState, factionId: string): number {
  if (!facilitiesActive(state) || factionId === "") {
    return 0;
  }
  let loss = 0;
  for (const regionId of Object.keys(state.regions)) {
    const sea = state.regions[regionId];
    if (sea == null || !sea.isSeaRegion() || !sea.is_convoy_zone) {
      continue;
    }
    let subs = 0;
    for (const entry of state.getUnitsInRegion(regionId)) {
      if (state.sameTeam(String(entry.faction_id ?? ""), factionId)) {
        continue;
      }
      if (classOf(String(entry.unit_type_id ?? "")) === "SUBMARINE") {
        subs += stackCount(entry);
      }
    }
    if (subs <= 0) {
      continue;
    }
    let cap = 0;
    for (const neighbor of state.getAdjacentRegions(regionId)) {
      const land = state.regions[neighbor];
      if (land?.isLandRegion() && land.owner_faction_id === factionId) {
        cap = Math.max(cap, printedOutput(land));
      }
    }
    loss += Math.min(subs, cap);
  }
  return loss;
}
