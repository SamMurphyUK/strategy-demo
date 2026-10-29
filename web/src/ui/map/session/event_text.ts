import type { Dict } from "../../../engine/model/types";

export function factionName(factionId: string): string {
  switch (String(factionId).toLowerCase()) {
    case "ussr":
      return "Soviet Union";
    case "ger":
      return "Germany";
    case "uk":
      return "United Kingdom";
    case "jap":
      return "Japan";
    case "usa":
      return "United States";
    case "allies":
      return "Allies";
    case "axis":
      return "Axis";
    case "":
    case "neutral":
      return "Neutral";
    default:
      return factionId;
  }
}

export function phaseName(phase: string): string {
  switch (phase) {
    case "purchase":
      return "Purchase";
    case "combat_move":
      return "Combat move";
    case "combat":
      return "Combat";
    case "noncombat_move":
      return "Non-combat move";
    case "mobilize":
      return "Mobilize";
    case "collect_income":
      return "Collect income";
    default:
      return phase;
  }
}

export function unitName(unitTypeId: string, unitTypes: Record<string, { name?: string }> = {}): string {
  const fromCatalog = unitTypes[unitTypeId]?.name;
  if (fromCatalog) {
    return fromCatalog;
  }
  const spaced = unitTypeId.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function unitList(units: unknown, unitTypes: Record<string, { name?: string }>): string {
  if (!Array.isArray(units) || units.length === 0) {
    return "nothing";
  }
  return units
    .map((u: Dict) => `${Math.trunc(Number(u.count ?? 1))} ${unitName(String(u.unit_type_id ?? ""), unitTypes)}`)
    .join(", ");
}

function battleResult(result: string): string {
  switch (result) {
    case "attacker_won":
      return "attacker won";
    case "defender_won":
      return "defender held";
    case "mutual_destruction":
      return "both sides destroyed";
    case "attacker_retreated":
      return "attacker retreated";
    case "draw":
      return "draw";
    default:
      return result;
  }
}

function casualtyText(casualties: unknown): string {
  const list: Dict[] = Array.isArray(casualties) ? casualties : [];
  const parts: string[] = [];
  for (const side of ["attacker", "defender"]) {
    const own = list.filter((c) => c.side === side);
    const destroyed = own.filter((c) => c.result === "destroyed").length;
    const damaged = own.length - destroyed;
    if (destroyed > 0) parts.push(`${side} lost ${destroyed}`);
    if (damaged > 0) parts.push(`${side} took ${damaged} damage`);
  }
  return parts.join(", ");
}

/** One line per canonical stub event. Types arrive lowercased with underscores stripped. */
export function describeEvent(evt: Dict, unitTypes: Record<string, { name?: string }> = {}): string {
  const p: Dict = evt.payload ?? {};
  const who = factionName(String(p.faction_id ?? ""));
  switch (String(evt.type ?? "")) {
    case "phasechanged":
      return `${who}: ${phaseName(String(p.new_phase ?? ""))}`;
    case "unitspurchased":
      return `${who} bought ${unitList(p.units, unitTypes)} for ${p.cost} IPC`;
    case "purchasefailed":
      return `${who} purchase failed: ${String(p.reason ?? "unknown")}`;
    case "unitsmoved": {
      const moves: Dict[] = Array.isArray(p.moves) ? p.moves : [];
      const parts = moves.map((m) => `${unitList(m.units, unitTypes)} ${m.from_region_id} to ${m.to_region_id}`);
      return `${who} moved ${parts.join("; ")}`;
    }
    case "transportloaded":
      return `${who} loaded ${unitList(p.units, unitTypes)} onto ${p.transport_instance_id}`;
    case "transportunloaded":
      return `${who} unloaded ${unitList(p.units, unitTypes)} into ${p.to_region_id}`;
    case "battlestarted":
      return `Battle in ${p.region_id}: ${factionName(String(p.attacker ?? ""))} attacks ${factionName(String(p.defender ?? ""))}`;
    case "dicerolled": {
      const lost = casualtyText(p.casualties);
      return `${p.region_id} round ${p.round}: attacker ${p.attacker_hits} hits, defender ${p.defender_hits} hits${lost ? ` (${lost})` : ""}`;
    }
    case "unitsdestroyed": {
      const lost = casualtyText(p.casualties);
      return `${p.region_id} round ${p.round}: ${lost || "no casualties"}`;
    }
    case "regioncaptured":
      return `${factionName(String(p.faction_id ?? ""))} captured ${p.region_id}`;
    case "battlefinished": {
      const retreat = p.retreat_to ? ` to ${p.retreat_to}` : "";
      return `${p.region_id}: ${battleResult(String(p.result ?? ""))}${retreat}`;
    }
    case "unitsplaced": {
      const placements: Dict[] = Array.isArray(p.placements) ? p.placements : [];
      const parts = placements.map((pl) => `${unitList(pl.units, unitTypes)} in ${pl.region_id}`);
      return `${who} placed ${parts.join("; ")}`;
    }
    case "placementforfeited":
      return `${who} forfeited unplaced units (${p.ipc_lost ?? 0} IPC lost)`;
    case "incomecollected":
      return `${who} collected ${p.amount} IPC (now ${p.new_total})`;
    case "turnended":
      return `${who} ended turn. ${factionName(String(p.next_faction_id ?? ""))} to play`;
    case "gamefinished":
      return `${factionName(String(p.winner_faction_id ?? ""))} wins: ${String(p.reason ?? "")}`;
    default:
      return `${String(evt.type ?? "event")} ${JSON.stringify(p)}`;
  }
}
