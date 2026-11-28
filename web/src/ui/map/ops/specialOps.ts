// What a selected unit can do as a special operation, and what a raid reported. Pure: every answer is the headless engine's.
//
//   combat       strategic bombing: heavy bombers on a major factory, tactical bombers on an airbase, harbor or depot
//   combat move  a naval raid: a carrier, cruiser or destroyer into an adjacent enemy sea zone or coastal port
//   non-combat   an air patrol: up to three fighters on an operational airbase or a carrier
//
// Nothing here decides legality. getBombOptions, navalRaidTargets and patrolEligible are the engine's own pre-roll checks, and the
// commands they lead to (strategic_bomb, naval_raid, and the patrols on end_phase) run the engine's own validators again.
import type { GameSession } from "../../../engine";
import type { GameState } from "../../../engine/model/game_state";
import { navalRaidTargets, patrolEligible } from "../../../engine/rules/optional/airAndNavalRaiding";
import { classifyUnit } from "../../../engine/types/ruleset";

export type OpIcon = "factory" | "airbase" | "harbor" | "depot" | "raid" | "patrol";
export type OpKind = "bomb" | "raid" | "patrol";

export interface OpOption {
  /** `bomb:factory`, `bomb:airbase`, `raid`, `patrol`. */
  id: string;
  kind: OpKind;
  icon: OpIcon;
  label: string;
  /** A bombing: the facility, and the fighters that could escort a raid on a factory. */
  facility?: "factory" | "airbase" | "harbor" | "depot";
  maxEscorts?: number;
  /** A raid: the zones it could strike. */
  targets?: string[];
  /** A patrol: how many fighters could fly, and how many are set. */
  max?: number;
  current?: number;
}

const BOMB_LABEL = {
  factory: "Bomb the factory",
  airbase: "Bomb the airbase",
  harbor: "Bomb the harbor",
  depot: "Bomb the depot",
} as const;

const RAIDERS = new Set(["CARRIER", "CRUISER", "DESTROYER"]);

/** The special operations the engine offers a unit of this type, standing in `regionId`, now. Empty when the optional rule is off. */
export function opsFor(game: GameSession, state: GameState, faction: string, regionId: string, unitTypeId: string): OpOption[] {
  if (!state.rulesetConfig.facilitiesAndPatrols || state.current_faction_id !== faction) {
    return [];
  }
  const kind = classifyUnit(unitTypeId);
  if (state.current_phase === "combat") {
    if (kind !== "HEAVY_BOMBER" && kind !== "TACTICAL_BOMBER") {
      return [];
    }
    // Heavy bombers raid factories; tactical bombers close an airbase, a harbor or a depot.
    return game
      .getBombOptions(faction, regionId)
      .filter((option) => (option.facility === "factory") === (kind === "HEAVY_BOMBER"))
      .map((option) => ({
        id: `bomb:${option.facility}`,
        kind: "bomb" as const,
        icon: option.facility,
        label: BOMB_LABEL[option.facility],
        facility: option.facility,
        maxEscorts: option.maxEscorts,
      }));
  }
  if (state.current_phase === "combat_move" && kind != null && RAIDERS.has(kind)) {
    const targets = navalRaidTargets(state, faction, regionId);
    return targets.length > 0 ? [{ id: "raid", kind: "raid", icon: "raid", label: "Naval raid", targets }] : [];
  }
  if (state.current_phase === "noncombat_move" && kind === "FIGHTER") {
    const eligible = patrolEligible(state, faction, regionId);
    return eligible ? [{ id: "patrol", kind: "patrol", icon: "patrol", label: "Air patrol", max: eligible.max, current: eligible.current }] : [];
  }
  return [];
}

/** The next patrol size when the option is clicked: one more fighter, back to none after the most. */
export function nextPatrolCount(current: number, max: number): number {
  return current >= max ? 0 : current + 1;
}

export interface OpReport {
  kind: "bomb" | "raid";
  /** The window's heading. */
  title: string;
  /** Where the raid struck, and where it set out (a raid). */
  regionId: string;
  fromRegionId?: string;
  outcome: "success" | "failure";
  /** The one line under the heading: Success or Failure, and what it came to. */
  headline: string;
  lines: string[];
}

type EventLike = { payload?: Record<string, unknown> };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function num(value: unknown): number {
  return Math.max(0, Math.trunc(Number(value ?? 0)));
}

/**
 * The raid an applied command reported, read off its events, or null when it reported none. The words are the headless result's: the
 * figures are the engine's, and success means the raid did something (damage dealt, a facility closed, a raider got through).
 */
export function reportFromEvents(events: readonly EventLike[], regionName: (regionId: string) => string): OpReport | null {
  for (const event of events) {
    const p = event.payload;
    if (!p) {
      continue;
    }
    const where = regionName(String(p.region_id ?? ""));
    if (p.reason === "strategic_bomb" && p.facility === "factory") {
      const damage = num(p.damage);
      const lines = [
        `Anti-aircraft: ${plural(num(p.bomber_losses), "bomber")} lost`,
        `Escorts against interceptors: ${plural(num(p.escort_losses), "escort")} and ${plural(num(p.interceptor_losses), "interceptor")} lost`,
        `Factory damage: ${damage} (repair tokens now ${num(p.tokens)})`,
      ];
      return {
        kind: "bomb",
        title: `Strategic bombing: ${where}`,
        regionId: String(p.region_id ?? ""),
        outcome: damage > 0 ? "success" : "failure",
        headline: damage > 0 ? `Success: ${damage} damage to the factory` : "Failure: no damage done",
        lines,
      };
    }
    if (p.reason === "tactical_interdiction") {
      const hits = num(p.hits);
      const facility = String(p.facility ?? "facility");
      return {
        kind: "bomb",
        title: `Interdiction: ${where}`,
        regionId: String(p.region_id ?? ""),
        outcome: hits > 0 ? "success" : "failure",
        headline: hits > 0 ? `Success: the ${facility} is closed through round ${num(p.disabled_until)}` : `Failure: the ${facility} stays open`,
        lines: [`Hits: ${hits}`],
      };
    }
    if (p.reason === "naval_raid") {
      const closed = p.harbor_disabled === true;
      const defenders = num(p.defender_losses);
      const pinned = p.pinned === true;
      const success = !pinned && (closed || defenders > 0);
      return {
        kind: "raid",
        title: `Naval raid: ${where}`,
        regionId: String(p.region_id ?? ""),
        fromRegionId: String(p.from_region_id ?? ""),
        outcome: success ? "success" : "failure",
        headline: pinned ? "Failure: the raiders were pinned" : success ? `Success: ${closed ? "the harbor is closed" : `${plural(defenders, "defender")} lost`}` : "Failure: the raiders withdrew",
        lines: pinned
          ? ["Enemy destroyers or a patrol held the raiders; no shots were exchanged"]
          : [`Raiders lost: ${num(p.raider_losses)}`, `Defenders lost: ${defenders}`, closed ? "The harbor is closed" : "The harbor stays open"],
      };
    }
  }
  return null;
}
