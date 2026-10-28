// Port of scripts/unit_texture_cache.gd path resolution. Pure: the caller says
// which `res://` paths exist, so this runs in tests without Vite.

export const TEXTURE_ROOT = "res://texture/units/";

const TEXTURE_ALIASES: Record<string, string> = {
  strategic_bomber: "fighter",
  tactical_bomber: "fighter",
  destroyer: "battleship",
  cruiser: "battleship",
  submarine: "battleship",
  carrier: "battleship",
  mech_infantry: "infantry",
};

const FACTION_SUFFIXES = ["allies", "axis"];

export function normalizeUnitTypeAndFaction(unitTypeId: string, factionId: string): { unitTypeId: string; factionId: string } {
  let unit = unitTypeId.toLowerCase().trim();
  let faction = factionId.toLowerCase().trim();
  for (const suffix of FACTION_SUFFIXES) {
    if (unit.endsWith(suffix) && unit.length > suffix.length) {
      faction = suffix;
      unit = unit.slice(0, unit.length - suffix.length);
      break;
    }
  }
  if (["allies", "american", "us"].includes(faction)) {
    faction = "allies";
  } else if (["axis", "ger", "germany", "german"].includes(faction)) {
    faction = "axis";
  }
  return { unitTypeId: unit, factionId: faction };
}

export function folderForFaction(faction: string): string {
  switch (faction.toLowerCase()) {
    case "allies":
      return "us";
    case "axis":
      return "ger";
    default:
      return "neutral";
  }
}

/** UnitTextureCache.get_texture lookup order: exact, alias, neutral fallback. Returns "" when nothing exists. */
export function resolveUnitArtPath(unitTypeId: string, factionId: string, exists: (resPath: string) => boolean): string {
  const n = normalizeUnitTypeAndFaction(unitTypeId, factionId);
  if (n.unitTypeId === "") {
    return "";
  }
  const folder = folderForFaction(n.factionId);
  const direct = `${TEXTURE_ROOT}${folder}/${n.unitTypeId}.png`;
  if (exists(direct)) {
    return direct;
  }
  const alias = TEXTURE_ALIASES[n.unitTypeId];
  if (alias) {
    const aliasPath = `${TEXTURE_ROOT}${folder}/${alias}.png`;
    if (exists(aliasPath)) {
      return aliasPath;
    }
  }
  const fallback = `${TEXTURE_ROOT}neutral/${n.unitTypeId}.png`;
  return exists(fallback) ? fallback : "";
}
