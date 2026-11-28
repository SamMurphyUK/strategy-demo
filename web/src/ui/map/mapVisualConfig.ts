// Live art settings for the Shogun board (../viewport3d/shogun), and the store that holds them.
//
// `mapVisuals` is one plain object, changed in place. The board reads its fields inside the frame
// loop and writes them to shader uniforms, post-pass numbers, and `visible` flags, so a slider
// costs a frame and nothing else: no React render of the board, no new geometry. The tuning drawer
// is the only React reader, and it subscribes for itself.
//
// No Three.js and no DOM here, so the 2D map and the tests can read it.

export type FriendlyBorderStyle = "subtle-dashed" | "solid" | "hidden";
export type FrontlineStyle = "dual-ink" | "classic" | "hidden";
export type HighlightRule = "click-and-drag" | "always-hover" | "off";
/** How much of an effect the board draws. "off" costs nothing: no pass, no buffer, no shader branch. */
export type EffectWeight = "off" | "low" | "medium" | "high";
/** What marks a picked-up or pointed-at stack: an ink line round its figures, a pigment wash, both, or nothing. */
export type OutlineMode = "units-only" | "watercolor-only" | "both" | "off";
/** The sun: crossing the table, held at noon, held at the warm end of the afternoon, or out. */
export type SunCycle = "animated" | "static-noon" | "static-golden" | "off";

export interface MapVisualConfig {
  /** The faction tint on the Diorama's pixel ground: its most, at the mid zoom. It fades to none as the diorama comes in. */
  factionTintMax: number;
  /** How close the zoom is (0 fitted board, 1 closest) where the tint starts to fade, and where it is gone: the diorama's. */
  factionTintFadeFrom: number;
  factionTintFadeTo: number;
  /** How much stronger the tint is along the outer edge of a faction's land than deep inside it. 0.6 is 60% stronger. */
  factionEdgeBoost: number;
  /** The tint's brightness and saturation at the mid zoom, as multipliers: 1 is the faction's own colour. */
  factionTintBrightness: number;
  factionTintSaturation: number;
  /** The border line's brightness against the faction's colour (under 1 is darker, so it reads on the tint), and a multiplier on its opacity. */
  factionBorderBrightness: number;
  factionBorderOpacity: number;
  /** How much of its strength a border keeps at the closest zoom, where the tint has faded out: 0.5 is half. Borders never fade to nothing. */
  factionBorderFloor: number;
  /** The border line's width on the screen, in px, at every zoom. */
  factionBorderWidth: number;
  /** The strength of the pale keyline either side of the border's dark core. 0 is none. */
  factionBorderKeyline: number;
  /** How much lighter or darker a territory sits than its neighbours: 0.05 is up to 5% either way. */
  factionRegionShift: number;
  /** How much larger the round unit tokens draw at the strategic and pixel zoom than their base size. They may overlap the borders. */
  tokenSizeBoost: number;
  /** How close the zoom is (0 fitted board, 1 closest) where borders start to ease toward that floor, and where they reach it. */
  factionBorderFadeFrom: number;
  factionBorderFadeTo: number;
  /** How much stronger one faction's tint is than the rest at the mid zoom: 1.6 is 60% stronger. */
  factionBoostUSSR: number;
  factionBoostGER: number;
  factionBoostJAP: number;
  factionBoostUS: number;
  factionBoostUK: number;
  /** The faction tint of a border between two territories of one faction, and of one between two factions' land. */
  factionBorderInner: number;
  factionBorderFrontier: number;
  /** Share of the faction colour over the natural ground at the closest zoom. */
  factionWashClose: number;
  /** The same share at the fitted board. */
  factionWashFar: number;
  /** Paper tooth and contour lines on the land. 0 is smooth. */
  terrainGrainStrength: number;
  /** The line between two territories of one faction. */
  friendlyBorderStyle: FriendlyBorderStyle;
  /** The line between two factions at war. */
  frontlineStyle: FrontlineStyle;
  /** When a territory wears the watercolour edge. */
  highlightMode: HighlightRule;
  watercolorIntensity: number;
  /** How strongly every legal destination shows while a stack is picked up. 0 shows the hovered one only. */
  legalHintStrength: number;
  /** Trees, mountains, and buildings. */
  showBiomeProps: boolean;
  /** Battle smoke and chimney smoke. */
  showBattleSmoke: boolean;
  /** Opacity of the thickest part of a puff. */
  smokeOpacity: number;
  /** Swell, surf, foam, and glints. */
  showCoastalWaves: boolean;
  enableDoF: boolean;
  /** Blur at the screen's far edge. 1 is the full lens; the shipped look pulls it back to 0.6. */
  bokehIntensity: number;
  /** Where the sun stands while it does not sweep, in degrees east of north. */
  sunAzimuth: number;
  /** The sun crosses the table through the day. */
  sunSweep: boolean;
  /** Dark edge around the pieces. */
  unitRim: number;
  /** Opacity of the shadow under a piece. */
  contactShadow: number;
  /** Shade where a cliff meets the sea and where a mountain or a building meets the ground. */
  aoWeight: EffectWeight;
  /** Glow round embers and sun glitter. Nothing at or below paper white glows. */
  bloomWeight: EffectWeight;
  /** Paper tooth over the finished picture, strongest at the strategic zoom. */
  filmGrainWeight: EffectWeight;
  outlineMode: OutlineMode;
  /** Shadows cast by cliffs, mountains, buildings, and standing figures. The weight is the map's size. */
  shadowQuality: EffectWeight;
  /** Sky on the sea: a sheen on the swell and a glitter path under the sun. */
  envReflectionWeight: EffectWeight;
  sunCycle: SunCycle;

  // --- The table: terrain, light, and bases. Each has a switch and its own numbers. ---

  /** Sculpted relief in Switzerland, the Himalayas, and Persia. Every other territory stays flat. */
  enableShogunMountains: boolean;
  /** The loose peak and boulder models along the world's ranges. */
  enableScatteredRocks: boolean;
  /** Height of the tallest summit, in world units. The board also holds it under two fifths of an infantry figure. */
  mountainPeakHeight: number;
  /** 0 is a smooth dome. 1 is the ridged massif. */
  mountainRidgeSharpness: number;
  /** Share of the summit's height where the snow is half on. */
  mountainSnowLine: number;
  /** Half the height the snow takes to come on, as a share of the summit. Small is a hard line. */
  mountainSnowBlend: number;
  /** How far sunlit snow goes above paper white, for the glow to spread. 0 leaves it white. */
  mountainSnowGlow: number;

  /** Fine relief on the land: flock, soil, sand, and rock grain, lit by the sun. */
  enablePbrSurface: boolean;
  /** Depth of the grain. */
  pbrNormalStrength: number;
  /** 1 is matt flock. Lower puts a satin sheen on the ground toward the sun. */
  pbrRoughness: number;
  /** World units the grain covers before it repeats. */
  pbrTilingScale: number;
  /** Saturation of the land's own colour under the grain. 1 is the printed colour. */
  terrainSaturation: number;

  enableRivers: boolean;
  /** Width of a river, in world units. */
  riverWidth: number;
  /** How much darker the middle of the channel is than its edge. */
  riverDepthShade: number;
  /** Strength of the sunlit and the shaded bank. */
  riverBankHighlight: number;

  enableRoads: boolean;
  /** Width of a road, in world units. */
  roadWidth: number;
  roadOpacity: number;
  /** 0 is bone ivory, 1 is warm parchment. */
  roadWarmth: number;

  /** The sun crosses the table. Off, it stops where it stands. */
  enableSunTransit: boolean;
  /** How fast the day passes. 1 is the shipped pace, a day in five minutes. */
  sunCycleSpeed: number;
  /** Height of the sun at either end of the day, in degrees above the table. */
  sunMinElevation: number;
  /** Height of the sun at noon, in degrees. */
  sunMaxElevation: number;
  /** 1 is the shipped amber. More warms noon as well; 0 is white light all day. */
  sunWarmthIntensity: number;
  /** Strength of the cool fill from the sky. */
  ambientFillIntensity: number;

  /** Shadows cast by the sun. Off, there is no shadow map at all. */
  enableShadows: boolean;
  /** How dark a full cast shadow is. */
  shadowOpacity: number;
  /** Width of a shadow's edge, in texels of the map. */
  shadowSoftness: number;
  /** How far off a slope the map is read, in world units. More cures stripes and loosens contact. */
  shadowNormalBias: number;

  /** The turned base under a standing figure: a dark rim, a brass ring, a faction field. */
  enableBasePlinths: boolean;
  /** Width of the rim, as a share of the base. */
  plinthRimWidth: number;
  /** 0 is polished, 1 is matt. Between, the rim carries a satin highlight. */
  plinthRoughness: number;
  /** 0 is a ring in the faction's colour, 1 is brass. */
  plinthBrassIntensity: number;
  /** A figure's shadow falls on bases only and leaves the ground clean. */
  shadowOnBasesOnly: boolean;

  // --- The pixel chart: faux-pixel cartography on the plain 3D board. ---

  /** The land and the sea are drawn as a chart of square texels that stay fixed to the board. */
  enableFauxPixelMap: boolean;
  /** Texels to a world unit at the closest zoom. The grid coarsens by halves as the camera rises. */
  pixelTexelDensity: number;
  /** How hard a slope is lit or shaded. 0 is a flat chart. */
  pixelHillshadeContrast: number;
  /** Flat tones on each side of level ground: this many of shade, and this many of light. */
  pixelShadowSteps: number;
  /** How far the 4×4 ordered dither mixes two neighbouring tones. 0 is hard bands. */
  pixelDitherStrength: number;
  /** Saturation of the chart's land palette. 1 is the palette as it is listed. */
  pixelPaletteSaturation: number;
  /** Depth bands on the sea, from the shelf to the open ocean. */
  seaContourSteps: number;
  /** Strength of the one-texel ochre rim where the land meets the sea. */
  coastRimIntensity: number;
  /** The pale dithered shallows along the coast. Off, the sea keeps its deep colour right up to the shore. */
  enablePixelFoam: boolean;
  /** How much of the shelf stays pale. 1 is the whole shelf, 0.7 takes the foam in by 30%. */
  pixelFoamReach: number;
  /** How far the edge of the shallows breathes in and out, like a tide lapping. 0 is a fixed edge. */
  pixelFoamBleed: number;
  /** Strength of the rings of surf that roll in around the coast. 0 is none. */
  seaWaveRings: number;
  /** Brightness of the sun glitter on the sea. 0 is none. */
  seaSheenStrength: number;
  /** How much of the waves and the glitter is left with the camera as far out as it goes. 0 is none, 1 is all of it. */
  seaFarVisibility: number;
  /** Size of the patch of sea the sun glitter gathers in. 1 is the old size; 0.7 is 30% smaller. */
  seaSheenRadius: number;
  /** The same, as a share of the above with the camera zoomed all the way out. 0.9 is a further 10% smaller. */
  seaSheenFarRadius: number;
  /** Distance between glints. 1 is the old spacing; 1.2 is 20% wider. Wider again as the camera rises. */
  seaSheenSpacing: number;
  /** How far the glints and the edge of the patch are scattered off a regular grid. */
  seaSheenScatter: number;
  /** How often the sea glints: how many are lit at once, and how fast each one flickers. 1 is the usual, 2 twice as many and twice as quick, 0 none. */
  seaSheenFrequency: number;
  /** How often a breaking wave throws a glint where the sun could catch it. 0 is never. */
  seaSheenPops: number;
  /** At sprite zoom the land eases from the pixel chart to a soft posterized wash, so the figures stand out. */
  enableSoftLand: boolean;
  /** The zoom where the softening starts, and the zoom where it is whole. The icon tokens hold the full pixel chart up to 3.8, where the sprites arrive. */
  softLandFrom: number;
  /** How far the world-space diorama surface (grass flock, sand ripples, snow, slate) comes in over the pixel chart from zoom 3.8 to 4.3. 0 keeps the chart. */
  dioramaPbrBlend: number;
  /** The diorama surface's repeats, against the shipped size. */
  dioramaTileScale: number;
  /** The nearest the camera may come, in camera distance (see boardTune.ts). */
  microMinDistance: number;
  /** Degrees above the horizon the camera looks from at the closest zoom. */
  microPitchDeg: number;
  /** Extra backward lean of the 2D figures in the micro tier, in degrees. */
  microSpriteTiltDeg: number;
  /** The tilt-shift blur of the top and bottom of the frame in the micro tier. 0 is none. */
  tiltShiftStrength: number;
  /** How far a ship's shadow stretches across the water, as a share of what the sun would throw. 0 is none; low is a reflection. */
  /** How deep the shadows drawn on the monuments go. 1 is the plain shade. */
  landmarkShadowStrength: number;
  /** The size of the ships against what they were: 0.4 is 60% smaller. */
  shipSizeScale: number;
  /** The recess wash of the city landmarks: a deeper, hue-shifted wash pooled in the crevices and under the eaves. 0 is none. */
  landmarkWashStrength: number;
  /** The drybrush edge highlight on the landmark ridges, domes and spires. 0 is none. */
  landmarkDrybrushStrength: number;
  /** The dark earth and stone contact shade across the foot of each landmark. 0 is none. */
  landmarkGroundAO: number;
  /** How much of its cliff an island keeps: 1 stands as tall as the continents, lower sits lower in the sea. A territory can take its own (see islandOverrides.ts). */
  islandElevationScale: number;
  /** The thick monsoon mist over the Southeast Asian jungles, hugging the canopy. 0 is none. */
  seaJungleMistStrength: number;
  /** How many birds wheel over the close-up board, and how loud their flocks are. 0 is none. */
  microBirdsWeight: number;
  /** How far apart the theaters' trees and ground are: emerald Pacific jungle against dry olive and gold Africa. 0 is one look. */
  canopyBiomeContrast: number;
  /** The glitter of quartz grains in the desert sand, close in. 0 is none. */
  sandGlintStrength: number;
  /** The warm terracotta-amber bounce in the shade of the dunes. 0 is plain shade. */
  sandSubsurfaceAmber: number;
  /** How far the snow feathers out into the flat land beside it, and bares the earth at its fringe. 0 is the chart's hard edge. */
  snowDriftBleed: number;
  /** The sand and snow powder blown off the crests, close in. 0 is none. */
  crestPowderStrength: number;
  /** How dark the cliffs are in their own shade: the foot and the face turned from the sun. 0 is the old flat light. */
  cliffShadowStrength: number;
  /** How deep the diorama surface's relief reads in the light. */
  dioramaNormalStrength: number;
  /** How much of the photographed sets' luminance modulates the palette colour. 0 is the chart's flat colour. */
  albedoDetailStrength: number;
  /** The cold slate-blue the shade of snow takes. */
  snowColdTint: number;
  /** The warm amber haze and shimmer over the desert. */
  desertHeatHaze: number;
  /** How far the ground darkens and enriches under dense trees. */
  forestUnderstoryTint: number;
  /** How strongly the wind drives the snow flurries and the haze. */
  windStrength: number;
  /** The height of the broad rolling hills, as a share of the mountains' height. 0 is flat. */
  terrainHillRelief: number;
  softLandTo: number;
  /** What is left of the dither, the colour, and the light and shade once the land is soft. 1 is as strategic. */
  softLandDither: number;
  softLandSaturation: number;
  softLandValueBand: number;
  /** How far brush strokes wander the soft bands. 0 is clean bands. */
  softLandBrush: number;
  /** Size of the detailed unit sprites and their bases at the 3.8 reveal, as a share of the round token they replace. */
  detailedSpriteBaseScale: number;
  /** How far the detailed sprites follow the board as the camera comes in from 3.8. 1 is steady in world space, like the terrain; 0 holds their size on screen. */
  detailedSpriteWorldLock: number;
  /** How high the land stands above the sea: the ceiling of the land, and so the height of the cliffs. 1 is as shipped. */
  terrainHeightScale: number;
  /** A multiplier on how far the sculpted ranges rise off the land. 1 is the range height as set. */
  mountainReliefHeight: number;
  /** How far a ship's hull sits below the water, in world units. 0 floats on the surface. */
  navalSubmergeDepth: number;
  /** How far a ship heaves up and down all the time. 0 holds it still. Pitch and roll between waves are all but level whatever this is. */
  /** The zoom where the city landmarks appear. Crossing it starts their build: it runs by the clock, not by further zoom. */
  landmarkRevealFrom: number;
  /** Retired with the zoom-driven rise; kept so saved looks still load. */
  landmarkRevealTo: number;
  /** Retired with the zoom-driven rise; kept so saved looks still load. */
  landmarkRevealBand: number;
  /** How long a landmark takes to build, brick by brick, in seconds. */
  landmarkBuildSeconds: number;
  /** The size of one build cube, as a share of the model's width. Smaller is finer bricks and more of them. */
  landmarkBuildCube: number;
  /** The zoom where the factory, harbor and airbase badges start to split apart and point at their models. */
  facilitySplitFrom: number;
  /** The zoom where the split badges are gone. Keep it a little under the closest zoom. */
  facilityFadeEnd: number;
  /** How far apart the badge's three triangles drift, in badge widths. */
  facilitySplitSpread: number;
  /** A flat faction roundel under every land territory that has an IPC value, in its owner's colours. */
  enableRegionRoundels: boolean;
  /** How much of an infantry base's width a region roundel takes. */
  roundelRadiusShare: number;
  /** The roundel's thickness against its radius. */
  roundelHeight: number;
  /** The zoom where the territory numerals and capital marks start to fade, and where they are gone. */
  emblemFadeFrom: number;
  emblemFadeTo: number;
  /** The bases under land stacks are real models on the board, not flat drawings. Ships keep their ring. */
  enable3DBases: boolean;
  /** Height of a base against its radius. */
  plinthHeight: number;
  /** Width of the pale bevel round the top edge of a base, as a share of its radius. */
  plinthBevel: number;
  /** A pair's base, and a stack of three or more's, against a single unit's. */
  squadRadius2: number;
  squadRadius3Plus: number;
  /** How far apart the figures of a pair or a crowd stand on their base. 1 is the shipped formation. */
  squadSpread: number;
  /** How hard the sun catches a base's bevel and rim: a crisp specular and a warm key against a cool shade. 0 is flat. */
  plinthSpecular: number;
  /** How large vehicles and aircraft stand against the infantry line in the close-up diorama, 1 being the old size. */
  vehicleDioramaScale: number;
  /** The radius of a tank's or gun's base against an infantry base: tight to the treads. */
  vehiclePlinthRadius: number;
  /** The same for the city landmarks: domes and spires catch the sun, and their shade runs cool. 0 is flat. */
  landmarkRimStrength: number;
  /** A fine tooth and a low satin sheen on the board, faded in as the camera comes in close. 0 is smooth. */
  boardSheenStrength: number;
  /** The soft dark footprint under each figure on its base. 0 is none. */
  contactAoStrength: number;
  navalIdleBobAmp: number;
  /** How hard a wave front rocks a ship (roll and pitch) as it crosses it. 0 is no rocking. */
  navalWaveRockAmp: number;
  /** Seconds for the invisible wave front to sweep the board and come round again. */
  waveLoopSeconds: number;
  /** The direction the front travels, in degrees: 0 runs west to east, 90 north to south. */
  waveDirectionDeg: number;
  /** Height of the ambient swell, in world units. The 20-second front stands taller than it. 0 is a flat sea. */
  waterSwellAmp: number;
  /** How much foam the swell throws up the cliff walls as its crest climbs them. 0 is none. */
  cliffSurgeFoam: number;
  /** How thick the valley and jungle mist lies, faded in with the close zoom. 0 is clear air. */
  microMistWeight: number;
  /** A submarine's share of a surface ship's rocking. 0.8 is 20% less. */
  subRockFactor: number;
  /** Each territory takes the palette of its climate. Off, the whole land is one temperate ramp. */
  regionalPaletteDetail: boolean;
}

export type VisualKey = keyof MapVisualConfig;

/** The Shogun look: natural ground, a light faction wash close in, ink borders, a watercolour selection. */
export const DEFAULT_VISUALS: Readonly<MapVisualConfig> = Object.freeze({
  factionTintMax: 0.45,
  factionTintFadeFrom: 0.2,
  factionTintFadeTo: 0.42,
  factionEdgeBoost: 0.6,
  factionBorderInner: 0.55,
  factionBorderFrontier: 0.7,
  factionTintBrightness: 1,
  factionTintSaturation: 1,
  factionBorderBrightness: 0.5,
  factionBorderOpacity: 1,
  factionBorderFloor: 1,
  factionBorderWidth: 2,
  factionBorderKeyline: 0.5,
  factionRegionShift: 0.05,
  tokenSizeBoost: 1.5,
  factionBorderFadeFrom: 0.55,
  factionBorderFadeTo: 0.9,
  factionBoostUSSR: 1.05,
  factionBoostGER: 1.6,
  factionBoostJAP: 1.15,
  factionBoostUS: 1.7,
  factionBoostUK: 1.5,
  factionWashClose: 0.15,
  factionWashFar: 0.5,
  terrainGrainStrength: 0.6,
  friendlyBorderStyle: "subtle-dashed",
  frontlineStyle: "dual-ink",
  highlightMode: "click-and-drag",
  watercolorIntensity: 1,
  legalHintStrength: 0.35,
  showBiomeProps: true,
  showBattleSmoke: true,
  smokeOpacity: 0.22,
  showCoastalWaves: true,
  enableDoF: true,
  bokehIntensity: 0.6,
  sunAzimuth: 28,
  sunSweep: true,
  unitRim: 0.5,
  contactShadow: 0.32,
  aoWeight: "medium",
  bloomWeight: "low",
  filmGrainWeight: "low",
  outlineMode: "units-only",
  shadowQuality: "medium",
  envReflectionWeight: "medium",
  sunCycle: "animated",
  enableShogunMountains: true,
  enableScatteredRocks: false,
  mountainPeakHeight: 6,
  mountainRidgeSharpness: 0.85,
  mountainSnowLine: 0.64,
  mountainSnowBlend: 0.2,
  mountainSnowGlow: 0.22,
  enablePbrSurface: true,
  pbrNormalStrength: 0.35,
  pbrRoughness: 0.82,
  pbrTilingScale: 12,
  terrainSaturation: 0.86,
  enableRivers: false,
  riverWidth: 0.62,
  riverDepthShade: 0.4,
  riverBankHighlight: 0.5,
  enableRoads: false,
  roadWidth: 0.3,
  roadOpacity: 0.6,
  roadWarmth: 0.5,
  enableSunTransit: true,
  sunCycleSpeed: 1,
  sunMinElevation: 35,
  sunMaxElevation: 65,
  sunWarmthIntensity: 1.2,
  ambientFillIntensity: 1,
  enableShadows: true,
  shadowOpacity: 0.4,
  shadowSoftness: 1.2,
  shadowNormalBias: 0.14,
  enableBasePlinths: true,
  plinthRimWidth: 0.2,
  plinthRoughness: 0.55,
  plinthBrassIntensity: 0.8,
  shadowOnBasesOnly: false,
  enableFauxPixelMap: true,
  pixelTexelDensity: 2.5,
  // Held quiet so the figures on it read: a narrower value band, 45% less dither, 30% less chroma.
  pixelHillshadeContrast: 1.0,
  pixelShadowSteps: 3,
  pixelDitherStrength: 0.385,
  pixelPaletteSaturation: 0.7,
  seaContourSteps: 4,
  coastRimIntensity: 0.9,
  enablePixelFoam: true,
  pixelFoamReach: 0.7,
  pixelFoamBleed: 0.5,
  seaWaveRings: 1.2,
  seaSheenStrength: 2,
  seaFarVisibility: 0.7,
  seaSheenRadius: 0.7,
  seaSheenFarRadius: 0.9,
  seaSheenSpacing: 1.2,
  seaSheenScatter: 0.7,
  seaSheenFrequency: 1,
  seaSheenPops: 0.5,
  enableSoftLand: true,
  softLandFrom: 3.8,
  dioramaPbrBlend: 0.85,
  dioramaTileScale: 1,
  microMinDistance: 1.35,
  microPitchDeg: 38,
  microSpriteTiltDeg: 10,
  tiltShiftStrength: 1,
  landmarkShadowStrength: 1.7,
  shipSizeScale: 0.4,
  landmarkWashStrength: 0.7,
  landmarkDrybrushStrength: 0.6,
  landmarkGroundAO: 0.7,
  islandElevationScale: 0.6,
  seaJungleMistStrength: 1,
  microBirdsWeight: 1,
  canopyBiomeContrast: 0.7,
  sandGlintStrength: 0.6,
  sandSubsurfaceAmber: 0.6,
  snowDriftBleed: 0.7,
  crestPowderStrength: 0.6,
  cliffShadowStrength: 1.1,
  dioramaNormalStrength: 0.7,
  albedoDetailStrength: 0.5,
  snowColdTint: 0.5,
  desertHeatHaze: 0.5,
  forestUnderstoryTint: 0.5,
  windStrength: 0.5,
  terrainHillRelief: 0.2,
  softLandTo: 5.6,
  softLandDither: 0.1,
  softLandSaturation: 0.58,
  softLandValueBand: 0.6,
  softLandBrush: 0.5,
  detailedSpriteBaseScale: 0.85,
  detailedSpriteWorldLock: 1,
  terrainHeightScale: 1,
  mountainReliefHeight: 1,
  navalSubmergeDepth: 0.6,
  landmarkRevealFrom: 4.4,
  landmarkRevealTo: 7,
  landmarkRevealBand: 0.08,
  landmarkBuildSeconds: 3.75,
  landmarkBuildCube: 0.06,
  facilitySplitFrom: 2.6,
  facilityFadeEnd: 6.4,
  facilitySplitSpread: 2.4,
  enableRegionRoundels: true,
  roundelRadiusShare: 0.82,
  roundelHeight: 0.05,
  emblemFadeFrom: 3.4,
  emblemFadeTo: 6,
  enable3DBases: true,
  plinthHeight: 0.22,
  plinthBevel: 0.11,
  squadRadius2: 1.25,
  squadRadius3Plus: 1.45,
  squadSpread: 1,
  plinthSpecular: 0.3,
  vehicleDioramaScale: 0.75,
  vehiclePlinthRadius: 0.92,
  landmarkRimStrength: 0.6,
  boardSheenStrength: 0.5,
  contactAoStrength: 0.5,
  navalIdleBobAmp: 0.66,
  navalWaveRockAmp: 1,
  waveLoopSeconds: 20,
  waveDirectionDeg: 0,
  waterSwellAmp: 0.3,
  cliffSurgeFoam: 0.7,
  microMistWeight: 0.6,
  subRockFactor: 0.8,
  regionalPaletteDetail: true,
});

/**
 * The pixel chart as a printed sheet: the light held high in the north, white enough to leave the
 * palette as listed, and nothing laid over the texels: no sky on the sea, no glow, no paper grain.
 */
export const PIXEL_CHART_VISUALS: Readonly<MapVisualConfig> = Object.freeze({
  ...DEFAULT_VISUALS,
  enableFauxPixelMap: true,
  regionalPaletteDetail: true,
  sunCycle: "static-noon",
  bloomWeight: "off",
  filmGrainWeight: "off",
  envReflectionWeight: "off",
});

/** Solid faction land, full borders, the banded frontline, hover marks, and the full lens. */
export const SOLID_VISUALS: Readonly<MapVisualConfig> = Object.freeze({
  ...DEFAULT_VISUALS,
  // The printed faction sheet, not the chart.
  enableFauxPixelMap: false,
  factionWashClose: 1,
  factionWashFar: 1,
  terrainGrainStrength: 0,
  friendlyBorderStyle: "solid",
  frontlineStyle: "classic",
  highlightMode: "always-hover",
  legalHintStrength: 1,
  smokeOpacity: 0.6,
  bokehIntensity: 1,
  unitRim: 0,
  contactShadow: 0.2,
});

/** Solid land with nothing standing or moving on it. */
export const PLAIN_VISUALS: Readonly<MapVisualConfig> = Object.freeze({
  ...SOLID_VISUALS,
  showBiomeProps: false,
  showBattleSmoke: false,
  showCoastalWaves: false,
  enableDoF: false,
  sunSweep: false,
  aoWeight: "off",
  bloomWeight: "off",
  filmGrainWeight: "off",
  outlineMode: "off",
  shadowQuality: "off",
  envReflectionWeight: "off",
  // The table as it was before the sculpted ranges: the loose peaks, the shipped arc, the flat base.
  enableShogunMountains: false,
  enableScatteredRocks: true,
  enablePbrSurface: false,
  enableRivers: false,
  enableRoads: false,
  sunCycleSpeed: 1,
  sunMinElevation: 30,
  sunMaxElevation: 62,
  sunWarmthIntensity: 1,
  ambientFillIntensity: 1,
  enableShadows: false,
  enableBasePlinths: false,
});

export const VISUAL_PRESETS = {
  shogun: DEFAULT_VISUALS,
  "faux-pixel-cartography": PIXEL_CHART_VISUALS,
  solid: SOLID_VISUALS,
  plain: PLAIN_VISUALS,
} as const;

export type VisualPresetName = keyof typeof VISUAL_PRESETS;

/** Slider ends. The sun stays inside the part of the day that casts shadows. */
export const VISUAL_RANGES: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  factionTintMax: [0, 1],
  factionTintFadeFrom: [0, 1],
  factionTintFadeTo: [0, 1],
  factionEdgeBoost: [0, 2],
  factionBorderInner: [0, 1],
  factionBorderFrontier: [0, 1],
  factionTintBrightness: [0.3, 2],
  factionTintSaturation: [0, 2],
  factionBorderBrightness: [0, 2],
  factionBorderOpacity: [0, 2],
  factionBorderFloor: [0, 1],
  factionBorderWidth: [0.5, 6],
  factionBorderKeyline: [0, 1],
  factionRegionShift: [0, 0.2],
  tokenSizeBoost: [1, 3],
  factionBorderFadeFrom: [0, 1],
  factionBorderFadeTo: [0, 1],
  factionBoostUSSR: [0.3, 3],
  factionBoostGER: [0.3, 3],
  factionBoostJAP: [0.3, 3],
  factionBoostUS: [0.3, 3],
  factionBoostUK: [0.3, 3],
  factionWashClose: [0, 1],
  factionWashFar: [0, 1],
  terrainGrainStrength: [0, 2],
  watercolorIntensity: [0, 2],
  legalHintStrength: [0, 1],
  smokeOpacity: [0, 0.6],
  bokehIntensity: [0, 1.5],
  sunAzimuth: [-50, 50],
  unitRim: [0, 1],
  contactShadow: [0, 0.6],
  mountainPeakHeight: [0, 18],
  mountainRidgeSharpness: [0, 1],
  mountainSnowLine: [0, 1],
  mountainSnowBlend: [0.02, 0.6],
  mountainSnowGlow: [0, 1],
  pbrNormalStrength: [0, 2],
  pbrRoughness: [0, 1],
  pbrTilingScale: [4, 60],
  terrainSaturation: [0, 1.4],
  riverWidth: [0.2, 2.5],
  riverDepthShade: [0, 1],
  riverBankHighlight: [0, 1],
  roadWidth: [0.1, 1.2],
  roadOpacity: [0, 1],
  roadWarmth: [0, 1],
  sunCycleSpeed: [0, 8],
  sunMinElevation: [10, 60],
  sunMaxElevation: [30, 88],
  sunWarmthIntensity: [0, 2],
  ambientFillIntensity: [0.4, 1.6],
  shadowOpacity: [0, 0.85],
  shadowSoftness: [0.3, 3],
  shadowNormalBias: [0, 0.6],
  plinthRimWidth: [0.06, 0.4],
  plinthRoughness: [0, 1],
  plinthBrassIntensity: [0, 1],
  pixelTexelDensity: [0.75, 6],
  pixelHillshadeContrast: [0, 3],
  pixelShadowSteps: [1, 6],
  pixelDitherStrength: [0, 1],
  pixelPaletteSaturation: [0, 1.5],
  seaContourSteps: [2, 6],
  coastRimIntensity: [0, 1],
  pixelFoamReach: [0.2, 1.2],
  pixelFoamBleed: [0, 1],
  seaWaveRings: [0, 2.5],
  seaSheenStrength: [0, 5],
  seaFarVisibility: [0, 1],
  seaSheenRadius: [0.2, 1.5],
  seaSheenFarRadius: [0.5, 1.2],
  seaSheenSpacing: [0.5, 3],
  seaSheenScatter: [0, 1],
  seaSheenFrequency: [0, 4],
  seaSheenPops: [0, 1],
  softLandFrom: [0.5, 6],
  dioramaPbrBlend: [0, 1],
  dioramaTileScale: [0.3, 3],
  microMinDistance: [1, 4],
  microPitchDeg: [30, 60],
  microSpriteTiltDeg: [0, 20],
  tiltShiftStrength: [0, 2],
  landmarkShadowStrength: [1, 3],
  shipSizeScale: [0.2, 1.2],
  landmarkWashStrength: [0, 1.5],
  landmarkDrybrushStrength: [0, 1.5],
  landmarkGroundAO: [0, 1.5],
  islandElevationScale: [0.15, 1],
  seaJungleMistStrength: [0, 2],
  microBirdsWeight: [0, 2],
  canopyBiomeContrast: [0, 1],
  sandGlintStrength: [0, 2],
  sandSubsurfaceAmber: [0, 1.5],
  snowDriftBleed: [0, 1.5],
  crestPowderStrength: [0, 2],
  cliffShadowStrength: [0, 2],
  dioramaNormalStrength: [0, 2.5],
  albedoDetailStrength: [0, 1.5],
  snowColdTint: [0, 1],
  desertHeatHaze: [0, 1],
  forestUnderstoryTint: [0, 1],
  windStrength: [0, 2],
  terrainHillRelief: [0, 0.5],
  softLandTo: [1, 8],
  softLandDither: [0, 1],
  softLandSaturation: [0, 1.2],
  softLandValueBand: [0.2, 1.2],
  softLandBrush: [0, 1],
  detailedSpriteBaseScale: [0.3, 2],
  detailedSpriteWorldLock: [0, 1.2],
  terrainHeightScale: [0.3, 2],
  mountainReliefHeight: [0, 3],
  navalSubmergeDepth: [0, 3],
  landmarkRevealFrom: [1, 8],
  landmarkRevealTo: [1.5, 9],
  landmarkRevealBand: [0.01, 0.4],
  landmarkBuildSeconds: [0.5, 30],
  landmarkBuildCube: [0.02, 0.25],
  facilitySplitFrom: [1, 8],
  facilityFadeEnd: [2, 9],
  facilitySplitSpread: [0, 6],
  roundelRadiusShare: [0.3, 1.2],
  roundelHeight: [0.01, 0.3],
  emblemFadeFrom: [1, 9],
  emblemFadeTo: [1.5, 10],
  plinthHeight: [0.05, 0.6],
  plinthBevel: [0, 0.3],
  squadRadius2: [1, 2],
  squadRadius3Plus: [1, 2.5],
  squadSpread: [0.3, 1.6],
  plinthSpecular: [0, 2],
  vehicleDioramaScale: [0.4, 1.2],
  vehiclePlinthRadius: [0.4, 1.2],
  landmarkRimStrength: [0, 2],
  boardSheenStrength: [0, 2],
  contactAoStrength: [0, 1],
  navalIdleBobAmp: [0, 3],
  navalWaveRockAmp: [0, 3],
  waveLoopSeconds: [5, 60],
  waveDirectionDeg: [0, 360],
  waterSwellAmp: [0, 1.2],
  cliffSurgeFoam: [0, 1.5],
  microMistWeight: [0, 1.5],
  subRockFactor: [0, 1],
});

const FRIENDLY_STYLES: readonly FriendlyBorderStyle[] = ["subtle-dashed", "solid", "hidden"];
const FRONTLINE_STYLES: readonly FrontlineStyle[] = ["dual-ink", "classic", "hidden"];
const HIGHLIGHT_RULES: readonly HighlightRule[] = ["click-and-drag", "always-hover", "off"];
export const EFFECT_WEIGHTS: readonly EffectWeight[] = ["off", "low", "medium", "high"];
export const OUTLINE_MODES: readonly OutlineMode[] = ["units-only", "watercolor-only", "both", "off"];
export const SUN_CYCLES: readonly SunCycle[] = ["animated", "static-noon", "static-golden", "off"];

/** The words each worded setting may hold. Every other setting is a number or a switch. */
const CHOICES: Partial<Record<VisualKey, readonly string[]>> = {
  friendlyBorderStyle: FRIENDLY_STYLES,
  frontlineStyle: FRONTLINE_STYLES,
  highlightMode: HIGHLIGHT_RULES,
  aoWeight: EFFECT_WEIGHTS,
  bloomWeight: EFFECT_WEIGHTS,
  filmGrainWeight: EFFECT_WEIGHTS,
  outlineMode: OUTLINE_MODES,
  shadowQuality: EFFECT_WEIGHTS,
  envReflectionWeight: EFFECT_WEIGHTS,
  sunCycle: SUN_CYCLES,
};

/** Every setting, in the order the type lists them. */
export const VISUAL_KEYS = Object.keys(DEFAULT_VISUALS) as VisualKey[];

function numberIn(value: unknown, key: string, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const [low, high] = VISUAL_RANGES[key] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  return Math.min(high, Math.max(low, value));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** A whole config from anything: a stored object, a pasted preset, or nothing. Gaps take `base`. */
export function parseVisuals(value: unknown, base: Readonly<MapVisualConfig> = DEFAULT_VISUALS): MapVisualConfig {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<VisualKey, unknown>>;
  const out: Record<string, unknown> = {};
  for (const key of VISUAL_KEYS) {
    const fallback = base[key];
    if (typeof fallback === "number") {
      out[key] = numberIn(raw[key], key, fallback);
    } else if (typeof fallback === "boolean") {
      out[key] = flag(raw[key], fallback);
    } else {
      out[key] = oneOf<string>(raw[key], CHOICES[key] ?? [fallback], fallback);
    }
  }
  return out as unknown as MapVisualConfig;
}

/** The config as the text the drawer copies: every key, in the order the type lists them. */
export function visualPresetJson(config: Readonly<MapVisualConfig>): string {
  return JSON.stringify(parseVisuals(config), null, 2);
}

/** The preset a config equals, or "custom". */
export function visualPresetOf(config: Readonly<MapVisualConfig>): VisualPresetName | "custom" {
  const text = visualPresetJson(config);
  for (const name of Object.keys(VISUAL_PRESETS) as VisualPresetName[]) {
    if (visualPresetJson(VISUAL_PRESETS[name]) === text) {
      return name;
    }
  }
  return "custom";
}

// --- Numbers the board derives from the config. Pure. -------------------------------------------

function smooth(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Share of the faction colour over the ground. `closeness` is 0 at the fitted board and 1 at the
 * closest zoom (see shogunDetail.ts). The wash eases from the far share to the close one.
 */
export function factionWash(closeness: number, config: Readonly<MapVisualConfig>): number {
  const near = smooth(closeness);
  return config.factionWashFar + (config.factionWashClose - config.factionWashFar) * near;
}

/**
 * The faction tint on the Diorama's pixel ground at a zoom: the most from the fitted board to the start of the fade, then easing to
 * none by the diorama's own zoom, where the ground is bare terrain. `closeness` is 0 at the fitted board and 1 at the closest zoom.
 */
export function factionTint(closeness: number, config: Readonly<MapVisualConfig>): number {
  const span = Math.max(1e-3, config.factionTintFadeTo - config.factionTintFadeFrom);
  return config.factionTintMax * (1 - smooth((closeness - config.factionTintFadeFrom) / span));
}

/**
 * How much of its strength a border keeps at a zoom: all of it through the mid zoom and the start of the diorama, easing to the floor
 * deep in. A border never fades to nothing, so territories stay readable at the closest zoom.
 */
export function factionBorderShare(closeness: number, config: Readonly<MapVisualConfig>): number {
  const span = Math.max(1e-3, config.factionBorderFadeTo - config.factionBorderFadeFrom);
  return config.factionBorderFloor + (1 - config.factionBorderFloor) * (1 - smooth((closeness - config.factionBorderFadeFrom) / span));
}

/** Ink opacity of the dashed and the solid friendly line for a style. */
export function friendlyBorderInk(style: FriendlyBorderStyle): { dashed: number; solid: number } {
  if (style === "subtle-dashed") {
    return { dashed: 0.25, solid: 0 };
  }
  return style === "solid" ? { dashed: 0, solid: 0.9 } : { dashed: 0, solid: 0 };
}

/** Which frontline drawing is on: 1 or 0 each. Both 0 leaves an ordinary border. */
export function frontlineInk(style: FrontlineStyle): { dual: number; classic: number } {
  return { dual: style === "dual-ink" ? 1 : 0, classic: style === "classic" ? 1 : 0 };
}

/** Lens strength for a zoom's focus share. 0 at altitude, and 0 with the lens off. */
export function bokehShare(focus: number, config: Readonly<MapVisualConfig>): number {
  return config.enableDoF ? Math.max(0, focus) * config.bokehIntensity : 0;
}

// --- Light and lens. Each weight is a row of numbers; "off" is null, and the board skips the work. ---

export interface AoLook {
  /** How dark the deepest crevice goes. 1 is the full ink. */
  strength: number;
  /** Depth taps for each pixel. */
  samples: number;
  /** Size of the shade buffer against the frame: 0.5 is a quarter of the pixels. */
  scale: number;
  /** Reach of the shade, in world units. A cliff is seven tall. */
  radius: number;
}

export function aoLook(weight: EffectWeight): AoLook | null {
  if (weight === "low") {
    return { strength: 0.45, samples: 6, scale: 0.5, radius: 2 };
  }
  if (weight === "medium") {
    return { strength: 0.62, samples: 10, scale: 0.5, radius: 2.4 };
  }
  return weight === "high" ? { strength: 0.8, samples: 16, scale: 1, radius: 2.8 } : null;
}

export interface BloomLook {
  /** Share of the glow added back to the picture. */
  strength: number;
  /** Halvings of the glow buffer. More spreads it wider. */
  levels: number;
}

/** Light above this glows. Paper white is 1, so the land, the sea, and the pieces stay as painted. */
export const BLOOM_THRESHOLD = 1.05;

export function bloomLook(weight: EffectWeight): BloomLook | null {
  if (weight === "low") {
    return { strength: 0.55, levels: 3 };
  }
  if (weight === "medium") {
    return { strength: 0.85, levels: 4 };
  }
  return weight === "high" ? { strength: 1.2, levels: 5 } : null;
}

const GRAIN_AMOUNT: Readonly<Record<EffectWeight, number>> = { off: 0, low: 0.028, medium: 0.046, high: 0.07 };

/**
 * Depth of the paper tooth, as a share of full brightness. It is deepest over the fitted board,
 * where the picture is a printed sheet, and eases to two thirds on the table, where it would dirty
 * the figures.
 */
export function grainAmount(weight: EffectWeight, closeness: number): number {
  const near = smooth(closeness);
  return GRAIN_AMOUNT[weight] * (1 - near / 3);
}

/** What the outline pass draws round a stack. Both 0 is no pass. */
export function outlineLook(mode: OutlineMode): { line: number; wash: number } {
  return {
    line: mode === "units-only" || mode === "both" ? 1 : 0,
    wash: mode === "watercolor-only" || mode === "both" ? 1 : 0,
  };
}

const SHADOW_MAP_SIZE: Readonly<Record<EffectWeight, number>> = { off: 0, low: 1024, medium: 2048, high: 4096 };

/** Side of the sun's shadow map, in texels. 0 is no map. */
export function shadowMapSize(quality: EffectWeight): number {
  return SHADOW_MAP_SIZE[quality];
}

const SKY_SHEEN: Readonly<Record<EffectWeight, number>> = { off: 0, low: 0.4, medium: 0.7, high: 1 };

/** Share of the sky the sea shows. 1 is the full sheen. */
export function skySheen(weight: EffectWeight): number {
  return SKY_SHEEN[weight];
}

/** True when the board needs the standing figures on their own canvas: to cast them, or to line them. */
export function wantsFigureCards(config: Readonly<MapVisualConfig>): { shadows: boolean; outline: boolean } {
  const look = outlineLook(config.outlineMode);
  return { shadows: castShadowLook(config) !== null && config.sunCycle !== "off", outline: look.line + look.wash > 0 };
}

// --- The table: terrain, light, and bases. A switch that is off gives null, and the board skips the work. ---

/** Height of an infantry figure on screen, in CSS pixels: the upright figure at its shipped scale. */
export const INFANTRY_FIGURE_PX = 24 * 1.4;
/**
 * A summit is as tall as the slider says, scaled by how close the camera is. It is not held under any share
 * of a figure any more: the great ranges stand well above the table, and a piece behind one is behind it,
 * as it would be on a model. A figure on a slope is lifted onto it (see groundLift).
 */

export interface MountainLook {
  /** Height of the tallest summit now, in world units. */
  height: number;
  sharpness: number;
  snowLine: number;
  snowBlend: number;
  snowGlow: number;
  /** How far the rock and the snow have come in: 0 from altitude, 1 on the table. */
  fade: number;
}

/**
 * The sculpted ranges at a zoom. `relief` is the zoom's share of the sun's shading (see
 * zoomDetail.ts): the ranges rise with it from a flat sheet, and from altitude there are none.
 */
export function mountainLook(config: Readonly<MapVisualConfig>, relief: number, k: number): MountainLook | null {
  const fade = Math.min(1, Math.max(0, relief));
  const height = config.mountainPeakHeight * fade;
  if (!config.enableShogunMountains || height <= 0.004) {
    return null;
  }
  return {
    height,
    sharpness: config.mountainRidgeSharpness,
    snowLine: config.mountainSnowLine,
    snowBlend: config.mountainSnowBlend,
    snowGlow: config.mountainSnowGlow,
    fade,
  };
}

export interface SurfaceLook {
  normal: number;
  roughness: number;
  /** World units for one repeat of the grain. */
  tiling: number;
  saturation: number;
}

export function surfaceLook(config: Readonly<MapVisualConfig>): SurfaceLook | null {
  if (!config.enablePbrSurface) {
    return null;
  }
  return { normal: config.pbrNormalStrength, roughness: config.pbrRoughness, tiling: config.pbrTilingScale, saturation: config.terrainSaturation };
}

export function riverLook(config: Readonly<MapVisualConfig>): { halfWidth: number; depth: number; bank: number } | null {
  return config.enableRivers ? { halfWidth: config.riverWidth / 2, depth: config.riverDepthShade, bank: config.riverBankHighlight } : null;
}

/**
 * The roads at a zoom. They are a detail of the table: over the fitted board there are none, and
 * they come in over the first fifth of the way down.
 */
export function roadLook(config: Readonly<MapVisualConfig>, closeness: number): { halfWidth: number; opacity: number; warmth: number } | null {
  const opacity = config.roadOpacity * smooth((closeness - 0.03) / 0.19);
  if (!config.enableRoads || opacity <= 0.004) {
    return null;
  }
  return { halfWidth: config.roadWidth / 2, opacity, warmth: config.roadWarmth };
}

/** The opacity the shipped shadow tint was drawn for. */
export const SHADOW_OPACITY_UNIT = 0.36;

export interface CastShadowLook {
  /** Side of the shadow map, in texels. */
  size: number;
  /** Depth of the shadow against the shipped tint. 1 is the tint as it was painted. */
  depth: number;
  softness: number;
  normalBias: number;
  /** Figures shade bases and nothing else. */
  basesOnly: boolean;
}

export function castShadowLook(config: Readonly<MapVisualConfig>): CastShadowLook | null {
  const size = shadowMapSize(config.shadowQuality);
  if (!config.enableShadows || size <= 0) {
    return null;
  }
  return {
    size,
    depth: config.shadowOpacity / SHADOW_OPACITY_UNIT,
    softness: config.shadowSoftness,
    normalBias: config.shadowNormalBias,
    basesOnly: config.shadowOnBasesOnly,
  };
}

/** The sun's arc and colour as the numbers sun.ts takes. The noon height is never under the dawn height. */
export function sunArcOf(config: Readonly<MapVisualConfig>): { minElevation: number; maxElevation: number; warmth: number; fill: number } {
  return {
    minElevation: config.sunMinElevation,
    maxElevation: Math.max(config.sunMinElevation, config.sunMaxElevation),
    warmth: config.sunWarmthIntensity,
    fill: config.ambientFillIntensity,
  };
}

/** Seconds of the sun's day that pass in one second. 0 is a sun that holds still. */
export function sunPace(config: Readonly<MapVisualConfig>): number {
  return config.enableSunTransit ? config.sunCycleSpeed : 0;
}

export interface PlinthLook {
  /** Width of the dark rim, as a share of the base's radius. */
  rim: number;
  /** Opacity of the satin highlight on the rim. */
  sheen: number;
  /** How much of the rim's arc the highlight covers, in radians. A matt rim spreads it wide and faint. */
  sheenArc: number;
  /** 0 is a ring in the faction's colour, 1 is brass. */
  brass: number;
}

export function plinthLook(config: Readonly<MapVisualConfig>): PlinthLook | null {
  if (!config.enableBasePlinths) {
    return null;
  }
  const rough = Math.min(1, Math.max(0, config.plinthRoughness));
  return {
    rim: config.plinthRimWidth,
    sheen: 0.62 * (1 - rough) ** 0.8,
    sheenArc: 0.35 + 1.25 * rough,
    brass: config.plinthBrassIntensity,
  };
}

// --- The pixel chart. ---------------------------------------------------------------------------

/** How much of a zoom step the texel grid follows. 1 would hold a texel at one size on screen. */
export const PIXIE_ZOOM_FOLLOW = 0.8;
/** A texel is never smaller than this on screen at the closest zoom, in CSS pixels. */
export const PIXIE_MIN_TEXEL_PX = 1.5;
/** The grid never coarsens past this many halvings. */
const PIXIE_OCTAVES = 6;

export interface PixieLook {
  /** Texels to a world unit on the coarse grid, and on the grid nested inside it. */
  coarse: number;
  fine: number;
  /** Share of the coarse texels that have split into four fine ones. */
  share: number;
  dither: number;
  contrast: number;
  /** Whole tones of shade and of light. */
  steps: number;
  saturation: number;
  /** Whole depth bands on the sea. */
  seaSteps: number;
  rim: number;
  regional: boolean;
  /** Share of the shelf that stays pale: 0 with the foam off. */
  foamReach: number;
  foamBleed: number;
  rings: number;
  /** 0 on the strategic chart, 1 on the soft land. Eases with the zoom. */
  soft: number;
  /** Brush stroke strength, already scaled by `soft`. */
  brush: number;
  /** What the soft land keeps of the dither, the colour, and the light and shade. The shader applies them. */
  softDither: number;
  softSat: number;
  softBand: number;
}

/**
 * How soft the land is at a zoom: 0 up to `softLandFrom`, 1 from `softLandTo`, an ease between. It
 * follows the camera and nothing else, so zooming scrubs it both ways with no timer and no pop.
 */
export function landSoftness(config: Readonly<MapVisualConfig>, k: number): number {
  if (!config.enableSoftLand) {
    return 0;
  }
  const from = config.softLandFrom;
  const to = Math.max(config.softLandTo, from + 0.01);
  return smooth((k - from) / (to - from));
}

/**
 * The pixel chart at a zoom, or null with it off. `k` is screen pixels per world unit and `maxK`
 * the closest zoom.
 *
 * The grid is fixed to the board, so a texel never slides under the camera. Its density halves
 * each time the camera has risen far enough, and between two densities the coarse texels split
 * into four a few at a time, so the change is a dissolve and not a jump. The finer grid's lines
 * all lie on the coarser grid's, so nothing moves when a texel splits.
 */
export function pixieLook(config: Readonly<MapVisualConfig>, k: number, maxK: number): PixieLook | null {
  if (!config.enableFauxPixelMap) {
    return null;
  }
  const top = Math.max(maxK, 1e-6);
  const density = Math.min(config.pixelTexelDensity, top / PIXIE_MIN_TEXEL_PX);
  const level = Math.max(-PIXIE_OCTAVES, PIXIE_ZOOM_FOLLOW * Math.log2(Math.min(1, Math.max(k, 1e-6) / top)));
  const octave = Math.floor(level);
  const coarse = density * 2 ** octave;
  const soft = landSoftness(config, k);
  return {
    coarse,
    fine: coarse * 2,
    share: smooth((level - octave - 0.35) / 0.3),
    dither: config.pixelDitherStrength,
    contrast: config.pixelHillshadeContrast,
    steps: Math.max(1, Math.round(config.pixelShadowSteps)),
    saturation: config.pixelPaletteSaturation,
    seaSteps: Math.max(2, Math.round(config.seaContourSteps)),
    rim: config.coastRimIntensity,
    regional: config.regionalPaletteDetail,
    foamReach: config.enablePixelFoam ? config.pixelFoamReach : 0,
    foamBleed: config.pixelFoamBleed,
    rings: config.seaWaveRings,
    soft,
    brush: soft * config.softLandBrush,
    softDither: config.softLandDither,
    softSat: config.softLandSaturation,
    softBand: config.softLandValueBand,
  };
}

// --- The store ----------------------------------------------------------------------------------

export const MAP_VISUALS_STORAGE_KEY = "strategy-demo.map-visuals";

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function readStored(): MapVisualConfig {
  try {
    const raw = storage()?.getItem(MAP_VISUALS_STORAGE_KEY);
    return raw ? parseVisuals(JSON.parse(raw)) : parseVisuals(null);
  } catch {
    return parseVisuals(null);
  }
}

/** The live settings. Read fields straight off it; change them through the setters below. */
export const mapVisuals: MapVisualConfig = readStored();

let rev = 0;
const listeners = new Set<() => void>();

function publish(save: boolean): void {
  rev += 1;
  try {
    if (save) {
      storage()?.setItem(MAP_VISUALS_STORAGE_KEY, JSON.stringify(mapVisuals));
    } else {
      storage()?.removeItem(MAP_VISUALS_STORAGE_KEY);
    }
  } catch {
    // The page still has the new values.
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getVisualRev(): number {
  return rev;
}

export function subscribeVisuals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setVisual<K extends VisualKey>(key: K, value: MapVisualConfig[K]): void {
  const next = parseVisuals({ ...mapVisuals, [key]: value }, mapVisuals);
  if (next[key] === mapVisuals[key]) {
    return;
  }
  mapVisuals[key] = next[key];
  publish(true);
}

/** Replaces every setting: a preset, or a pasted one. */
export function applyVisuals(value: unknown): void {
  Object.assign(mapVisuals, parseVisuals(value));
  publish(true);
}

/** Back to the shipped look, and the stored copy is dropped. */
export function resetVisuals(): void {
  Object.assign(mapVisuals, parseVisuals(null));
  publish(false);
}
