// Frontline 1941 - Tactical Combat Engine & Definitions

export type UnitType =
  | 'infantry'
  | 'artillery'
  | 'tank'
  | 'fighter'
  | 'tactical_bomber'
  | 'strategic_bomber'
  | 'submarine'
  | 'destroyer'
  | 'cruiser'
  | 'carrier'
  | 'battleship'
  | 'aaa';

export type TheaterId = 'normandy' | 'eastern' | 'north_africa' | 'pacific' | 'navy_test' | 'air_strike_test';

export interface UnitDefinition {
  type: UnitType;
  name: string;
  category: 'land' | 'air' | 'sea';
  cost: number;
  maxHp: number;
  baseAttackRank: number; // 1: <=1, 2: <=2, 3: <=3, 4: <=4
  baseDefenseRank: number;
  description: string;
  isFirstStrike?: boolean;
  isAntiAir?: boolean;
}

export const UNIT_DEFINITIONS: Record<UnitType, UnitDefinition> = {
  infantry: {
    type: 'infantry',
    name: 'Infantry',
    category: 'land',
    cost: 3,
    maxHp: 1,
    baseAttackRank: 1,
    baseDefenseRank: 2,
    description: 'Hits <=1 alone. Paired 1:1 with Artillery promoted to Rank II (<=2)!',
  },
  artillery: {
    type: 'artillery',
    name: 'Howitzer Artillery',
    category: 'land',
    cost: 4,
    maxHp: 1,
    baseAttackRank: 2,
    baseDefenseRank: 2,
    description: 'Hits <=2. Promotes 1 paired Infantry to Rank II (<=2) via Brass Synergy link.',
  },
  tank: {
    type: 'tank',
    name: 'Armor Tank',
    category: 'land',
    cost: 6,
    maxHp: 1,
    baseAttackRank: 3,
    baseDefenseRank: 3,
    description: 'Hits <=3. Heavy armor breakthrough. Pairs with Tactical Bomber for Combined Arms!',
  },
  fighter: {
    type: 'fighter',
    name: 'Fighter Wing',
    category: 'air',
    cost: 10,
    maxHp: 1,
    baseAttackRank: 3,
    baseDefenseRank: 4,
    description: 'Hits <=3 on Attack, <=4 on Defense. Can pair with Tactical Bomber.',
  },
  tactical_bomber: {
    type: 'tactical_bomber',
    name: 'Tactical Bomber',
    category: 'air',
    cost: 11,
    maxHp: 1,
    baseAttackRank: 3,
    baseDefenseRank: 3,
    description: 'Hits <=3. Combined Arms: promoted to Rank IV (<=4) if paired with Tank or Fighter!',
  },
  strategic_bomber: {
    type: 'strategic_bomber',
    name: 'Strategic Bomber',
    category: 'air',
    cost: 12,
    maxHp: 1,
    baseAttackRank: 4,
    baseDefenseRank: 1,
    description: 'Hits <=4 on Attack! High altitude carpet bombing.',
  },
  submarine: {
    type: 'submarine',
    name: 'Submarine',
    category: 'sea',
    cost: 6,
    maxHp: 1,
    baseAttackRank: 2,
    baseDefenseRank: 1,
    isFirstStrike: true,
    description: 'Pre-Battle Sneak Attack first strike! Canceled if enemy possesses a Destroyer.',
  },
  destroyer: {
    type: 'destroyer',
    name: 'Destroyer',
    category: 'sea',
    cost: 8,
    maxHp: 1,
    baseAttackRank: 2,
    baseDefenseRank: 2,
    description: 'Hits <=2. Sonar radar detection cancels enemy submarine sneak attacks.',
  },
  cruiser: {
    type: 'cruiser',
    name: 'Cruiser',
    category: 'sea',
    cost: 12,
    maxHp: 1,
    baseAttackRank: 3,
    baseDefenseRank: 3,
    description: 'Hits <=3. Heavy naval bombardment and fleet vanguard.',
  },
  carrier: {
    type: 'carrier',
    name: 'Fleet Carrier',
    category: 'sea',
    cost: 16,
    maxHp: 2,
    baseAttackRank: 1,
    baseDefenseRank: 2,
    description: 'Capital Vessel (2 HP). Absorbs 1 hit without sinking. Defends at Rank II.',
  },
  battleship: {
    type: 'battleship',
    name: 'Battleship',
    category: 'sea',
    cost: 20,
    maxHp: 2,
    baseAttackRank: 4,
    baseDefenseRank: 4,
    description: 'Capital Vessel (2 HP). Hits <=4 on Attack & Defense! Absorbs 1 hit before sinking.',
  },
  aaa: {
    type: 'aaa',
    name: 'Anti-Aircraft Flak',
    category: 'land',
    cost: 5,
    maxHp: 1,
    baseAttackRank: 1,
    baseDefenseRank: 1,
    isAntiAir: true,
    description: 'Pre-Battle Flak: Fires 1 die at <=1 for every attacking aircraft.',
  },
};

export interface CombatUnit {
  uid: string;
  type: UnitType;
  side: 'attacker' | 'defender';
  currentHp: number;
  maxHp: number;
  effectiveRank: number; // 1, 2, 3, or 4
  pairedWithUid?: string;
  hasSynergyBonus: boolean;
  isFirstStrikeEligible?: boolean;
  hasFiredThisRound: boolean;
  isPendingCasualty: boolean;
  isPermanentCasualty?: boolean; // (BETA) permanently excluded casualty that never reappears in subsequent rounds
  isDestroyed: boolean;
  status: 'alive' | 'downed' | 'dead';
  downedTime?: number;
  downedFadeProgress?: number;
  fadeAlpha?: number;
  isFadingOut?: boolean;
  fadeElapsed?: number;
  fadeDuration?: number;
  staggerY?: number; // organic vertical position jitter (+/- 2-4 pixels)
  staggerX?: number; // organic horizontal position jitter (+/- 4-8 pixels)
  // Opening Deployment March & Ready station simulation
  marchStartOffsetX?: number; // starting offset at beginning of march
  marchCurrentOffsetX?: number; // X offset during forward deployment march
  isMarching?: boolean; // active forward march / roll animation
  readyAnimType?: 'crouch' | 'reload' | 'scan' | 'swivel' | 'crank' | 'rev';
  readyAnimProgress?: number; // 0 to 1 during post-march stationing
  // Naval combat simulation states (2-HP listing & sinking system)
  listingAngle?: number; // radians of permanent hull listing into sea (10 deg injured, 45 deg sinking)
  sinkingProgress?: number; // 0 to 1 as ship slips beneath waves
  sinkingY?: number; // translation downward into water
  secondaryExplosionsTimer?: number;
  wreckageSpawned?: boolean;
  // Victory sequence animation
  victoryAdvanceX?: number; // cumulative pixels advanced across frontline
  victoryAscentY?: number; // cumulative pixels ascended (for air units)
  isCheering?: boolean;
  // Visual tracking & Anticipation
  animRecoil: number; // 0 to 1
  animBobOffset: number;
  animAnticipation: number; // 0 to 1 during rolling
  animAimTilt: number; // angle for barrels / rifles
  animRevEngine: number; // plane revving
  damageSmokeParticles: boolean;
  colIndex: number;
  rowIndex: number;
  // Aircraft Carrier logistics & movement simulation
  planesCarried?: number; // active planes aboard (max 2 by default)
  maxPlanesCarried?: number; // max plane capacity (default 2)
  carrierFloatX?: number; // X offset for gliding forward & floating back to Rank III
  carrierFloatTargetX?: number;
  carrierFloatState?: 'IDLE' | 'MOVING_FORWARD' | 'FIRING_GUNS' | 'FLOATING_BACK';
  carrierFightersFiredThisRound?: boolean; // tracking defensive fighter sortie at Rank IV
  planeSmokeTimer?: number; // air strike test casualty smoke puff timer
}

export interface TheaterConfig {
  id: TheaterId;
  name: string;
  subtitle: string;
  bgAssetKey: string;
  allowedCategories: ('land' | 'air' | 'sea')[];
  attackerFaction: string;
  defenderFaction: string;
  attackerColor: string;
  defenderColor: string;
}

export const THEATERS: Record<TheaterId, TheaterConfig> = {
  normandy: {
    id: 'normandy',
    name: 'European Test (Coast / Forest)',
    subtitle: 'European Coast & Forest 1944',
    bgAssetKey: 'bg_normandy_bocage',
    allowedCategories: ['land', 'air', 'sea'],
    attackerFaction: 'Allied Forces',
    defenderFaction: 'Fortified Axis',
    attackerColor: '#72745C', // Olive Drab
    defenderColor: '#857577', // Feldgrau
  },
  eastern: {
    id: 'eastern',
    name: 'Eastern Front Snow',
    subtitle: 'Winter Offensive 1941-42',
    bgAssetKey: 'bg_eastern_front',
    allowedCategories: ['land', 'air'],
    attackerFaction: 'Red Army Guard',
    defenderFaction: 'Wehrmacht Center',
    attackerColor: '#9A4E48', // Soviet Crimson
    defenderColor: '#857577', // Feldgrau
  },
  north_africa: {
    id: 'north_africa',
    name: 'North Africa Desert',
    subtitle: 'El Alamein Sands 1942',
    bgAssetKey: 'bg_north_africa_desert',
    allowedCategories: ['land', 'air'],
    attackerFaction: 'British Desert Rats',
    defenderFaction: 'Afrika Korps',
    attackerColor: '#9E7F55', // Khaki Leather
    defenderColor: '#CAA574', // Sand Tan
  },
  pacific: {
    id: 'pacific',
    name: 'Pacific High Seas',
    subtitle: 'Carrier Task Force Clash',
    bgAssetKey: 'bg_pacific_high_seas',
    allowedCategories: ['sea', 'air'],
    attackerFaction: 'US Navy Task Force',
    defenderFaction: 'Combined Imperial Fleet',
    attackerColor: '#495462', // Naval Steel
    defenderColor: '#9A4E48', // Crimson
  },
  navy_test: {
    id: 'navy_test',
    name: 'NAVY TEST',
    subtitle: 'Full Surface & Subsurface Fleet Battle',
    bgAssetKey: 'bg_pacific_high_seas',
    allowedCategories: ['sea', 'air'],
    attackerFaction: 'Task Force Vanguard',
    defenderFaction: 'Imperial Battle Fleet',
    attackerColor: '#495462', // Naval Steel
    defenderColor: '#857577', // Feldgrau
  },
  air_strike_test: {
    id: 'air_strike_test',
    name: 'AIR STRIKE TEST',
    subtitle: '6 Fighters & 2 Bombers Strike Surface Fleet',
    bgAssetKey: 'bg_pacific_high_seas',
    allowedCategories: ['sea', 'air'],
    attackerFaction: 'Air Wing Strike Force',
    defenderFaction: 'Surface Task Force',
    attackerColor: '#72745C', // Olive Drab / Naval Steel
    defenderColor: '#857577', // Feldgrau
  },
};

export interface ScenarioPreset {
  id: string;
  title: string;
  theater: TheaterId;
  description: string;
  attackerUnits: UnitType[];
  defenderUnits: UnitType[];
}

export const SCENARIOS: ScenarioPreset[] = [
  {
    id: 'normandy_breakout',
    title: 'Operation Cobra Breakout',
    theater: 'normandy',
    description: 'Armored spearhead and close air support smashing through fortified bocage hedgerows.',
    attackerUnits: [
      'infantry', 'infantry', 'infantry', 'infantry',
      'artillery', 'artillery',
      'tank', 'tank', 'tank',
      'fighter', 'tactical_bomber'
    ],
    defenderUnits: [
      'infantry', 'infantry', 'infantry', 'infantry', 'infantry',
      'artillery', 'artillery',
      'tank', 'tank',
      'aaa', 'fighter'
    ],
  },
  {
    id: 'barbarossa_blizzard',
    title: 'Barbarossa Winter Front',
    theater: 'eastern',
    description: 'Red Army counter-offensive striking entrenched German forward lines in frozen trenches.',
    attackerUnits: [
      'infantry', 'infantry', 'infantry', 'infantry', 'infantry',
      'artillery', 'artillery', 'artillery',
      'tank', 'tank', 'tank',
      'tactical_bomber'
    ],
    defenderUnits: [
      'infantry', 'infantry', 'infantry', 'infantry',
      'artillery', 'artillery',
      'tank', 'tank', 'tank',
      'aaa', 'fighter'
    ],
  },
  {
    id: 'desert_rats_charge',
    title: 'El Alamein Sandstorm',
    theater: 'north_africa',
    description: 'Heavy armor artillery barrage across open dunes breaking through minefields.',
    attackerUnits: [
      'infantry', 'infantry', 'infantry',
      'artillery', 'artillery',
      'tank', 'tank', 'tank', 'tank',
      'fighter', 'strategic_bomber'
    ],
    defenderUnits: [
      'infantry', 'infantry', 'infantry', 'infantry',
      'artillery', 'artillery',
      'tank', 'tank', 'tank',
      'aaa', 'tactical_bomber'
    ],
  },
  {
    id: 'coral_sea_carrier',
    title: 'Battle of the Coral Sea',
    theater: 'pacific',
    description: 'Massive fleet engagement: carrier strike aircraft, dreadnoughts, and submarine wolfpacks.',
    attackerUnits: [
      'submarine', 'destroyer', 'destroyer', 'cruiser',
      'carrier', 'battleship',
      'fighter', 'tactical_bomber', 'tactical_bomber'
    ],
    defenderUnits: [
      'submarine', 'destroyer', 'cruiser', 'cruiser',
      'carrier', 'battleship',
      'fighter', 'fighter', 'tactical_bomber'
    ],
  },
  {
    id: 'navy_test_fleet',
    title: 'NAVY TEST: CAPITAL FLEET BATTLE',
    theater: 'navy_test',
    description: 'Full naval fleet combat: Submarines, Destroyers, Cruisers, Aircraft Carriers & Dreadnought Battleships.',
    attackerUnits: [
      'submarine', 'submarine',
      'destroyer', 'destroyer',
      'cruiser',
      'carrier',
      'battleship',
    ],
    defenderUnits: [
      'submarine',
      'destroyer',
      'cruiser', 'cruiser',
      'carrier',
      'battleship',
    ],
  },
  {
    id: 'air_strike_test_operation',
    title: 'AIR STRIKE TEST',
    theater: 'air_strike_test',
    description: 'Maritime strike: 6 Fighters (Rank III) & 2 Bombers (Rank IV) vs 1 Battleship & 3 Destroyers.',
    attackerUnits: [
      'fighter', 'fighter', 'fighter', 'fighter', 'fighter', 'fighter',
      'strategic_bomber', 'strategic_bomber',
    ],
    defenderUnits: [
      'destroyer', 'destroyer', 'destroyer',
      'battleship',
    ],
  },
];

export interface DiceResult {
  dieId: string;
  unitUid: string;
  side: 'attacker' | 'defender';
  unitType: UnitType;
  targetRank: number;
  rolledValue: number;
  isHit: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  vRot: number;
  settled: boolean;
  displayedValue?: number;
  faceCycleTimer?: number;
  hitFlashTimer?: number;
  hasTriggeredHitVfx?: boolean;
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  vy: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
  accentColor: string;
}

export type BattlePhase =
  | 'DEPLOYMENT_MARCH'
  | 'DEPLOYMENT_READY'
  | 'IDLE'
  | 'DEF_AA_ATTACK'
  | 'AA_ALLOCATION'
  | 'ATK_SHORE_BOMBARDMENT'
  | 'ATK_SUB_SURPRISE'
  | 'DEF_SUB_SURPRISE'
  | 'ATK_RANK_1'
  | 'ATK_RANK_2'
  | 'ATK_RANK_3'
  | 'ATK_RANK_4'
  | 'DEF_RANK_1'
  | 'DEF_RANK_2'
  | 'DEF_RANK_3'
  | 'DEF_RANK_4'
  | 'ALLOCATION'
  | 'ATTACKER_DECISION'
  | 'VICTORY_SEQUENCE'
  | 'ROUND_RESOLVED';

export interface PlaneBullet {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  targetSide: 'attacker' | 'defender';
  isHit: boolean;
  color: string;
  trail: {x: number; y: number}[];
  life: number;
  maxLife: number;
}

export interface DroppingBomb {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  groundY: number;
  isHit: boolean;
  unitType: UnitType;
  targetSide: 'attacker' | 'defender';
}

export interface CombatShell {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  progress: number; // 0 to 1
  arcHeight: number;
  color: string;
  trail: {x: number; y: number}[];
  isHit: boolean;
  unitType: UnitType;
  targetSide: 'attacker' | 'defender';
  isTorpedo?: boolean; // submarine torpedo wake cutting through water
  countsAsHit?: boolean; // false for surprise-strike shots, whose casualties are removed directly
}

export interface WaterGeyser {
  id: string;
  x: number;
  y: number;
  height: number;
  maxHeight: number;
  life: number;
  maxLife: number;
  width: number;
}

export interface HitSparks {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export type RankSubPhase =
  | 'IDLE'
  | 'ROLLING'
  | 'FIRING'
  | 'RESOLVED';

export interface BloodSplatter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface BloodPuddle {
  x: number;
  y: number;
  rx: number;
  ry: number;
  maxRx?: number;
  maxRy?: number;
  color: string;
  alpha: number;
  type?: 'blood' | 'oil';
  expansionProgress?: number;
  fadeTimer?: number;
  maxFadeTimer?: number;
}

export interface FlyingDebris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  type: 'helmet' | 'shrapnel' | 'rifle' | 'plane_wing';
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface SmokePuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  sourceType?: 'muzzle_small' | 'muzzle_heavy' | 'impact_explosion' | 'crater_plume';
  fadeTimer?: number;
  maxFadeTimer?: number;
}

export interface GroundCrater {
  id?: string;
  casualtyUid?: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  theater: TheaterId;
  isSmallCasualtyCrater?: boolean;
  alpha?: number;
  fadeTimer?: number;
  maxFadeTimer?: number;
}

export interface CasualtyRecord {
  id: string;
  unitUid: string;
  craterId?: string;
  x: number;
  y: number;
  type: UnitType;
  faction: string;
  side: 'attacker' | 'defender';
  facing: 'east' | 'west';
  effectiveRank: number;
  isConfirmed: boolean;
  isPermanent: boolean;
  timeSinceConfirmed: number;
  fadeDuration: number; // 3 to 20s randomized individual timer
  spriteFadeStart: number;
  spriteFadeDuration: number;
  fluidFadeStart: number;
  fluidFadeDuration: number;
  smallCraterRadius: number; // 3 to 5
  smallCraterRy: number;
  fluidType: 'blood' | 'oil';
  fluidColor: string;
  fluidRx: number;
  fluidRy: number;
  fluidMaxRx: number;
  fluidMaxRy: number;
  spriteAlpha: number;
  fluidAlpha: number;
  smokeAlpha: number;
  craterAlpha?: number;
}

export interface GroundFire {
  id: string;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  flickerOffset: number;
  charredRadius: number;
  smokeTimer: number;
  emberTimer: number;
  fadeTimer?: number;
  maxFadeTimer?: number;
  alpha?: number;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface PlaneSortie {
  id: string;
  unitUid: string;
  side: 'attacker' | 'defender';
  unitType: 'fighter' | 'tactical_bomber' | 'strategic_bomber';
  homeX: number;
  homeY: number;
  currentX: number;
  currentY: number;
  currentRot: number;
  progress: number; // 0 to 1
  duration: number; // in seconds
  isHit: boolean;
  bombsDropped: number;
  bulletBurstsFired: number;
  targetX?: number;
  targetY?: number;
}
