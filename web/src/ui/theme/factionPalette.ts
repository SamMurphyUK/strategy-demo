// Single source of truth for faction colours on the campaign UI and unit tokens.
//
// `primary` comes from the tactical board (PALETTE / THEATERS in ui/battle). `ring`, `fill` and `ink`
// are the token colours: ring border, warm interior and silhouette/letter contrast.
// US and GER use the exact colours measured from the supplied vector art (allies_inf_ii.png and the
// axis_*.png set). UK, JAP and USSR follow the same recipe: a lighter ring, a near-white interior
// tinted toward the faction, and a dark ink.

export type FactionKey = "US" | "UK" | "JAP" | "GER" | "USSR" | "NEUTRAL";
export type FactionSide = "allies" | "axis" | "neutral";

export interface FactionPalette {
  key: FactionKey;
  name: string;
  side: FactionSide;
  /** The faction's board colour. Banners and chips. */
  primary: string;
  /** Token ring border. Also the region tint on the campaign map, where it reads better on parchment. */
  ring: string;
  /** Token interior. */
  fill: string;
  /** Silhouette and letter colour; contrasts with `fill` and `ring`. */
  ink: string;
}

export const FACTION_PALETTE: Record<FactionKey, FactionPalette> = {
  US: {
    key: "US",
    name: "United States",
    side: "allies",
    primary: "#72745C", // board: Olive Drab
    ring: "#A8B272", // art
    fill: "#FCFAF3", // art
    ink: "#434927", // art
  },
  UK: {
    key: "UK",
    name: "United Kingdom",
    side: "allies",
    primary: "#9E7F55", // board: Khaki Leather (British Desert Rats)
    ring: "#CAA574", // board: Sand Tan
    fill: "#FBF7EC",
    ink: "#2B2418",
  },
  JAP: {
    key: "JAP",
    name: "Japan",
    side: "axis",
    primary: "#B77958", // board: Terracotta. The board's Imperial Fleet shares Crimson with the Red Army; tokens need them apart.
    ring: "#C98F6E",
    fill: "#FBF5EE",
    ink: "#1F1412",
  },
  GER: {
    key: "GER",
    name: "Germany",
    side: "axis",
    primary: "#857577", // board: Feldgrau
    ring: "#8A8C7F", // art
    fill: "#F9F8F6", // art
    ink: "#000000", // art
  },
  USSR: {
    key: "USSR",
    name: "Soviet Union",
    side: "allies",
    primary: "#9A4E48", // board: Soviet Crimson
    ring: "#B8605A",
    fill: "#FBF4F1",
    ink: "#2A1415",
  },
  NEUTRAL: {
    key: "NEUTRAL",
    name: "Neutral",
    side: "neutral",
    primary: "#A69C90", // board: Trench Mud Light
    ring: "#A69C90",
    fill: "#F4F1EA",
    ink: "#1A1A18",
  },
};

/**
 * Scenario ids are `ussr`, `uk`, `usa`, `ger` and `jap`. The old two-faction demo ids `allies` and
 * `axis` still resolve, to the US and Germany palettes. `data/factions.json` ids (`germany`, `uk`) too.
 */
const ALIASES: Record<string, FactionKey> = {
  us: "US",
  usa: "US",
  america: "US",
  american: "US",
  allies: "US",
  allied: "US",
  uk: "UK",
  gb: "UK",
  britain: "UK",
  british: "UK",
  jap: "JAP",
  japan: "JAP",
  japanese: "JAP",
  ger: "GER",
  germany: "GER",
  german: "GER",
  axis: "GER",
  ussr: "USSR",
  russia: "USSR",
  soviet: "USSR",
};

export function resolveFaction(factionId: string | null | undefined): FactionKey {
  const id = String(factionId ?? "").trim().toLowerCase();
  return ALIASES[id] ?? "NEUTRAL";
}

export function factionPalette(factionId: string | null | undefined): FactionPalette {
  return FACTION_PALETTE[resolveFaction(factionId)];
}
