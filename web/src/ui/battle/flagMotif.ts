// Faction cloth for the waving flag. Colours are the battle board palette, so the
// intro and the outro are cut from the same cloth.

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
  NEUTRAL: { stripes: [MUD, KHAKI], canton: EARTH, emblem: "stars" },
};

/** `ger` and `axis` are Germany. An unknown id flies the neutral cloth. */
export function flagMotifForFaction(factionId: string): FlagMotif {
  const id = String(factionId ?? "").trim().toLowerCase();
  if (id === "ussr" || id === "russia" || id === "soviet") return MOTIFS.USSR;
  if (id === "usa" || id === "us" || id === "america" || id === "american" || id === "allies" || id === "allied") {
    return MOTIFS.US;
  }
  if (id === "uk" || id === "gb" || id === "britain" || id === "british") return MOTIFS.UK;
  if (id === "ger" || id === "germany" || id === "german" || id === "axis") return MOTIFS.GER;
  if (id === "jap" || id === "japan" || id === "japanese") return MOTIFS.JAP;
  return MOTIFS.NEUTRAL;
}

/** The number on the battle outro: IPC of pieces destroyed in that battle. */
export function ipcLostCaption(amount: number): string {
  return `${Math.max(0, Math.trunc(amount))} IPC LOST`;
}
