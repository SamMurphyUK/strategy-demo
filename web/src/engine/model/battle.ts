export type BattleSide = "attacker" | "defender";

/** One piece in a battle. Stack counts are expanded so each piece can take its own hits. */
export interface BattleUnitState {
  id: string;
  faction_id: string;
  unit_type_id: string;
  instance_id?: string;
  hp: number;
  max_hp: number;
  /** Came off a transport this combat. It cannot retreat. */
  amphibious?: boolean;
}

export interface BattleDie {
  unit_id: string;
  side: BattleSide;
  rank: number;
  roll: number;
  hit: boolean;
  /** Submarine opening shot. Its casualties are removed before anyone else fires. */
  surprise: boolean;
  /** Anti-aircraft opening shot, before round 1. */
  aa?: boolean;
  /** Shore bombardment opening shot, before round 1. */
  bombard?: boolean;
}

export interface BattleCasualty {
  unit_id: string;
  side: BattleSide;
  result: "damaged" | "destroyed";
  /** Caused by a submarine opening shot. */
  surprise?: boolean;
  /** Caused by the defender's anti-aircraft volley. */
  aa?: boolean;
  /** Caused by shore bombardment. */
  bombard?: boolean;
}

/**
 * `awaiting_roll`: round 1 has not been rolled.
 * `awaiting_casualties`: the attacker must assign `attacker_hits_to_take` hits.
 * `awaiting_decision`: the round is over; the attacker presses on (rolls) or retreats.
 */
export type BattleStage = "awaiting_roll" | "awaiting_casualties" | "awaiting_decision";

export interface ActiveBattle {
  region_id: string;
  attacker_faction_id: string;
  defender_faction_id: string;
  battle_type: "land" | "naval";
  round: number;
  stage: BattleStage;
  attackers: BattleUnitState[];
  defenders: BattleUnitState[];
  attacker_hits_to_take: number;
  /** Of `attacker_hits_to_take`, the ones from submarines. They cannot be assigned to aircraft. */
  attacker_hits_skip_air?: number;
  /** Of `attacker_hits_to_take`, the ones from aircraft with no friendly destroyer. They cannot be assigned to submarines. */
  attacker_hits_skip_sub?: number;
  last_dice: BattleDie[];
  last_casualties: BattleCasualty[];
}
