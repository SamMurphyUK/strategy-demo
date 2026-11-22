// Aircraft spend one fuel per region entered. The same pool covers combat move and noncombat
// move, and it refills only when movement tracking clears (the next turn).
import type { GameState } from "../model/game_state";
import type { UnitStackEntry } from "../model/types";
import { normalizeUnitTypeAndFaction } from "../presentation/region_unit_display";

export interface StrandedPlane {
  regionId: string;
  unitType: string;
  count: number;
  fuel: number;
  /** A friendly landing spot is still inside the fuel that remains. */
  canReturn: boolean;
}

export function isAirUnit(state: GameState, unitType: string): boolean {
  return state.unit_types[unitType]?.category === "air";
}

export function airMovement(state: GameState, unitType: string): number {
  return Math.max(0, Math.trunc(Number(state.unit_types[unitType]?.movement ?? 0)));
}

function orderedCount(state: GameState, factionId: string, regionId: string, unitType: string): number {
  let total = 0;
  for (const order of state.phase_orders) {
    if (order.faction === factionId && order.fromRegionId === regionId && order.unitType === unitType) {
      total += Math.max(0, order.count);
    }
  }
  return total;
}

function airKey(factionId: string, regionId: string, unitType: string): string {
  return `${factionId}|${regionId}|${unitType}`;
}

function stackCount(entry: UnitStackEntry): number {
  return Math.max(0, Math.trunc(Number(entry.count ?? 0)));
}

function airCount(state: GameState, factionId: string, regionId: string, unitType: string): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    if (String(entry.faction_id ?? "") !== factionId || String(entry.unit_type_id ?? "") !== unitType) {
      continue;
    }
    if ("instance_id" in entry && String(entry.instance_id ?? "") !== "") {
      continue;
    }
    total += stackCount(entry);
  }
  return total;
}

/** Same-team land or sea with no enemy units. Combat move cannot declare an attack here. */
export function isFriendlyHeldTerritory(state: GameState, regionId: string, factionId: string): boolean {
  const region = state.regions[regionId];
  if (region == null) {
    return false;
  }
  const owner = String(region.owner_faction_id);
  if (owner === "" || !state.sameTeam(owner, factionId)) {
    return false;
  }
  return !state.isRegionHostileTo(regionId, factionId);
}

/** Fuel already used, plus a held order that has not entered its destination yet. */
export function fuelSpent(state: GameState, factionId: string, regionId: string, unitType: string): number {
  const ledger = Math.trunc(Number(state.air_movement_spent[airKey(factionId, regionId, unitType)] ?? 0));
  let pending = 0;
  if (state.current_phase === "combat_move" || state.current_phase === "noncombat_move") {
    for (const order of state.phase_orders) {
      if (order.faction !== factionId || order.unitType !== unitType || order.fromRegionId !== regionId) {
        continue;
      }
      pending += Math.max(0, order.stepsUsed);
    }
  }
  return ledger + pending;
}

export function fuelRemaining(state: GameState, factionId: string, regionId: string, unitType: string): number {
  return Math.max(0, airMovement(state, unitType) - fuelSpent(state, factionId, regionId, unitType));
}

/**
 * The fuel shown on a map token. Display factions are normalized ("ger" becomes "axis"),
 * so the ledger is read from the stack's real faction id.
 */
export function fuelForDisplayEntry(
  state: GameState,
  regionId: string,
  unitType: string,
  displayFaction: string,
): number | null {
  if (!isAirUnit(state, unitType)) {
    return null;
  }
  for (const unit of state.getUnitsInRegion(regionId)) {
    const parsed = normalizeUnitTypeAndFaction(String(unit.unit_type_id ?? ""), String(unit.faction_id ?? ""));
    if (parsed.unit_type_id !== unitType || parsed.faction_id !== displayFaction) {
      continue;
    }
    if ("instance_id" in unit && String(unit.instance_id ?? "") !== "") {
      continue;
    }
    return fuelRemaining(state, String(unit.faction_id ?? ""), regionId, unitType);
  }
  return fuelRemaining(state, displayFaction, regionId, unitType);
}

/** Record fuel on the region an air unit has actually entered. */
export function noteAirArrival(
  state: GameState,
  factionId: string,
  fromRegion: string,
  toRegion: string,
  unitType: string,
  steps: number,
): void {
  if (!isAirUnit(state, unitType) || fromRegion === "" || toRegion === "" || fromRegion === toRegion) {
    return;
  }
  const fromKey = airKey(factionId, fromRegion, unitType);
  const prior = Math.trunc(Number(state.air_movement_spent[fromKey] ?? 0));
  const arrived = prior + Math.max(0, Math.trunc(steps));
  const toKey = airKey(factionId, toRegion, unitType);
  const already = state.air_movement_spent[toKey];
  state.air_movement_spent[toKey] = already == null ? arrived : Math.max(Math.trunc(Number(already)), arrived);
  if (airCount(state, factionId, fromRegion, unitType) <= 0) {
    delete state.air_movement_spent[fromKey];
  }
}

interface CarrierStats {
  capacity: number;
  hostsFighters: boolean;
  hostsTactical: boolean;
}

function carrierStats(state: GameState, factionId: string, seaId: string): CarrierStats {
  const stats: CarrierStats = { capacity: 0, hostsFighters: false, hostsTactical: false };
  for (const entry of state.getUnitsInRegion(seaId)) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId)) {
      continue;
    }
    const special = state.unit_types[String(entry.unit_type_id ?? "")]?.special ?? {};
    const cap = Math.trunc(Number(special.fighter_capacity ?? 0));
    if (cap <= 0) {
      continue;
    }
    stats.capacity += cap * stackCount(entry);
    if (special.can_host_fighters !== false) {
      stats.hostsFighters = true;
    }
    if (special.can_host_tactical_bombers === true) {
      stats.hostsTactical = true;
    }
  }
  return stats;
}

function fitsCarrier(state: GameState, unitType: string, stats: CarrierStats): boolean {
  const special = state.unit_types[unitType]?.special ?? {};
  if (special.can_land_on_carrier === true) {
    return stats.capacity > 0 && stats.hostsFighters;
  }
  if (unitType === "tactical_bomber") {
    return stats.hostsTactical && stats.capacity > 0;
  }
  return false;
}

function carrierAirCount(state: GameState, factionId: string, seaId: string): number {
  const stats = carrierStats(state, factionId, seaId);
  let total = 0;
  for (const entry of state.getUnitsInRegion(seaId)) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId)) {
      continue;
    }
    const unitType = String(entry.unit_type_id ?? "");
    if (!isAirUnit(state, unitType) || !fitsCarrier(state, unitType, stats)) {
      continue;
    }
    total += stackCount(entry);
  }
  return total;
}

function friendlyLand(state: GameState, factionId: string, regionId: string): boolean {
  const region = state.regions[regionId];
  if (region == null || !region.isLandRegion()) {
    return false;
  }
  if (state.territories_captured_this_turn[regionId]) {
    return false;
  }
  const owner = String(region.owner_faction_id);
  return owner !== "" && state.sameTeam(owner, factionId) && !state.isRegionHostileTo(regionId, factionId);
}

/** The whole stack is already on friendly land, or on a friendly carrier with room for every plane. */
export function isLanded(state: GameState, factionId: string, unitType: string, regionId: string): boolean {
  if (!isAirUnit(state, unitType)) {
    return true;
  }
  if (friendlyLand(state, factionId, regionId)) {
    return true;
  }
  const region = state.regions[regionId];
  if (region == null || !region.isSeaRegion() || state.isRegionHostileTo(regionId, factionId)) {
    return false;
  }
  const stats = carrierStats(state, factionId, regionId);
  if (!fitsCarrier(state, unitType, stats)) {
    return false;
  }
  const present = carrierAirCount(state, factionId, regionId);
  return present > 0 && stats.capacity >= present;
}

/** Regions an air unit can reach in `range` steps, flying over enemy pieces. The start is excluded. */
export function regionsWithin(state: GameState, start: string, range: number): string[] {
  if (start === "" || range <= 0) {
    return [];
  }
  const seen: Record<string, boolean> = { [start]: true };
  const frontier: { region: string; dist: number }[] = [{ region: start, dist: 0 }];
  const out: string[] = [];
  while (frontier.length > 0) {
    const current = frontier.shift()!;
    if (current.dist === range) {
      continue;
    }
    for (const next of state.getAdjacentRegions(current.region)) {
      if (seen[next]) {
        continue;
      }
      seen[next] = true;
      const dist = current.dist + 1;
      out.push(next);
      frontier.push({ region: next, dist });
    }
  }
  return out;
}

export function airSteps(state: GameState, from: string, to: string): number {
  if (from === "" || to === "") {
    return Number.POSITIVE_INFINITY;
  }
  if (from === to) {
    return 0;
  }
  if (state.isAdjacent(from, to)) {
    return 1;
  }
  const seen: Record<string, boolean> = { [from]: true };
  const frontier: { region: string; dist: number }[] = [{ region: from, dist: 0 }];
  while (frontier.length > 0) {
    const current = frontier.shift()!;
    for (const next of state.getAdjacentRegions(current.region)) {
      if (seen[next]) {
        continue;
      }
      const dist = current.dist + 1;
      if (next === to) {
        return dist;
      }
      seen[next] = true;
      frontier.push({ region: next, dist });
    }
  }
  return Number.POSITIVE_INFINITY;
}

export function canLandAt(state: GameState, factionId: string, unitType: string, regionId: string): boolean {
  if (friendlyLand(state, factionId, regionId)) {
    return true;
  }
  const region = state.regions[regionId];
  if (region == null || !region.isSeaRegion() || state.isRegionHostileTo(regionId, factionId)) {
    return false;
  }
  const stats = carrierStats(state, factionId, regionId);
  if (!fitsCarrier(state, unitType, stats)) {
    return false;
  }
  return stats.capacity - carrierAirCount(state, factionId, regionId) >= 1;
}

function flag(state: GameState, unitType: string, name: string): boolean {
  return Boolean(state.unit_types[unitType]?.special?.[name]);
}

function isFriendlyDestroyer(state: GameState, factionId: string, unitType: string, faction: string, count: number): boolean {
  return count > 0 && state.sameTeam(faction, factionId) && flag(state, unitType, "cancels_submarine_abilities");
}

/** A friendly destroyer is already in the zone, or already ordered to attack it. */
export function friendlyDestroyerCommitted(state: GameState, factionId: string, regionId: string): boolean {
  for (const entry of state.getUnitsInRegion(regionId)) {
    if (isFriendlyDestroyer(state, factionId, String(entry.unit_type_id ?? ""), String(entry.faction_id ?? ""), stackCount(entry))) {
      return true;
    }
  }
  for (const order of state.phase_orders) {
    if (order.toRegionId === regionId && isFriendlyDestroyer(state, factionId, order.unitType, order.faction, order.count)) {
      return true;
    }
  }
  return false;
}

/**
 * Aircraft may attack every navy piece. A sea zone whose only enemy ships are submarines
 * is not a target unless a friendly destroyer is in the attack.
 */
export function airCannotStrike(state: GameState, factionId: string, regionId: string): boolean {
  const region = state.regions[regionId];
  if (region == null || !region.isSeaRegion()) {
    return false;
  }
  let subs = 0;
  let others = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    const faction = String(entry.faction_id ?? "");
    if (faction === "" || state.sameTeam(faction, factionId)) {
      continue;
    }
    const unitType = String(entry.unit_type_id ?? "");
    const count = stackCount(entry);
    if (count <= 0) {
      continue;
    }
    const unit = state.unit_types[unitType];
    if (unit == null || unit.category === "land") {
      continue;
    }
    if (flag(state, unitType, "requires_destroyer_to_be_hit_by_air")) {
      subs += count;
    } else {
      others += count;
    }
  }
  return subs > 0 && others === 0 && !friendlyDestroyerCommitted(state, factionId, regionId);
}

/** After flying to `to`, fuel remains to reach a friendly landing spot. */
export function canReturnAfter(state: GameState, factionId: string, unitType: string, from: string, to: string): boolean {
  const steps = airSteps(state, from, to);
  const fuel = fuelRemaining(state, factionId, from, unitType);
  if (!Number.isFinite(steps) || steps > fuel) {
    return false;
  }
  if (canLandAt(state, factionId, unitType, to)) {
    return true;
  }
  const left = fuel - steps;
  for (const spot of regionsWithin(state, to, left)) {
    if (canLandAt(state, factionId, unitType, spot)) {
      return true;
    }
  }
  return false;
}

export function landingRegions(state: GameState, factionId: string, unitType: string, fromRegion: string): string[] {
  const fuel = fuelRemaining(state, factionId, fromRegion, unitType);
  const spots: string[] = [];
  for (const regionId of regionsWithin(state, fromRegion, fuel)) {
    if (canLandAt(state, factionId, unitType, regionId)) {
      spots.push(regionId);
    }
  }
  return spots;
}

export function strandedPlanes(state: GameState, factionId: string): StrandedPlane[] {
  const planes: StrandedPlane[] = [];
  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.region_units[regionId] ?? []) {
      if (String(entry.faction_id ?? "") !== factionId) {
        continue;
      }
      const unitType = String(entry.unit_type_id ?? "");
      const count = stackCount(entry) - orderedCount(state, factionId, regionId, unitType);
      if (!isAirUnit(state, unitType) || count <= 0) {
        continue;
      }
      if ("instance_id" in entry && String(entry.instance_id ?? "") !== "") {
        continue;
      }
      if (isLanded(state, factionId, unitType, regionId)) {
        continue;
      }
      const fuel = fuelRemaining(state, factionId, regionId, unitType);
      planes.push({
        regionId,
        unitType,
        count,
        fuel,
        canReturn: landingRegions(state, factionId, unitType, regionId).length > 0,
      });
    }
  }
  return planes;
}

export function describeStranded(state: GameState, planes: readonly StrandedPlane[]): string {
  return planes
    .map((plane) => {
      const name = state.unit_types[plane.unitType]?.name || plane.unitType;
      const where = state.regions[plane.regionId]?.name || plane.regionId;
      return `${name} in ${where} (${plane.fuel} fuel)`;
    })
    .join(", ");
}

/** Empty when noncombat may end. Otherwise the sentence the phase panel and the log both use. */
export function planesMustLandMessage(state: GameState, factionId: string): string {
  const blocking = strandedPlanes(state, factionId).filter((plane) => plane.canReturn);
  if (blocking.length === 0) {
    return "";
  }
  return `Fly your planes back before ending the phase: ${describeStranded(state, blocking)}.`;
}

export function planesLostMessage(state: GameState, planes: readonly StrandedPlane[]): string {
  if (planes.length === 0) {
    return "";
  }
  const verb = planes.length === 1 ? "was lost" : "were lost";
  return `${describeStranded(state, planes)} ${verb}. No landing spot was in range.`;
}

/** Remove air units that are not landed and cannot reach a landing spot. */
export function scrapUnlandablePlanes(state: GameState, factionId: string): void {
  for (const regionId of Object.keys(state.region_units)) {
    const units = state.region_units[regionId];
    if (units == null) {
      continue;
    }
    for (let i = units.length - 1; i >= 0; i--) {
      const entry = units[i];
      if (String(entry.faction_id ?? "") !== factionId) {
        continue;
      }
      const unitType = String(entry.unit_type_id ?? "");
      if (!isAirUnit(state, unitType) || stackCount(entry) <= 0) {
        continue;
      }
      if (isLanded(state, factionId, unitType, regionId)) {
        continue;
      }
      if (landingRegions(state, factionId, unitType, regionId).length > 0) {
        continue;
      }
      units.splice(i, 1);
      delete state.air_movement_spent[airKey(factionId, regionId, unitType)];
    }
  }
}

/**
 * Destinations the player may click or drag onto.
 * Combat move keeps enemy territory, and friendly territory that still has enemy units.
 * In noncombat, aircraft may end only on a landing spot they can still reach.
 */
export function offeredMoveDestinations(
  state: GameState,
  phase: string,
  factionId: string,
  fromRegion: string,
  unitType: string,
  dests: readonly string[],
): string[] {
  if (phase === "combat_move") {
    return dests.filter((regionId) => {
      if (isFriendlyHeldTerritory(state, regionId, factionId)) {
        return false;
      }
      if (!isAirUnit(state, unitType)) {
        return true;
      }
      if (!state.isRegionHostileTo(regionId, factionId)) {
        return false;
      }
      return canReturnAfter(state, factionId, unitType, fromRegion, regionId) && !airCannotStrike(state, factionId, regionId);
    });
  }
  if (phase === "noncombat_move" && isAirUnit(state, unitType)) {
    const spots = new Set(landingRegions(state, factionId, unitType, fromRegion));
    return dests.filter((regionId) => spots.has(regionId));
  }
  return [...dests];
}

export interface DeckPlane {
  unitType: string;
  factionId: string;
  count: number;
}

export interface CarrierDeck {
  carrierUnitType: string;
  carrierFactionId: string;
  capacity: number;
  parked: DeckPlane[];
}

interface CarrierSeat {
  unitType: string;
  factionId: string;
  capacity: number;
  hostsFighters: boolean;
  hostsTactical: boolean;
  parked: DeckPlane[];
  filled: number;
}

function airParkRank(unitType: string): number {
  if (unitType === "fighter") {
    return 0;
  }
  if (unitType === "tactical_bomber") {
    return 1;
  }
  return 2;
}

function carrierSeat(state: GameState, entry: UnitStackEntry): CarrierSeat | null {
  const unitType = String(entry.unit_type_id ?? "");
  const factionId = String(entry.faction_id ?? "");
  const count = stackCount(entry);
  const special = state.unit_types[unitType]?.special ?? {};
  const each = Math.trunc(Number(special.fighter_capacity ?? 0));
  if (factionId === "" || count <= 0 || each <= 0) {
    return null;
  }
  return {
    unitType,
    factionId,
    capacity: each * count,
    hostsFighters: special.can_host_fighters !== false,
    hostsTactical: special.can_host_tactical_bombers === true,
    parked: [],
    filled: 0,
  };
}

function planeFitsSeat(state: GameState, unitType: string, seat: CarrierSeat): boolean {
  return fitsCarrier(state, unitType, {
    capacity: seat.capacity,
    hostsFighters: seat.hostsFighters,
    hostsTactical: seat.hostsTactical,
  });
}

/**
 * Planes drawn on each carrier in a sea zone. Capacity is filled same-faction first, fighters before
 * tactical bombers. A plane that does not fit, and any plane in a hostile zone, stays on the map.
 */
export function carrierDecks(state: GameState, regionId: string): CarrierDeck[] {
  const region = state.regions[regionId];
  if (region == null || !region.isSeaRegion()) {
    return [];
  }
  const seats: CarrierSeat[] = [];
  const piles = new Map<string, DeckPlane>();
  for (const entry of state.getUnitsInRegion(regionId)) {
    const seat = carrierSeat(state, entry);
    if (seat) {
      seats.push(seat);
      continue;
    }
    const unitType = String(entry.unit_type_id ?? "");
    const factionId = String(entry.faction_id ?? "");
    const count = stackCount(entry);
    if (factionId === "" || count <= 0 || !isAirUnit(state, unitType)) {
      continue;
    }
    if (state.isRegionHostileTo(regionId, factionId)) {
      continue;
    }
    const key = `${factionId}|${unitType}`;
    const pile = piles.get(key);
    if (pile) {
      pile.count += count;
    } else {
      piles.set(key, { unitType, factionId, count });
    }
  }
  const planes = [...piles.values()].sort(
    (a, b) => airParkRank(a.unitType) - airParkRank(b.unitType) || a.factionId.localeCompare(b.factionId) || a.unitType.localeCompare(b.unitType),
  );
  for (const plane of planes) {
    let left = plane.count;
    const open = seats
      .filter((seat) => state.sameTeam(seat.factionId, plane.factionId) && planeFitsSeat(state, plane.unitType, seat))
      .sort((a, b) => {
        const own = (seat: CarrierSeat) => (seat.factionId === plane.factionId ? 0 : 1);
        return own(a) - own(b) || a.factionId.localeCompare(b.factionId) || a.unitType.localeCompare(b.unitType);
      });
    for (const seat of open) {
      if (left <= 0) {
        break;
      }
      const room = seat.capacity - seat.filled;
      if (room <= 0) {
        continue;
      }
      const take = Math.min(room, left);
      const held = seat.parked.find((parked) => parked.unitType === plane.unitType && parked.factionId === plane.factionId);
      if (held) {
        held.count += take;
      } else {
        seat.parked.push({ unitType: plane.unitType, factionId: plane.factionId, count: take });
      }
      seat.filled += take;
      left -= take;
    }
  }
  return seats
    .filter((seat) => seat.parked.length > 0)
    .map((seat) => ({
      carrierUnitType: seat.unitType,
      carrierFactionId: seat.factionId,
      capacity: seat.capacity,
      parked: seat.parked,
    }))
    .sort((a, b) => a.carrierFactionId.localeCompare(b.carrierFactionId) || a.carrierUnitType.localeCompare(b.carrierUnitType));
}

export interface FerryPassenger {
  unitType: string;
  count: number;
}

/**
 * Same-faction planes already sitting on this carrier. They ride with the ship and do not spend fuel.
 * Allied planes stay where they are. A plane that already has its own order is not taken.
 * `reserved` is extra planes spoken for by an earlier line in the same command.
 */
export function ferryPassengers(
  state: GameState,
  factionId: string,
  fromRegion: string,
  carrierType: string,
  carrierCount: number,
  reserved: Readonly<Record<string, number>> = {},
): FerryPassenger[] {
  const each = Math.trunc(Number(state.unit_types[carrierType]?.special?.fighter_capacity ?? 0));
  const moving = Math.trunc(carrierCount);
  if (each <= 0 || moving <= 0) {
    return [];
  }
  const deck = carrierDecks(state, fromRegion).find(
    (item) => item.carrierFactionId === factionId && item.carrierUnitType === carrierType,
  );
  if (deck == null) {
    return [];
  }
  let seats = each * moving;
  const taken: FerryPassenger[] = [];
  for (const plane of deck.parked) {
    if (plane.factionId !== factionId || seats <= 0) {
      continue;
    }
    const key = `${plane.factionId}|${plane.unitType}`;
    const movable = state.movableStackCount(factionId, fromRegion, plane.unitType) - Math.trunc(reserved[key] ?? 0);
    const count = Math.min(plane.count, movable, seats);
    if (count <= 0) {
      continue;
    }
    taken.push({ unitType: plane.unitType, count });
    seats -= count;
  }
  return taken;
}

/** How many of this stack are drawn on a carrier instead of as their own token. */
export function parkedAirCount(state: GameState, regionId: string, factionId: string, unitType: string): number {
  let total = 0;
  for (const deck of carrierDecks(state, regionId)) {
    for (const plane of deck.parked) {
      if (plane.factionId === factionId && plane.unitType === unitType) {
        total += plane.count;
      }
    }
  }
  return total;
}

/** A copy of the zone's stacks with parked aircraft removed. Entries that are not parked are the same objects. */
export function omitParkedAir<T extends { faction_id?: string; unit_type_id?: string; count?: number }>(
  state: GameState,
  regionId: string,
  units: readonly T[],
): T[] {
  const hide = new Map<string, number>();
  for (const deck of carrierDecks(state, regionId)) {
    for (const plane of deck.parked) {
      const key = `${plane.factionId}|${plane.unitType}`;
      hide.set(key, (hide.get(key) ?? 0) + plane.count);
    }
  }
  if (hide.size === 0) {
    return [...units];
  }
  const out: T[] = [];
  for (const entry of units) {
    const key = `${String(entry.faction_id ?? "")}|${String(entry.unit_type_id ?? "")}`;
    const parked = hide.get(key) ?? 0;
    const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    if (parked <= 0 || count <= 0) {
      out.push(entry);
      continue;
    }
    const take = Math.min(parked, count);
    hide.set(key, parked - take);
    const left = count - take;
    if (left > 0) {
      out.push({ ...entry, count: left });
    }
  }
  return out;
}

/** Fuel the sortie spends: the flight to `to`, plus the hop from there to the nearest deck or airfield. */
export function sortieCost(state: GameState, factionId: string, unitType: string, from: string, to: string): number | null {
  const steps = airSteps(state, from, to);
  const fuel = fuelRemaining(state, factionId, from, unitType);
  if (!Number.isFinite(steps) || steps <= 0 || steps > fuel) {
    return null;
  }
  if (canLandAt(state, factionId, unitType, to)) {
    return steps;
  }
  const left = fuel - steps;
  let back = Number.POSITIVE_INFINITY;
  for (const spot of regionsWithin(state, to, left)) {
    if (!canLandAt(state, factionId, unitType, spot)) {
      continue;
    }
    const hop = airSteps(state, to, spot);
    if (hop < back) {
      back = hop;
    }
  }
  if (!Number.isFinite(back)) {
    return null;
  }
  return steps + back;
}

export interface LandingMark {
  regionId: string;
  tone: "safe" | "tight";
}

/**
 * Landing spots to paint. In combat move they are the fields still in range after the hovered attack.
 * In noncombat they are the fields the plane can reach from where it is. The hovered attack region is
 * left out, so the attack wash stays on it.
 */
export function landingMarks(
  state: GameState,
  factionId: string,
  unitType: string,
  from: string,
  hover: string,
  phase: string,
): LandingMark[] {
  if (!isAirUnit(state, unitType)) {
    return [];
  }
  let origin = from;
  let budget = fuelRemaining(state, factionId, from, unitType);
  if (phase === "combat_move") {
    if (hover === "" || hover === from) {
      return [];
    }
    const steps = airSteps(state, from, hover);
    if (!Number.isFinite(steps) || steps <= 0 || steps > budget) {
      return [];
    }
    origin = hover;
    budget -= steps;
  } else if (phase !== "noncombat_move") {
    return [];
  }
  const marks: LandingMark[] = [];
  for (const spot of regionsWithin(state, origin, budget)) {
    if (!canLandAt(state, factionId, unitType, spot)) {
      continue;
    }
    const used = airSteps(state, origin, spot);
    const leftover = budget - used;
    const land = state.regions[spot]?.isLandRegion() === true;
    marks.push({ regionId: spot, tone: land && leftover >= 1 ? "safe" : "tight" });
  }
  marks.sort((a, b) => a.regionId.localeCompare(b.regionId));
  return marks;
}
