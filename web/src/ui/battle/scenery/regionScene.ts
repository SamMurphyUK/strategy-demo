// What a battle in a given region looks like. Pure data: the painter turns a scene into pixels,
// and the seed fixes every random choice so a region bakes the same backdrop every time.

export type Biome =
  | "temperate"
  | "boreal"
  | "steppe"
  | "mediterranean"
  | "desert"
  | "savanna"
  | "jungle"
  | "paddy";

export type Culture =
  | "german"
  | "british"
  | "western"
  | "nordic"
  | "russian"
  | "mediterranean"
  | "arab"
  | "african"
  | "indian"
  | "chinese"
  | "japanese"
  | "american"
  | "latin"
  | "oceanic";

export type Settlement = "capital" | "city" | "town" | "village" | "wild";

export type Ocean = "atlantic" | "pacific" | "arctic" | "mediterranean" | "indian";

export type Landmark =
  | "brandenburg_gate"
  | "reichstag"
  | "flak_tower"
  | "big_ben"
  | "st_pauls"
  | "tower_bridge"
  | "kremlin"
  | "st_basils"
  | "admiralty_spire"
  | "capitol"
  | "washington_monument"
  | "empire_state"
  | "golden_gate"
  | "diet_building"
  | "pagoda"
  | "mount_fuji"
  | "colosseum"
  | "st_peters"
  | "eiffel_tower"
  | "windmill"
  | "parthenon"
  | "hagia_sophia"
  | "pyramids"
  | "dome_of_the_rock"
  | "mughal_dome"
  | "rock_of_gibraltar"
  | "table_mountain"
  | "harbour_bridge"
  | "diamond_head"
  | "suribachi";

export interface LandScene {
  kind: "land";
  regionId: string;
  seed: number;
  biome: Biome;
  culture: Culture;
  settlement: Settlement;
  /** Touches a sea zone. The water strip runs along the bottom of the board. */
  coastal: boolean;
  /** A town or wilder region with no land neighbours, styled by the ocean around it. Island cities keep their skyline. */
  island: "atlantic" | "pacific" | null;
  hasFactory: boolean;
  landmarks: Landmark[];
}

export interface SeaScene {
  kind: "sea";
  regionId: string;
  seed: number;
  ocean: Ocean;
  /** The nearest coast seen on the horizon, or null in open water. */
  coast: { biome: Biome; culture: Culture } | null;
}

export type RegionScene = LandScene | SeaScene;

/** The region facts a scene is derived from. */
export interface SceneRegion {
  id: string;
  name: string;
  type: string;
  adjacent: string[];
  isCapital: boolean;
  hasFactory: boolean;
  ipc: number;
  /** Map position in demomap01.json coordinates. Used when a region is not in the tables below. */
  anchor?: { x: number; y: number };
}

type LandEntry = [Biome, Culture, ...Landmark[]];

const LAND: Record<string, LandEntry> = {
  Germany: ["temperate", "german", "brandenburg_gate", "reichstag", "flak_tower"],
  "United Kingdom": ["temperate", "british", "big_ben", "st_pauls", "tower_bridge"],
  Moscow: ["boreal", "russian", "kremlin", "st_basils"],
  Japan: ["temperate", "japanese", "diet_building", "pagoda", "mount_fuji"],
  "Eastern US": ["temperate", "american", "capitol", "washington_monument", "empire_state"],
  "West Coast": ["mediterranean", "american", "golden_gate"],
  "Central US": ["steppe", "american"],
  Canada: ["boreal", "american"],
  "East Canada": ["boreal", "american"],
  Alaska: ["boreal", "american"],
  Greenland: ["boreal", "nordic"],
  Mexico: ["desert", "latin"],
  Panama: ["jungle", "latin"],
  Bahamas: ["jungle", "british"],
  Brazil: ["jungle", "latin"],
  Venezeula: ["jungle", "latin"],
  Colombia: ["jungle", "latin"],
  Argentina: ["savanna", "latin"],
  Chile: ["mediterranean", "latin"],
  "Territory 2": ["steppe", "latin"],
  "Territory 1": ["boreal", "american"],
  Iceland: ["boreal", "nordic"],
  Eire: ["temperate", "british"],
  Norway: ["boreal", "nordic"],
  Sweden: ["boreal", "nordic"],
  Finland: ["boreal", "nordic"],
  Karelia: ["boreal", "russian"],
  Archangel: ["boreal", "russian"],
  Petersburgh: ["boreal", "russian", "admiralty_spire"],
  Baltics: ["temperate", "german"],
  Belarus: ["temperate", "russian"],
  Poland: ["temperate", "western"],
  Ukraine: ["steppe", "russian"],
  Caucus: ["steppe", "russian"],
  Volgads: ["steppe", "russian"],
  Novo: ["steppe", "russian"],
  Siberia: ["boreal", "russian"],
  Yakkut: ["boreal", "russian"],
  "Eastern Siberia": ["boreal", "russian"],
  Kamkatchka: ["boreal", "russian"],
  "Territory 30": ["boreal", "russian"],
  "Central Asia": ["desert", "arab"],
  Netherlands: ["temperate", "western", "windmill"],
  France: ["temperate", "western", "eiffel_tower"],
  Spain: ["mediterranean", "mediterranean"],
  Gibraltar: ["mediterranean", "british", "rock_of_gibraltar"],
  Italy: ["mediterranean", "mediterranean", "colosseum", "st_peters"],
  Sicily: ["mediterranean", "mediterranean"],
  Malta: ["mediterranean", "mediterranean"],
  Yugoslavia: ["mediterranean", "mediterranean"],
  Greece: ["mediterranean", "mediterranean", "parthenon"],
  Turkey: ["mediterranean", "arab", "hagia_sophia"],
  Morocco: ["desert", "arab"],
  Algiers: ["desert", "arab"],
  Libya: ["desert", "arab"],
  Egypt: ["desert", "arab", "pyramids"],
  Sudan: ["desert", "arab"],
  "Greater Palestine": ["desert", "arab", "dome_of_the_rock"],
  "Gulf States": ["desert", "arab"],
  Persia: ["desert", "arab"],
  Afghanistan: ["desert", "arab"],
  Senegal: ["savanna", "african"],
  "Central Africa": ["savanna", "african"],
  "Central Africa B": ["jungle", "african"],
  "Belgian Congo": ["jungle", "african"],
  Ethiopia: ["savanna", "african"],
  Angola: ["savanna", "african"],
  Rhodesia: ["savanna", "african"],
  Mozambique: ["savanna", "african"],
  "South Africa": ["savanna", "african", "table_mountain"],
  Madagascar: ["savanna", "african"],
  Pakistan: ["desert", "indian"],
  India: ["paddy", "indian", "mughal_dome"],
  Burma: ["jungle", "indian"],
  Thailand: ["jungle", "chinese"],
  Yunnan: ["jungle", "chinese"],
  Szechwan: ["paddy", "chinese"],
  Anhwei: ["paddy", "chinese"],
  Kiangsu: ["paddy", "chinese"],
  Kwangtun: ["paddy", "chinese"],
  Manchuria: ["steppe", "chinese"],
  "Territory 1 B": ["steppe", "chinese"],
  Okinawa: ["jungle", "japanese"],
  "Iwo Jima": ["savanna", "japanese", "suribachi"],
  "Philippine Islands": ["jungle", "oceanic"],
  Borneo: ["jungle", "oceanic"],
  "East Indies": ["jungle", "oceanic"],
  "New Guinea": ["jungle", "oceanic"],
  "Solomon Islands": ["jungle", "oceanic"],
  "Carol Islands": ["jungle", "oceanic"],
  "Wake Island": ["jungle", "oceanic"],
  Midway: ["jungle", "oceanic"],
  Hawaii: ["jungle", "american", "diamond_head"],
  "East Australia": ["savanna", "british", "harbour_bridge"],
  "West Australia": ["desert", "british"],
  "New Zealand": ["temperate", "british"],
};

/** Faction capitals on the board. A region flagged `victory` in the map counts too. */
const CAPITALS = new Set(["Germany", "United Kingdom", "Moscow", "Japan", "Eastern US"]);

/** FNV-1a. The same region id always gives the same seed. */
export function sceneSeed(regionId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < regionId.length; i++) {
    h ^= regionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32. Every random choice in a bake comes from one of these. */
export function sceneRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which ocean a map position sits in, from demomap01.json coordinates (Pacific wraps both edges). */
export function oceanAt(x: number, y: number): Ocean {
  if (y < 125) return "arctic";
  if (x >= 245 && x <= 360 && y >= 230 && y <= 295) return "mediterranean";
  if (x >= 330 && x < 490 && y >= 300) return "indian";
  if (x >= 490 || x < 90) return "pacific";
  return "atlantic";
}

function biomeAt(x: number, y: number): Biome {
  if (y < 160) return "boreal";
  if (y < 230) return "temperate";
  if (y < 300) return x > 440 && x < 560 ? "paddy" : "desert";
  if (y < 380) return "jungle";
  return "savanna";
}

function cultureAt(x: number, y: number): Culture {
  if (x < 90 || x > 700) return "american";
  if (x < 200) return y > 300 ? "latin" : "american";
  if (x < 340) return y > 330 ? "african" : y > 260 ? "arab" : "western";
  if (x < 440) return y > 290 ? "indian" : y > 230 ? "arab" : "russian";
  if (x < 560) return y > 330 ? "oceanic" : y < 200 ? "russian" : "chinese";
  return y > 330 ? "oceanic" : "japanese";
}

function settlementOf(region: SceneRegion): Settlement {
  if (region.isCapital || CAPITALS.has(region.name) || CAPITALS.has(region.id)) return "capital";
  if (region.hasFactory) return "city";
  if (region.ipc >= 2) return "town";
  if (region.ipc >= 1) return "village";
  return "wild";
}

function landEntry(region: SceneRegion): LandEntry {
  const known = LAND[region.name] ?? LAND[region.id];
  if (known) return known;
  const at = region.anchor ?? { x: 260, y: 210 };
  return [biomeAt(at.x, at.y), cultureAt(at.x, at.y)];
}

function isSea(region: SceneRegion | undefined): boolean {
  return region?.type === "sea";
}

/** The backdrop for a battle in this region. `lookup` resolves neighbour ids. */
export function regionScene(
  region: SceneRegion,
  lookup: (id: string) => SceneRegion | undefined,
): RegionScene {
  const seed = sceneSeed(region.id);
  const neighbours = region.adjacent.map((id) => lookup(id)).filter((r): r is SceneRegion => r != null);

  if (isSea(region)) {
    const coastLand = neighbours.find((r) => !isSea(r));
    const coast = coastLand ? landEntry(coastLand) : null;
    return {
      kind: "sea",
      regionId: region.id,
      seed,
      ocean: seaOcean(region, coastLand),
      coast: coast ? { biome: coast[0], culture: coast[1] } : null,
    };
  }

  const [biome, culture, ...landmarks] = landEntry(region);
  const seas = neighbours.filter(isSea);
  const coastal = seas.length > 0;
  const landLocked = neighbours.some((r) => !isSea(r));
  const settlement = settlementOf(region);
  const urban = settlement === "capital" || settlement === "city";
  let island: LandScene["island"] = null;
  if (coastal && !landLocked && !urban) {
    const ocean = seaOcean(seas[0]);
    island = ocean === "pacific" || ocean === "indian" ? "pacific" : "atlantic";
  }
  return {
    kind: "land",
    regionId: region.id,
    seed,
    biome,
    culture,
    settlement,
    coastal,
    island,
    hasFactory: region.hasFactory,
    landmarks,
  };
}

function seaOcean(sea: SceneRegion, coast?: SceneRegion): Ocean {
  return sea.anchor ? oceanAt(sea.anchor.x, sea.anchor.y) : oceanFromCoast(coast);
}

function oceanFromCoast(coast: SceneRegion | undefined): Ocean {
  if (!coast) return "atlantic";
  const [biome, culture] = landEntry(coast);
  if (biome === "boreal") return "arctic";
  if (culture === "mediterranean") return "mediterranean";
  if (culture === "indian" || culture === "african") return "indian";
  if (culture === "japanese" || culture === "oceanic" || culture === "chinese") return "pacific";
  return "atlantic";
}
