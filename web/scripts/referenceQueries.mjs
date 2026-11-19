/**
 * Axis & Allies 1940 reference-plate manifest.
 * Fourteen combat types, five major powers. Facilities are not included.
 * Land and naval plates are side profiles. Air plates are top-down planforms.
 */

export const FACTION_IDS = ["GER", "USSR", "UK", "US", "JAP"];

export const UNIT_TYPES = [
  { unitTypeId: "infantry", camera: "side", domain: "land" },
  { unitTypeId: "mech_infantry", camera: "side", domain: "land" },
  { unitTypeId: "artillery", camera: "side", domain: "land" },
  { unitTypeId: "tank", camera: "side", domain: "land" },
  { unitTypeId: "aaa", camera: "side", domain: "land" },
  { unitTypeId: "fighter", camera: "top", domain: "air" },
  { unitTypeId: "tac_bomber", camera: "top", domain: "air" },
  { unitTypeId: "bomber", camera: "top", domain: "air" },
  { unitTypeId: "submarine", camera: "side", domain: "sea" },
  { unitTypeId: "transport", camera: "side", domain: "sea" },
  { unitTypeId: "destroyer", camera: "side", domain: "sea" },
  { unitTypeId: "cruiser", camera: "side", domain: "sea" },
  { unitTypeId: "carrier", camera: "side", domain: "sea" },
  { unitTypeId: "battleship", camera: "side", domain: "sea" },
];

/** Search words that enforce the camera split. Pixel checks still have to agree. */
export const CAMERA_RULES = {
  side: {
    label: "Side profile, facing right",
    searchTerms: ["side profile", "side view", "elevation drawing", "line drawing"],
    fileQuery: '(profile OR elevation OR "side view" OR "line drawing" OR silhouette OR diagram)',
  },
  top: {
    label: "Top-down T, nose right or up",
    searchTerms: ["top view", "planform", "top-down", "3-view"],
    fileQuery: '(planform OR "top view" OR "plan view" OR "top-down" OR "3-view" OR silhouette)',
  },
};

const VEHICLES = [
  "Category:Line drawings of tanks",
  "Category:Side views of tanks",
  "Category:Orthographic elevations of vehicles",
];

const SHIPS = [
  "Category:Line drawings of naval ships",
  "Category:Line drawings of ships",
  "Category:Side views of ships",
  "Category:Ship profiles",
];

const PLANS = [
  "Category:Orthographic plan views of aircraft",
  "Category:Orthographic plans of aircraft",
];

const SOLDIERS = ["Category:Line drawings of soldiers"];

function plate(unitTypeId, className, phrases, options = {}) {
  const unit = UNIT_TYPES.find((item) => item.unitTypeId === unitTypeId);
  return {
    unitTypeId,
    className,
    camera: unit.camera,
    domain: unit.domain,
    phrases,
    prefer: options.prefer ?? [],
    requireAny: options.requireAny ?? [],
    rejectAny: options.rejectAny ?? [],
    categories: options.categories ?? [],
    curatedTitles: options.curatedTitles ?? [],
    searchHint: options.searchHint ?? "",
  };
}

const air = (maker, extra = []) => [...PLANS, `Category:Line drawings of ${maker} aircraft`, ...extra];

export const REFERENCE_MATRIX = {
  GER: {
    infantry: plate("infantry", "Heer rifleman", ["Wehrmacht Heer soldier", "Stahlhelm infantry", "German infantryman"], {
      categories: SOLDIERS,
      prefer: ["stahlhelm", "wehrmacht"],
      rejectAny: ["ss dagger", "medal"],
    }),
    mech_infantry: plate("mech_infantry", "Sd.Kfz. 251 half-track", ["Sd.Kfz. 251", "SdKfz 251", "Sonderkraftfahrzeug 251"], {
      categories: VEHICLES,
      prefer: ["251"],
    }),
    artillery: plate("artillery", "10.5cm leFH 18", ["10.5 cm leFH 18", "leFH 18", "10.5cm leFH"], {
      prefer: ["lefh 18"],
    }),
    tank: plate("tank", "Panzer IV Ausf. H", ["Panzer IV", "Panzerkampfwagen IV", "Pz.Kpfw. IV"], {
      categories: VEHICLES,
      prefer: ["ausf. h", "ausf h", "ausf. g"],
      curatedTitles: ["File:Panzer IV G.svg", "File:Panzer IV MAN-Entwurf.svg"],
      rejectAny: ["wirbelwind", "kugelblitz", "ostwind", "hummel", "brummbar", "brummbär"],
    }),
    aaa: plate("aaa", "8.8cm FlaK 36", ["8.8 cm Flak 36", "8.8 cm Flak", "FlaK 36"], {
      prefer: ["flak 36", "flak 18"],
      searchHint: "gun",
    }),
    fighter: plate("fighter", "Bf 109G", ["Messerschmitt Bf 109", "Bf 109", "Me 109"], {
      categories: air("Messerschmitt"),
      prefer: ["109g", "bf 109 g"],
      rejectAny: ["bf 110", "bf 108"],
    }),
    tac_bomber: plate("tac_bomber", "Ju 87 Stuka", ["Junkers Ju 87", "Ju 87", "Stuka"], {
      categories: air("Junkers"),
      prefer: ["ju 87"],
      requireAny: ["ju 87", "junkers", "stuka"],
    }),
    bomber: plate("bomber", "He 111", ["Heinkel He 111", "He 111"], {
      categories: air("Heinkel"),
      prefer: ["111"],
      rejectAny: ["he 115", "he 162", "he 177", "he 219"],
    }),
    submarine: plate("submarine", "Type VIIC U-boat", ["Type VIIC", "Typ VIIC", "U-boat VIIC"], {
      categories: SHIPS,
      prefer: ["viic", "type vii"],
      searchHint: "submarine",
    }),
    transport: plate("transport", "German merchant troopship", ["Wilhelm Gustloff", "Cap Arcona", "German troopship"], {
      categories: SHIPS,
      prefer: ["gustloff"],
      searchHint: "ship",
    }),
    destroyer: plate("destroyer", "Type 1936A destroyer", ["Type 1936A destroyer", "Zerstörer 1936A", "Narvik-class destroyer"], {
      categories: SHIPS,
      prefer: ["1936a", "narvik"],
      searchHint: "destroyer",
    }),
    cruiser: plate("cruiser", "Admiral Hipper cruiser", ["Admiral Hipper", "Hipper-class cruiser"], {
      categories: SHIPS,
      requireAny: ["hipper", "cruiser", "kreuzer"],
      searchHint: "cruiser",
    }),
    carrier: plate("carrier", "Graf Zeppelin carrier", ["Graf Zeppelin carrier", "Flugzeugträger Graf Zeppelin", "Graf Zeppelin"], {
      categories: SHIPS,
      prefer: ["carrier", "flugzeugträger", "flugzeugtrager"],
      rejectAny: ["airship", "lz 127", "lz127", "dirigible"],
      searchHint: "carrier",
    }),
    battleship: plate("battleship", "Bismarck battleship", ["Bismarck battleship", "Schlachtschiff Bismarck", "Bismarck", "Bismark"], {
      categories: SHIPS,
      requireAny: ["battleship", "schlachtschiff", "ship", "kms"],
      rejectAny: ["otto von", "north dakota", "chancellor"],
      searchHint: "battleship",
      curatedTitles: ["File:Battleship Bismark.svg"],
    }),
  },
  USSR: {
    infantry: plate("infantry", "Red Army rifleman", ["Red Army soldier", "Soviet infantryman", "SSh-40"], {
      categories: SOLDIERS,
      prefer: ["ssh-40", "red army"],
    }),
    mech_infantry: plate("mech_infantry", "M3/BA-64 scout half-track", ["M3 half-track", "BA-64", "M3 Halftrack"], {
      categories: VEHICLES,
      prefer: ["half-track", "halftrack", "ba-64"],
    }),
    artillery: plate("artillery", "76mm ZiS-3", ["ZiS-3", "76 mm divisional gun M1942", "76mm ZiS-3"], {
      prefer: ["zis-3", "zis 3"],
    }),
    tank: plate("tank", "T-34/76", ["T-34", "T-34-76", "T-34/76"], {
      categories: VEHICLES,
      prefer: ["t-34-76", "t-34/76", "1942", "1941"],
    }),
    aaa: plate("aaa", "85mm 52-K AA gun", ["52-K", "85 mm air defense gun M1939", "85mm 52-K"], {
      prefer: ["52-k"],
      searchHint: "gun",
    }),
    fighter: plate("fighter", "Yak-3", ["Yakovlev Yak-3", "Yak-3"], {
      categories: air("Yakovlev"),
      prefer: ["yak-3"],
      rejectAny: ["yak-1", "yak-7", "yak-9"],
    }),
    tac_bomber: plate("tac_bomber", "Il-2 Sturmovik", ["Ilyushin Il-2", "Il-2", "Sturmovik"], {
      categories: air("Ilyushin"),
      prefer: ["il-2"],
      rejectAny: ["il-10"],
    }),
    bomber: plate("bomber", "Il-4", ["Ilyushin Il-4", "Il-4", "DB-3F"], {
      categories: air("Ilyushin"),
      prefer: ["il-4"],
      rejectAny: ["il-2"],
    }),
    submarine: plate("submarine", "Shchuka-class submarine", ["Shchuka-class", "Shchuka class submarine", "Schuka-class"], {
      categories: SHIPS,
      prefer: ["shchuka", "schuka"],
      searchHint: "submarine",
    }),
    transport: plate("transport", "Soviet troop transport", ["Iosif Stalin ship", "Soviet troopship", "Soviet transport ship"], {
      categories: SHIPS,
      searchHint: "ship",
    }),
    destroyer: plate("destroyer", "Gnevny-class destroyer", ["Gnevny-class", "Gnevny class destroyer"], {
      categories: SHIPS,
      prefer: ["gnevny"],
      searchHint: "destroyer",
    }),
    cruiser: plate("cruiser", "Kirov-class cruiser", ["Kirov-class cruiser", "Cruiser Kirov"], {
      categories: SHIPS,
      requireAny: ["cruiser", "kreiser", "kirov-class"],
      rejectAny: ["airship", "map"],
      searchHint: "cruiser",
    }),
    carrier: plate("carrier", "Project 71 carrier", ["Project 71 aircraft carrier", "Projekt 71", "Project 71 carrier"], {
      categories: SHIPS,
      searchHint: "carrier",
    }),
    battleship: plate("battleship", "Sovetsky Soyuz / Gangut battleship", ["Sovetsky Soyuz", "Gangut-class battleship", "Soviet battleship Gangut"], {
      categories: SHIPS,
      prefer: ["sovetsky soyuz", "gangut"],
      searchHint: "battleship",
    }),
  },
  UK: {
    infantry: plate("infantry", "British Tommy rifleman", ["British Tommy", "British infantryman", "Brodie helmet soldier"], {
      categories: SOLDIERS,
      prefer: ["tommy", "brodie"],
    }),
    mech_infantry: plate("mech_infantry", "Universal Carrier / M5 half-track", ["Universal Carrier", "Bren Carrier", "M5 half-track"], {
      categories: VEHICLES,
      prefer: ["universal carrier", "bren"],
    }),
    artillery: plate("artillery", "QF 25-pounder", ["QF 25-pounder", "25-pounder", "25 pounder"], {
      prefer: ["25-pounder", "25 pounder"],
    }),
    tank: plate("tank", "Cromwell Mk IV", ["Cromwell tank", "Cruiser Mk VIII Cromwell", "A27M Cromwell"], {
      categories: VEHICLES,
      prefer: ["cromwell"],
      rejectAny: ["oliver cromwell"],
    }),
    aaa: plate("aaa", "QF 3.7-inch AA gun", ["QF 3.7-inch AA gun", "3.7-inch AA", "QF 3.7 inch"], {
      prefer: ["3.7"],
      searchHint: "gun",
    }),
    fighter: plate("fighter", "Supermarine Spitfire", ["Supermarine Spitfire", "Spitfire"], {
      categories: air("Supermarine"),
      prefer: ["spitfire"],
      requireAny: ["supermarine", "spitfire mk", "aircraft", "raf"],
      rejectAny: ["triumph", "automobile"],
      curatedTitles: ["File:Supermarine Spitfire Mk Vb 3-view.svg"],
    }),
    tac_bomber: plate("tac_bomber", "Fairey Barracuda / Mosquito FB", ["Fairey Barracuda", "de Havilland Mosquito", "Mosquito FB"], {
      categories: [...air("Fairey"), ...air("de Havilland")],
      prefer: ["barracuda", "mosquito"],
      requireAny: ["fairey", "havilland", "barracuda", "mosquito"],
      rejectAny: ["insect", "fish", "disease"],
    }),
    bomber: plate("bomber", "Avro Lancaster", ["Avro Lancaster", "Lancaster bomber"], {
      categories: air("Avro"),
      prefer: ["lancaster"],
      requireAny: ["avro", "lancaster", "bomber"],
      rejectAny: ["county", "map"],
    }),
    submarine: plate("submarine", "T-class submarine", ["British T-class submarine", "Triton class submarine", "T-class submarine"], {
      categories: SHIPS,
      prefer: ["t-class", "triton class"],
      searchHint: "submarine",
    }),
    transport: plate("transport", "Liberty/Empire troopship", ["Empire ship", "Empire Windrush", "Liberty ship"], {
      categories: SHIPS,
      prefer: ["empire"],
      searchHint: "ship",
    }),
    destroyer: plate("destroyer", "Tribal-class destroyer", ["Tribal-class destroyer", "Tribal class destroyer (1936)"], {
      categories: SHIPS,
      requireAny: ["destroyer", "hms", "ship"],
      searchHint: "destroyer",
    }),
    cruiser: plate("cruiser", "County-class cruiser", ["County-class cruiser", "County class cruiser"], {
      categories: SHIPS,
      requireAny: ["cruiser", "hms"],
      searchHint: "cruiser",
    }),
    carrier: plate("carrier", "Illustrious-class carrier", ["Illustrious-class", "HMS Illustrious"], {
      categories: SHIPS,
      prefer: ["illustrious"],
      requireAny: ["carrier", "hms", "ship", "illustrious"],
      searchHint: "carrier",
    }),
    battleship: plate("battleship", "King George V battleship", ["King George V-class battleship", "HMS King George V"], {
      categories: SHIPS,
      requireAny: ["battleship", "hms", "ship", "class"],
      rejectAny: ["portrait", "king george v of", "stamp"],
      searchHint: "battleship",
    }),
  },
  US: {
    infantry: plate("infantry", "US GI rifleman", ["US Army infantryman", "American GI", "M1 helmet soldier"], {
      categories: SOLDIERS,
      prefer: ["m1 helmet", "gi"],
    }),
    mech_infantry: plate("mech_infantry", "M3 Half-track", ["M3 half-track", "M3A1 half-track", "M3 Halftrack"], {
      categories: VEHICLES,
      prefer: ["half-track", "halftrack"],
    }),
    artillery: plate("artillery", "M2A1 105mm howitzer", ["M2A1 105 mm howitzer", "M101 howitzer", "105 mm howitzer M2"], {
      prefer: ["m2a1", "m101"],
    }),
    tank: plate("tank", "M4A1 Sherman", ["M4A1 Sherman", "M4 Sherman", "Sherman tank"], {
      categories: VEHICLES,
      prefer: ["m4a1", "sherman"],
      requireAny: ["sherman", "m4"],
      rejectAny: ["william tecumseh", "general sherman"],
    }),
    aaa: plate("aaa", "90mm M1 AA gun", ["90 mm gun M1", "90mm M1 AA", "90 mm anti-aircraft gun"], {
      prefer: ["90 mm", "90mm"],
      searchHint: "gun",
    }),
    fighter: plate("fighter", "P-51D Mustang", ["North American P-51", "P-51D Mustang", "P-51 Mustang"], {
      categories: air("North American"),
      prefer: ["p-51d", "p-51"],
      requireAny: ["p-51", "north american", "mustang"],
      rejectAny: ["ford mustang", "automobile"],
    }),
    tac_bomber: plate("tac_bomber", "SBD Dauntless", ["Douglas SBD Dauntless", "SBD Dauntless", "Douglas SBD"], {
      categories: air("Douglas"),
      prefer: ["sbd", "dauntless"],
      requireAny: ["sbd", "douglas", "dauntless"],
      rejectAny: ["hms dauntless"],
    }),
    bomber: plate("bomber", "B-17G Flying Fortress", ["Boeing B-17", "B-17 Flying Fortress", "B-17G"], {
      categories: air("Boeing"),
      prefer: ["b-17"],
      requireAny: ["b-17", "flying fortress", "boeing"],
    }),
    submarine: plate("submarine", "Gato-class submarine", ["Gato-class submarine", "USS Gato", "Gato class"], {
      categories: SHIPS,
      prefer: ["gato"],
      searchHint: "submarine",
    }),
    transport: plate("transport", "Liberty ship transport", ["Liberty ship", "EC2-S-C1", "SS John W. Brown"], {
      categories: SHIPS,
      prefer: ["liberty ship"],
      searchHint: "ship",
    }),
    destroyer: plate("destroyer", "Fletcher-class destroyer", ["Fletcher-class destroyer", "Fletcher class"], {
      categories: SHIPS,
      prefer: ["fletcher"],
      requireAny: ["destroyer", "fletcher", "uss"],
      searchHint: "destroyer",
    }),
    cruiser: plate("cruiser", "Baltimore-class cruiser", ["Baltimore-class cruiser", "Baltimore class cruiser"], {
      categories: SHIPS,
      requireAny: ["cruiser", "uss"],
      rejectAny: ["city", "map", "orioles"],
      searchHint: "cruiser",
    }),
    carrier: plate("carrier", "Essex-class carrier", ["Essex-class aircraft carrier", "USS Essex (CV-9)", "Essex-class carrier"], {
      categories: SHIPS,
      prefer: ["essex"],
      requireAny: ["carrier", "cv-", "uss essex", "essex-class"],
      rejectAny: ["county", "map"],
      searchHint: "carrier",
    }),
    battleship: plate("battleship", "Iowa-class battleship", ["Iowa-class battleship", "USS Iowa (BB-61)", "BB-61"], {
      categories: SHIPS,
      prefer: ["iowa-class", "bb-61"],
      requireAny: ["battleship", "bb-61", "bb-62", "uss iowa"],
      rejectAny: ["state", "map", "des moines"],
      searchHint: "battleship",
    }),
  },
  JAP: {
    infantry: plate("infantry", "IJA rifleman", ["Imperial Japanese Army soldier", "IJA infantryman", "Japanese Army uniform"], {
      categories: SOLDIERS,
      prefer: ["ija", "imperial japanese army"],
    }),
    mech_infantry: plate("mech_infantry", "Type 1 Ho-Ha half-track", ["Type 1 Ho-Ha", "Ho-Ha"], {
      categories: VEHICLES,
      prefer: ["ho-ha"],
    }),
    artillery: plate("artillery", "Type 91 105mm howitzer", ["Type 91 10 cm howitzer", "Type 91 105 mm howitzer", "Type 91 howitzer"], {
      prefer: ["type 91"],
    }),
    tank: plate("tank", "Type 97 Chi-Ha Kai", ["Type 97 Chi-Ha", "Chi-Ha Kai", "Chi-Ha"], {
      categories: VEHICLES,
      prefer: ["shinhoto", "kai", "chi-ha"],
    }),
    aaa: plate("aaa", "Type 88 75mm AA gun", ["Type 88 75 mm AA gun", "Type 88 75 mm", "75 mm Type 88"], {
      prefer: ["type 88"],
      searchHint: "gun",
    }),
    fighter: plate("fighter", "A6M2 Zero", ["Mitsubishi A6M", "A6M2 Zero", "A6M Zero"], {
      categories: air("Mitsubishi"),
      prefer: ["a6m2", "a6m"],
      requireAny: ["a6m", "mitsubishi", "zero"],
      rejectAny: ["a6m5 only poster"],
    }),
    tac_bomber: plate("tac_bomber", "D3A Val", ["Aichi D3A", "D3A Val", "Type 99 dive bomber"], {
      categories: air("Aichi"),
      prefer: ["d3a"],
      requireAny: ["d3a", "aichi", "type 99"],
    }),
    bomber: plate("bomber", "G4M Betty", ["Mitsubishi G4M", "G4M Betty", "Type 1 land attack"], {
      categories: air("Mitsubishi"),
      prefer: ["g4m"],
      requireAny: ["g4m", "mitsubishi", "betty"],
    }),
    submarine: plate("submarine", "Type B1 submarine", ["Type B1 submarine", "I-15 class submarine", "Junsen B"], {
      categories: SHIPS,
      prefer: ["b1", "i-15"],
      requireAny: ["submarine", "i-15", "b1"],
      searchHint: "submarine",
    }),
    transport: plate("transport", "Japanese troop transport", ["Heian Maru", "Japanese troopship", "Sakito Maru"], {
      categories: SHIPS,
      searchHint: "ship",
    }),
    destroyer: plate("destroyer", "Kagero-class destroyer", ["Kagero-class destroyer", "Kagerō-class destroyer", "Kagero class"], {
      categories: SHIPS,
      prefer: ["kagero", "kagerō"],
      searchHint: "destroyer",
    }),
    cruiser: plate("cruiser", "Takao-class cruiser", ["Takao-class cruiser", "Takao class cruiser"], {
      categories: SHIPS,
      requireAny: ["cruiser", "ijn", "ship"],
      searchHint: "cruiser",
    }),
    carrier: plate("carrier", "Shokaku-class carrier", ["Shokaku-class", "Shōkaku", "Shokaku"], {
      categories: SHIPS,
      prefer: ["shokaku", "shōkaku"],
      requireAny: ["carrier", "shokaku", "shōkaku", "ijn"],
      searchHint: "carrier",
    }),
    battleship: plate("battleship", "Yamato battleship", ["Japanese battleship Yamato", "IJN Yamato", "Yamato battleship"], {
      categories: SHIPS,
      prefer: ["yamato"],
      requireAny: ["battleship", "ijn", "ship"],
      rejectAny: ["prefecture", "people", "map"],
      searchHint: "battleship",
    }),
  },
};

export function listTargets() {
  const targets = [];
  for (const factionId of FACTION_IDS) {
    for (const unit of UNIT_TYPES) {
      const entry = REFERENCE_MATRIX[factionId]?.[unit.unitTypeId];
      if (!entry) throw new Error(`Missing reference query for ${factionId} ${unit.unitTypeId}`);
      targets.push({ factionId, ...entry });
    }
  }
  if (targets.length !== FACTION_IDS.length * UNIT_TYPES.length) {
    throw new Error(`Expected 70 targets, found ${targets.length}`);
  }
  return targets;
}
