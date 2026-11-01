/**
 * Playground contract for the strategy-demo rules engine.
 *
 * Property names match the GDScript model in core/model and the command
 * payloads accepted by GameSession.apply_command. This file has no engine
 * implementation. Google Playground should import the types and
 * MOCK_INITIAL_STATE, and stub GameActions.
 *
 * Naming map (GDScript -> this file):
 * - Region (type "land" | "sea") -> Territory | SeaZone
 * - class Unit (catalog row from data/units.json) -> UnitType
 * - region_units entry -> Unit
 * - CombatEngine battle dict -> CombatState (derived, not persisted)
 * - GameEvent DICE_ROLLED payload -> DiceRollResult (hit totals only)
 *
 * The live engine does not store CombatState or per-die rolls. Battles are
 * found by scanning region_units, and each round records attacker_hits and
 * defender_hits. Casualties are applied automatically, cheapest cost first.
 * resolveCombatRound below is the per-round slice of CombatEngine._resolve_battle
 * so the canvas can animate a round. The current engine does not pause between
 * rounds; resolveAllBattles runs the whole fight.
 */

export const TURN_PHASES = [
  "purchase",
  "combat_move",
  "combat",
  "noncombat_move",
  "mobilize",
  "collect_income",
] as const;

export type TurnPhase = (typeof TURN_PHASES)[number];

export const COMMAND_TYPES = [
  "purchase_units",
  "move_units",
  "load_transport",
  "unload_transport",
  "designate_amphibious",
  "place_units",
  "end_phase",
  "end_turn",
  "strategic_bomb",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export const EVENT_TYPES = [
  "phase_changed",
  "units_purchased",
  "purchase_failed",
  "units_moved",
  "transport_loaded",
  "transport_unloaded",
  "amphibious_declared",
  "amphibious_cancelled",
  "battle_started",
  "dice_rolled",
  "units_destroyed",
  "cargo_destroyed",
  "battle_finished",
  "region_captured",
  "units_placed",
  "placement_forfeited",
  "income_collected",
  "turn_ended",
  "game_finished",
] as const;

export type GameEventType = (typeof EVENT_TYPES)[number];

export type UnitCategory = "land" | "air" | "sea";
export type RegionType = "land" | "sea";
export type BattleType = "land" | "naval";
export type BattleResult =
  | "attacker_won"
  | "defender_won"
  | "mutual_destruction"
  | "draw"
  | "in_progress";

/** Catalog row. GDScript class Unit, loaded from data/units.json. JSON key is "move"; the runtime field is movement. */
export interface UnitType {
  id: string;
  name: string;
  category: UnitCategory;
  attack: number;
  defense: number;
  movement: number;
  cost: number;
  container: Record<string, unknown>;
  special: Record<string, unknown>;
}

/** GDScript class Faction. */
export interface Faction {
  id: string;
  name: string;
  color: string;
  starting_ipc: number;
  turn_order: number;
}

/**
 * Shared region record. GDScript class Region.
 * Land and sea are the same object with type "land" or "sea".
 * Sea zones have ipc_value 0, is_capital false, has_factory false.
 */
export interface Region {
  id: string;
  name: string;
  type: RegionType;
  ipc_value: number;
  owner_faction_id: string;
  is_capital: boolean;
  has_factory: boolean;
  adjacent: string[];
}

export interface Territory extends Region {
  type: "land";
}

export interface SeaZone extends Region {
  type: "sea";
}

/**
 * One stack or one container instance inside region_units[region_id].
 * Stacks omit instance_id. Transports, carriers, and other containers set instance_id.
 */
export interface Unit {
  faction_id: string;
  unit_type_id: string;
  count: number;
  instance_id?: string;
}

export interface CargoLine {
  unit_type_id: string;
  count: number;
}

/** transport_instances[instance_id]. */
export interface TransportInstance {
  region_id: string;
  cargo: CargoLine[];
}

export interface PurchaseLine {
  unit_type_id: string;
  count: number;
}

export interface AmphibiousAssault {
  assault_id: string;
  transport_instance_id: string;
  origin_sea_zone_id: string;
  target_region_id: string;
  cargo: CargoLine[];
}

/**
 * Derived battle. CombatEngine._identify_battles builds this and does not store it.
 * Present on the mock so the canvas can render an in-progress fight.
 */
export interface CombatState {
  region_id: string;
  attacker_faction_id: string;
  defender_faction_id: string;
  battle_type: BattleType;
  round: number;
  status: BattleResult;
  /** Last DICE_ROLLED totals. Null before the first round. */
  last_roll: DiceRollResult | null;
}

/**
 * Engine payload is { region_id, round, attacker_hits, defender_hits }.
 * rolls is optional UI detail. CombatEngine does not keep individual faces;
 * it counts hits from (rng.next_int() % 6) + 1.
 */
export interface DiceRollResult {
  region_id: string;
  round: number;
  attacker_hits: number;
  defender_hits: number;
  rolls?: DieFace[];
}

export interface DieFace {
  faction_id: string;
  unit_type_id: string;
  side: "attack" | "defense";
  roll: number;
  hit: boolean;
}

/** One entry of command.payload.moves. GDScript MovementEngine.process_move. */
export interface MoveOrder {
  from_region_id: string;
  to_region_id: string;
  units: Unit[];
}

export interface CommandError {
  code: string;
  message: string;
}

export interface GameEvent {
  event_id: string;
  sequence: number;
  type: GameEventType;
  payload: Record<string, unknown>;
}

export interface CommandResult {
  result_type: "ok" | "error";
  error?: CommandError;
  events: GameEvent[];
  new_state?: GameState;
}

/**
 * Full mutable state. Field names match core/model/game_state.gd.
 * active_combat is not a GDScript field. It is the current CombatEngine battle
 * for the playground. Omit it (null) when no hostile stacks share a region.
 */
export interface GameState {
  game_round: number;
  current_faction_id: string;
  current_phase: TurnPhase;
  turn_number: number;
  unit_types: Record<string, UnitType>;
  factions: Record<string, Faction>;
  regions: Record<string, Territory | SeaZone>;
  adjacency: Record<string, string[]>;
  turn_order: string[];
  rules: Record<string, unknown>;
  region_units: Record<string, Unit[]>;
  ipc: Record<string, number>;
  pending_purchases: Record<string, PurchaseLine[]>;
  pending_amphibious_assaults: AmphibiousAssault[];
  factories_controlled_at_turn_start: Record<string, string[]>;
  next_instance_id: Record<string, number>;
  transport_instances: Record<string, TransportInstance>;
  game_over: boolean;
  winner_faction_id: string;
  /** Keys are "faction_id|region_id|unit_type_id". */
  units_arrived_this_phase: Record<string, number>;
  units_embarked_this_phase: Record<string, number>;
  instances_moved_this_phase: Record<string, boolean>;
  active_combat: CombatState | null;
  rng: { state: number; sequence: number };
}

export interface UnitMovePreview {
  legal_regions: string[];
  illegal_regions: Record<string, string>;
  special_actions: Array<{ action_type: string; target_region: string }>;
}

/**
 * Every call the HUD and canvas need. Names are the playground API.
 * The GDScript source of each call is noted on the method.
 */
export interface GameActions {
  /** GameSession.get_state / GameState.to_snapshot, plus active_combat. */
  getState(): GameState;

  /** GameSession.get_legal_commands. Empty array when player_id is not the active faction. */
  getLegalCommands(playerId: string): CommandType[];

  /**
   * MovementValidator.get_legal_destinations_for_stack, or
   * get_legal_destinations_for_instance when instanceId is set.
   * GameSessionStub.get_legal_move_destinations.
   */
  getValidMoves(
    fromRegionId: string,
    unitTypeId: string,
    factionId: string,
    instanceId?: string
  ): UnitMovePreview;

  /** Command type "move_units". MovementEngine.process_move. */
  commitMove(order: MoveOrder, playerId: string): CommandResult;

  /** Command type "load_transport". */
  loadTransport(args: {
    player_id: string;
    transport_instance_id: string;
    from_region_id: string;
    units: Unit[];
  }): CommandResult;

  /** Command type "unload_transport". */
  unloadTransport(args: {
    player_id: string;
    transport_instance_id: string;
    to_region_id: string;
    units: CargoLine[];
  }): CommandResult;

  /** TransportLoadValidator.get_legal_load_destinations. */
  getValidLoadDestinations(
    fromRegionId: string,
    unitTypeId: string,
    factionId: string
  ): string[];

  /** Command type "designate_amphibious". AmphibiousEngine.designate_assault. */
  designateAmphibious(args: {
    player_id: string;
    transport_instance_id: string;
    origin_sea_zone_id: string;
    target_region_id: string;
  }): CommandResult;

  /**
   * One iteration of CombatEngine._resolve_battle.
   * Both sides roll, then casualties come off cheapest unit_type.cost first.
   * Does not exist as its own GDScript method. resolve_all_battles loops this
   * until one side has no combat units (attack > 0 or defense > 0).
   */
  resolveCombatRound(territoryId: string): CommandResult;

  /** CombatEngine.resolve_all_battles. Called from EndPhaseController when leaving "combat". */
  resolveAllBattles(attackerFactionId: string): CommandResult;

  /** Command type "purchase_units". EconomyEngine.process_purchase. Does not place units. */
  purchaseUnits(items: PurchaseLine[], playerId: string): CommandResult;

  /** EconomyEngine.can_afford. */
  canAfford(factionId: string, unitTypeId: string, count?: number): boolean;

  /** Command type "place_units". PlacementEngine.process_placement. Phase must be "mobilize". */
  placeUnits(args: {
    player_id: string;
    placements: Array<{ region_id: string; units: PurchaseLine[] }>;
  }): CommandResult;

  /** PlacementValidator.get_valid_placement_regions / Ruleset.get_legal_mobilize_regions. */
  getValidPlacementRegions(factionId: string, unitTypeId: string): string[];

  /** Command type "strategic_bomb". Damage is one d6 subtracted from the target owner's IPC. */
  strategicBomb(regionId: string, playerId: string): CommandResult;

  /** Command type "end_phase". TurnEngine.advance_phase. Combat phase also resolves battles. */
  advancePhase(playerId: string): CommandResult;

  /**
   * Command type "end_turn". Switches faction, resets phase to "purchase",
   * increments turn_number, and increments game_round when turn order wraps.
   * Stub path also collects land IPC via EconomyEngine.collect_income.
   */
  endTurn(playerId: string): CommandResult;

  /** EconomyEngine.calculate_income. Land ipc_value of regions owned by faction. Sea zones add 0. */
  previewIncome(factionId: string): number;

  /** VictoryEngine.check_victory. Win when one faction owns every is_capital region. */
  checkVictory(): CommandResult;
}

export const UNIT_CATALOG: Record<string, UnitType> = {
  infantry: {
    id: "infantry",
    name: "Infantry",
    category: "land",
    cost: 3,
    attack: 1,
    defense: 2,
    movement: 1,
    container: {},
    special: { can_be_boosted_by_artillery: true },
  },
  artillery: {
    id: "artillery",
    name: "Artillery",
    category: "land",
    cost: 4,
    attack: 2,
    defense: 2,
    movement: 1,
    container: {},
    special: { boosts_infantry: true, boosts_infantry_attack_to: 2 },
  },
  mech_infantry: {
    id: "mech_infantry",
    name: "Mechanised Infantry",
    category: "land",
    cost: 4,
    attack: 1,
    defense: 2,
    movement: 2,
    container: {},
    special: {
      can_be_boosted_by_artillery: true,
      moves_like_tank: true,
      can_blitz_with_tank: true,
    },
  },
  tank: {
    id: "tank",
    name: "Tank",
    category: "land",
    cost: 6,
    attack: 3,
    defense: 3,
    movement: 2,
    container: {},
    special: {
      can_blitz: true,
      boosts_tactical_bomber: true,
      can_be_boosted_by_tactical_bomber: true,
    },
  },
  fighter: {
    id: "fighter",
    name: "Fighter",
    category: "air",
    cost: 10,
    attack: 3,
    defense: 4,
    movement: 4,
    container: {},
    special: { can_land_on_carrier: true, can_scramble: true },
  },
  tactical_bomber: {
    id: "tactical_bomber",
    name: "Tactical Bomber",
    category: "air",
    cost: 11,
    attack: 3,
    defense: 3,
    movement: 4,
    container: {},
    special: {
      boosts_tanks: true,
      can_be_boosted_by_tanks: true,
      can_bomb_naval_base: true,
      can_bomb_air_base: true,
    },
  },
  strategic_bomber: {
    id: "strategic_bomber",
    name: "Strategic Bomber",
    category: "air",
    cost: 12,
    attack: 4,
    defense: 1,
    movement: 6,
    container: {},
    special: {
      can_strategic_bomb_factory: true,
      can_bomb_naval_base: true,
      can_bomb_air_base: true,
    },
  },
  submarine: {
    id: "submarine",
    name: "Submarine",
    category: "sea",
    cost: 6,
    attack: 2,
    defense: 1,
    movement: 2,
    container: {},
    special: {
      has_surprise_strike: true,
      can_submerge: true,
      cannot_hit_air: true,
      requires_destroyer_to_be_hit_by_air: true,
    },
  },
  destroyer: {
    id: "destroyer",
    name: "Destroyer",
    category: "sea",
    cost: 8,
    attack: 2,
    defense: 2,
    movement: 2,
    container: {},
    special: { cancels_submarine_abilities: true },
  },
  cruiser: {
    id: "cruiser",
    name: "Cruiser",
    category: "sea",
    cost: 12,
    attack: 3,
    defense: 3,
    movement: 2,
    container: {},
    special: { shore_bombardment_attack: 3 },
  },
  battleship: {
    id: "battleship",
    name: "Battleship",
    category: "sea",
    cost: 20,
    attack: 4,
    defense: 4,
    movement: 2,
    container: {},
    special: { shore_bombardment_attack: 4, takes_two_hits: true },
  },
  carrier: {
    id: "carrier",
    name: "Aircraft Carrier",
    category: "sea",
    cost: 16,
    attack: 1,
    defense: 2,
    movement: 2,
    container: {},
    special: { fighter_capacity: 2, can_host_fighters: true, can_host_tactical_bombers: true },
  },
  transport: {
    id: "transport",
    name: "Transport",
    category: "sea",
    cost: 7,
    attack: 0,
    defense: 0,
    movement: 2,
    container: { max_cargo_slots: 2 },
    special: {
      can_carry_infantry: true,
      can_carry_other_land_unit: true,
      max_cargo_slots: 2,
      cannot_attack: true,
      cannot_defend: true,
      dies_first: true,
    },
  },
};

const land = (
  id: string,
  name: string,
  ipc: number,
  owner: string,
  adjacent: string[],
  capital = false,
  factory = false
): Territory => ({
  id,
  name,
  type: "land",
  ipc_value: ipc,
  owner_faction_id: owner,
  is_capital: capital,
  has_factory: factory,
  adjacent,
});

const sea = (id: string, name: string, adjacent: string[]): SeaZone => ({
  id,
  name,
  type: "sea",
  ipc_value: 0,
  owner_faction_id: "",
  is_capital: false,
  has_factory: false,
  adjacent,
});

/**
 * Ten connected regions. Allies are in combat phase with a land battle in
 * france (Allied infantry, artillery, and a tank vs Axis infantry and artillery)
 * and a naval battle in sz_english_channel (Allied battleship vs Axis submarine).
 * Transport cargo, a carrier, pending purchases, and one declared amphibious
 * assault are filled in so the HUD has every panel to render.
 */
export const MOCK_INITIAL_STATE: GameState = {
  game_round: 1,
  current_faction_id: "allies",
  current_phase: "combat",
  turn_number: 1,
  unit_types: UNIT_CATALOG,
  factions: {
    allies: {
      id: "allies",
      name: "Allies",
      color: "#5C7538",
      starting_ipc: 28,
      turn_order: 0,
    },
    axis: {
      id: "axis",
      name: "Axis",
      color: "#8C3A3A",
      starting_ipc: 32,
      turn_order: 1,
    },
  },
  regions: {
    united_kingdom: land(
      "united_kingdom",
      "United Kingdom",
      8,
      "allies",
      ["sz_english_channel", "sz_north_sea"],
      true,
      true
    ),
    france: land("france", "France", 4, "axis", [
      "sz_english_channel",
      "sz_bay_of_biscay",
      "western_germany",
      "low_countries",
    ]),
    western_germany: land(
      "western_germany",
      "Western Germany",
      6,
      "axis",
      ["france", "germany", "low_countries", "sz_baltic"],
      false,
      true
    ),
    germany: land(
      "germany",
      "Germany",
      10,
      "axis",
      ["western_germany", "sz_baltic"],
      true,
      true
    ),
    low_countries: land("low_countries", "Low Countries", 3, "axis", [
      "france",
      "western_germany",
      "sz_english_channel",
    ]),
    norway: land("norway", "Norway", 3, "allies", ["sz_north_sea", "sz_baltic"]),
    sz_english_channel: sea("sz_english_channel", "English Channel", [
      "united_kingdom",
      "france",
      "low_countries",
      "sz_north_sea",
      "sz_bay_of_biscay",
    ]),
    sz_north_sea: sea("sz_north_sea", "North Sea", [
      "united_kingdom",
      "norway",
      "sz_english_channel",
      "sz_baltic",
    ]),
    sz_baltic: sea("sz_baltic", "Baltic Sea", [
      "norway",
      "germany",
      "western_germany",
      "sz_north_sea",
    ]),
    sz_bay_of_biscay: sea("sz_bay_of_biscay", "Bay of Biscay", [
      "france",
      "sz_english_channel",
    ]),
  },
  adjacency: {
    united_kingdom: ["sz_english_channel", "sz_north_sea"],
    france: ["sz_english_channel", "sz_bay_of_biscay", "western_germany", "low_countries"],
    western_germany: ["france", "germany", "low_countries", "sz_baltic"],
    germany: ["western_germany", "sz_baltic"],
    low_countries: ["france", "western_germany", "sz_english_channel"],
    norway: ["sz_north_sea", "sz_baltic"],
    sz_english_channel: [
      "united_kingdom",
      "france",
      "low_countries",
      "sz_north_sea",
      "sz_bay_of_biscay",
    ],
    sz_north_sea: ["united_kingdom", "norway", "sz_english_channel", "sz_baltic"],
    sz_baltic: ["norway", "germany", "western_germany", "sz_north_sea"],
    sz_bay_of_biscay: ["france", "sz_english_channel"],
  },
  turn_order: ["allies", "axis"],
  rules: {
    victory: "all_enemy_capitals_captured",
    casualty_order: "cheapest_cost_first",
    die: "d6",
    hit_when: "roll_less_or_equal_stat",
  },
  region_units: {
    united_kingdom: [
      { faction_id: "allies", unit_type_id: "infantry", count: 3 },
      { faction_id: "allies", unit_type_id: "fighter", count: 1 },
      { faction_id: "allies", unit_type_id: "strategic_bomber", count: 1 },
    ],
    france: [
      { faction_id: "allies", unit_type_id: "infantry", count: 2 },
      { faction_id: "allies", unit_type_id: "artillery", count: 1 },
      { faction_id: "allies", unit_type_id: "tank", count: 1 },
      { faction_id: "axis", unit_type_id: "infantry", count: 3 },
      { faction_id: "axis", unit_type_id: "artillery", count: 1 },
    ],
    western_germany: [
      { faction_id: "axis", unit_type_id: "infantry", count: 2 },
      { faction_id: "axis", unit_type_id: "tank", count: 2 },
    ],
    germany: [
      { faction_id: "axis", unit_type_id: "infantry", count: 4 },
      { faction_id: "axis", unit_type_id: "fighter", count: 1 },
    ],
    low_countries: [{ faction_id: "axis", unit_type_id: "infantry", count: 1 }],
    norway: [{ faction_id: "allies", unit_type_id: "infantry", count: 2 }],
    sz_english_channel: [
      {
        faction_id: "allies",
        unit_type_id: "battleship",
        count: 1,
        instance_id: "battleship_allies_001",
      },
      {
        faction_id: "allies",
        unit_type_id: "transport",
        count: 1,
        instance_id: "transport_allies_001",
      },
      {
        faction_id: "axis",
        unit_type_id: "submarine",
        count: 1,
        instance_id: "submarine_axis_001",
      },
    ],
    sz_north_sea: [
      {
        faction_id: "allies",
        unit_type_id: "carrier",
        count: 1,
        instance_id: "carrier_allies_001",
      },
      {
        faction_id: "allies",
        unit_type_id: "destroyer",
        count: 1,
        instance_id: "destroyer_allies_001",
      },
      { faction_id: "allies", unit_type_id: "fighter", count: 1 },
    ],
    sz_baltic: [
      {
        faction_id: "axis",
        unit_type_id: "cruiser",
        count: 1,
        instance_id: "cruiser_axis_001",
      },
      {
        faction_id: "axis",
        unit_type_id: "transport",
        count: 1,
        instance_id: "transport_axis_001",
      },
    ],
    sz_bay_of_biscay: [],
  },
  ipc: { allies: 17, axis: 24 },
  pending_purchases: {
    allies: [],
    axis: [
      { unit_type_id: "infantry", count: 2 },
      { unit_type_id: "tank", count: 1 },
    ],
  },
  pending_amphibious_assaults: [
    {
      assault_id: "amp_001",
      transport_instance_id: "transport_axis_001",
      origin_sea_zone_id: "sz_baltic",
      target_region_id: "norway",
      cargo: [
        { unit_type_id: "infantry", count: 1 },
        { unit_type_id: "artillery", count: 1 },
      ],
    },
  ],
  factories_controlled_at_turn_start: {
    allies: ["united_kingdom"],
    axis: ["germany", "western_germany"],
  },
  next_instance_id: {
    transport_allies: 2,
    transport_axis: 2,
    battleship_allies: 2,
    submarine_axis: 2,
    carrier_allies: 2,
    destroyer_allies: 2,
    cruiser_axis: 2,
  },
  transport_instances: {
    transport_allies_001: {
      region_id: "sz_english_channel",
      cargo: [
        { unit_type_id: "infantry", count: 1 },
        { unit_type_id: "tank", count: 1 },
      ],
    },
    transport_axis_001: {
      region_id: "sz_baltic",
      cargo: [
        { unit_type_id: "infantry", count: 1 },
        { unit_type_id: "artillery", count: 1 },
      ],
    },
  },
  game_over: false,
  winner_faction_id: "",
  units_arrived_this_phase: {
    "allies|france|infantry": 2,
    "allies|france|artillery": 1,
    "allies|france|tank": 1,
  },
  units_embarked_this_phase: {},
  instances_moved_this_phase: {
    battleship_allies_001: true,
    submarine_axis_001: true,
  },
  active_combat: {
    region_id: "france",
    attacker_faction_id: "allies",
    defender_faction_id: "axis",
    battle_type: "land",
    round: 0,
    status: "in_progress",
    last_roll: null,
  },
  rng: { state: 12345, sequence: 1 },
};
