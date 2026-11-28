// The facility emblems of a territory, with the words each one says on hover. Pure.
//
// A territory shows what it holds as compact emblems next to its flag: the capital's star, a factory (major or minor), a port and an
// airbase. Hovering one says exactly what it is and what state it is in: a factory's build slots and its damage, a port's or an airbase's
// closure. Nothing here changes the rules; it reads the state.
import { factorySlots } from "../../engine/placement/productionCap";
import type { GameState } from "../../engine/model/game_state";
import type { Region } from "../../engine/model/region";
import { factionName } from "../map/session/event_text";

export type EmblemId = "capital" | "factory" | "port" | "airbase";

export interface Emblem {
  id: EmblemId;
  /** The emblem's name. */
  label: string;
  /** What to say on hover: the name and its state, in one concise line. */
  detail: string;
  /** A major factory: drawn heavier than a minor one. */
  major: boolean;
  /** A port or an airbase that is closed, or a factory that is damaged. */
  impaired: boolean;
}

/** The rounds a facility is closed for, or 0 when it is open. */
function closedFor(state: GameState, closedThrough: number): number {
  return closedThrough > state.game_round ? closedThrough : 0;
}

/** Every emblem a territory carries, in the order they sit beside the flag: capital, factory, port, airbase. */
export function regionEmblems(state: GameState, region: Region): Emblem[] {
  if (!region.isLandRegion()) {
    return [];
  }
  const out: Emblem[] = [];
  if (region.is_capital) {
    const home = region.original_owner_id || region.owner_faction_id;
    const held = region.owner_faction_id !== "" && region.owner_faction_id !== home;
    out.push({
      id: "capital",
      label: "Capital",
      detail: held ? `Capital of ${factionName(home)}, held by ${factionName(region.owner_faction_id)}` : `Capital of ${factionName(home)}`,
      major: false,
      impaired: held,
    });
  }
  if (region.has_factory) {
    const slots = factorySlots(state, region);
    const damage = Math.max(0, Math.trunc(state.repairTokens[region.id] ?? 0));
    const kind = region.major_factory ? "Major factory" : "Minor factory";
    out.push({
      id: "factory",
      label: kind,
      detail:
        damage > 0
          ? `${kind}: builds up to ${slots} units a turn, ${damage} slot${damage === 1 ? "" : "s"} out of action until repaired`
          : `${kind}: builds up to ${slots} units a turn, undamaged`,
      major: region.major_factory,
      impaired: damage > 0,
    });
  }
  if (region.harbor) {
    const closed = closedFor(state, region.harbor_disabled_until);
    out.push({
      id: "port",
      label: "Port",
      detail: closed > 0 ? `Port: closed through round ${closed}` : "Port: harbor open",
      major: false,
      impaired: closed > 0,
    });
  }
  if (region.airbase) {
    const closed = closedFor(state, region.airbase_disabled_until);
    out.push({
      id: "airbase",
      label: "Airbase",
      detail: closed > 0 ? `Airbase: closed through round ${closed}` : "Airbase: open",
      major: false,
      impaired: closed > 0,
    });
  }
  return out;
}
