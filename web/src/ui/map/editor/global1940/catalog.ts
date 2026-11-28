// Rough Global 1940 board. Boxes are geographic (west, east, south, north). The builder claims
// them in order against the imported coast, then hangs any leftover land or water on the nearest
// territory. Gameplay borders are the link list below, not a pixel touch.

export interface GlobalZone {
  id: string;
  name: string;
  /** Empty is a strict neutral. */
  owner: string;
  sea?: boolean;
  ipc?: number;
  capital?: boolean;
  factory?: "major" | "minor";
  airbase?: boolean;
  harbour?: boolean;
  convoy?: boolean;
  cover?: "URBAN" | "FOREST" | "MOUNTAIN" | "DESERT" | "SNOW";
  /** Who owns ships in a neutral sea zone. Land uses `owner`. */
  garrison?: string;
  /** West, east, south, north, in degrees. */
  box: [number, number, number, number];
  units?: { id: string; count: number }[];
}

export interface GlobalCanal {
  id: string;
  seas: [string, string];
  control: string[];
}

export const GLOBAL_FACTIONS = [
  { id: "germany", name: "Germany", color: "#8C7C79", team: "axis", turn_order: 1, starting_ipc: 0 },
  { id: "soviet_union", name: "Soviet Union", color: "#9C524E", team: "allies", turn_order: 2, starting_ipc: 28 },
  { id: "japan", name: "Japan", color: "#B97A60", team: "axis", turn_order: 3, starting_ipc: 0 },
  { id: "united_kingdom", name: "United Kingdom", color: "#A88A5E", team: "allies", turn_order: 4, starting_ipc: 0 },
  { id: "italy", name: "Italy", color: "#5B7D73", team: "axis", turn_order: 6, starting_ipc: 0 },
  { id: "china", name: "China", color: "#AAA25D", team: "allies", turn_order: 5, starting_ipc: 0 },
  { id: "united_states", name: "United States", color: "#7D7B62", team: "allies", turn_order: 7, starting_ipc: 26 },
  { id: "anzac", name: "ANZAC", color: "#846D59", team: "allies", turn_order: 8, starting_ipc: 0 },
  { id: "free_france", name: "Free France", color: "#4E5463", team: "allies", turn_order: 9, starting_ipc: 0 },
] as const;

/** Germany, the Soviet Union, Japan, Britain, Italy, China, the United States. ANZAC is commanded. */
export const GLOBAL_TURN = ["germany", "soviet_union", "japan", "united_kingdom", "italy", "china", "united_states"] as const;

export const GLOBAL_CANALS: GlobalCanal[] = [
  { id: "suez", seas: ["sz_east_med", "sz_red_sea"], control: ["egypt", "cairo"] },
  { id: "panama", seas: ["sz_caribbean", "sz_panama_pacific"], control: ["central_america"] },
];

const u = (id: string, count: number) => ({ id, count });

/** Specific boxes first. A later box only receives land the earlier ones left behind. */
const RAW_ZONES: GlobalZone[] = [
  { id: "london", name: "London", owner: "united_kingdom", ipc: 6, capital: true, factory: "major", airbase: true, harbour: true, cover: "URBAN", box: [-8, 2, 50, 59], units: [u("infantry", 4), u("fighter", 2), u("aa", 1)] },
  { id: "gibraltar", name: "Gibraltar", owner: "united_kingdom", ipc: 0, airbase: true, harbour: true, box: [-8, -4, 35, 37] },
  { id: "paris", name: "France", owner: "free_france", ipc: 4, capital: true, factory: "major", cover: "URBAN", box: [-5, 8, 43, 51], units: [u("infantry", 4), u("artillery", 1), u("tank", 1), u("fighter", 1)] },
  { id: "berlin", name: "Germany", owner: "germany", ipc: 10, capital: true, factory: "major", airbase: true, cover: "URBAN", box: [6, 15, 47, 55], units: [u("infantry", 6), u("artillery", 2), u("mech_infantry", 2), u("tank", 3), u("aa", 1), u("fighter", 2), u("tactical_bomber", 1), u("strategic_bomber", 1)] },
  { id: "warsaw", name: "Poland", owner: "germany", ipc: 2, box: [15, 24, 49, 55] },
  { id: "rome", name: "Italy", owner: "italy", ipc: 3, capital: true, factory: "major", cover: "URBAN", box: [7, 19, 37, 47], units: [u("infantry", 2), u("artillery", 1), u("tank", 1), u("fighter", 1)] },
  { id: "greece", name: "Greece", owner: "united_kingdom", ipc: 2, box: [19, 28, 36, 42] },
  { id: "portugal", name: "Portugal", owner: "", ipc: 1, box: [-10, -6, 37, 42] },
  { id: "spain", name: "Spain", owner: "", ipc: 2, box: [-10, -1, 36, 44] },
  { id: "norway", name: "Norway", owner: "", ipc: 1, box: [4, 20, 58, 71] },
  { id: "sweden", name: "Sweden", owner: "", ipc: 2, box: [11, 24, 55, 69] },
  { id: "finland", name: "Finland", owner: "", ipc: 1, cover: "SNOW", box: [21, 32, 60, 70] },
  { id: "leningrad", name: "Leningrad", owner: "soviet_union", ipc: 2, factory: "minor", box: [28, 40, 58, 66], units: [u("infantry", 2)] },
  { id: "moscow", name: "Moscow", owner: "soviet_union", ipc: 8, capital: true, factory: "major", cover: "URBAN", box: [32, 50, 52, 60], units: [u("infantry", 6), u("artillery", 2), u("tank", 2), u("fighter", 1)] },
  { id: "stalingrad", name: "Stalingrad", owner: "soviet_union", ipc: 2, factory: "minor", box: [40, 50, 46, 53] },
  { id: "caucasus", name: "Caucasus", owner: "soviet_union", ipc: 3, factory: "minor", cover: "MOUNTAIN", box: [38, 50, 40, 47], units: [u("infantry", 2), u("tank", 1)] },
  { id: "arkhangelsk", name: "Archangel", owner: "soviet_union", ipc: 1, cover: "SNOW", box: [36, 55, 64, 72] },
  { id: "turkey", name: "Turkey", owner: "", ipc: 2, box: [26, 45, 36, 42] },
  { id: "northwest_persia", name: "Northwest Persia", owner: "", ipc: 0, box: [44, 52, 34, 40] },
  { id: "persia", name: "Persia", owner: "united_kingdom", ipc: 2, cover: "DESERT", box: [48, 62, 25, 36] },
  { id: "iraq", name: "Iraq", owner: "united_kingdom", ipc: 2, cover: "DESERT", box: [40, 48, 29, 37] },
  { id: "cairo", name: "Cairo", owner: "united_kingdom", ipc: 2, harbour: true, cover: "URBAN", box: [29, 34, 28, 32], units: [u("infantry", 2)] },
  { id: "egypt", name: "Egypt", owner: "united_kingdom", ipc: 2, cover: "DESERT", box: [24, 36, 22, 32] },
  { id: "morocco", name: "Morocco", owner: "free_france", ipc: 1, cover: "DESERT", box: [-12, 12, 28, 36] },
  { id: "west_africa", name: "West Africa", owner: "free_france", ipc: 1, box: [-18, 16, 4, 20] },
  { id: "south_africa", name: "South Africa", owner: "united_kingdom", ipc: 2, box: [14, 33, -35, -22] },
  { id: "calcutta", name: "Calcutta", owner: "united_kingdom", ipc: 3, factory: "minor", harbour: true, cover: "URBAN", box: [86, 91, 21, 26] },
  { id: "india", name: "India", owner: "united_kingdom", ipc: 3, airbase: true, box: [68, 90, 8, 32], units: [u("infantry", 3), u("artillery", 1)] },
  { id: "burma", name: "Burma", owner: "united_kingdom", ipc: 1, cover: "FOREST", box: [92, 102, 16, 28] },
  { id: "yunnan", name: "Yunnan", owner: "china", ipc: 1, cover: "FOREST", box: [98, 104, 22, 28], units: [u("infantry", 2)] },
  { id: "szechwan", name: "Szechwan", owner: "china", ipc: 1, cover: "MOUNTAIN", box: [100, 108, 28, 34], units: [u("infantry", 2)] },
  { id: "kweichow", name: "Kweichow", owner: "china", ipc: 1, box: [104, 110, 24, 28] },
  { id: "hunan", name: "Hunan", owner: "china", ipc: 1, box: [109, 115, 25, 31] },
  { id: "shansi", name: "Shansi", owner: "china", ipc: 1, box: [110, 116, 34, 41] },
  { id: "suiyuan", name: "Suiyuan", owner: "china", ipc: 1, box: [106, 114, 39, 44] },
  { id: "shanghai", name: "Shanghai", owner: "japan", ipc: 3, factory: "minor", box: [118, 123, 28, 34], units: [u("infantry", 2)] },
  { id: "manchuria", name: "Manchuria", owner: "japan", ipc: 3, box: [120, 135, 40, 52], units: [u("infantry", 2)] },
  { id: "korea", name: "Korea", owner: "japan", ipc: 2, box: [124, 130, 34, 42] },
  { id: "tokyo", name: "Japan", owner: "japan", ipc: 8, capital: true, factory: "major", airbase: true, harbour: true, cover: "URBAN", box: [166, 179, 31, 46], units: [u("infantry", 4), u("artillery", 1), u("tank", 1), u("fighter", 2), u("tactical_bomber", 1)] },
  { id: "manila", name: "Manila", owner: "united_states", ipc: 2, factory: "minor", harbour: true, box: [120, 122, 14, 16] },
  { id: "philippines", name: "Philippines", owner: "united_states", ipc: 2, box: [119, 127, 6, 19], units: [u("infantry", 2)] },
  { id: "malaya", name: "Malaya", owner: "united_kingdom", ipc: 3, box: [100, 105, 1, 7] },
  { id: "sumatra", name: "Sumatra", owner: "united_kingdom", ipc: 4, box: [95, 106, -6, 6] },
  { id: "java", name: "Java", owner: "united_kingdom", ipc: 4, box: [105, 115, -9, -5] },
  { id: "borneo", name: "Borneo", owner: "united_kingdom", ipc: 4, box: [109, 119, -4, 7] },
  { id: "celebes", name: "Celebes", owner: "united_kingdom", ipc: 3, box: [119, 126, -6, 2] },
  { id: "sydney", name: "Sydney", owner: "anzac", ipc: 2, capital: true, factory: "minor", harbour: true, cover: "URBAN", box: [-150, -138, -38, -30], units: [u("infantry", 2)] },
  { id: "australia", name: "Australia", owner: "anzac", ipc: 2, box: [-158, -125, -40, -12] },
  { id: "new_zealand", name: "New Zealand", owner: "anzac", ipc: 1, box: [-130, -116, -48, -34] },
  { id: "canada", name: "Canada", owner: "united_kingdom", ipc: 3, box: [-110, -55, 48, 70] },
  { id: "washington", name: "Eastern United States", owner: "united_states", ipc: 12, capital: true, factory: "major", airbase: true, harbour: true, cover: "URBAN", box: [-90, -67, 30, 47], units: [u("infantry", 2), u("fighter", 1), u("artillery", 1)] },
  { id: "western_united_states", name: "Western United States", owner: "united_states", ipc: 10, factory: "major", harbour: true, box: [-176, -152, 34, 54], units: [u("infantry", 2)] },
  { id: "central_america", name: "Central America", owner: "united_states", ipc: 1, box: [-92, -77, 7, 18] },
  { id: "mexico", name: "Mexico", owner: "united_states", ipc: 2, box: [-110, -90, 16, 31] },
  { id: "alaska", name: "Alaska", owner: "united_states", ipc: 1, cover: "SNOW", box: [-170, -140, 55, 72] },
  { id: "venezuela", name: "Venezuela", owner: "", ipc: 2, box: [-73, -60, 1, 12] },
  { id: "brazil", name: "Brazil", owner: "", ipc: 2, box: [-70, -35, -30, 5] },
  { id: "argentina", name: "Argentina", owner: "", ipc: 2, box: [-72, -55, -55, -22] },
  { id: "chile", name: "Chile", owner: "", ipc: 2, box: [-76, -68, -55, -18] },
  { id: "siberia", name: "Siberia", owner: "soviet_union", ipc: 1, cover: "SNOW", box: [60, 160, 50, 75] },

  { id: "sz_barents", name: "SZ Barents", owner: "", sea: true, box: [20, 60, 68, 82] },
  { id: "sz_north_sea", name: "SZ North Sea", owner: "", sea: true, convoy: true, box: [-4, 10, 52, 62] },
  { id: "sz_baltic", name: "SZ Baltic", owner: "", sea: true, garrison: "germany", box: [10, 24, 54, 66], units: [u("submarine", 2), u("destroyer", 1), u("cruiser", 1), u("transport", 1), u("battleship", 1)] },
  { id: "sz_english_channel", name: "SZ English Channel", owner: "", sea: true, convoy: true, garrison: "united_kingdom", box: [-6, 2, 48, 52], units: [u("destroyer", 1), u("cruiser", 1), u("battleship", 1), u("carrier", 1), u("transport", 1)] },
  { id: "sz_west_med", name: "SZ West Mediterranean", owner: "", sea: true, box: [-6, 12, 35, 44] },
  { id: "sz_east_med", name: "SZ East Mediterranean", owner: "", sea: true, convoy: true, garrison: "italy", box: [12, 36, 30, 40], units: [u("destroyer", 1), u("cruiser", 1), u("submarine", 1), u("transport", 1)] },
  { id: "sz_red_sea", name: "SZ Red Sea", owner: "", sea: true, box: [32, 46, 12, 28] },
  { id: "sz_persian", name: "SZ Persian Gulf", owner: "", sea: true, box: [46, 60, 22, 30] },
  { id: "sz_mid_atlantic", name: "SZ Mid Atlantic", owner: "", sea: true, convoy: true, box: [-45, -8, 30, 55] },
  { id: "sz_south_atlantic", name: "SZ South Atlantic", owner: "", sea: true, box: [-40, 15, -45, 5] },
  { id: "sz_caribbean", name: "SZ Caribbean", owner: "", sea: true, box: [-90, -60, 10, 28] },
  { id: "sz_east_us", name: "SZ Eastern US", owner: "", sea: true, garrison: "united_states", box: [-78, -64, 28, 42], units: [u("destroyer", 1), u("cruiser", 1), u("carrier", 1), u("battleship", 1), u("transport", 1), u("submarine", 1)] },
  { id: "sz_indian", name: "SZ Indian Ocean", owner: "", sea: true, convoy: true, box: [55, 95, -10, 22] },
  { id: "sz_south_indian", name: "SZ South Indian", owner: "", sea: true, box: [30, 110, -50, -15] },
  { id: "sz_south_china", name: "SZ South China Sea", owner: "", sea: true, convoy: true, box: [105, 122, 0, 22] },
  { id: "sz_java_sea", name: "SZ Java Sea", owner: "", sea: true, convoy: true, box: [100, 125, -10, 2] },
  { id: "sz_philippine", name: "SZ Philippine Sea", owner: "", sea: true, box: [122, 145, 5, 25] },
  { id: "sz_japan", name: "SZ Japan", owner: "", sea: true, garrison: "japan", box: [155, 180, 28, 48], units: [u("carrier", 1), u("destroyer", 2), u("cruiser", 1), u("battleship", 1), u("submarine", 1), u("transport", 1)] },
  { id: "sz_north_pacific", name: "SZ North Pacific", owner: "", sea: true, box: [145, 165, 30, 55] },
  { id: "sz_west_us", name: "SZ Western US", owner: "", sea: true, box: [-180, -150, 20, 55] },
  { id: "sz_panama_pacific", name: "SZ Panama Pacific", owner: "", sea: true, box: [-95, -78, 2, 12] },
  { id: "sz_coral", name: "SZ Coral Sea", owner: "", sea: true, garrison: "anzac", box: [-170, -140, -20, 8], units: [u("destroyer", 1)] },
  { id: "sz_south_pacific", name: "SZ South Pacific", owner: "", sea: true, box: [-155, -115, -50, -8] },
];

/** Starting stacks for land that had none, plus the fleets that should sit in open water. */
const STACKS: Record<string, Pick<GlobalZone, "garrison" | "units">> = {
  gibraltar: { units: [u("infantry", 1), u("fighter", 1)] },
  warsaw: { units: [u("infantry", 4), u("artillery", 1), u("tank", 2), u("fighter", 1)] },
  greece: { units: [u("infantry", 2), u("fighter", 1)] },
  portugal: { garrison: "neutral", units: [u("infantry", 2)] },
  spain: { garrison: "neutral", units: [u("infantry", 3), u("artillery", 1)] },
  norway: { garrison: "neutral", units: [u("infantry", 2)] },
  sweden: { garrison: "neutral", units: [u("infantry", 3)] },
  finland: { garrison: "neutral", units: [u("infantry", 3)] },
  leningrad: { units: [u("infantry", 4), u("artillery", 1), u("fighter", 1)] },
  stalingrad: { units: [u("infantry", 3), u("artillery", 1), u("tank", 1)] },
  arkhangelsk: { units: [u("infantry", 2)] },
  turkey: { garrison: "neutral", units: [u("infantry", 4), u("artillery", 1)] },
  northwest_persia: { garrison: "neutral", units: [u("infantry", 1)] },
  persia: { units: [u("infantry", 1)] },
  iraq: { units: [u("infantry", 1)] },
  cairo: { units: [u("infantry", 3), u("artillery", 1), u("tank", 1), u("fighter", 1)] },
  egypt: { units: [u("infantry", 2), u("tank", 1), u("fighter", 1)] },
  morocco: { units: [u("infantry", 2)] },
  west_africa: { units: [u("infantry", 1)] },
  south_africa: { units: [u("infantry", 2)] },
  calcutta: { units: [u("infantry", 2), u("aa", 1)] },
  burma: { units: [u("infantry", 2)] },
  kweichow: { units: [u("infantry", 2)] },
  hunan: { units: [u("infantry", 2)] },
  shansi: { units: [u("infantry", 2)] },
  suiyuan: { units: [u("infantry", 2)] },
  shanghai: { units: [u("infantry", 3), u("artillery", 1), u("fighter", 1)] },
  manchuria: { units: [u("infantry", 4), u("artillery", 1), u("tank", 1)] },
  korea: { units: [u("infantry", 2)] },
  manila: { units: [u("infantry", 2), u("fighter", 1)] },
  malaya: { units: [u("infantry", 2)] },
  sumatra: { units: [u("infantry", 1)] },
  java: { units: [u("infantry", 1)] },
  borneo: { units: [u("infantry", 1)] },
  celebes: { units: [u("infantry", 1)] },
  australia: { units: [u("infantry", 2), u("fighter", 1)] },
  new_zealand: { units: [u("infantry", 1)] },
  canada: { units: [u("infantry", 2)] },
  western_united_states: { units: [u("infantry", 2), u("fighter", 1), u("aa", 1)] },
  central_america: { units: [u("infantry", 1)] },
  mexico: { units: [u("infantry", 1)] },
  alaska: { units: [u("infantry", 1)] },
  venezuela: { garrison: "neutral", units: [u("infantry", 2)] },
  brazil: { garrison: "neutral", units: [u("infantry", 2)] },
  argentina: { garrison: "neutral", units: [u("infantry", 2)] },
  chile: { garrison: "neutral", units: [u("infantry", 1)] },
  siberia: { units: [u("infantry", 3)] },
  sz_barents: { garrison: "soviet_union", units: [u("submarine", 1), u("destroyer", 1)] },
  sz_north_sea: { garrison: "united_kingdom", units: [u("destroyer", 1), u("cruiser", 1)] },
  sz_west_med: { garrison: "italy", units: [u("cruiser", 1), u("destroyer", 1), u("transport", 1)] },
  sz_red_sea: { garrison: "united_kingdom", units: [u("destroyer", 1), u("transport", 1)] },
  sz_indian: { garrison: "united_kingdom", units: [u("carrier", 1), u("cruiser", 1), u("destroyer", 1), u("transport", 1)] },
  sz_south_china: { garrison: "japan", units: [u("destroyer", 1), u("cruiser", 1), u("transport", 1)] },
  sz_java_sea: { garrison: "united_kingdom", units: [u("destroyer", 1), u("cruiser", 1)] },
  sz_philippine: { garrison: "united_states", units: [u("destroyer", 1), u("submarine", 1)] },
  sz_west_us: { garrison: "united_states", units: [u("destroyer", 1), u("cruiser", 1), u("submarine", 1)] },
  sz_caribbean: { garrison: "united_states", units: [u("destroyer", 1)] },
};

export const GLOBAL_ZONES: GlobalZone[] = RAW_ZONES.map((zone) => {
  const stack = STACKS[zone.id];
  return stack ? { ...zone, ...stack } : zone;
});

/** One entry per border. The builder writes both directions. */
export const GLOBAL_LINKS: readonly [string, string][] = [
  ["london", "paris"], ["london", "norway"], ["london", "sz_english_channel"], ["london", "sz_north_sea"],
  ["paris", "berlin"], ["paris", "spain"], ["paris", "sz_english_channel"], ["paris", "sz_west_med"],
  ["berlin", "warsaw"], ["berlin", "rome"], ["berlin", "sz_baltic"],
  ["warsaw", "moscow"], ["moscow", "leningrad"], ["moscow", "stalingrad"], ["moscow", "caucasus"], ["moscow", "arkhangelsk"], ["moscow", "siberia"],
  ["leningrad", "finland"], ["leningrad", "sz_baltic"], ["leningrad", "arkhangelsk"],
  ["stalingrad", "caucasus"], ["caucasus", "turkey"], ["caucasus", "persia"],
  ["finland", "sweden"], ["sweden", "norway"], ["norway", "sz_north_sea"], ["norway", "sz_barents"],
  ["arkhangelsk", "sz_barents"], ["siberia", "manchuria"], ["siberia", "sz_north_pacific"],
  ["spain", "portugal"], ["spain", "gibraltar"], ["portugal", "sz_mid_atlantic"], ["gibraltar", "morocco"], ["gibraltar", "sz_west_med"],
  ["rome", "greece"], ["rome", "sz_west_med"], ["rome", "sz_east_med"],
  ["greece", "turkey"], ["greece", "sz_east_med"], ["turkey", "northwest_persia"], ["turkey", "sz_east_med"],
  ["northwest_persia", "persia"], ["persia", "iraq"], ["persia", "india"], ["iraq", "egypt"], ["iraq", "sz_persian"],
  ["egypt", "cairo"], ["egypt", "morocco"], ["egypt", "sz_east_med"], ["egypt", "sz_red_sea"], ["cairo", "sz_east_med"],
  ["morocco", "west_africa"], ["morocco", "sz_west_med"], ["west_africa", "south_africa"], ["west_africa", "sz_south_atlantic"], ["south_africa", "sz_south_atlantic"], ["south_africa", "sz_indian"],
  ["india", "calcutta"], ["india", "burma"], ["india", "sz_indian"], ["calcutta", "sz_indian"], ["burma", "yunnan"], ["burma", "malaya"],
  ["yunnan", "szechwan"], ["yunnan", "kweichow"], ["szechwan", "hunan"], ["szechwan", "shansi"], ["kweichow", "hunan"],
  ["hunan", "shanghai"], ["shansi", "suiyuan"], ["shansi", "shanghai"], ["suiyuan", "manchuria"],
  ["shanghai", "manchuria"], ["shanghai", "sz_south_china"], ["manchuria", "korea"], ["korea", "sz_japan"],
  ["tokyo", "sz_japan"], ["manila", "philippines"], ["philippines", "sz_philippine"], ["manila", "sz_south_china"],
  ["malaya", "sumatra"], ["malaya", "sz_south_china"], ["sumatra", "sz_java_sea"], ["java", "sz_java_sea"], ["borneo", "sz_south_china"], ["borneo", "sz_java_sea"], ["celebes", "sz_java_sea"],
  ["australia", "sydney"], ["sydney", "sz_coral"], ["australia", "sz_indian"], ["australia", "sz_coral"], ["new_zealand", "sz_south_pacific"],
  ["canada", "washington"], ["canada", "alaska"], ["washington", "western_united_states"], ["washington", "sz_east_us"],
  ["western_united_states", "mexico"], ["western_united_states", "sz_west_us"], ["mexico", "central_america"],
  ["central_america", "sz_caribbean"], ["central_america", "sz_panama_pacific"], ["alaska", "sz_north_pacific"], ["alaska", "sz_west_us"],
  ["venezuela", "brazil"], ["venezuela", "sz_caribbean"], ["brazil", "argentina"], ["brazil", "sz_south_atlantic"], ["argentina", "chile"], ["chile", "sz_south_pacific"],
  ["sz_barents", "sz_north_sea"], ["sz_north_sea", "sz_baltic"], ["sz_north_sea", "sz_english_channel"], ["sz_north_sea", "sz_mid_atlantic"],
  ["sz_english_channel", "sz_west_med"], ["sz_english_channel", "sz_mid_atlantic"], ["sz_west_med", "sz_east_med"],
  ["sz_east_med", "sz_red_sea"], ["sz_red_sea", "sz_persian"], ["sz_red_sea", "sz_indian"], ["sz_persian", "sz_indian"],
  ["sz_mid_atlantic", "sz_south_atlantic"], ["sz_mid_atlantic", "sz_east_us"], ["sz_mid_atlantic", "sz_caribbean"],
  ["sz_caribbean", "sz_east_us"], ["sz_caribbean", "sz_panama_pacific"], ["sz_east_us", "sz_south_atlantic"],
  ["sz_indian", "sz_south_indian"], ["sz_indian", "sz_south_china"], ["sz_south_indian", "sz_south_atlantic"], ["sz_south_indian", "sz_coral"],
  ["sz_south_china", "sz_java_sea"], ["sz_south_china", "sz_philippine"], ["sz_java_sea", "sz_philippine"], ["sz_java_sea", "sz_coral"],
  ["sz_philippine", "sz_japan"], ["sz_philippine", "sz_coral"], ["sz_japan", "sz_north_pacific"],
  ["sz_north_pacific", "sz_west_us"], ["sz_west_us", "sz_panama_pacific"], ["sz_coral", "sz_south_pacific"], ["sz_south_pacific", "sz_north_pacific"],
];
