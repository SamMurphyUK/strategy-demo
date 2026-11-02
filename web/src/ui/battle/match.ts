// The contract between the battle board and a battle the engine is deciding.
// The board animates what it is given and reports the player's choices; it never rolls.
import type { TheaterId, UnitType } from "./combatTypes";

export interface MatchUnit {
  /** Engine battle unit id. The board uses it as the unit's uid. */
  id: string;
  type: UnitType;
  maxHp: number;
  /** What this piece cost. The outro adds these up for units destroyed in the battle. */
  cost?: number;
}

export interface MatchDie {
  roll: number;
  hit: boolean;
}

export interface MatchHit {
  unitId: string;
  result: "damaged" | "destroyed";
}

export interface MatchRound {
  /** One die per unit that fires this round, keyed by unit id. */
  dice: Record<string, MatchDie>;
  /** Casualties from submarine opening shots, by the side that suffered them. */
  surpriseCasualties: { attacker: MatchHit[]; defender: MatchHit[] };
  /** Defender casualties from the main exchange. The engine picks them. */
  defenderCasualties: MatchHit[];
  /** Hits the attacking player must assign. */
  attackerHitsToTake: number;
}

export type MatchOutcome = "attacker_wins" | "defender_wins" | "mutual" | "undecided";

export interface BattleMatch {
  theater: TheaterId;
  regionName: string;
  /** Attacking faction. Picks the battle theme. Absent in the sandbox, which uses the theater. */
  attackerFaction?: string;
  /**
   * Sandbox stand-in for the outro numbers. A map battle ignores these and counts
   * the IPC of units destroyed in the fight.
   */
  attackerIpc: number;
  defenderIpc: number;
  attackers: MatchUnit[];
  defenders: MatchUnit[];
  /** Rolls round 1, or presses on into the next round. */
  rollRound(): MatchRound;
  /** One id per hit, in order; a two-hit unit can appear twice. Returns where the battle stands. */
  confirmCasualties(unitIds: string[]): MatchOutcome;
  canRetreat(): boolean;
  retreat(): void;
  /** Leave the board once the battle is over. */
  exit(): void;
}
