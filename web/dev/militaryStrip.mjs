// Node copy of the sixteen-colour strip and the roster mappings.
// web/tests/art/bake_review.test.ts checks this against militaryPalette.ts and starterParts.ts.

export const MILITARY = {
  cream: "#DDCF99",
  tan: "#CCA87B",
  terracotta: "#B97A60",
  crimson: "#9C524E",
  plum: "#774251",
  charcoal: "#4B3D44",
  steel: "#4E5463",
  spruce: "#5B7D73",
  sage: "#8E9F7D",
  taupe: "#645355",
  feldgrau: "#8C7C79",
  bone: "#A99C8D",
  olive: "#7D7B62",
  brass: "#AAA25D",
  brown: "#846D59",
  khaki: "#A88A5E",
};

export const MILITARY_STRIP_KEYS = Object.keys(MILITARY);

export const FACTION_MILITARY_MAPPINGS = {
  GER: {
    primary_uniform_or_hull: "feldgrau",
    secondary_trim_or_webbing: "charcoal",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "bone",
    insignia_accent: "crimson",
  },
  USSR: {
    primary_uniform_or_hull: "crimson",
    secondary_trim_or_webbing: "tan",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "bone",
    insignia_accent: "brass",
  },
  UK: {
    primary_uniform_or_hull: "khaki",
    secondary_trim_or_webbing: "taupe",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "bone",
    insignia_accent: "crimson",
  },
  US: {
    primary_uniform_or_hull: "olive",
    secondary_trim_or_webbing: "khaki",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "tan",
    insignia_accent: "cream",
  },
  JAP: {
    primary_uniform_or_hull: "terracotta",
    secondary_trim_or_webbing: "khaki",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "tan",
    insignia_accent: "crimson",
  },
  MINOR: {
    primary_uniform_or_hull: "sage",
    secondary_trim_or_webbing: "spruce",
    metallic_steel: "steel",
    metallic_brass_or_track: "taupe",
    wood_or_leather: "brown",
    skin_stand_in: "bone",
    insignia_accent: "plum",
  },
};

/** The faction's colours, in strip order, with no extras from the other ten keys. */
export function activePalette(factionId) {
  const mapping = FACTION_MILITARY_MAPPINGS[factionId];
  if (!mapping) {
    throw new Error(`factionId "${factionId}" is not a roster id`);
  }
  const used = new Set(Object.values(mapping));
  return MILITARY_STRIP_KEYS.filter((key) => used.has(key)).map((key) => {
    const rgb = Number.parseInt(MILITARY[key].slice(1), 16);
    return { key, r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255 };
  });
}
