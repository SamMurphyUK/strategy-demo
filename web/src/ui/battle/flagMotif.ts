// Faction cloth for the waving flag. Colours are the battle board palette, so the
// intro and the outro are cut from the same cloth.
import { resolveFaction } from "../theme/factionPalette";

export type FlagEmblem = "star" | "stars" | "cross" | "disc";

export interface FlagMotif {
  stripes: readonly string[];
  canton: string;
  emblem: FlagEmblem;
}

const CRIMSON = "#9A4E48";
const PLUM = "#6F3B4A";
const SAND = "#DFCE91";
const NAVAL = "#495462";
const CHARCOAL = "#423840";
const TERRACOTTA = "#B77958";
const KHAKI = "#9E7F55";
const MUD = "#A69C90";
const EARTH = "#7D6652";

const MOTIFS: Record<string, FlagMotif> = {
  USSR: { stripes: [CRIMSON, PLUM], canton: PLUM, emblem: "star" },
  US: { stripes: [NAVAL, SAND], canton: NAVAL, emblem: "stars" },
  UK: { stripes: [NAVAL, SAND, CRIMSON], canton: NAVAL, emblem: "cross" },
  GER: { stripes: [CHARCOAL, SAND, CRIMSON], canton: CHARCOAL, emblem: "cross" },
  JAP: { stripes: [CRIMSON, TERRACOTTA], canton: CRIMSON, emblem: "disc" },
  ITA: { stripes: ["#5B7D73", SAND], canton: "#5B7D73", emblem: "cross" },
  CHI: { stripes: ["#AAA25D", CRIMSON], canton: "#AAA25D", emblem: "star" },
  ANZ: { stripes: ["#846D59", SAND], canton: "#846D59", emblem: "stars" },
  FRA: { stripes: [NAVAL, SAND, CRIMSON], canton: NAVAL, emblem: "cross" },
  NEUTRAL: { stripes: [MUD, KHAKI], canton: EARTH, emblem: "stars" },
};

/** `ger` and `axis` are Germany. An unknown id flies the neutral cloth. */
export function flagMotifForFaction(factionId: string): FlagMotif {
  return MOTIFS[resolveFaction(factionId)] ?? MOTIFS.NEUTRAL;
}

/** The number on the battle outro: IPC of pieces destroyed in that battle. */
export function ipcLostCaption(amount: number): string {
  return `${Math.max(0, Math.trunc(amount))} IO LOST`;
}
