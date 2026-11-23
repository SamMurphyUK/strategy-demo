import type { GameState } from "../engine/model/game_state";
import type { Alliance, AllianceWarPlan, TheaterId } from "./coalitionWarRoom";
import { theaterOfRegion, tuvInTheater } from "./coalitionWarRoom";

export type TheaterPostureId =
  | "POSTURE_BARBAROSSA_CENTER"
  | "POSTURE_CAUCASUS_OIL"
  | "POSTURE_ATLANTIC_FORTRESS"
  | "POSTURE_DEEP_DEFENSE"
  | "POSTURE_COUNTER_PUNCH"
  | "POSTURE_SOUTHERN_RESOURCE_BLITZ"
  | "POSTURE_CHINA_BURMA_CRUSH"
  | "POSTURE_PACIFIC_PERIMETER"
  | "POSTURE_MED_LIFELINE"
  | "POSTURE_ATLANTIC_LIBERATION"
  | "POSTURE_INDIA_BURMA_SHIELD"
  | "POSTURE_MARE_NOSTRUM"
  | "POSTURE_BALKAN_EAST_SUPPORT"
  | "POSTURE_MOUNTAIN_ATTRITION"
  | "POSTURE_TORCH_MED_INVASION"
  | "POSTURE_OVERLORD_CHANNEL"
  | "POSTURE_PACIFIC_ISLAND_HOP";

export interface TheaterPosture {
  id: TheaterPostureId;
  faction: string;
  theaterId: TheaterId;
  anchors: string[];
  preferredKinds: string[];
  preferredFactory: string[];
  homeDefense: boolean;
}

const MENU: TheaterPosture[] = [
  { id: "POSTURE_BARBAROSSA_CENTER", faction: "germany", theaterId: "THEATER_EASTERN_FRONT", anchors: ["moscow", "leningrad", "ukraine"], preferredKinds: ["ARMOR", "INFANTRY", "ARTILLERY"], preferredFactory: ["berlin", "germany"], homeDefense: false },
  { id: "POSTURE_CAUCASUS_OIL", faction: "germany", theaterId: "THEATER_MED_AFRICA", anchors: ["ukraine", "stalingrad", "turkey", "egypt"], preferredKinds: ["ARMOR", "INFANTRY"], preferredFactory: ["berlin"], homeDefense: false },
  { id: "POSTURE_ATLANTIC_FORTRESS", faction: "germany", theaterId: "THEATER_WESTERN_EUROPE", anchors: ["france", "norway", "berlin"], preferredKinds: ["SUBMARINE", "INFANTRY", "FIGHTER"], preferredFactory: ["france", "berlin"], homeDefense: true },
  { id: "POSTURE_DEEP_DEFENSE", faction: "soviet_union", theaterId: "THEATER_EASTERN_FRONT", anchors: ["leningrad", "moscow", "stalingrad"], preferredKinds: ["INFANTRY", "ARTILLERY"], preferredFactory: ["moscow"], homeDefense: true },
  { id: "POSTURE_COUNTER_PUNCH", faction: "soviet_union", theaterId: "THEATER_EASTERN_FRONT", anchors: ["ukraine", "poland", "baltic"], preferredKinds: ["ARMOR", "ARTILLERY"], preferredFactory: ["moscow"], homeDefense: false },
  { id: "POSTURE_SOUTHERN_RESOURCE_BLITZ", faction: "japan", theaterId: "THEATER_PACIFIC_ISLANDS", anchors: ["malaya", "philippines", "java", "sumatra", "borneo"], preferredKinds: ["TRANSPORT", "INFANTRY", "ARTILLERY"], preferredFactory: ["japan", "tokyo"], homeDefense: false },
  { id: "POSTURE_CHINA_BURMA_CRUSH", faction: "japan", theaterId: "THEATER_CHINA_BURMA", anchors: ["yunnan", "burma", "india"], preferredKinds: ["INFANTRY", "ARTILLERY", "FIGHTER"], preferredFactory: ["japan"], homeDefense: false },
  { id: "POSTURE_PACIFIC_PERIMETER", faction: "japan", theaterId: "THEATER_PACIFIC_ISLANDS", anchors: ["japan", "tokyo", "carolines", "philippines"], preferredKinds: ["DESTROYER", "CARRIER", "FIGHTER"], preferredFactory: ["japan", "tokyo"], homeDefense: true },
  { id: "POSTURE_MED_LIFELINE", faction: "united_kingdom", theaterId: "THEATER_MED_AFRICA", anchors: ["gibraltar", "malta", "egypt"], preferredKinds: ["DESTROYER", "FIGHTER", "TRANSPORT"], preferredFactory: ["london", "uk"], homeDefense: false },
  { id: "POSTURE_ATLANTIC_LIBERATION", faction: "united_kingdom", theaterId: "THEATER_WESTERN_EUROPE", anchors: ["norway", "france", "normandy"], preferredKinds: ["TRANSPORT", "INFANTRY", "ARTILLERY", "DESTROYER"], preferredFactory: ["london", "uk"], homeDefense: true },
  { id: "POSTURE_INDIA_BURMA_SHIELD", faction: "united_kingdom", theaterId: "THEATER_CHINA_BURMA", anchors: ["india", "burma", "yunnan"], preferredKinds: ["INFANTRY", "FIGHTER"], preferredFactory: ["india"], homeDefense: false },
  { id: "POSTURE_MARE_NOSTRUM", faction: "italy", theaterId: "THEATER_MED_AFRICA", anchors: ["greece", "egypt", "gibraltar"], preferredKinds: ["DESTROYER", "CRUISER", "TRANSPORT", "INFANTRY"], preferredFactory: ["rome", "italy"], homeDefense: false },
  { id: "POSTURE_BALKAN_EAST_SUPPORT", faction: "italy", theaterId: "THEATER_EASTERN_FRONT", anchors: ["ukraine", "greece", "balkans"], preferredKinds: ["INFANTRY", "ARMOR"], preferredFactory: ["rome"], homeDefense: true },
  { id: "POSTURE_MOUNTAIN_ATTRITION", faction: "china", theaterId: "THEATER_CHINA_BURMA", anchors: ["yunnan", "szechwan"], preferredKinds: ["INFANTRY", "CHINESE_GUERRILLA"], preferredFactory: ["szechwan"], homeDefense: true },
  { id: "POSTURE_TORCH_MED_INVASION", faction: "united_states", theaterId: "THEATER_MED_AFRICA", anchors: ["morocco", "algeria", "egypt", "italy"], preferredKinds: ["TRANSPORT", "DESTROYER", "INFANTRY", "ARTILLERY"], preferredFactory: ["eastern", "east"], homeDefense: false },
  { id: "POSTURE_OVERLORD_CHANNEL", faction: "united_states", theaterId: "THEATER_WESTERN_EUROPE", anchors: ["france", "normandy", "uk"], preferredKinds: ["TRANSPORT", "DESTROYER", "INFANTRY"], preferredFactory: ["eastern", "east"], homeDefense: true },
  { id: "POSTURE_PACIFIC_ISLAND_HOP", faction: "united_states", theaterId: "THEATER_PACIFIC_ISLANDS", anchors: ["solomon", "carolines", "philippines"], preferredKinds: ["TRANSPORT", "CARRIER", "DESTROYER", "INFANTRY"], preferredFactory: ["western", "west"], homeDefense: false },
];

const ALIAS: Record<string, string> = {
  ger: "germany",
  jap: "japan",
  ussr: "soviet_union",
  uk: "united_kingdom",
  usa: "united_states",
};

export function postureFaction(factionId: string): string {
  const key = factionId.trim().toLowerCase();
  return ALIAS[key] ?? key;
}

export function posturesFor(factionId: string): TheaterPosture[] {
  const name = postureFaction(factionId);
  return MENU.filter((posture) => posture.faction === name);
}

export function postureById(id: TheaterPostureId): TheaterPosture | undefined {
  return MENU.find((posture) => posture.id === id);
}

function regionText(state: GameState, regionId: string): string {
  const region = state.regions[regionId];
  return `${regionId} ${region?.name ?? ""}`.toLowerCase();
}

function matchesAnchor(state: GameState, regionId: string, anchors: readonly string[]): boolean {
  const text = regionText(state, regionId);
  return anchors.some((anchor) => text.includes(anchor));
}

export function postureAnchors(state: GameState, posture: TheaterPosture): string[] {
  return Object.keys(state.regions).filter((regionId) => matchesAnchor(state, regionId, posture.anchors));
}

function capitalThreat(state: GameState, factionId: string): number {
  let worst = 0;
  for (const region of Object.values(state.regions)) {
    if (!region.is_capital || !state.sameTeam(region.owner_faction_id, factionId)) {
      continue;
    }
    let garrison = 0;
    let enemy = 0;
    for (const entry of state.getUnitsInRegion(region.id)) {
      const owner = String(entry.faction_id ?? "");
      const unit = state.unit_types[String(entry.unit_type_id ?? "")];
      const body = Math.max(0, Math.trunc(Number(entry.count ?? 0))) * Math.max(0, unit?.cost ?? 0);
      if (owner !== "" && state.sameTeam(owner, factionId)) {
        garrison += body;
      }
    }
    for (const near of state.getAdjacentRegions(region.id)) {
      for (const entry of state.getUnitsInRegion(near)) {
        const owner = String(entry.faction_id ?? "");
        if (owner === "" || state.sameTeam(owner, factionId)) {
          continue;
        }
        const unit = state.unit_types[String(entry.unit_type_id ?? "")];
        enemy += Math.max(0, Math.trunc(Number(entry.count ?? 0))) * Math.max(0, unit?.cost ?? 0);
      }
    }
    if (enemy <= 0) {
      continue;
    }
    worst = Math.max(worst, enemy / Math.max(1, enemy + garrison));
  }
  return worst;
}

function localStrength(state: GameState, factionId: string, posture: TheaterPosture): number {
  const friendly = tuvInTheater(state, factionId, posture.theaterId, true);
  const enemy = tuvInTheater(state, factionId, posture.theaterId, false);
  if (friendly + enemy === 0) {
    return 0;
  }
  return friendly / (friendly + enemy);
}

function unclaimedObjectives(state: GameState, factionId: string, posture: TheaterPosture): number {
  let total = 0;
  for (const goal of state.nationalObjectives) {
    if (!state.sameTeam(goal.factionId, factionId)) {
      continue;
    }
    const open = goal.holds.some((regionId) => !state.sameTeam(state.regions[regionId]?.owner_faction_id ?? "", factionId));
    const inTheater = goal.holds.some((regionId) => theaterOfRegion(state, regionId) === posture.theaterId);
    if (open && inTheater) {
      total += Math.max(0, Math.trunc(Number(goal.production ?? 5)));
    }
  }
  if (posture.faction === "italy" && posture.theaterId === "THEATER_MED_AFRICA") {
    const held = ["egypt", "greece", "gibraltar"].filter((id) => state.sameTeam(state.regions[id]?.owner_faction_id ?? "", factionId)).length;
    if (held < 3) {
      total += 5;
    }
  }
  return total;
}

/** Home-capital danger wins. Otherwise strength, unpaid objectives, and the coalition's main theater. */
export function selectPosture(state: GameState, factionId: string, plan: AllianceWarPlan | null): TheaterPosture | null {
  const menu = posturesFor(factionId);
  if (menu.length === 0) {
    return null;
  }
  if (capitalThreat(state, factionId) > 0.5) {
    return menu.find((posture) => posture.homeDefense) ?? menu[0];
  }
  const ranked = menu
    .map((posture) => {
      let score = localStrength(state, factionId, posture) * 40 + unclaimedObjectives(state, factionId, posture);
      if (plan != null && posture.theaterId === plan.primaryTheater) {
        score = score * 1.25 + 10;
      }
      return { posture, score };
    })
    .sort((a, b) => b.score - a.score || (a.posture.id < b.posture.id ? -1 : 1));
  return ranked[0]?.posture ?? null;
}

export function purchaseMultiplier(posture: TheaterPosture | null, kind: string): number {
  if (posture == null || kind === "") {
    return 1;
  }
  return posture.preferredKinds.includes(kind) ? 2 : 1;
}

export function preferredFactoryId(state: GameState, factionId: string, posture: TheaterPosture | null): string {
  if (posture == null) {
    return "";
  }
  const factories = Object.values(state.regions).filter(
    (region) => region.has_factory && region.owner_faction_id === factionId && region.isLandRegion(),
  );
  const match = factories.find((region) => posture.preferredFactory.some((token) => regionText(state, region.id).includes(token)));
  return match?.id ?? "";
}

export function allianceOf(state: GameState, factionId: string): Alliance {
  return state.factions[factionId]?.team === "axis" ? "axis" : "allies";
}
