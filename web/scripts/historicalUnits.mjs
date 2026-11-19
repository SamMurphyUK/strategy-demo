/** Historical designation inserted into the Retro Diffusion prompt for each roster unit. */

export const FACTIONS = ["GER", "USSR", "UK", "US", "JAP"];

export const UNIT_TYPES = [
  "infantry",
  "mech_infantry",
  "artillery",
  "tank",
  "aaa",
  "fighter",
  "tac_bomber",
  "bomber",
  "submarine",
  "transport",
  "destroyer",
  "cruiser",
  "carrier",
  "battleship",
];

export const AIR_UNITS = new Set(["fighter", "tac_bomber", "bomber"]);

export const HISTORICAL_UNITS = {
  GER: {
    infantry: "1943 Wehrmacht Heer infantryman with Kar98k rifle",
    mech_infantry: "Sd.Kfz. 251 half-track",
    artillery: "10.5cm leFH 18 howitzer",
    tank: "Panzer IV Ausf. H tank",
    aaa: "8.8cm FlaK 36 AA gun",
    fighter: "Messerschmitt Bf 109G fighter",
    tac_bomber: "Junkers Ju 87 Stuka dive bomber",
    bomber: "Heinkel He 111 bomber",
    submarine: "Type VIIC U-boat submarine",
    transport: "German troop transport ship",
    destroyer: "Type 1936A Narvik destroyer",
    cruiser: "Admiral Hipper heavy cruiser",
    carrier: "Graf Zeppelin aircraft carrier",
    battleship: "Bismarck battleship",
  },
  USSR: {
    infantry: "1943 Red Army rifleman with Mosin-Nagant rifle",
    mech_infantry: "M3 half-track",
    artillery: "76mm ZiS-3 divisional gun",
    tank: "T-34/76 tank",
    aaa: "85mm 52-K AA gun",
    fighter: "Yakovlev Yak-3 fighter",
    tac_bomber: "Ilyushin Il-2 Sturmovik",
    bomber: "Ilyushin Il-4 bomber",
    submarine: "Shchuka-class submarine",
    transport: "Soviet troop transport ship",
    destroyer: "Gnevny-class destroyer",
    cruiser: "Kirov-class cruiser",
    carrier: "Project 71 aircraft carrier",
    battleship: "Gangut-class battleship",
  },
  UK: {
    infantry: "1943 British infantryman with Lee-Enfield rifle",
    mech_infantry: "Universal Carrier",
    artillery: "QF 25-pounder howitzer",
    tank: "Cromwell Mk IV tank",
    aaa: "QF 3.7-inch AA gun",
    fighter: "Supermarine Spitfire fighter",
    tac_bomber: "de Havilland Mosquito fighter-bomber",
    bomber: "Avro Lancaster bomber",
    submarine: "T-class submarine",
    transport: "British Empire troop transport ship",
    destroyer: "Tribal-class destroyer",
    cruiser: "County-class heavy cruiser",
    carrier: "Illustrious-class aircraft carrier",
    battleship: "King George V battleship",
  },
  US: {
    infantry: "1943 US Army infantryman with M1 Garand rifle",
    mech_infantry: "M3 half-track",
    artillery: "M2A1 105mm howitzer",
    tank: "M4A1 Sherman tank",
    aaa: "90mm M1 AA gun",
    fighter: "North American P-51D Mustang fighter",
    tac_bomber: "Douglas SBD Dauntless dive bomber",
    bomber: "Boeing B-17G Flying Fortress bomber",
    submarine: "Gato-class submarine",
    transport: "Liberty ship troop transport",
    destroyer: "Fletcher-class destroyer",
    cruiser: "Baltimore-class heavy cruiser",
    carrier: "Essex-class aircraft carrier",
    battleship: "Iowa-class battleship",
  },
  JAP: {
    infantry: "1943 Imperial Japanese Army infantryman with Type 99 rifle",
    mech_infantry: "Type 1 Ho-Ha half-track",
    artillery: "Type 91 105mm howitzer",
    tank: "Type 97 Chi-Ha Kai tank",
    aaa: "Type 88 75mm AA gun",
    fighter: "Mitsubishi A6M2 Zero fighter",
    tac_bomber: "Aichi D3A Val dive bomber",
    bomber: "Mitsubishi G4M Betty bomber",
    submarine: "Type B1 submarine",
    transport: "Japanese troop transport ship",
    destroyer: "Kagero-class destroyer",
    cruiser: "Takao-class heavy cruiser",
    carrier: "Shokaku-class aircraft carrier",
    battleship: "Yamato battleship",
  },
};

const SIDE_PROMPT =
  "side-profile pixel art game sprite, PLATFORMER STYLE, facing right, flat orthographic side view, full body centered, single isolated unit on transparent background, PLATFORMER STYLE POSE, {NAME}, crisp 1px pixel clusters, flat cel shading, limited color palette, no anti-aliasing, no drop shadow, no ground floor, no text";

const AIR_PROMPT =
  "top-down pixel art game sprite, nose pointing right, flat orthographic top view forming a T shape, full aircraft centered, single isolated unit on transparent background, {NAME}, crisp 1px pixel clusters, flat cel shading, limited color palette, no anti-aliasing, no drop shadow, no ground floor, no text";

/** Starter blueprint ids where the editor already has one. Other units use faction_unit. */
const KNOWN_BLUEPRINT = {
  GER: { infantry: "ger_infantry_43", tank: "ger_tank_pz4" },
  USSR: { infantry: "ussr_infantry_43", tank: "ussr_tank_t34" },
  UK: { infantry: "uk_infantry_43", tank: "uk_tank_cromwell" },
  US: { infantry: "us_infantry_43", tank: "us_tank_sherman" },
  JAP: { infantry: "jap_infantry_43", tank: "jap_tank_chi_ha" },
};

export function historicalName(factionId, unitTypeId) {
  const name = HISTORICAL_UNITS[factionId]?.[unitTypeId];
  if (!name) {
    throw new Error(`No historical name for ${factionId} ${unitTypeId}`);
  }
  return name;
}

export function bakePromptFor(factionId, unitTypeId) {
  const name = historicalName(factionId, unitTypeId);
  const template = AIR_UNITS.has(unitTypeId) ? AIR_PROMPT : SIDE_PROMPT;
  return template.replace("{NAME}", name);
}

export function blueprintIdFor(factionId, unitTypeId) {
  return KNOWN_BLUEPRINT[factionId]?.[unitTypeId] ?? `${factionId.toLowerCase()}_${unitTypeId}`;
}
