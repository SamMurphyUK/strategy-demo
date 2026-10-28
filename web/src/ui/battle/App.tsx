// tslint:disable
/* eslint-disable */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Play,
  RotateCw,
  Volume2,
  VolumeX,
  Swords,
  Shield,
  Award,
  HelpCircle,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  FastForward,
  Flag,
  Crosshair,
  RefreshCw,
  Zap,
} from 'lucide-react';
import {getConfig} from './constants';
import BackgroundMusic from './utils/BackgroundMusic';
import {
  createFixedStepper,
  GameState,
  MenuOverlay,
  Overlay,
  prepareCanvas,
  useAssets,
  gameAudio,
} from './utils/helper';
import {
  usePlayground,
  usePlaygroundGameLifecycle,
} from './utils/usePlayground';
import {
  BattlePhase,
  CombatShell,
  CombatUnit,
  DiceResult,
  HitSparks,
  SCENARIOS,
  THEATERS,
  TheaterId,
  UNIT_DEFINITIONS,
  UnitType,
  BloodSplatter,
  BloodPuddle,
  FlyingDebris,
  SmokePuff,
  GroundCrater,
  GroundFire,
  Shockwave,
  PlaneSortie,
  PlaneBullet,
  DroppingBomb,
  RankSubPhase,
  FloatingText,
  CasualtyRecord,
  WaterGeyser,
} from './combatTypes';
import {
  aaShotCount,
  assignHits,
  battleOutcome,
  compareByCostThenRank,
  createBattleDice,
  hitsOn,
  nextCombatPhase,
  rankCanFire,
  resolveHit,
  resolveRanks,
} from './rules';
import {
  drawProceduralUnit,
  drawWWIIBattlefield,
  drawAnimatedSea,
  drawOffshoreBattleship,
  drawBloodSplatters,
  drawFlyingDebris,
  drawSmokePuffs,
  drawGroundFires,
  drawShockwaves,
  drawPlaneSortie,
  drawPlaneBullets,
  drawDroppingBombs,
  drawFloatingTexts,
  drawPixelString,
  drawProceduralWavingFlag,
  drawVictorySequenceModal,
  drawWaterGeysers,
  drawPixelRankBadge,
  PALETTE,
} from './unitRenderer';

// Ambient Background Music URL
const BACKGROUND_MUSIC_URL = 'battle-assets/audio/bgm_war_room_march.mp3';

export type RankStepState = 'READY_TO_FIRE' | 'FIRING' | 'RESOLVED';

export const isCombatActive = (u: CombatUnit): boolean => {
  // (BETA) Permanent casualty exclusion: casualties never reappear or reactivate in future rounds
  return u.status === 'alive' && !u.isDestroyed && !u.isPendingCasualty && !u.isPermanentCasualty;
};

let nextUnitUid = 1;

/**
 * Deterministic organic jitter calculated from unit ID and index:
 * - 10% variation on X axis within rank column (±12px to ±16px)
 * - 5% variation on Y axis (±8px to ±12px)
 * Prevents stiff, artificial grid alignments and creates organic formation noise.
 */
function getUnitOrganicJitter(uidNum: number, uid: string): {offsetX: number; offsetY: number} {
  let hash = uidNum * 49297;
  for (let i = 0; i < uid.length; i++) {
    hash = ((hash << 5) - hash) + uid.charCodeAt(i);
    hash |= 0;
  }
  const valX = Math.sin(hash * 1.41421356);
  const valY = Math.cos(hash * 3.14159265);

  const magX = 12 + Math.abs(valX) * 4; // 12 to 16 px
  const offsetX = Math.round((valX >= 0 ? 1 : -1) * magX);

  const magY = 8 + Math.abs(valY) * 4; // 8 to 12 px
  const offsetY = Math.round((valY >= 0 ? 1 : -1) * magY);

  return {offsetX, offsetY};
}

function createUnit(type: UnitType, side: 'attacker' | 'defender'): CombatUnit {
  const def = UNIT_DEFINITIONS[type];
  const uidNum = nextUnitUid++;
  const uid = `unit_${side}_${type}_${uidNum}`;
  const {offsetX, offsetY} = getUnitOrganicJitter(uidNum, uid);

  let readyAnimType: CombatUnit['readyAnimType'] = 'rev';
  if (type === 'infantry') {
    const infantryTypes: ('crouch' | 'reload' | 'scan')[] = ['crouch', 'reload', 'scan'];
    readyAnimType = infantryTypes[uidNum % 3];
  } else if (type === 'tank') {
    readyAnimType = 'swivel';
  } else if (type === 'artillery' || type === 'aaa') {
    readyAnimType = 'crank';
  }

  return {
    uid,
    type,
    side,
    currentHp: def.maxHp,
    maxHp: def.maxHp,
    effectiveRank: side === 'attacker' ? def.baseAttackRank : def.baseDefenseRank,
    hasSynergyBonus: false,
    hasFiredThisRound: false,
    isPendingCasualty: false,
    isPermanentCasualty: false, // (BETA)
    isDestroyed: false,
    status: 'alive',
    downedTime: 0,
    downedFadeProgress: 0,
    fadeAlpha: 1.0,
    isFadingOut: false,
    staggerX: offsetX,
    staggerY: offsetY,
    readyAnimType,
    animRecoil: 0,
    animBobOffset: Math.random() * Math.PI * 2,
    animAnticipation: 0,
    animAimTilt: 0,
    animRevEngine: 0,
    damageSmokeParticles: false,
    colIndex: 0,
    rowIndex: 0,
    planesCarried: type === 'carrier' ? 2 : undefined,
    maxPlanesCarried: type === 'carrier' ? 2 : undefined,
    carrierFloatX: 0,
    carrierFloatState: 'IDLE',
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stepperRef = useRef<ReturnType<typeof createFixedStepper>>(undefined);

  // --- PLAYGROUND SDK INTEGRATION ---
  const {sdk} = usePlayground();

  // --- ASSETS ---
  const ASSETS_MANIFEST: Record<string, string> = {
    bg_normandy_bocage: 'battle-assets/images/bg_normandy_bocage.png',
    bg_eastern_front: 'battle-assets/images/bg_eastern_front.png',
    bg_north_africa_desert: 'battle-assets/images/bg_north_africa_desert.png',
    bg_pacific_high_seas: 'battle-assets/images/bg_pacific_high_seas.png',
    icon_combined_arms_badge: 'battle-assets/images/icon_combined_arms_badge.png',
    icon_brass_d6: 'battle-assets/images/icon_brass_d6.png',
  };
  const {assets, isReady: assetsReady} = useAssets(ASSETS_MANIFEST);

  const canvasWidth = getConfig('baseCanvasWidth') as number;
  const canvasHeight = getConfig('baseCanvasHeight') as number;

  if (!stepperRef.current) {
    const stepMs = getConfig('stepMs');
    const maxSubSteps = getConfig('maxSubSteps');
    stepperRef.current = createFixedStepper(stepMs, maxSubSteps);
  }

  // --- REACT STATE FOR HUD & OVERLAYS ---
  const [gameState, setGameState] = useState<GameState>({
    status: 'START',
    score: 0,
    level: 1,
    round: 1,
  });

  const [diceSeed, setDiceSeed] = useState(() => {
    const fromUrl = Number(new URLSearchParams(window.location.search).get('seed'));
    return Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : 1;
  });
  const diceRef = useRef<() => number>(createBattleDice(diceSeed));

  const [currentTheater, setCurrentTheater] = useState<TheaterId>('normandy');
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  const [isTheaterMenuOpen, setIsTheaterMenuOpen] = useState(false);
  const theaterDropdownRef = useRef<HTMLDivElement>(null);

  // Close theater menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (theaterDropdownRef.current && !theaterDropdownRef.current.contains(e.target as Node)) {
        setIsTheaterMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // "YOUR LAST HITS" Tracker State & Refs
  const [lastPlayerHits, setLastPlayerHits] = useState<number | null>(null);
  const lastPlayerHitsRef = useRef<number | null>(null);
  const playerAttackShootingCompleteRef = useRef(false);

  const [battlePhase, setBattlePhase] = useState<BattlePhase>('IDLE');
  const [rankStepState, setRankStepState] = useState<RankStepState>('READY_TO_FIRE');
  const [rankSubPhase, setRankSubPhase] = useState<RankSubPhase>('IDLE');
  const [roundNumber, setRoundNumber] = useState(1);
  const roundNumberRef = useRef(roundNumber);
  roundNumberRef.current = roundNumber;

  // Defending Flak AA Interception State & Refs
  const [pendingAaHits, setPendingAaHits] = useState(0);
  const hasExecutedAAInterceptionRef = useRef(false);

  // Support Offshore Battleship for European Test (Coast / Forest)
  const offshoreBattleshipRef = useRef({
    active: true,
    x: 50,
    y: 610,
    recoilX: 0,
    recoilTrauma: 0,
    turretAngle: -0.22,
    turretRecoil: 0,
    muzzleFlash: 0,
    hasFired: false,
    driftingAstern: false,
  });

  const [isAutoRolling, setIsAutoRolling] = useState(false);
  const [isSandboxOpen, setIsSandboxOpen] = useState(false);

  // Dynamic IPC Values (Attacker: 41 IPC, Defender: 50 IPC)
  const [attackerIpc, setAttackerIpc] = useState(41);
  const [defenderIpc, setDefenderIpc] = useState(50);
  const attackerIpcRef = useRef(41);
  const defenderIpcRef = useRef(50);
  attackerIpcRef.current = attackerIpc;
  defenderIpcRef.current = defenderIpc;

  // Attacker Victory Sequence State & Refs
  const [isVictorySequenceActive, setIsVictorySequenceActive] = useState(false);
  const victorySeqRef = useRef({
    active: false,
    stage: 'INACTIVE' as 'INACTIVE' | 'CHEERING' | 'FADE_TO_BLACK' | 'FLAG_SCREEN',
    elapsed: 0,
    flagElapsed: 0,
    blackFadeAlpha: 0,
    regionName: 'NORMANDY',
  });
  const returnButtonRectRef = useRef<{x: number; y: number; w: number; h: number} | null>(null);

  // Deployment march & formation state ref
  const deploymentRef = useRef({
    active: false,
    stage: 'DONE' as 'MARCHING' | 'READY_ANIM' | 'DONE',
    marchElapsed: 0,
    marchDuration: 3.0,
    readyElapsed: 0,
    readyDuration: 0.8,
    rankSymbolsAlpha: 0,
  });

  // Overlay Menu controls
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(false);

  // Attacker & Defender counts
  const [attackerUnits, setAttackerUnits] = useState<CombatUnit[]>([]);
  const [defenderUnits, setDefenderUnits] = useState<CombatUnit[]>([]);
  const [pendingAttackerHits, setPendingAttackerHits] = useState(0);
  const [pendingDefenderHits, setPendingDefenderHits] = useState(0);
  const [, setCombatLog] = useState<string[]>([]);
  const [, setLastVolleySummary] = useState<string>('');

  // Simulation Refs (to ensure zero-lag 60fps physics & particles)
  const attackerUnitsRef = useRef<CombatUnit[]>([]);
  const defenderUnitsRef = useRef<CombatUnit[]>([]);
  attackerUnitsRef.current = attackerUnits;
  defenderUnitsRef.current = defenderUnits;

  const attackerHitsRef = useRef(0);
  const defenderHitsRef = useRef(0);
  const lastHitTimeRef = useRef(0);

  const battlePhaseRef = useRef<BattlePhase>('IDLE');
  battlePhaseRef.current = battlePhase;

  const rankStepStateRef = useRef<RankStepState>('READY_TO_FIRE');
  rankStepStateRef.current = rankStepState;

  const rankSubPhaseRef = useRef<RankSubPhase>('IDLE');
  rankSubPhaseRef.current = rankSubPhase;

  const currentTheaterRef = useRef<TheaterId>(currentTheater);
  currentTheaterRef.current = currentTheater;

  // Simulation Speed Multiplier (1 = 1x, 2 = 2x double speed)
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2>(1);
  const speedMultiplierRef = useRef<1 | 2>(1);
  speedMultiplierRef.current = speedMultiplier;

  const toggleSpeed = useCallback(() => {
    setSpeedMultiplier((prev) => (prev === 1 ? 2 : 1));
    gameAudio.playCrispClick();
  }, []);

  const activeDiceRef = useRef<DiceResult[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const combatShellsRef = useRef<CombatShell[]>([]);
  const planeBulletsRef = useRef<PlaneBullet[]>([]);
  const droppingBombsRef = useRef<DroppingBomb[]>([]);
  const sparksRef = useRef<HitSparks[]>([]);
  const bloodSplattersRef = useRef<BloodSplatter[]>([]);
  const bloodPuddlesRef = useRef<BloodPuddle[]>([]);
  const flyingDebrisRef = useRef<FlyingDebris[]>([]);
  const smokePuffsRef = useRef<SmokePuff[]>([]);
  const cratersRef = useRef<GroundCrater[]>([]);
  const groundFiresRef = useRef<GroundFire[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const activeSortiesRef = useRef<PlaneSortie[]>([]);
  const casualtyRecordsRef = useRef<CasualtyRecord[]>([]);
  const waterGeysersRef = useRef<WaterGeyser[]>([]);

  const screenShakeRef = useRef(0);
  const gameTimeRef = useRef(0);
  const diceRattleTimerRef = useRef(0);
  const lastDiceBounceTimeRef = useRef(0);
  // Sequence timers run on gameTimeRef (simulation seconds), not setTimeout: hits are tallied when
  // projectiles land in update(), so the rank sequence has to advance on the same clock.
  const sequenceTimeoutsRef = useRef<{at: number; seq: number; gen: number; fn: () => void}[]>([]);
  const sequenceGenRef = useRef(0);
  const sequenceSeqRef = useRef(0);
  const autoRollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  // Clear all pending scheduled combat timeouts
  const clearSequenceTimeouts = useCallback(() => {
    sequenceGenRef.current += 1;
    sequenceTimeoutsRef.current = [];
  }, []);

  const scheduleSequenceTimeout = useCallback((fn: () => void, delayMs: number) => {
    sequenceSeqRef.current += 1;
    sequenceTimeoutsRef.current.push({
      at: gameTimeRef.current + delayMs / 1000,
      seq: sequenceSeqRef.current,
      gen: sequenceGenRef.current,
      fn,
    });
  }, []);

  // A callback may clear or schedule timers, so each due timer is re-checked against the current generation.
  const runDueSequenceTimeouts = () => {
    const now = gameTimeRef.current;
    const due = sequenceTimeoutsRef.current.filter((t) => t.at <= now);
    if (due.length === 0) return;
    sequenceTimeoutsRef.current = sequenceTimeoutsRef.current.filter((t) => t.at > now);
    due.sort((a, b) => a.at - b.at || a.seq - b.seq);
    for (const t of due) {
      if (t.gen === sequenceGenRef.current) t.fn();
    }
  };

  // Calculate Combined Arms Synergies & Layout Columns
  // REVERSED RANK ORDER:
  // Attacker (Left side): Rear is Rank IV (outer left) -> Rank III -> Rank II -> Frontline Rank I (closest to center)
  // Defender (Right side): Frontline Rank I (closest to center) -> Rank II -> Rank III -> Rear Rank IV (outer right)
  const recalculateSynergies = (
    atkList: CombatUnit[],
    defList: CombatUnit[],
  ): {atk: CombatUnit[]; def: CombatUnit[]} => {
    const isNavyTest = currentTheaterRef.current === 'navy_test';
    const isAirStrikeTest = currentTheaterRef.current === 'air_strike_test';
    const isMaritime = isNavyTest || isAirStrikeTest;

    const processSide = (list: CombatUnit[], side: 'attacker' | 'defender'): CombatUnit[] => {
      const ranks = resolveRanks(
        list.map((u) => ({uid: u.uid, type: u.type, active: isCombatActive(u)})),
        side,
        currentTheaterRef.current,
      );
      const result: CombatUnit[] = list.map((u) => {
        const rank = ranks.find((r) => r.uid === u.uid)!;
        return {
          ...u,
          effectiveRank: rank.effectiveRank,
          hasSynergyBonus: rank.hasSynergyBonus,
          pairedWithUid: rank.pairedWithUid,
        };
      });

      // Column layout & row positioning:
      const landCountPerRank: Record<number, number> = {1: 0, 2: 0, 3: 0, 4: 0};
      const seaCountPerRank: Record<number, number> = {1: 0, 2: 0, 3: 0, 4: 0};

      result.forEach((u) => {
        // Casualties stay in their place on the field
        if (!isCombatActive(u)) {
          return;
        }

        const rank = Math.max(1, Math.min(4, u.effectiveRank));
        const def = UNIT_DEFINITIONS[u.type];
        const isSeaOrMaritime = isMaritime || def.category === 'sea' || def.category === 'air';

        if (side === 'attacker') {
          u.colIndex = 4 - rank; // Rank 4 -> 0, Rank 3 -> 1, Rank 2 -> 2, Rank 1 -> 3
        } else {
          u.colIndex = rank - 1; // Rank 1 -> 0, Rank 2 -> 1, Rank 3 -> 2, Rank 4 -> 3
        }

        if (isSeaOrMaritime) {
          u.rowIndex = seaCountPerRank[rank] || 0;
          seaCountPerRank[rank] = (seaCountPerRank[rank] || 0) + 1;
        } else {
          u.rowIndex = landCountPerRank[rank] || 0;
          landCountPerRank[rank] = (landCountPerRank[rank] || 0) + 1;
        }
      });

      return result;
    };

    return {
      atk: processSide(atkList, 'attacker'),
      def: processSide(defList, 'defender'),
    };
  };

  // Helper to get unit screen coordinates
  const getUnitScreenPos = (unit: CombatUnit): {x: number; y: number} => {
    const isAttacker = unit.side === 'attacker';
    const isNavyTest = currentTheaterRef.current === 'navy_test';
    const isAirStrikeTest = currentTheaterRef.current === 'air_strike_test';
    const def = UNIT_DEFINITIONS[unit.type];
    const isSea = def.category === 'sea';

    let x = 0;
    if (isAttacker) {
      x = 102 + unit.colIndex * 105;
      if (unit.marchCurrentOffsetX !== undefined) {
        x += unit.marchCurrentOffsetX;
      }
      if (unit.victoryAdvanceX) {
        x += unit.victoryAdvanceX;
      }
    } else {
      x = 862 + unit.colIndex * 105;
    }

    let y = 0;
    if (isAirStrikeTest) {
      // In AIR STRIKE TEST:
      // Attacker has 6 Fighters (Rank III) and 2 Bombers (Rank IV)
      // Defender has 3 Destroyers (Rank II) and 1 Battleship (Rank IV)
      if (isAttacker) {
        if (unit.effectiveRank === 3) {
          // 6 Fighters spread vertically
          y = 160 + (unit.rowIndex || 0) * 54;
        } else if (unit.effectiveRank === 4) {
          // 2 Strategic Bombers
          y = 230 + (unit.rowIndex || 0) * 110;
        } else {
          y = 180 + (unit.rowIndex || 0) * 55;
        }
      } else {
        if (unit.effectiveRank === 2) {
          // 3 Destroyers
          y = 195 + (unit.rowIndex || 0) * 90;
        } else if (unit.effectiveRank === 4) {
          // 1 Battleship
          y = 285;
        } else {
          y = 190 + (unit.rowIndex || 0) * 80;
        }
      }

      if (unit.staggerX !== undefined) x += unit.staggerX;
      if (unit.staggerY !== undefined) y += unit.staggerY;
      if (unit.sinkingY !== undefined) y += unit.sinkingY;
      if (isAttacker && unit.victoryAscentY) y -= unit.victoryAscentY;
      return {x, y};
    }

    if (isNavyTest) {
      // In NAVY TEST:
      // Space out the ships vertically on Rank II so there is a wide open water corridor
      // at Y = 310 between Rank III and Rank I for the carrier to glide forward and return back!
      if (unit.type === 'carrier') {
        y = 310;
      } else if (unit.effectiveRank === 2) {
        const rIdx = unit.rowIndex || 0;
        if (rIdx === 0) y = 160;
        else if (rIdx === 1) y = 220;
        else if (rIdx === 2) y = 400;
        else y = 465;
      } else {
        const rIdx = unit.rowIndex || 0;
        if (rIdx === 0) y = 190;
        else if (rIdx === 1) y = 430;
        else y = 220 + rIdx * 80;
      }

      if (unit.carrierFloatX !== undefined) {
        x += unit.carrierFloatX;
      }
      // Apply persistent organic jitter
      if (unit.staggerX !== undefined) {
        x += unit.staggerX;
      }
      if (unit.staggerY !== undefined) {
        y += unit.staggerY;
      }
      if (unit.sinkingY !== undefined) {
        y += unit.sinkingY;
      }
      if (isAttacker && unit.victoryAscentY) {
        y -= unit.victoryAscentY;
      }
      return {x, y};
    }

    if (isSea) {
      y = 565 + unit.rowIndex * 38;
    } else {
      y = 160 + unit.rowIndex * 46;
    }

    // Directly add persistent deterministic offsets to rendered x and y
    if (unit.staggerX !== undefined) {
      x += unit.staggerX;
    }
    if (unit.staggerY !== undefined) {
      y += unit.staggerY;
    }

    if (unit.sinkingY !== undefined) {
      y += unit.sinkingY;
    }

    if (isAttacker && unit.victoryAscentY) {
      y -= unit.victoryAscentY;
    }

    return {x, y};
  };

  // Setup Scenario
  const loadScenario = useCallback((scenarioIndex: number) => {
    diceRef.current = createBattleDice(diceSeed);
    clearSequenceTimeouts();
    const sc = SCENARIOS[scenarioIndex % SCENARIOS.length];
    setCurrentTheater(sc.theater);
    setCurrentScenarioIndex(scenarioIndex);
    setBattlePhase('DEPLOYMENT_MARCH');
    setRankStepState('READY_TO_FIRE');
    setRankSubPhase('IDLE');
    setRoundNumber(1);
    setIsAutoRolling(false);
    deploymentRef.current = {
      active: true,
      stage: 'MARCHING',
      marchElapsed: 0,
      marchDuration: 3.0,
      readyElapsed: 0,
      readyDuration: 0.8,
      rankSymbolsAlpha: 0,
    };
    activeDiceRef.current = [];
    floatingTextsRef.current = [];
    combatShellsRef.current = [];
    planeBulletsRef.current = [];
    droppingBombsRef.current = [];
    sparksRef.current = [];
    bloodSplattersRef.current = [];
    bloodPuddlesRef.current = [];
    flyingDebrisRef.current = [];
    smokePuffsRef.current = [];
    cratersRef.current = [];
    groundFiresRef.current = [];
    shockwavesRef.current = [];
    activeSortiesRef.current = [];
    casualtyRecordsRef.current = [];
    waterGeysersRef.current = [];
    offshoreBattleshipRef.current = {
      active: sc.theater === 'normandy',
      x: 50,
      y: 610,
      recoilX: 0,
      recoilTrauma: 0,
      turretAngle: -0.22,
      turretRecoil: 0,
      muzzleFlash: 0,
      hasFired: false,
      driftingAstern: false,
    };
    victorySeqRef.current = {
      active: false,
      stage: 'INACTIVE',
      elapsed: 0,
      flagElapsed: 0,
      blackFadeAlpha: 0,
      regionName: sc.theater === 'normandy'
        ? 'EUROPEAN TEST (COAST / FOREST)'
        : sc.theater === 'navy_test'
        ? 'OPEN PACIFIC OCEAN (NAVY TEST)'
        : sc.theater === 'air_strike_test'
        ? 'OPEN PACIFIC OCEAN (AIR STRIKE TEST)'
        : THEATERS[sc.theater].name
            .replace(' Bocage', '')
            .replace(' Snow', '')
            .replace(' Desert', '')
            .replace(' High Seas', ' Islands')
            .toUpperCase(),
    };
    setIsVictorySequenceActive(false);
    returnButtonRectRef.current = null;
    attackerHitsRef.current = 0;
    defenderHitsRef.current = 0;
    setPendingAttackerHits(0);
    setPendingDefenderHits(0);
    setPendingAaHits(0);
    hasExecutedAAInterceptionRef.current = false;
    setLastVolleySummary('');

    // Reset last hits tracker
    playerAttackShootingCompleteRef.current = false;
    lastPlayerHitsRef.current = null;
    setLastPlayerHits(null);

    const initialAtk = sc.attackerUnits.map((t) => createUnit(t, 'attacker'));
    const initialDef = sc.defenderUnits.map((t) => createUnit(t, 'defender'));

    const {atk, def} = recalculateSynergies(initialAtk, initialDef);

    // Initialize 3-second attacking deployment march:
    // Attacking troops start roughly 2/3rds back in rear rank order:
    // Rank I starts around Rank III position (-210px), Rank II (-180px), Rank III (-150px), Rank IV (-120px)
    atk.forEach((u) => {
      const rank = Math.max(1, Math.min(4, u.effectiveRank));
      const startOffset = -120 - (4 - rank) * 30; // Rank 1: -210, Rank 2: -180, Rank 3: -150, Rank 4: -120
      u.marchStartOffsetX = startOffset;
      u.marchCurrentOffsetX = startOffset;
      u.isMarching = true;
      u.readyAnimProgress = undefined;
    });

    setAttackerUnits(atk);
    setDefenderUnits(def);
    setCombatLog([
      `Scenario: ${sc.title}`,
      `Theater: ${THEATERS[sc.theater].name}`,
      `Sequential battle protocol active. Attackers fire first, Defenders return fire second.`,
    ]);
  }, [clearSequenceTimeouts, diceSeed]);

  // Handler to switch theater from top UI bar
  const handleSelectTheater = useCallback(
    (targetTheater: TheaterId) => {
      setIsTheaterMenuOpen(false);
      setCurrentTheater(targetTheater);
      currentTheaterRef.current = targetTheater;
      const sIdx = SCENARIOS.findIndex((s) => s.theater === targetTheater);
      if (sIdx !== -1) {
        loadScenario(sIdx);
      }
      if (gameStateRef.current.status === 'START') {
        setGameState((prev) => ({...prev, status: 'PLAYING'}));
      }
      gameAudio.playConfirmSelect();
    },
    [loadScenario],
  );

  const initGame = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      status: 'PLAYING',
      score: 0,
      level: 1,
      round: 1,
    }));
    loadScenario(currentScenarioIndex);
    if (sdk) {
      sdk.startGame();
    }
  }, [sdk, loadScenario, currentScenarioIndex]);

  usePlaygroundGameLifecycle(gameState, sdk);

  // Automatically initialize deployment march on initial boot & handle autoplay
  const hasInitializedOnBoot = useRef(false);
  useEffect(() => {
    if (!hasInitializedOnBoot.current) {
      hasInitializedOnBoot.current = true;
      loadScenario(0);
      if (new URLSearchParams(window.location.search).has('autoplay')) {
        initGame();
      }
    }
  }, [initGame, loadScenario]);

  // Spawn visual shell projectile (or submarine torpedo)
  const spawnShell = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: string,
    isHit: boolean,
    unitType: UnitType,
    targetSide: 'attacker' | 'defender',
    isTorpedo = false,
  ) => {
    combatShellsRef.current.push({
      id: `shell_${Math.random()}`,
      startX,
      startY,
      endX,
      endY,
      progress: 0,
      arcHeight: isTorpedo ? 0 : 28 + Math.random() * 20,
      color,
      trail: [],
      isHit,
      unitType,
      targetSide,
      isTorpedo,
    });
  };

  // Spawn visual impact sparks / embers (richer counts & lingering)
  const spawnSparks = (x: number, y: number, count = 18) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 140;
      sparksRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 0.4 + Math.random() * 0.6,
        maxLife: 1.0,
        color: Math.random() > 0.45 ? PALETTE.sandCream : PALETTE.terracotta,
        size: 2 + Math.random() * 3,
      });
    }
  };

  // Spawn long-lingering billowing smoke puffs (rich layers, 6-12 seconds lifetime)
  const spawnSmoke = (
    x: number,
    y: number,
    radius = 7,
    maxRadius = 28,
    color: string = PALETTE.deepTaupe,
    life = 8.5,
    sourceType: 'muzzle_small' | 'muzzle_heavy' | 'impact_explosion' | 'crater_plume' = 'muzzle_small',
  ) => {
    smokePuffsRef.current.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 14 + 4, // gentle wind drift eastward
      vy: -9 - Math.random() * 12,       // slow billowing upward lift
      radius,
      maxRadius,
      life: life * (0.85 + Math.random() * 0.35),
      maxLife: life * 1.2,
      color,
      sourceType,
    });

    if (smokePuffsRef.current.length > 350) {
      smokePuffsRef.current.shift();
    }
  };

  // Spawn persistent burning ground fire spots & embers from combat hits
  const spawnGroundFire = (x: number, y: number, isHeavy: boolean) => {
    // Avoid excessive overlap on the exact same coordinate
    const tooClose = groundFiresRef.current.some(
      (f) => Math.hypot(f.x - x, f.y - y) < 14,
    );
    if (!tooClose && groundFiresRef.current.length < 50) {
      groundFiresRef.current.push({
        id: `fire_${Math.random()}`,
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 6,
        radius: isHeavy ? 8 + Math.random() * 4 : 5 + Math.random() * 3,
        intensity: 1.0,
        flickerOffset: Math.random() * 100,
        charredRadius: isHeavy ? 15 + Math.random() * 6 : 9 + Math.random() * 4,
        smokeTimer: Math.random() * 0.4,
        emberTimer: Math.random() * 0.25,
      });

      // Stamp crater underneath ground fire
      if (cratersRef.current.length < 80) {
        cratersRef.current.push({
          id: `crater_${Math.random()}`,
          x,
          y: y + 2,
          rx: isHeavy ? 14 + Math.random() * 4 : 8 + Math.random() * 3,
          ry: isHeavy ? 8 + Math.random() * 3 : 5 + Math.random() * 2,
          theater: currentTheaterRef.current,
          alpha: 1.0,
        });
      }
    } else if (tooClose) {
      const existing = groundFiresRef.current.find(
        (f) => Math.hypot(f.x - x, f.y - y) < 14,
      );
      if (existing) {
        existing.radius = Math.min(16, existing.radius + 2);
        existing.charredRadius = Math.min(22, existing.charredRadius + 3);
        existing.intensity = 1.0;
        existing.fadeTimer = undefined; // reset fade if re-ignited
      }
    }
  };

  // Spawn blood splatters & persistent puddle
  const spawnBlood = (x: number, y: number, count = 14) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 35 + Math.random() * 95;
      bloodSplattersRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 35,
        life: 0.6 + Math.random() * 0.5,
        maxLife: 1.1,
        color: Math.random() > 0.45 ? PALETTE.crimson : PALETTE.plum,
        size: 1.5 + Math.random() * 2.5,
      });
    }

    if (bloodPuddlesRef.current.length < 50) {
      bloodPuddlesRef.current.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 6,
        rx: 7 + Math.random() * 7,
        ry: 4 + Math.random() * 3,
        color: PALETTE.crimson,
        alpha: 0.85,
      });
    }
  };

  // Spawn flying helmets & shrapnel debris in parabolic arcs
  const spawnFlyingDebris = (x: number, y: number, type: 'helmet' | 'shrapnel') => {
    for (let i = 0; i < 4; i++) {
      flyingDebrisRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 140,
        vy: -120 - Math.random() * 110,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 18,
        type: i === 0 && type === 'helmet' ? 'helmet' : 'shrapnel',
        color: i === 0 && type === 'helmet' ? PALETTE.feldgrau : PALETTE.deepTaupe,
        size: 3 + Math.random() * 3,
        life: 1.0 + Math.random() * 0.5,
        maxLife: 1.5,
      });
    }
  };

  // Spawn heavy explosion VFX (crater, shockwave, dense lingering smoke plumes, embers)
  const spawnExplosionVFX = (x: number, y: number, isHeavy: boolean, allowCrater = true) => {
    shockwavesRef.current.push({
      x,
      y,
      radius: 4,
      maxRadius: isHeavy ? 42 : 24,
      life: 0.45,
      maxLife: 0.45,
      color: PALETTE.mustardBrass,
    });

    spawnSparks(x, y, isHeavy ? 30 : 18);

    // Billowing lingering smoke plumes (6-11 seconds) in rich layered colors
    const plumeCount = isHeavy ? 12 : 6;
    for (let i = 0; i < plumeCount; i++) {
      const plumeColor =
        i % 3 === 0
          ? PALETTE.bunkerCharcoal
          : i % 3 === 1
          ? PALETTE.deepTaupe
          : PALETTE.trenchMudBone;

      spawnSmoke(
        x + (Math.random() - 0.5) * 22,
        y + (Math.random() - 0.5) * 16,
        isHeavy ? 10 : 7,
        isHeavy ? 38 : 25,
        plumeColor,
        isHeavy ? 9.5 : 7.2,
        'impact_explosion',
      );
    }

    if (allowCrater && cratersRef.current.length < 60) {
      cratersRef.current.push({
        id: `crater_${Math.random()}`,
        x,
        y,
        rx: isHeavy ? 15 + Math.random() * 7 : 9 + Math.random() * 5,
        ry: isHeavy ? 10 + Math.random() * 5 : 6 + Math.random() * 3,
        theater: currentTheaterRef.current,
        alpha: 1.0,
      });
    }
  };

  // Trigger impact on target line
  const triggerHitImpact = (
    x: number,
    y: number,
    isHit: boolean,
    unitType: UnitType,
    targetSide: 'attacker' | 'defender',
  ) => {
    const isNavyTest = currentTheaterRef.current === 'navy_test';
    const isAirStrikeTest = currentTheaterRef.current === 'air_strike_test';
    const isPlaneSideHit = isAirStrikeTest && targetSide === 'attacker';

    // Submarine torpedo impact or naval surface bomb impact: spawns geyser water splash explosion!
    if (unitType === 'submarine' || (isNavyTest && isHit) || (isAirStrikeTest && targetSide === 'defender' && isHit)) {
      waterGeysersRef.current.push({
        id: `geyser_${Math.random()}`,
        x,
        y: y + 2,
        height: 0,
        maxHeight: isHit ? 44 : 26,
        life: 0.9,
        maxLife: 0.9,
        width: isHit ? 24 : 14,
      });
      if (isHit) {
        gameAudio.playWaterGeyserSplash();
      }
    }

    if (isHit) {
      // 1. Troop Fire Hit Sound: Tactical confirmation "beep" strictly on confirmed hit!
      gameAudio.playTacticalHitBeep();

      screenShakeRef.current =
        unitType === 'strategic_bomber' || unitType === 'battleship' ? 14 : 6;

      // 2. Spawn floating pixel text HIT directly above struck target unit
      const hitX = Math.round(x);
      const hitY = Math.round(y - 6);
      floatingTextsRef.current.push({
        id: `hit_unit_${Math.random()}`,
        x: hitX,
        y: hitY,
        vy: -34,
        text: 'HIT',
        life: 1.2,
        maxLife: 1.2,
        color: targetSide === 'defender' ? PALETTE.sandCream : PALETTE.crimson,
        accentColor: targetSide === 'defender' ? PALETTE.terracotta : PALETTE.plum,
      });

      // 3. Increment confirmed hits counter in exact sync with impact
      lastHitTimeRef.current = gameTimeRef.current;
      if (targetSide === 'defender') {
        attackerHitsRef.current += 1;
        setPendingDefenderHits(attackerHitsRef.current);
      } else {
        defenderHitsRef.current += 1;
        setPendingAttackerHits(defenderHitsRef.current);
      }

      const isHumanCrew = unitType === 'infantry' || unitType === 'artillery' || unitType === 'aaa';
      if (!isPlaneSideHit) {
        if (isHumanCrew) {
          spawnBlood(x, y, 14);
          spawnFlyingDebris(x, y, 'helmet');
          gameAudio.playSoldierScream();
        } else {
          spawnFlyingDebris(x, y, 'shrapnel');
          gameAudio.playMetalCrunch();
        }
      } else {
        // Planes taking hits: metal debris & crunch, but NO blood, craters, or oil
        spawnFlyingDebris(x, y, 'shrapnel');
        gameAudio.playMetalCrunch();
      }

      const isHeavy =
        unitType === 'artillery' ||
        unitType === 'tank' ||
        unitType === 'tactical_bomber' ||
        unitType === 'strategic_bomber' ||
        unitType === 'battleship' ||
        unitType === 'cruiser' ||
        unitType === 'destroyer';

      // No craters on plane side or in maritime modes
      const allowCrater = isHeavy && !isNavyTest && !isAirStrikeTest && !isPlaneSideHit;
      spawnExplosionVFX(x, y, isHeavy, allowCrater);

      if (isAirStrikeTest) {
        // AIR STRIKE TEST rule: "For hits, do smoke but no fire."
        // Produces billowing smoke plumes, but NO fire emitters!
        for (let s = 0; s < 8; s++) {
          spawnSmoke(
            x + (Math.random() - 0.5) * 16,
            y + (Math.random() - 0.5) * 12,
            8,
            26,
            s % 2 === 0 ? PALETTE.bunkerCharcoal : PALETTE.deepTaupe,
            7.2,
            'impact_explosion',
          );
        }
      } else if (isHeavy) {
        // Persistent burning ground fire spots & embers: on land or floating oil fire in sea
        spawnGroundFire(x, y, isHeavy);
      }
    } else {
      // MISS: NO beep sound on miss!
      spawnSparks(x, y, 5);
      if (!isNavyTest && !isAirStrikeTest) {
        spawnSmoke(x, y, 5, 14, PALETTE.trenchMudBone, 3.5, 'crater_plume');
      }
    }
  };

  // Register casualty record with small impact crater and fluid pool
  const registerCasualtyRecord = (unit: CombatUnit, playSfx = true): CasualtyRecord => {
    const pos = getUnitScreenPos(unit);
    const fixedX = Math.round(pos.x);
    const fixedY = Math.round(pos.y);

    const existing = casualtyRecordsRef.current.find((c) => c.unitUid === unit.uid);
    if (existing) {
      existing.x = fixedX;
      existing.y = fixedY;
      return existing;
    }

    const isAirStrikeTest = currentTheaterRef.current === 'air_strike_test';
    const isPlaneSide = isAirStrikeTest && (unit.side === 'attacker' || UNIT_DEFINITIONS[unit.type].category === 'air');

    let craterId: string | undefined = undefined;
    let smallCraterRadius = 0;
    let smallCraterRy = 0;

    // AIR STRIKE TEST rule: "Don't do any impact craters / oil on the planes side."
    if (!isPlaneSide) {
      // 1. Small Impact Crater beneath everything (radius 3 to 5)
      smallCraterRadius = Math.floor(Math.random() * 3) + 3; // 3, 4, or 5
      smallCraterRy = Math.round(smallCraterRadius * 0.65 * 10) / 10;
      craterId = `crater_${unit.uid}_${Math.random()}`;
      cratersRef.current.push({
        id: craterId,
        casualtyUid: unit.uid,
        x: fixedX,
        y: fixedY + 3,
        rx: smallCraterRadius,
        ry: smallCraterRy,
        theater: currentTheaterRef.current,
        isSmallCasualtyCrater: true,
        alpha: 1.0,
      });
    }

    // 2. Fluid Pool (Blood pool for infantry/crews, Engine oil slick for vehicles/air/sea)
    const isHumanCrew = unit.type === 'infantry' || unit.type === 'artillery' || unit.type === 'aaa';
    const fluidType: 'blood' | 'oil' = isHumanCrew ? 'blood' : 'oil';

    if (isPlaneSide) {
      // Planes emit billowing smoke as they spiral down/fade away without leaving craters or oil
      for (let s = 0; s < 6; s++) {
        spawnSmoke(
          fixedX + (Math.random() - 0.5) * 14,
          fixedY + (Math.random() - 0.5) * 10,
          7,
          24,
          s % 2 === 0 ? PALETTE.bunkerCharcoal : PALETTE.deepTaupe,
          6.0,
          'impact_explosion',
        );
      }
    } else if (unit.type === 'infantry') {
      spawnBlood(fixedX, fixedY, 12);
      spawnFlyingDebris(fixedX, fixedY, 'helmet');
    } else {
      spawnFlyingDebris(fixedX, fixedY, 'shrapnel');
      spawnSmoke(fixedX, fixedY, 8, 22, PALETTE.bunkerCharcoal, 6, 'impact_explosion');
    }

    const theater = THEATERS[currentTheaterRef.current];
    const initialDuration = 3.0 + Math.random() * 17.0; // 3 to 20s randomized individual timer
    const rec: CasualtyRecord = {
      id: `cas_${unit.uid}_${Math.random()}`,
      unitUid: unit.uid,
      craterId,
      x: fixedX,
      y: fixedY,
      type: unit.type,
      faction: unit.side === 'attacker' ? theater.attackerColor : theater.defenderColor,
      side: unit.side,
      facing: unit.side === 'attacker' ? 'east' : 'west',
      effectiveRank: unit.effectiveRank,
      isConfirmed: false,
      isPermanent: false,
      timeSinceConfirmed: 0,
      fadeDuration: initialDuration,
      spriteFadeStart: 0,
      spriteFadeDuration: initialDuration,
      fluidFadeStart: 0,
      fluidFadeDuration: initialDuration,
      smallCraterRadius,
      smallCraterRy,
      fluidType,
      fluidColor: fluidType === 'blood' ? PALETTE.crimson : PALETTE.bunkerCharcoal,
      fluidRx: isPlaneSide ? 0 : (fluidType === 'blood' ? 9 : 13),
      fluidRy: isPlaneSide ? 0 : (fluidType === 'blood' ? 5 : 7),
      fluidMaxRx: isPlaneSide ? 0 : (fluidType === 'blood' ? 15 : 21),
      fluidMaxRy: isPlaneSide ? 0 : (fluidType === 'blood' ? 8 : 11),
      spriteAlpha: 1.0,
      fluidAlpha: isPlaneSide ? 0 : 1.0,
      smokeAlpha: 1.0,
      craterAlpha: isPlaneSide ? 0 : 1.0,
    };

    casualtyRecordsRef.current.push(rec);

    if (playSfx) {
      if (unit.type === 'infantry') gameAudio.playInfantryGroan();
      else if (unit.type === 'artillery' || unit.type === 'aaa') gameAudio.playArtilleryCookoff();
      else gameAudio.playVehicleWreckCreak();
    }

    return rec;
  };

  // Applies 1 casualty hit to a specific unit (damage or downed state) with death audio
  const applyCasualtyToUnit = (unit: CombatUnit, playSfx = true) => {
    const pos = getUnitScreenPos(unit);

    if (unit.maxHp > 1 && unit.currentHp > 1) {
      // 2-HP capital unit absorbs 1 hit (Battleship or Carrier)
      unit.currentHp -= 1;
      unit.isPendingCasualty = false;
      // Injured Phase: permanently tilts 10 degrees (listing into sea), drops 2-3px deeper
      unit.listingAngle = 0.175; // 10 degrees
      unit.staggerY = (unit.staggerY || 0) + 3;
      unit.damageSmokeParticles = true;
      if (playSfx) gameAudio.playShieldBlock();
      spawnSparks(pos.x, pos.y, 10);
    } else {
      // (BETA) Unit is downed: immediately excluded from combat logic while preserving visual downed state
      unit.currentHp = 0;
      unit.status = 'downed';
      unit.isDestroyed = true;
      // A confirmed casualty stays confirmed. Replaying the hit must not put it back up for allocation.
      if (!unit.isPermanentCasualty) {
        unit.isPendingCasualty = true;
      }
      unit.downedTime = 0;
      unit.downedFadeProgress = 0;
      unit.fadeAlpha = 1.0;
      unit.isFadingOut = false;

      // Sinking phase for warships: tilts to 45 degrees, initiates slow descent into the deep
      if (
        unit.type === 'battleship' ||
        unit.type === 'carrier' ||
        unit.type === 'cruiser' ||
        unit.type === 'destroyer' ||
        unit.type === 'submarine'
      ) {
        unit.listingAngle = 0.785; // 45 degrees
        unit.sinkingProgress = 0;
        unit.sinkingY = 0;
      }

      // Register casualty record with small permanent crater and fluid pool
      registerCasualtyRecord(unit, playSfx);
    }
  };

  // AI Defending Force Casualty Transition (lowest unit cost/rank first with distinct death SFX)
  const autoAssignDefenderCasualties = useCallback(() => {
    const currentDef = [...defenderUnitsRef.current];
    const aliveDefenders = currentDef.filter(isCombatActive);

    const steps = assignHits(
      aliveDefenders.map((u) => ({uid: u.uid, type: u.type, rank: u.effectiveRank, currentHp: u.currentHp, maxHp: u.maxHp})),
      pendingDefenderHits,
    ).map((step) => ({step, unit: aliveDefenders.find((u) => u.uid === step.uid)!}));

    steps.forEach(({step, unit}) => {
      if (step.result === 'destroyed') {
        unit.isPendingCasualty = false;
        unit.isPermanentCasualty = true;
        unit.status = 'downed';
        unit.isDestroyed = true;
        unit.currentHp = 0;
        registerCasualtyRecord(unit, false);
      } else {
        unit.currentHp = step.hpAfter;
        unit.listingAngle = 0.175;
        unit.staggerY = (unit.staggerY || 0) + 3;
        unit.damageSmokeParticles = true;
      }
    });

    const {atk, def} = recalculateSynergies(attackerUnitsRef.current, defenderUnitsRef.current);
    attackerUnitsRef.current = atk;
    defenderUnitsRef.current = def;
    setAttackerUnits(atk);
    setDefenderUnits(def);

    steps.forEach(({step, unit}, idx) => {
      scheduleSequenceTimeout(() => {
        if (step.result === 'destroyed') {
          applyCasualtyToUnit(unit, true);
          unit.isPermanentCasualty = true;
          unit.isPendingCasualty = false;
        } else {
          gameAudio.playShieldBlock();
        }
        const nextState = recalculateSynergies(attackerUnitsRef.current, defenderUnitsRef.current);
        attackerUnitsRef.current = nextState.atk;
        defenderUnitsRef.current = nextState.def;
        setAttackerUnits(nextState.atk);
        setDefenderUnits(nextState.def);
      }, idx * 150);
    });

    setPendingDefenderHits(0);

    if (steps.length > 0) {
      setCombatLog((prev) => [
        `AI Defender allocated ${steps.length} casualties to front ranks.`,
        ...prev.slice(0, 8),
      ]);
    }
  }, [pendingDefenderHits, scheduleSequenceTimeout]);

  // Player manual assignment by rank row click (marks unit as pending casualty)
  const handleAssignHitToFriendlyRank = (rankNum: number) => {
    const currentAtk = [...attackerUnitsRef.current];

    if (pendingAttackerHits > 0) {
      gameAudio.playCrispClick();
      // (BETA) Only pick from currently active units; permanent casualties from prior rounds never appear
      const rankUnits = currentAtk.filter(
        (u) => isCombatActive(u) && u.effectiveRank === rankNum,
      );
      if (rankUnits.length === 0) return;

      // Pick cheapest available unit within the selected rank
      rankUnits.sort((a, b) => {
        return compareByCostThenRank(a, b);
      });

      const target = rankUnits[0];
      if (resolveHit(target.currentHp, target.maxHp) === 'damaged') {
        target.currentHp -= 1;
        target.listingAngle = 0.175;
        target.staggerY = (target.staggerY || 0) + 3;
        target.damageSmokeParticles = true;
        gameAudio.playShieldBlock();
        setPendingAttackerHits((h) => Math.max(0, h - 1));
        const {atk, def} = recalculateSynergies(currentAtk, defenderUnitsRef.current);
        attackerUnitsRef.current = atk;
        setAttackerUnits([...atk]);
        return;
      }
      target.isPendingCasualty = true;
      target.isPermanentCasualty = false; // (BETA)
      target.status = 'downed';
      target.isDestroyed = true;
      target.currentHp = 0;
      target.fadeAlpha = 1.0;
      target.isFadingOut = false;
      registerCasualtyRecord(target, true);
      setPendingAttackerHits((h) => Math.max(0, h - 1));

      const {atk, def} = recalculateSynergies(currentAtk, defenderUnitsRef.current);
      attackerUnitsRef.current = atk;
      setAttackerUnits([...atk]);
    } else {
      // (BETA) Toggle unassign ONLY for currently pending casualties that are NOT permanent from prior rounds
      const pendingUnits = currentAtk.filter(
        (u) => u.isPendingCasualty && !u.isPermanentCasualty && u.effectiveRank === rankNum,
      );
      if (pendingUnits.length > 0) {
        gameAudio.playCrispClick();
        const pUnit = pendingUnits[0];
        pUnit.isPendingCasualty = false;
        pUnit.status = 'alive';
        pUnit.isDestroyed = false;
        pUnit.currentHp = pUnit.maxHp;
        pUnit.fadeAlpha = 1.0;
        pUnit.isFadingOut = false;

        // Remove unconfirmed casualty record & its small crater preview
        const pIdx = casualtyRecordsRef.current.findIndex((c) => c.unitUid === pUnit.uid && !c.isConfirmed);
        if (pIdx !== -1) {
          const removed = casualtyRecordsRef.current.splice(pIdx, 1)[0];
          const cIdx = cratersRef.current.findIndex(
            (c) =>
              c.casualtyUid === pUnit.uid ||
              (removed.craterId && c.id === removed.craterId) ||
              (c.isSmallCasualtyCrater && Math.hypot(c.x - removed.x, c.y - (removed.y + 3)) < 5),
          );
          if (cIdx !== -1) cratersRef.current.splice(cIdx, 1);
        }

        setPendingAttackerHits((h) => h + 1);

        const {atk, def} = recalculateSynergies(currentAtk, defenderUnitsRef.current);
        attackerUnitsRef.current = atk;
        setAttackerUnits([...atk]);
      }
    }
  };

  // Player clicks "AUTO-ASSIGN CHEAPEST" button (marks cheapest units as pending casualties)
  const handleAutoAssignFriendlyCasualties = useCallback(() => {
    if (pendingAttackerHits <= 0) return;
    gameAudio.playCrispClick();

    const currentAtk = [...attackerUnitsRef.current];
    // (BETA) Exclude permanent casualties from prior rounds
    const availableAttackers = currentAtk.filter(isCombatActive);

    const steps = assignHits(
      availableAttackers.map((u) => ({uid: u.uid, type: u.type, rank: u.effectiveRank, currentHp: u.currentHp, maxHp: u.maxHp})),
      pendingAttackerHits,
    );
    for (const step of steps) {
      const u = availableAttackers.find((unit) => unit.uid === step.uid)!;
      if (step.result === 'damaged') {
        u.currentHp = step.hpAfter;
        u.listingAngle = 0.175;
        u.staggerY = (u.staggerY || 0) + 3;
        u.damageSmokeParticles = true;
        continue;
      }
      u.isPendingCasualty = true;
      u.isPermanentCasualty = false;
      u.status = 'downed';
      u.isDestroyed = true;
      u.currentHp = 0;
      u.fadeAlpha = 1.0;
      u.isFadingOut = false;
      registerCasualtyRecord(u, false);
    }
    gameAudio.playInfantryGroan();

    setPendingAttackerHits(0);
    const {atk, def} = recalculateSynergies(currentAtk, defenderUnitsRef.current);
    attackerUnitsRef.current = atk;
    setAttackerUnits([...atk]);
  }, [pendingAttackerHits]);

  // Return to Combat action after Victory Sequence
  const handleReturnToCombat = useCallback(() => {
    gameAudio.playConfirmSelect();
    victorySeqRef.current = {
      active: false,
      stage: 'INACTIVE',
      elapsed: 0,
      flagElapsed: 0,
      blackFadeAlpha: 0,
      regionName: '',
    };
    setIsVictorySequenceActive(false);
    returnButtonRectRef.current = null;

    // Load next historical scenario or reset engagement for fresh combat
    const nextIdx = (currentScenarioIndex + 1) % SCENARIOS.length;
    loadScenario(nextIdx);
    setGameState((prev) => ({
      ...prev,
      status: 'PLAYING',
      level: prev.level + 1,
    }));
  }, [currentScenarioIndex, loadScenario]);

  // Attacker Victory Sequence Trigger:
  // 1. Fade out UI
  // 2. Friendly forces slowly advance forward and cheer; planes bank and climb out of sight
  // 3. Fade to black after ~3.5s
  // 4. Full-screen waving flag background in loop
  // 5. Center VICTORY modal expands with region name, emblems, and IPC counters
  // 6. "RETURN TO COMBAT" button fades in
  const triggerAttackerVictorySequence = useCallback(() => {
    clearSequenceTimeouts();
    setIsAutoRolling(false);
    setBattlePhase('VICTORY_SEQUENCE');
    setIsVictorySequenceActive(true);

    const scoreGain =
      defenderUnitsRef.current.filter((u) => u.status === 'downed' || u.isDestroyed).length * 150;
    setGameState((prev) => ({...prev, score: prev.score + scoreGain}));

    // Audio cue: victory fanfare, then enthusiastic bugle and soldier shouts chorus!
    gameAudio.playVictoryFanfare();
    scheduleSequenceTimeout(() => {
      gameAudio.playBugleChime();
      gameAudio.playSoldierCheer();
    }, 400);

    const theaterObj = THEATERS[currentTheaterRef.current];
    const regionName = currentTheaterRef.current === 'normandy'
      ? 'EUROPEAN TEST (COAST / FOREST)'
      : currentTheaterRef.current === 'navy_test'
      ? 'OPEN PACIFIC OCEAN (NAVY TEST)'
      : currentTheaterRef.current === 'air_strike_test'
      ? 'OPEN PACIFIC OCEAN (AIR STRIKE TEST)'
      : theaterObj.name
          .replace(' Bocage', '')
          .replace(' Snow', '')
          .replace(' Desert', '')
          .replace(' High Seas', ' Islands')
          .toUpperCase();

    victorySeqRef.current = {
      active: true,
      stage: 'CHEERING',
      elapsed: 0,
      flagElapsed: 0,
      blackFadeAlpha: 0,
      regionName,
    };

    // Mark surviving friendly units: land units advance & cheer; air units climb upward
    attackerUnitsRef.current.forEach((u) => {
      if (isCombatActive(u)) {
        u.victoryAdvanceX = 0;
        u.victoryAscentY = 0;
        if (u.type === 'infantry') {
          u.isCheering = true;
        }
      }
    });

    setCombatLog((prev) => [
      `🏆 VICTORY! All defending enemy forces eliminated!`,
      `Friendly vanguard cheering and advancing across ${regionName}.`,
      ...prev.slice(0, 8),
    ]);
  }, [clearSequenceTimeouts, scheduleSequenceTimeout]);

  // Debug Auto-Win Handler: eliminates all active defender units and triggers victory march
  const handleInstantKillDefenders = useCallback(() => {
    gameAudio.playCrispClick();
    defenderUnitsRef.current.forEach((u) => {
      u.currentHp = 0;
      u.status = 'downed';
      u.isDestroyed = true;
      u.isPendingCasualty = false; // (BETA)
      u.isPermanentCasualty = true; // (BETA)
      u.fadeAlpha = 1.0;
      registerCasualtyRecord(u, false);
    });
    setDefenderUnits([...defenderUnitsRef.current]);
    setPendingDefenderHits(0);
    triggerAttackerVictorySequence();
  }, [triggerAttackerVictorySequence]);

  // Finalize casualties on modal confirm: triggers downed transitions with distinct death SFX
  const handleFinalizeCasualties = useCallback(() => {
    gameAudio.playConfirmSelect();
    const currentAtk = [...attackerUnitsRef.current];
    // (BETA) Confirmed casualties permanently locked out of all future rounds
    const pendingUnits = currentAtk.filter((u) => u.isPendingCasualty && !u.isPermanentCasualty);

    // 1. CONFIRM ALL CASUALTIES AND ASSIGN INDIVIDUAL 3 - 20s TIMERS:
    // (BETA) Mark confirmed casualties as permanent so they NEVER reappear in future rounds
    pendingUnits.forEach((u) => {
      u.isPendingCasualty = false; // (BETA)
      u.isPermanentCasualty = true; // (BETA) permanent casualty exclusion
      u.status = 'downed'; // (BETA)
      u.isDestroyed = true; // (BETA)
      u.currentHp = 0; // (BETA)
    });
    const unconfirmed = casualtyRecordsRef.current.filter((c) => !c.isConfirmed);
    unconfirmed.forEach((rec) => {
      rec.isConfirmed = true;
      rec.isPermanent = false;
      rec.timeSinceConfirmed = 0;
      const individualTimer = 3.0 + Math.random() * 17.0; // Individual randomized timer: 3 - 20 seconds
      rec.fadeDuration = individualTimer;
      rec.spriteFadeDuration = individualTimer;
      rec.fluidFadeDuration = individualTimer;
      rec.spriteAlpha = 1.0;
      rec.fluidAlpha = 1.0;
      rec.smokeAlpha = 1.0;
      rec.craterAlpha = 1.0;

      // Link its associated casualty crater to this exact individual timer
      const matchedCrater = cratersRef.current.find(
        (cr) =>
          cr.casualtyUid === rec.unitUid ||
          (rec.craterId && cr.id === rec.craterId) ||
          (cr.isSmallCasualtyCrater && Math.hypot(cr.x - rec.x, cr.y - (rec.y + 3)) < 6),
      );
      if (matchedCrater) {
        matchedCrater.fadeTimer = individualTimer;
        matchedCrater.maxFadeTimer = individualTimer;
        matchedCrater.alpha = 1.0;
      }

      // Link any ground fire in the immediate vicinity to this casualty's timer
      groundFiresRef.current.forEach((f) => {
        if (Math.hypot(f.x - rec.x, f.y - rec.y) < 36) {
          f.fadeTimer = individualTimer;
          f.maxFadeTimer = individualTimer;
          f.alpha = 1.0;
        }
      });
    });

    // 2. All remaining dynamic craters from this round receive individual timers (3 - 20s)
    cratersRef.current.forEach((cr) => {
      if (cr.fadeTimer === undefined) {
        const craterTimer = 3.0 + Math.random() * 17.0; // 3 to 20 seconds
        cr.fadeTimer = craterTimer;
        cr.maxFadeTimer = craterTimer;
        cr.alpha = 1.0;
      }
    });

    // 3. All remaining ground fires receive individual timers (3 - 20s)
    groundFiresRef.current.forEach((f) => {
      if (f.fadeTimer === undefined) {
        const fireTimer = 3.0 + Math.random() * 17.0; // 3 to 20 seconds
        f.fadeTimer = fireTimer;
        f.maxFadeTimer = fireTimer;
        f.alpha = 1.0;
      }
    });

    // 4. Standalone blood puddles & smoke puffs also smoothly fade out
    bloodPuddlesRef.current.forEach((p) => {
      if (p.fadeTimer === undefined) {
        const puddleTimer = 3.0 + Math.random() * 17.0;
        p.fadeTimer = puddleTimer;
        p.maxFadeTimer = puddleTimer;
      }
    });

    smokePuffsRef.current.forEach((p) => {
      if (p.fadeTimer === undefined) {
        const smokeTimer = 2.5 + Math.random() * 3.5;
        p.fadeTimer = smokeTimer;
        p.maxFadeTimer = smokeTimer;
      }
    });

    // Transition all selected player casualties into downed state with distinct death audio
    pendingUnits.forEach((u, idx) => {
      scheduleSequenceTimeout(() => {
        applyCasualtyToUnit(u, true);
        const {atk, def} = recalculateSynergies(attackerUnitsRef.current, defenderUnitsRef.current);
        attackerUnitsRef.current = atk;
        defenderUnitsRef.current = def;
        setAttackerUnits(atk);
        setDefenderUnits(def);
      }, idx * 150);
    });

    const finalizeDelay = Math.max(250, pendingUnits.length * 150 + 200);

    scheduleSequenceTimeout(() => {
      const liveAtk = attackerUnitsRef.current.filter(isCombatActive).length;
      const liveDef = defenderUnitsRef.current.filter(isCombatActive).length;

      const scoreGain = defenderUnitsRef.current.filter((u) => u.status === 'downed' || u.isDestroyed).length * 150;
      setGameState((prev) => ({...prev, score: prev.score + scoreGain}));

      const outcome = battleOutcome(liveAtk, liveDef);
      if (outcome === 'attacker_wins') {
        triggerAttackerVictorySequence();
      } else if (outcome === 'defender_wins' || outcome === 'mutual') {
        setBattlePhase('IDLE');
        setIsAutoRolling(false);
        setGameState((prev) => ({...prev, status: outcome === 'mutual' ? 'MUTUAL' : 'GAME_OVER'}));
        gameAudio.playDefeatMotif();
        setCombatLog((prev) => [
          outcome === 'mutual'
            ? `Both sides are destroyed. The defender holds the ground.`
            : `\u2620 DEFEAT: Friendly attacking vanguard broken!`,
          ...prev.slice(0, 8),
        ]);
      } else {
        // As Attacker, enter decision phase with RETREAT (blue) and PRESS ON (red) flanking the dice tray!
        setBattlePhase('ATTACKER_DECISION');
        setRankStepState('READY_TO_FIRE');
        setIsAutoRolling(false);
        setCombatLog((prev) => [
          `Casualties confirmed. Round ${roundNumber} concluded.`,
          `ATTACKER COMMAND: Choose RETREAT (blue) or PRESS ON (red) to continue.`,
          ...prev.slice(0, 8),
        ]);
      }
    }, finalizeDelay);
  }, [roundNumber, scheduleSequenceTimeout]);

  // Helper to check if a specific side and rank has living, un-downed units to fire
  const toFiringUnit = (u: CombatUnit) => ({
    type: u.type,
    active: isCombatActive(u),
    effectiveRank: u.effectiveRank,
    hasFiredThisRound: u.hasFiredThisRound,
    carrierFightersFired: u.carrierFightersFiredThisRound,
  });

  const hasActiveUnitsInRank = (side: 'attacker' | 'defender', rankNum: number): boolean => {
    const units = (side === 'attacker' ? attackerUnitsRef.current : defenderUnitsRef.current).map(toFiringUnit);
    return rankCanFire(units, side, rankNum, currentTheaterRef.current);
  };

  // Finds the next phase that actually has units to fire, automatically skipping empty ranks!
  const getNextActiveCombatPhase = useCallback((current: BattlePhase): BattlePhase => {
    return nextCombatPhase({
      theater: currentTheaterRef.current,
      round: roundNumberRef.current,
      current,
      aaResolved: hasExecutedAAInterceptionRef.current,
      shoreFired: offshoreBattleshipRef.current.hasFired,
      attackers: attackerUnitsRef.current.map(toFiringUnit),
      defenders: defenderUnitsRef.current.map(toFiringUnit),
    });
  }, []);

  // Player Attacker Decision Handlers
  const handlePressOn = useCallback(() => {
    gameAudio.playConfirmSelect();
    setRoundNumber((r) => r + 1);
    // (BETA) Permanent casualty exclusion: only reset units that are alive and not permanent casualties
    attackerUnitsRef.current.forEach((u) => {
      if (isCombatActive(u)) { // (BETA)
        u.hasFiredThisRound = false;
        u.carrierFightersFiredThisRound = false;
        if (u.type === 'carrier') {
          u.planesCarried = u.maxPlanesCarried || 2;
        }
      }
    });
    defenderUnitsRef.current.forEach((u) => {
      if (isCombatActive(u)) { // (BETA)
        u.hasFiredThisRound = false;
        u.carrierFightersFiredThisRound = false;
        if (u.type === 'carrier') {
          u.planesCarried = u.maxPlanesCarried || 2;
        }
      }
    });
    const firstActive = getNextActiveCombatPhase('IDLE');
    setBattlePhase(firstActive);
    setRankStepState('READY_TO_FIRE');
    setRankSubPhase('IDLE');
    attackerHitsRef.current = 0;
    defenderHitsRef.current = 0;
    setPendingAttackerHits(0);
    setPendingDefenderHits(0);
    setLastVolleySummary(`Round ${roundNumber + 1}: Attacker vanguard advancing!`);
    activeDiceRef.current = [];
    // Reset "YOUR LAST HITS" tracker for new round's shooting turn
    playerAttackShootingCompleteRef.current = false;
    lastPlayerHitsRef.current = null;
    setLastPlayerHits(null);
    setCombatLog((prev) => [
      `Commander ordered: PRESS ON! Commencing Round ${roundNumber + 1}.`,
      ...prev.slice(0, 8),
    ]);
  }, [getNextActiveCombatPhase, roundNumber]);

  const handleRetreatDecision = useCallback(() => {
    gameAudio.playCrispClick();
    setIsAutoRolling(false);
    setBattlePhase('IDLE');
    setGameState((prev) => ({...prev, status: 'RETREATED'}));
    setCombatLog((prev) => [
      `Attacking forces withdraw. The defender holds the ground.`,
      ...prev.slice(0, 8),
    ]);
  }, []);

  // Auto-allocate casualties legacy handler (router to auto friendly + defender)
  const handleAutoAssignCasualties = useCallback(() => {
    if (pendingDefenderHits > 0) {
      autoAssignDefenderCasualties();
    }
    if (pendingAttackerHits > 0) {
      handleAutoAssignFriendlyCasualties();
    }
    handleFinalizeCasualties();
  }, [
    pendingDefenderHits,
    pendingAttackerHits,
    autoAssignDefenderCasualties,
    handleAutoAssignFriendlyCasualties,
    handleFinalizeCasualties,
  ]);

  // Single unit fire trigger with lowest-value priority target
  const fireSingleUnit = (
    u: CombatUnit,
    targetValue: number,
    dieResult: DiceResult | undefined,
    targetEnemy?: CombatUnit,
  ) => {
    u.animRecoil = 1;
    const pos = getUnitScreenPos(u);
    const isAtk = u.side === 'attacker';
    const muzzleX = isAtk ? pos.x + 22 : pos.x - 22;
    const muzzleY = pos.y - 2;

    const isHit = dieResult ? dieResult.isHit : false;

    // TARGETING LOGIC:
    // Uses prioritized target unit (sorted by lowest value/rank first).
    // NEVER aims at empty rows or destroyed/downed units!
    let targetX: number;
    let targetY: number;

    if (targetEnemy) {
      const ePos = getUnitScreenPos(targetEnemy);
      if (isHit) {
        // Confirmed hit directly on the enemy unit in its populated row
        targetX = ePos.x + (Math.random() - 0.5) * 6;
        targetY = ePos.y + (Math.random() - 0.5) * 6;
      } else {
        // Clean miss: directed into the same populated enemy row, but landing in dirt nearby
        const missOffset = isAtk ? 18 + Math.random() * 12 : -18 - Math.random() * 12;
        targetX = ePos.x + missOffset;
        targetY = ePos.y + (Math.random() - 0.5) * 12;
      }
    } else {
      targetX = isAtk ? 920 : 360;
      targetY = pos.y;
    }

    // 1. Procedural SFX & firing mechanics by unit type
    if (u.type === 'submarine') {
      gameAudio.playTorpedoWhoosh();
      spawnShell(
        muzzleX,
        muzzleY,
        targetX,
        targetY,
        PALETTE.sandCream,
        isHit,
        u.type,
        isAtk ? 'defender' : 'attacker',
        true, // isTorpedo
      );
      return;
    } else if (u.type === 'carrier') {
      // Aircraft Carrier Firing Sequence:
      // 1. Nudges forward and discharges secondary deck guns / flak (with muzzle puff/sound)
      gameAudio.playGunshotBlast();
      spawnSmoke(muzzleX, muzzleY, 6, 16, PALETTE.trenchMudBone, 4.5, 'muzzle_small');
      spawnSmoke(muzzleX + (isAtk ? 4 : -4), muzzleY - 2, 5, 12, PALETTE.deepTaupe, 4.0, 'muzzle_small');
      for (let e = 0; e < 8; e++) {
        sparksRef.current.push({
          x: muzzleX,
          y: muzzleY,
          vx: (isAtk ? 1 : -1) * (40 + Math.random() * 50),
          vy: (Math.random() - 0.5) * 30,
          life: 0.35 + Math.random() * 0.3,
          maxLife: 0.65,
          color: PALETTE.mustardBrass,
          size: 2.5,
        });
      }

      // Shell / flak tracer from secondary deck guns toward target
      spawnShell(
        muzzleX,
        muzzleY,
        targetX,
        targetY,
        isAtk ? PALETTE.sandCream : PALETTE.terracotta,
        isHit,
        'carrier',
        isAtk ? 'defender' : 'attacker',
      );

      // 2. Carrier launches active fighter plane sortie from its flight deck
      const currentPlanes = u.planesCarried !== undefined ? u.planesCarried : 2;
      if (currentPlanes > 0) {
        u.planesCarried = Math.max(0, currentPlanes - 1);
        gameAudio.playPlaneEngineFlyby(3.8 / (speedMultiplierRef.current || 1), false);
        activeSortiesRef.current.push({
          id: `sortie_carrier_${u.uid}_${Math.random()}`,
          unitUid: u.uid,
          side: u.side,
          unitType: 'fighter',
          homeX: pos.x + (isAtk ? 14 : -14),
          homeY: pos.y - 8,
          currentX: pos.x + (isAtk ? 14 : -14),
          currentY: pos.y - 8,
          currentRot: 0,
          progress: 0,
          duration: 3.8,
          isHit,
          bombsDropped: 0,
          bulletBurstsFired: 0,
          targetX,
          targetY,
        });
      }

      // 3. Attacking Carrier floats back to Rank III position slowly and smoothly (-210px astern)
      if (isAtk && currentTheaterRef.current === 'navy_test') {
        u.carrierFloatState = 'FLOATING_BACK';
        u.carrierFloatTargetX = -210;
      }
      return;
    } else if (u.type === 'infantry') {
      gameAudio.playRifleCrack();
      spawnSmoke(muzzleX, muzzleY, 5, 14, PALETTE.trenchMudBone, 4.5, 'muzzle_small');
      spawnSmoke(muzzleX + 4, muzzleY - 2, 4, 10, PALETTE.deepTaupe, 4.0, 'muzzle_small');
    } else if (u.type === 'artillery') {
      gameAudio.playArtilleryBoom();
      for (let s = 0; s < 8; s++) {
        spawnSmoke(
          muzzleX + (Math.random() - 0.5) * 12,
          muzzleY + (Math.random() - 0.5) * 8,
          8,
          32,
          s % 3 === 0 ? PALETTE.bunkerCharcoal : s % 3 === 1 ? PALETTE.deepTaupe : PALETTE.trenchMudBone,
          8.5,
          'muzzle_heavy',
        );
      }
    } else if (u.type === 'tank') {
      gameAudio.playTankBlast();
      for (let s = 0; s < 7; s++) {
        spawnSmoke(
          muzzleX + (Math.random() - 0.5) * 10,
          muzzleY + (Math.random() - 0.5) * 8,
          7,
          26,
          s % 3 === 0 ? PALETTE.bunkerCharcoal : s % 3 === 1 ? PALETTE.deepTaupe : PALETTE.trenchMudBone,
          7.5,
          'muzzle_heavy',
        );
      }
    } else if (u.type === 'fighter') {
      gameAudio.playFighterGuns();
      spawnSmoke(muzzleX, muzzleY, 4, 12, PALETTE.trenchMudBone, 3.8, 'muzzle_small');
    } else if (u.type === 'tactical_bomber' || u.type === 'strategic_bomber') {
      gameAudio.playBomberWhistleDrop();
    } else if (u.type === 'battleship') {
      gameAudio.playNavalSalvo();
      screenShakeRef.current = 14;
      for (let s = 0; s < 12; s++) {
        spawnSmoke(
          muzzleX + (Math.random() - 0.5) * 16,
          muzzleY + (Math.random() - 0.5) * 12,
          10,
          38,
          s % 3 === 0 ? PALETTE.bunkerCharcoal : s % 3 === 1 ? PALETTE.deepTaupe : PALETTE.trenchMudBone,
          9.5,
          'muzzle_heavy',
        );
      }
    } else if (UNIT_DEFINITIONS[u.type].category === 'sea') {
      gameAudio.playNavalSalvo();
      for (let s = 0; s < 9; s++) {
        spawnSmoke(
          muzzleX + (Math.random() - 0.5) * 14,
          muzzleY + (Math.random() - 0.5) * 10,
          9,
          34,
          s % 3 === 0 ? PALETTE.bunkerCharcoal : s % 3 === 1 ? PALETTE.deepTaupe : PALETTE.trenchMudBone,
          9.0,
          'muzzle_heavy',
        );
      }
    } else if (u.type === 'aaa') {
      gameAudio.playRifleCrack();
      spawnSmoke(muzzleX, muzzleY, 5, 16, PALETTE.trenchMudBone, 4.5, 'muzzle_small');
    }

    // Muzzle flash sparks
    for (let e = 0; e < 6; e++) {
      sparksRef.current.push({
        x: muzzleX,
        y: muzzleY,
        vx: (isAtk ? 1 : -1) * (35 + Math.random() * 55),
        vy: (Math.random() - 0.5) * 35,
        life: 0.3 + Math.random() * 0.3,
        maxLife: 0.6,
        color: PALETTE.mustardBrass,
        size: 2.5,
      });
    }

    // 2. Air units launch deliberate, readable PlaneSortie swoops (3.8s duration)
    if (UNIT_DEFINITIONS[u.type].category === 'air') {
      const isBomber = u.type === 'tactical_bomber' || u.type === 'strategic_bomber';
      gameAudio.playPlaneEngineFlyby(3.8 / (speedMultiplierRef.current || 1), isBomber);

      activeSortiesRef.current.push({
        id: `sortie_${u.uid}_${Math.random()}`,
        unitUid: u.uid,
        side: u.side,
        unitType: u.type as 'fighter' | 'tactical_bomber' | 'strategic_bomber',
        homeX: pos.x,
        homeY: pos.y,
        currentX: pos.x,
        currentY: pos.y,
        currentRot: 0,
        progress: 0,
        duration: 3.8, // Slower flight speed for deliberate readability
        isHit,
        bombsDropped: 0,
        bulletBurstsFired: 0,
        targetX,
        targetY,
      });
      return;
    }

    // 3. Land & Sea units launch shell trajectories
    const shellColor = isAtk ? PALETTE.sandCream : PALETTE.terracotta;

    spawnShell(
      muzzleX,
      muzzleY,
      targetX,
      targetY,
      shellColor,
      isHit,
      u.type,
      isAtk ? 'defender' : 'attacker',
    );
  };

  // Advance to Next Rank (Automatically skips empty ranks directly to the next populated rank)
  const advanceToNextRank = useCallback(() => {
    gameAudio.playCrispClick();
    clearSequenceTimeouts();
    const current = battlePhaseRef.current;
    const nextPhase = getNextActiveCombatPhase(current);

    setBattlePhase(nextPhase);
    setRankStepState('READY_TO_FIRE');
    setRankSubPhase('IDLE');
    setLastVolleySummary('');
    activeDiceRef.current = [];

    if (nextPhase === 'ALLOCATION') {
      setLastVolleySummary('All salvos complete! Allocate round casualties.');
      autoAssignDefenderCasualties();
      // Record player hits for the round tracker once attacking is done
      lastPlayerHitsRef.current = attackerHitsRef.current;
      setLastPlayerHits(attackerHitsRef.current);
      playerAttackShootingCompleteRef.current = true;
      setCombatLog((prev) => [
        `Round salvos complete! Defending AI allocated casualties. Assign friendly casualties or click Auto-Assign.`,
        ...prev.slice(0, 8),
      ]);
    } else if (nextPhase.startsWith('DEF_') && current.startsWith('ATK_')) {
      // Attacker offensive complete! Record hits for tracker
      lastPlayerHitsRef.current = attackerHitsRef.current;
      setLastPlayerHits(attackerHitsRef.current);
      playerAttackShootingCompleteRef.current = true;
      setLastVolleySummary('Attacker offensive complete. Defender returning fire!');
      setCombatLog((prev) => [
        `All Attacker ranks have fired. Defenders prepare return salvo!`,
        ...prev.slice(0, 8),
      ]);
    }
  }, [clearSequenceTimeouts, getNextActiveCombatPhase, autoAssignDefenderCasualties]);

  // SEQUENTIAL PHASE COMBAT: One side fires row by row!
  // Empty ranks are automatically skipped without blocking or requiring useless rolls!
  const executeActiveSalvo = useCallback(
    (side: 'attacker' | 'defender', rankNumber: number, isSurpriseStrike = false) => {
      clearSequenceTimeouts();
      const isNavyTest = currentTheaterRef.current === 'navy_test';

      let shooters: CombatUnit[] = [];
      if (isSurpriseStrike) {
        shooters = (side === 'attacker' ? attackerUnitsRef.current : defenderUnitsRef.current).filter(
          (u) => isCombatActive(u) && u.type === 'submarine' && !u.hasFiredThisRound,
        );
      } else if (isNavyTest && side === 'defender' && rankNumber === 4) {
        // In NAVY TEST Rank IV: Battleships & Defending Fighters (launched from Carriers at Rank IV <= 4)
        shooters = defenderUnitsRef.current.filter(
          (u) => isCombatActive(u) && ((u.effectiveRank === 4 && !u.hasFiredThisRound) || (u.type === 'carrier' && !u.carrierFightersFiredThisRound)),
        );
      } else {
        shooters = (side === 'attacker' ? attackerUnitsRef.current : defenderUnitsRef.current).filter(
          (u) => isCombatActive(u) && u.effectiveRank === rankNumber && !u.hasFiredThisRound,
        );
      }

      const targetValue = rankNumber;
      const rankRoman = ['I', 'II', 'III', 'IV'][rankNumber - 1] || 'I';
      const sideName = side === 'attacker' ? 'Attacker' : 'Defender';

      // If no shooters in this rank for this side, automatically skip immediately!
      if (shooters.length === 0) {
        const emptyMsg = isSurpriseStrike
          ? `${sideName} Submarines: No Surprise Strike available.`
          : `${sideName} Rank ${rankRoman}: Empty rank automatically skipped.`;
        setLastVolleySummary(emptyMsg);
        setCombatLog((prev) => [emptyMsg, ...prev.slice(0, 8)]);
        advanceToNextRank();
        return;
      }

      setRankStepState('FIRING');
      setRankSubPhase('ROLLING');

      // If Attacker Carrier firing at Rank 1 from Rank III, glide forward to Rank 1
      if (side === 'attacker' && rankNumber === 1) {
        shooters.forEach((u) => {
          if (u.type === 'carrier' && (u.carrierFloatX || 0) < 0) {
            u.carrierFloatState = 'MOVING_FORWARD';
            u.carrierFloatTargetX = 0;
          }
        });
      }

      // TARGETING PRIORITY:
      // Sort surviving enemies strictly by lowest unit cost / rank value first!
      const enemyUnits = (side === 'attacker' ? defenderUnitsRef.current : attackerUnitsRef.current).filter(
        isCombatActive,
      );
      const sortedEnemies = [...enemyUnits].sort((a, b) => {
        return compareByCostThenRank(a, b);
      });

      // Roll dice for active side in the bottom sea tray
      const newDice: DiceResult[] = [];
      let totalHits = 0;
      shooters.forEach((u, i) => {
        const roll = diceRef.current();
        const isHit = hitsOn(roll, targetValue);
        if (isHit) totalHits++;

        // Tray coordinates at bottom sea (X: 496..784, Y: 544..694)
        const colSpread = (i % 7) * 36;
        const spawnX = side === 'attacker' ? 512 + colSpread : 638 + colSpread;
        const spawnY = 544 + Math.floor(i / 7) * 14;

        newDice.push({
          dieId: `dice_${side}_${u.uid}_${Math.random()}`,
          unitUid: u.uid,
          side,
          unitType: u.type,
          targetRank: targetValue,
          rolledValue: roll,
          displayedValue: Math.floor(Math.random() * 6) + 1,
          faceCycleTimer: 0,
          isHit,
          x: spawnX,
          y: spawnY,
          vx: (Math.random() - 0.5) * 60,
          vy: 160 + Math.random() * 110,
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 18,
          settled: false,
          hitFlashTimer: 0,
          hasTriggeredHitVfx: false,
        });
      });

      activeDiceRef.current = newDice;
      diceRattleTimerRef.current = 0;
      gameAudio.playDiceRattle();

      // Trigger anticipation on units of this side while dice roll
      shooters.forEach((u) => {
        u.animAnticipation = 1;
      });

      const ROLL_ANTICIPATION_MS = 1200;
      const STAGGER_DELAY_MS = 130;

      // After roll window: settle dice, play hitmarker ticks for hits, and start staggered sequential firing
      scheduleSequenceTimeout(() => {
        newDice.forEach((d) => {
          d.settled = true;
          d.displayedValue = d.rolledValue;
          if (d.isHit && !d.hasTriggeredHitVfx) {
            d.hasTriggeredHitVfx = true;
            d.hitFlashTimer = 1.0;
            gameAudio.playStrongHitGong();
            spawnSparks(d.x, d.y, 12);
          }
        });
        shooters.forEach((u) => {
          u.animAnticipation = 0;
          if (isNavyTest && side === 'defender' && rankNumber === 4 && u.type === 'carrier') {
            u.carrierFightersFiredThisRound = true;
          } else {
            u.hasFiredThisRound = true;
          }
        });
        setRankSubPhase('FIRING');

        // Order units for staggered fire (outer rearguard to frontline)
        const sortedShooters = [...shooters].sort((a, b) =>
          side === 'attacker' ? a.colIndex - b.colIndex : b.colIndex - a.colIndex,
        );

        sortedShooters.forEach((u, idx) => {
          scheduleSequenceTimeout(() => {
            const dieRes = newDice.find((d) => d.unitUid === u.uid);
            const targetEnemy = sortedEnemies.length > 0
              ? sortedEnemies[idx % sortedEnemies.length]
              : undefined;

            fireSingleUnit(u, targetValue, dieRes, targetEnemy);
          }, idx * STAGGER_DELAY_MS);
        });

        // SUBMARINE SURPRISE STRIKE (OPENING SALVO) IMMEDIATE CASUALTY RESOLUTION:
        // Any hits scored immediately remove enemy units as casualties BEFORE normal ranks!
        if (isSurpriseStrike && totalHits > 0) {
          scheduleSequenceTimeout(() => {
            const plan = assignHits(
              sortedEnemies.map((u) => ({uid: u.uid, type: u.type, rank: u.effectiveRank, currentHp: u.currentHp, maxHp: u.maxHp})),
              totalHits,
            );
            for (const step of plan) {
              const victim = sortedEnemies.find((u) => u.uid === step.uid)!;
              if (step.result === 'destroyed') victim.isPermanentCasualty = true;
              applyCasualtyToUnit(victim, true);
              if (step.result === 'destroyed') victim.isPendingCasualty = false;
            }
            const nextState = recalculateSynergies(attackerUnitsRef.current, defenderUnitsRef.current);
            attackerUnitsRef.current = nextState.atk;
            defenderUnitsRef.current = nextState.def;
            setAttackerUnits(nextState.atk);
            setDefenderUnits(nextState.def);

            setCombatLog((prev) => [
              `⚡ SUBMARINE SURPRISE STRIKE: ${totalHits} hit(s) scored! Casualties removed BEFORE returning fire!`,
              ...prev.slice(0, 8),
            ]);
          }, sortedShooters.length * STAGGER_DELAY_MS + 400);
        }

        // Wait for all projectiles and plane swoops to impact
        const totalDuration = sortedShooters.length * STAGGER_DELAY_MS + 1200;
        scheduleSequenceTimeout(() => {
          setRankSubPhase('IDLE');
          setRankStepState('RESOLVED');
          const summary = isSurpriseStrike
            ? `⚡ ${sideName} Submarine Surprise Strike: ${shooters.length}d6 (${totalHits} Hits scored)`
            : `${sideName} Rank ${rankRoman} Salvo: ${shooters.length}d6 (${totalHits} Hits inflicted)`;
          setLastVolleySummary(summary);
          setCombatLog((prev) => [summary, ...prev.slice(0, 8)]);

          // If this was an attacker salvo, check if attacker has concluded all their shooting for this round
          if (side === 'attacker') {
            let hasMoreAttackerShooters = false;
            for (let r = rankNumber + 1; r <= 4; r++) {
              if (hasActiveUnitsInRank('attacker', r)) {
                hasMoreAttackerShooters = true;
                break;
              }
            }
            if (!hasMoreAttackerShooters) {
              lastPlayerHitsRef.current = attackerHitsRef.current;
              setLastPlayerHits(attackerHitsRef.current);
              playerAttackShootingCompleteRef.current = true;
            }
          }
        }, totalDuration);
      }, ROLL_ANTICIPATION_MS);
    },
    [clearSequenceTimeouts, scheduleSequenceTimeout, advanceToNextRank],
  );

  // Defending Flak Gun Anti-Air Interception Salvo (AA ATTACK)
  // Each defending AA gun fires up to 3 dice/shots total, but at most 1 shot per enemy air unit.
  // In Axis & Allies, AA guns hit on a roll of 1 (<= 1).
  const executeAntiAirInterception = useCallback(() => {
    clearSequenceTimeouts();
    hasExecutedAAInterceptionRef.current = true;
    setRankStepState('FIRING');
    setRankSubPhase('ROLLING');

    const aaGuns = defenderUnitsRef.current.filter((u) => isCombatActive(u) && u.type === 'aaa');
    const airUnits = attackerUnitsRef.current.filter(
      (u) => isCombatActive(u) && UNIT_DEFINITIONS[u.type].category === 'air',
    );

    // Prioritize air units by cost / rank (cheapest first)
    const sortedAirUnits = [...airUnits].sort((a, b) => {
      return compareByCostThenRank(a, b);
    });

    const totalShots = aaShotCount(aaGuns.length, sortedAirUnits.length);

    if (totalShots === 0) {
      advanceToNextRank();
      return;
    }

    const targetValue = 1; // Standard Axis & Allies rule: AA guns hit on <= 1
    const newDice: DiceResult[] = [];
    let hitsCount = 0;

    for (let i = 0; i < totalShots; i++) {
      const roll = diceRef.current();
      const isHit = hitsOn(roll, targetValue);
      if (isHit) hitsCount++;

      const gun = aaGuns[i % aaGuns.length];
      const colSpread = (i % 7) * 36;
      const spawnX = 638 + colSpread;
      const spawnY = 544 + Math.floor(i / 7) * 14;

      newDice.push({
        dieId: `dice_aa_${i}_${Math.random()}`,
        unitUid: gun.uid,
        side: 'defender',
        unitType: 'aaa',
        targetRank: targetValue,
        rolledValue: roll,
        displayedValue: Math.floor(Math.random() * 6) + 1,
        faceCycleTimer: 0,
        isHit,
        x: spawnX,
        y: spawnY,
        vx: (Math.random() - 0.5) * 50,
        vy: 170 + Math.random() * 90,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 16,
        settled: false,
        hitFlashTimer: 0,
        hasTriggeredHitVfx: false,
      });
    }

    activeDiceRef.current = newDice;
    diceRattleTimerRef.current = 0;
    gameAudio.playDiceRattle();

    // Elevate Flak gun barrels skyward
    aaGuns.forEach((g) => {
      g.animAnticipation = 1;
    });

    const ROLL_ANTICIPATION_MS = 1200;
    const STAGGER_DELAY_MS = 340;

    scheduleSequenceTimeout(() => {
      newDice.forEach((d) => {
        d.settled = true;
        d.displayedValue = d.rolledValue;
        if (d.isHit && !d.hasTriggeredHitVfx) {
          d.hasTriggeredHitVfx = true;
          d.hitFlashTimer = 1.0;
          gameAudio.playStrongHitGong();
          spawnSparks(d.x, d.y, 12);
        }
      });

      aaGuns.forEach((g) => {
        g.animAnticipation = 0;
      });

      setRankSubPhase('FIRING');

      // Staggered flak bursts
      for (let i = 0; i < totalShots; i++) {
        const shotIdx = i;
        const targetPlane = sortedAirUnits[shotIdx];
        const shooterGun = aaGuns[shotIdx % aaGuns.length];
        const dieRes = newDice[shotIdx];
        const isHit = dieRes.isHit;

        scheduleSequenceTimeout(() => {
          shooterGun.animRecoil = 1;
          gameAudio.playAaaFlakFire();

          const gunPos = getUnitScreenPos(shooterGun);
          const planePos = getUnitScreenPos(targetPlane);
          const muzzleX = gunPos.x - 14;
          const muzzleY = gunPos.y - 10;

          // Muzzle sparks at Flak gun
          for (let e = 0; e < 6; e++) {
            sparksRef.current.push({
              x: muzzleX,
              y: muzzleY,
              vx: -30 - Math.random() * 50,
              vy: -20 - Math.random() * 30,
              life: 0.3 + Math.random() * 0.25,
              maxLife: 0.55,
              color: PALETTE.mustardBrass,
              size: 2.5,
            });
          }

          // Flak tracer projectile arcing high into the sky towards plane
          spawnShell(
            muzzleX,
            muzzleY,
            planePos.x,
            planePos.y,
            PALETTE.terracotta,
            isHit,
            'aaa',
            'attacker',
          );

          // Sky flak burst timing
          scheduleSequenceTimeout(() => {
            gameAudio.playFlakBurstSky();

            // Black flak burst smoke clouds in the sky
            spawnSmoke(
              planePos.x + (Math.random() - 0.5) * 14,
              planePos.y - 4 + (Math.random() - 0.5) * 8,
              8,
              26,
              PALETTE.bunkerCharcoal,
              6.5,
              'impact_explosion',
            );
            spawnSmoke(
              planePos.x + 8,
              planePos.y - 12,
              6,
              20,
              PALETTE.deepTaupe,
              5.0,
              'impact_explosion',
            );

            // Shrapnel sparks & shockwave in sky
            spawnSparks(planePos.x, planePos.y, 14);
            shockwavesRef.current.push({
              x: planePos.x,
              y: planePos.y,
              radius: 4,
              maxRadius: 24,
              life: 0.35,
              maxLife: 0.35,
              color: PALETTE.mustardBrass,
            });

            if (isHit) {
              gameAudio.playTacticalHitBeep();
              gameAudio.playMetalCrunch();
              spawnFlyingDebris(planePos.x, planePos.y, 'shrapnel');
              screenShakeRef.current = 10;

              // Floating +HIT text above hit aircraft
              floatingTextsRef.current.push({
                id: `hit_plane_${Math.random()}`,
                x: Math.round(planePos.x),
                y: Math.round(planePos.y - 8),
                vy: -32,
                text: '+HIT',
                life: 1.3,
                maxLife: 1.3,
                color: PALETTE.crimson,
                accentColor: PALETTE.plum,
              });

              // Increment confirmed hits counter
              lastHitTimeRef.current = gameTimeRef.current;
              defenderHitsRef.current += 1;
              setPendingDefenderHits(defenderHitsRef.current);

              // Target plane emits damage smoke
              targetPlane.damageSmokeParticles = true;
              targetPlane.planeSmokeTimer = 0.2;
            }
          }, 360);
        }, shotIdx * STAGGER_DELAY_MS);
      }

      const totalDelay = totalShots * STAGGER_DELAY_MS + 850;
      scheduleSequenceTimeout(() => {
        setRankSubPhase('IDLE');
        setRankStepState('RESOLVED');

        const summary =
          hitsCount > 0
            ? `⚡ DEFENDING FLAK: ${totalShots} shots fired (${hitsCount} Hit${hitsCount > 1 ? 's' : ''} scored!)`
            : `Defending Flak: ${totalShots} shots fired (0 Hits). Incoming air wing clear!`;
        setLastVolleySummary(summary);
        setCombatLog((prev) => [summary, ...prev.slice(0, 8)]);

        if (hitsCount > 0) {
          // Transition to early AA ATTACK CASUALTIES screen
          scheduleSequenceTimeout(() => {
            setPendingAaHits(hitsCount);
            setBattlePhase('AA_ALLOCATION');
            setRankStepState('READY_TO_FIRE');
          }, 600);
        }
      }, totalDelay);
    }, ROLL_ANTICIPATION_MS);
  }, [clearSequenceTimeouts, scheduleSequenceTimeout, advanceToNextRank]);

  // Early AA Casualty Allocation Handlers
  const handleAssignHitToAirUnit = useCallback((type: UnitType) => {
    const currentAtk = [...attackerUnitsRef.current];

    if (pendingAaHits > 0) {
      gameAudio.playCrispClick();
      const availablePlanes = currentAtk.filter(
        (u) => isCombatActive(u) && u.type === type && UNIT_DEFINITIONS[u.type].category === 'air',
      );
      if (availablePlanes.length === 0) return;

      const target = availablePlanes[0];
      target.isPendingCasualty = true;
      target.isPermanentCasualty = false;
      target.status = 'downed';
      target.isDestroyed = true;
      target.currentHp = 0;
      target.fadeAlpha = 1.0;
      target.isFadingOut = false;
      registerCasualtyRecord(target, true);
      setPendingAaHits((h) => Math.max(0, h - 1));

      const {atk, def} = recalculateSynergies(currentAtk, defenderUnitsRef.current);
      attackerUnitsRef.current = atk;
      setAttackerUnits([...atk]);
    } else {
      // Toggle unassign
      const pendingPlanes = currentAtk.filter(
        (u) => u.isPendingCasualty && !u.isPermanentCasualty && u.type === type,
      );
      if (pendingPlanes.length > 0) {
        gameAudio.playCrispClick();
        const pPlane = pendingPlanes[0];
        pPlane.isPendingCasualty = false;
        pPlane.status = 'alive';
        pPlane.isDestroyed = false;
        pPlane.currentHp = pPlane.maxHp;
        pPlane.fadeAlpha = 1.0;

        const pIdx = casualtyRecordsRef.current.findIndex((c) => c.unitUid === pPlane.uid && !c.isConfirmed);
        if (pIdx !== -1) {
          casualtyRecordsRef.current.splice(pIdx, 1);
        }

        setPendingAaHits((h) => h + 1);

        const {atk, def} = recalculateSynergies(currentAtk, defenderUnitsRef.current);
        attackerUnitsRef.current = atk;
        setAttackerUnits([...atk]);
      }
    }
  }, [pendingAaHits]);

  const handleAutoAssignAaCasualties = useCallback(() => {
    if (pendingAaHits <= 0) return;
    gameAudio.playCrispClick();

    const currentAtk = [...attackerUnitsRef.current];
    const airUnits = currentAtk.filter(
      (u) => isCombatActive(u) && UNIT_DEFINITIONS[u.type].category === 'air',
    );

    // Lowest cost first (Fighters $10, Tac Bombers $11, Strat Bombers $12)
    airUnits.sort((a, b) => {
      return compareByCostThenRank(a, b);
    });

    let remaining = pendingAaHits;
    for (const u of airUnits) {
      if (remaining <= 0) break;
      u.isPendingCasualty = true;
      u.isPermanentCasualty = false;
      u.status = 'downed';
      u.isDestroyed = true;
      u.currentHp = 0;
      registerCasualtyRecord(u, false);
      remaining--;
    }
    gameAudio.playMetalCrunch();

    setPendingAaHits(0);
    const {atk, def} = recalculateSynergies(currentAtk, defenderUnitsRef.current);
    attackerUnitsRef.current = atk;
    setAttackerUnits([...atk]);
  }, [pendingAaHits]);

  const handleFinalizeAaCasualties = useCallback(() => {
    gameAudio.playConfirmSelect();
    const currentAtk = [...attackerUnitsRef.current];
    const pendingPlanes = currentAtk.filter(
      (u) => u.isPendingCasualty && !u.isPermanentCasualty && UNIT_DEFINITIONS[u.type].category === 'air',
    );

    // Permanently eliminate selected aircraft casualties from play!
    // They cannot participate in or fire during subsequent bombardment or regular combat rounds.
    pendingPlanes.forEach((p) => {
      p.isPendingCasualty = false;
      p.isPermanentCasualty = true;
      p.status = 'downed';
      p.isDestroyed = true;
      p.currentHp = 0;
    });

    const unconfirmed = casualtyRecordsRef.current.filter((c) => !c.isConfirmed);
    unconfirmed.forEach((rec) => {
      rec.isConfirmed = true;
      rec.isPermanent = false;
      rec.timeSinceConfirmed = 0;
      const individualTimer = 3.0 + Math.random() * 17.0;
      rec.fadeDuration = individualTimer;
      rec.spriteFadeDuration = individualTimer;
      rec.fluidFadeDuration = individualTimer;
      rec.spriteAlpha = 1.0;
      rec.fluidAlpha = 1.0;
      rec.smokeAlpha = 1.0;
    });

    // Apply casualty destruction effect & death audio
    pendingPlanes.forEach((p, idx) => {
      scheduleSequenceTimeout(() => {
        applyCasualtyToUnit(p, true);
        p.isPermanentCasualty = true;
        p.isPendingCasualty = false;
        const nextState = recalculateSynergies(attackerUnitsRef.current, defenderUnitsRef.current);
        attackerUnitsRef.current = nextState.atk;
        defenderUnitsRef.current = nextState.def;
        setAttackerUnits(nextState.atk);
        setDefenderUnits(nextState.def);
      }, idx * 150);
    });

    const delay = Math.max(300, pendingPlanes.length * 150 + 250);
    scheduleSequenceTimeout(() => {
      setPendingAaHits(0);
      const nextPhase = getNextActiveCombatPhase('AA_ALLOCATION');
      setBattlePhase(nextPhase);
      setRankStepState('READY_TO_FIRE');
      setRankSubPhase('IDLE');
      setLastVolleySummary('');
      activeDiceRef.current = [];

      setCombatLog((prev) => [
        `Aircraft casualties confirmed. Eliminated planes removed from play.`,
        `Proceeding with opening salvos.`,
        ...prev.slice(0, 8),
      ]);
    }, delay);
  }, [scheduleSequenceTimeout, getNextActiveCombatPhase]);

  // Offshore Shore Bombardment Salvo (fires once on attacker's opening sequence)
  const executeShoreBombardment = useCallback(() => {
    clearSequenceTimeouts();
    setRankStepState('FIRING');
    setRankSubPhase('ROLLING');

    const enemyUnits = defenderUnitsRef.current.filter(isCombatActive);
    const sortedEnemies = [...enemyUnits].sort((a, b) => {
      return compareByCostThenRank(a, b);
    });

    const targetValue = 4; // Hits on d6 <= 4
    const roll = diceRef.current();
    const isHit = hitsOn(roll, targetValue);

    const newDice: DiceResult[] = [
      {
        dieId: `dice_offshore_battleship_${Math.random()}`,
        unitUid: 'offshore_battleship',
        side: 'attacker',
        unitType: 'battleship',
        targetRank: targetValue,
        rolledValue: roll,
        displayedValue: Math.floor(Math.random() * 6) + 1,
        faceCycleTimer: 0,
        isHit,
        x: 638,
        y: 544,
        vx: (Math.random() - 0.5) * 40,
        vy: 180 + Math.random() * 80,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 16,
        settled: false,
        hitFlashTimer: 0,
        hasTriggeredHitVfx: false,
      },
    ];

    activeDiceRef.current = newDice;
    diceRattleTimerRef.current = 0;
    gameAudio.playDiceRattle();

    // Aim battleship forward turrets towards enemy lines
    offshoreBattleshipRef.current.turretAngle = -0.32;

    const ROLL_ANTICIPATION_MS = 1200;

    scheduleSequenceTimeout(() => {
      newDice.forEach((d) => {
        d.settled = true;
        d.displayedValue = d.rolledValue;
        if (d.isHit && !d.hasTriggeredHitVfx) {
          d.hasTriggeredHitVfx = true;
          d.hitFlashTimer = 1.0;
          gameAudio.playStrongHitGong();
          spawnSparks(d.x, d.y, 12);
        }
      });

      setRankSubPhase('FIRING');

      // Massive screen shake trauma, heavy muzzle blast with lingering smoke, and recoil kick
      screenShakeRef.current = 24;
      offshoreBattleshipRef.current.recoilX = -24;
      offshoreBattleshipRef.current.turretRecoil = 1.0;
      offshoreBattleshipRef.current.muzzleFlash = 1.0;
      offshoreBattleshipRef.current.hasFired = true;

      gameAudio.playNavalSalvo();

      // Heavy billowing lingering smoke puffs (plumes of smoke)
      for (let s = 0; s < 14; s++) {
        spawnSmoke(
          offshoreBattleshipRef.current.x + 85 + (Math.random() - 0.5) * 22,
          offshoreBattleshipRef.current.y - 12 + (Math.random() - 0.5) * 14,
          10,
          40,
          s % 2 === 0 ? PALETTE.bunkerCharcoal : PALETTE.deepTaupe,
          9.5,
          'muzzle_heavy',
        );
      }

      // Muzzle sparks
      for (let e = 0; e < 12; e++) {
        sparksRef.current.push({
          x: offshoreBattleshipRef.current.x + 90,
          y: offshoreBattleshipRef.current.y - 12,
          vx: 60 + Math.random() * 80,
          vy: (Math.random() - 0.5) * 40,
          life: 0.4 + Math.random() * 0.3,
          maxLife: 0.7,
          color: PALETTE.mustardBrass,
          size: 3.5,
        });
      }

      const targetEnemy = sortedEnemies.length > 0 ? sortedEnemies[0] : undefined;
      let targetX = 920;
      let targetY = 260;
      if (targetEnemy) {
        const ePos = getUnitScreenPos(targetEnemy);
        if (isHit) {
          targetX = ePos.x + (Math.random() - 0.5) * 6;
          targetY = ePos.y + (Math.random() - 0.5) * 6;
        } else {
          targetX = ePos.x + 24;
          targetY = ePos.y + (Math.random() - 0.5) * 12;
        }
      }

      spawnShell(
        offshoreBattleshipRef.current.x + 90,
        offshoreBattleshipRef.current.y - 12,
        targetX,
        targetY,
        PALETTE.sandCream,
        isHit,
        'battleship',
        'defender',
      );

      // After firing its salvo, very slowly retreats/drifts backward astern off the left edge
      offshoreBattleshipRef.current.driftingAstern = true;

      scheduleSequenceTimeout(() => {
        setRankSubPhase('IDLE');
        setRankStepState('RESOLVED');
        const summary = `Offshore Shore Bombardment: 1d6 Main Salvo (${isHit ? 1 : 0} Hit inflicted)`;
        setLastVolleySummary(summary);
        setCombatLog((prev) => [summary, ...prev.slice(0, 8)]);

        let hasMoreAttackerShooters = false;
        for (let r = 1; r <= 4; r++) {
          if (hasActiveUnitsInRank('attacker', r)) {
            hasMoreAttackerShooters = true;
            break;
          }
        }
        if (!hasMoreAttackerShooters) {
          lastPlayerHitsRef.current = attackerHitsRef.current;
          setLastPlayerHits(attackerHitsRef.current);
          playerAttackShootingCompleteRef.current = true;
        }
      }, 1300);
    }, ROLL_ANTICIPATION_MS);
  }, [clearSequenceTimeouts, scheduleSequenceTimeout]);

  // Trigger Current Active Salvo
  const fireCurrentVolley = useCallback(() => {
    const current = battlePhaseRef.current;
    if (current === 'DEF_AA_ATTACK') {
      executeAntiAirInterception();
    } else if (current === 'ATK_SHORE_BOMBARDMENT') {
      executeShoreBombardment();
    } else if (current === 'ATK_SUB_SURPRISE') {
      executeActiveSalvo('attacker', 2, true);
    } else if (current === 'DEF_SUB_SURPRISE') {
      executeActiveSalvo('defender', 1, true);
    } else if (current === 'IDLE' || current === 'ROUND_RESOLVED') {
      const nextPhase = getNextActiveCombatPhase('IDLE');
      setBattlePhase(nextPhase);
      if (nextPhase === 'DEF_AA_ATTACK') {
        executeAntiAirInterception();
      } else if (nextPhase === 'ATK_SHORE_BOMBARDMENT') {
        executeShoreBombardment();
      } else if (nextPhase === 'ATK_SUB_SURPRISE') {
        executeActiveSalvo('attacker', 2, true);
      } else if (nextPhase === 'DEF_SUB_SURPRISE') {
        executeActiveSalvo('defender', 1, true);
      } else {
        const side = nextPhase.startsWith('DEF_') ? 'defender' : 'attacker';
        const rank = parseInt(nextPhase.replace('ATK_RANK_', '').replace('DEF_RANK_', ''), 10) || 1;
        executeActiveSalvo(side, rank);
      }
    } else if (current === 'ATK_RANK_1') {
      executeActiveSalvo('attacker', 1);
    } else if (current === 'ATK_RANK_2') {
      executeActiveSalvo('attacker', 2);
    } else if (current === 'ATK_RANK_3') {
      executeActiveSalvo('attacker', 3);
    } else if (current === 'ATK_RANK_4') {
      executeActiveSalvo('attacker', 4);
    } else if (current === 'DEF_RANK_1') {
      executeActiveSalvo('defender', 1);
    } else if (current === 'DEF_RANK_2') {
      executeActiveSalvo('defender', 2);
    } else if (current === 'DEF_RANK_3') {
      executeActiveSalvo('defender', 3);
    } else if (current === 'DEF_RANK_4') {
      executeActiveSalvo('defender', 4);
    }
  }, [executeActiveSalvo, executeShoreBombardment, getNextActiveCombatPhase]);

  // Primary Combat Action Router
  const handlePrimaryCombatAction = useCallback(() => {
    const phase = battlePhaseRef.current;
    const stepState = rankStepStateRef.current;

    // Gated during opening deployment march and ready sequence
    if (phase === 'DEPLOYMENT_MARCH' || phase === 'DEPLOYMENT_READY') {
      return;
    }

    if (phase === 'ATTACKER_DECISION') {
      handlePressOn();
      return;
    }

    if (phase === 'IDLE' || phase === 'ROUND_RESOLVED') {
      setRoundNumber((r) => (phase === 'ROUND_RESOLVED' ? r + 1 : r));
      const firstActive = getNextActiveCombatPhase('IDLE');
      setBattlePhase(firstActive);
      setRankStepState('READY_TO_FIRE');
      setRankSubPhase('IDLE');
      setLastVolleySummary('');
      activeDiceRef.current = [];
    } else if (phase === 'AA_ALLOCATION') {
      if (pendingAaHits > 0) {
        handleAutoAssignAaCasualties();
      } else {
        handleFinalizeAaCasualties();
      }
    } else if (phase === 'ALLOCATION') {
      if (pendingAttackerHits > 0) {
        handleAutoAssignFriendlyCasualties();
      } else {
        handleFinalizeCasualties();
      }
    } else {
      if (stepState === 'READY_TO_FIRE') {
        fireCurrentVolley();
      } else if (stepState === 'RESOLVED') {
        advanceToNextRank();
      }
    }
  }, [
    fireCurrentVolley,
    advanceToNextRank,
    getNextActiveCombatPhase,
    handlePressOn,
    pendingAaHits,
    handleAutoAssignAaCasualties,
    handleFinalizeAaCasualties,
    pendingAttackerHits,
    handleAutoAssignFriendlyCasualties,
    handleFinalizeCasualties,
  ]);

  // Spacebar and Enter shortcut for instant manual firing, K for debug auto-win
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isHowToPlayOpen) {
          setIsHowToPlayOpen(false);
        } else {
          setIsGameMenuOpen((prev) => !prev);
        }
        return;
      }

      if (e.key === 'k' || e.key === 'K' || e.key === 'F10') {
        if (gameStateRef.current.status === 'PLAYING' && !victorySeqRef.current.active) {
          e.preventDefault();
          handleInstantKillDefenders();
          return;
        }
      }

      if (e.code === 'Space' || e.code === 'Enter') {
        if (victorySeqRef.current.active && victorySeqRef.current.stage === 'FLAG_SCREEN') {
          e.preventDefault();
          handleReturnToCombat();
          return;
        }

        if (gameStateRef.current.status === 'PLAYING' && !isGameMenuOpen && !isHowToPlayOpen) {
          e.preventDefault();
          handlePrimaryCombatAction();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isHowToPlayOpen,
    isGameMenuOpen,
    handlePrimaryCombatAction,
    handleInstantKillDefenders,
    handleReturnToCombat,
  ]);

  // Auto-roll Continuous Handler
  const handleAutoRoll = useCallback(() => {
    gameAudio.playConfirmSelect();
    setIsAutoRolling(true);
  }, []);

  useEffect(() => {
    if (!isAutoRolling) return;
    if (gameState.status !== 'PLAYING') {
      setIsAutoRolling(false);
      return;
    }

    const autoRollDelay = (getConfig('autoRollDelay') as number) || 800;
    autoRollTimeoutRef.current = setTimeout(() => {
      const phase = battlePhaseRef.current;
      const stepState = rankStepStateRef.current;

      if (phase === 'ATTACKER_DECISION') {
        // Paused on Attacker Decision menu: must wait for player to press PRESS ON!
        setIsAutoRolling(false);
        return;
      } else if (phase === 'IDLE') {
        const firstActive = getNextActiveCombatPhase('IDLE');
        setBattlePhase(firstActive);
        setRankStepState('READY_TO_FIRE');
      } else if (phase === 'ROUND_RESOLVED') {
        setRoundNumber((r) => r + 1);
        const firstActive = getNextActiveCombatPhase('IDLE');
        setBattlePhase(firstActive);
        setRankStepState('READY_TO_FIRE');
      } else if (phase === 'AA_ALLOCATION') {
        if (pendingAaHits > 0) {
          handleAutoAssignAaCasualties();
        } else {
          handleFinalizeAaCasualties();
        }
      } else if (phase === 'ALLOCATION') {
        if (pendingAttackerHits > 0) {
          handleAutoAssignFriendlyCasualties();
        } else {
          handleFinalizeCasualties();
        }
      } else {
        if (stepState === 'READY_TO_FIRE') {
          fireCurrentVolley();
        } else if (stepState === 'RESOLVED') {
          advanceToNextRank();
        }
      }
    }, autoRollDelay);

    return () => {
      if (autoRollTimeoutRef.current) clearTimeout(autoRollTimeoutRef.current);
    };
  }, [
    isAutoRolling,
    battlePhase,
    rankStepState,
    gameState.status,
    fireCurrentVolley,
    advanceToNextRank,
    handleAutoAssignCasualties,
    pendingAaHits,
    pendingAttackerHits,
    handleAutoAssignAaCasualties,
    handleFinalizeAaCasualties,
    handleAutoAssignFriendlyCasualties,
    handleFinalizeCasualties,
  ]);

  // Sandbox Add/Remove Unit
  const handleModifySandboxArmy = (
    side: 'attacker' | 'defender',
    type: UnitType,
    delta: number,
  ) => {
    gameAudio.playCrispClick();
    if (delta > 0) {
      const newUnit = createUnit(type, side);
      if (side === 'attacker') {
        const {atk, def} = recalculateSynergies([...attackerUnits, newUnit], defenderUnits);
        setAttackerUnits(atk);
        setDefenderUnits(def);
      } else {
        const {atk, def} = recalculateSynergies(attackerUnits, [...defenderUnits, newUnit]);
        setAttackerUnits(atk);
        setDefenderUnits(def);
      }
    } else {
      if (side === 'attacker') {
        const idx = attackerUnits.findIndex((u) => u.type === type && !u.isDestroyed);
        if (idx !== -1) {
          const next = [...attackerUnits];
          next.splice(idx, 1);
          const {atk, def} = recalculateSynergies(next, defenderUnits);
          setAttackerUnits(atk);
          setDefenderUnits(def);
        }
      } else {
        const idx = defenderUnits.findIndex((u) => u.type === type && !u.isDestroyed);
        if (idx !== -1) {
          const next = [...defenderUnits];
          next.splice(idx, 1);
          const {atk, def} = recalculateSynergies(attackerUnits, next);
          setAttackerUnits(atk);
          setDefenderUnits(def);
        }
      }
    }
  };

  // Canvas Click Detection
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Victory Sequence Screen: Check "RETURN TO COMBAT" button click
    if (victorySeqRef.current.active && victorySeqRef.current.stage === 'FLAG_SCREEN') {
      const bRect = returnButtonRectRef.current;
      const hitX = bRect ? clickX >= bRect.x && clickX <= bRect.x + bRect.w : clickX >= 505 && clickX <= 775;
      const hitY = bRect ? clickY >= bRect.y && clickY <= bRect.y + bRect.h : clickY >= 435 && clickY <= 495;
      if (hitX && hitY) {
        handleReturnToCombat();
        return;
      }
      return;
    }

    // Deployment sequence: clicks gated until march & stationing completes
    if (battlePhase === 'DEPLOYMENT_MARCH' || battlePhase === 'DEPLOYMENT_READY') {
      return;
    }

    // Check Decision Menu buttons flanking dice tray when in ATTACKER_DECISION
    if (battlePhase === 'ATTACKER_DECISION') {
      const btnW = 130;
      const btnH = 56;
      const trayX = 490;
      const trayY = 538;
      const trayH = 162;
      const leftBtnX = trayX - btnW - 14; // 346
      const rightBtnX = trayX + 300 + 14; // 804
      const btnY = trayY + Math.round((trayH - btnH) / 2); // 591

      // Left Button: RETREAT
      if (clickX >= leftBtnX - 4 && clickX <= leftBtnX + btnW + 4 && clickY >= btnY - 4 && clickY <= btnY + btnH + 4) {
        handleRetreatDecision();
        return;
      }

      // Right Button: PRESS ON
      if (clickX >= rightBtnX - 4 && clickX <= rightBtnX + btnW + 4 && clickY >= btnY - 4 && clickY <= btnY + btnH + 4) {
        handlePressOn();
        return;
      }

      // Dice Tray center area also triggers PRESS ON
      if (clickX >= 485 && clickX <= 795 && clickY >= 530 && clickY <= 705) {
        handlePressOn();
        return;
      }
    }

    // Check click on Tactical Dice Tray at the Bottom Sea (X: 485..795, Y: 530..705)
    if (clickX >= 485 && clickX <= 795 && clickY >= 530 && clickY <= 705) {
      handlePrimaryCombatAction();
      return;
    }

    // During AA_ALLOCATION phase, click directly on friendly air units to assign casualties
    if (battlePhase === 'AA_ALLOCATION') {
      if (pendingAaHits > 0) {
        const hitPlane = attackerUnitsRef.current.find((u) => {
          if (!isCombatActive(u) || UNIT_DEFINITIONS[u.type].category !== 'air') return false;
          const pos = getUnitScreenPos(u);
          return Math.hypot(clickX - pos.x, clickY - pos.y) < 28;
        });

        if (hitPlane) {
          handleAssignHitToAirUnit(hitPlane.type);
          return;
        }
      }
      return;
    }

    // During ALLOCATION phase, click directly on friendly units or rank columns to assign casualties
    if (battlePhase === 'ALLOCATION') {
      if (pendingAttackerHits > 0) {
        // Direct unit click
        const hitAtk = attackerUnitsRef.current.find((u) => {
          if (!isCombatActive(u)) return false;
          const pos = getUnitScreenPos(u);
          return Math.hypot(clickX - pos.x, clickY - pos.y) < 28;
        });

        if (hitAtk) {
          hitAtk.isPendingCasualty = true;
          hitAtk.status = 'downed';
          hitAtk.isDestroyed = true;
          hitAtk.currentHp = 0;
          hitAtk.fadeAlpha = 1.0;
          hitAtk.isFadingOut = false;
          registerCasualtyRecord(hitAtk, true);

          setPendingAttackerHits((h) => Math.max(0, h - 1));
          const {atk, def} = recalculateSynergies(attackerUnitsRef.current, defenderUnitsRef.current);
          attackerUnitsRef.current = atk;
          setAttackerUnits([...atk]);
          return;
        }

        // Friendly rank column click (Attacker columns: X: 55..475)
        if (clickX >= 55 && clickX <= 475 && clickY >= 120 && clickY <= 690) {
          const colIndex = Math.floor((clickX - 55) / 105);
          const rankNum = 4 - colIndex; // Col 0: Rank 4, Col 3: Rank 1
          if (rankNum >= 1 && rankNum <= 4) {
            handleAssignHitToFriendlyRank(rankNum);
            return;
          }
        }
      }
      return;
    }

    // Direct canvas clicks anywhere trigger primary combat action (roll or advance)
    handlePrimaryCombatAction();
  };

  // 🛑 Game Loop Update Function 🛑
  const update = (deltaTime: number) => {
    gameTimeRef.current += deltaTime;
    runDueSequenceTimeouts();

    // Opening Deployment March & Ready station simulation
    if (deploymentRef.current.active) {
      if (deploymentRef.current.stage === 'MARCHING') {
        deploymentRef.current.marchElapsed += deltaTime;
        const p = Math.min(1, deploymentRef.current.marchElapsed / deploymentRef.current.marchDuration);
        // Easing: easeOutQuad for smooth deceleration into formation
        const ease = 1 - (1 - p) * (1 - p);

        attackerUnitsRef.current.forEach((u) => {
          const startOffset = u.marchStartOffsetX ?? -150;
          u.marchCurrentOffsetX = Math.round((1 - ease) * startOffset);
          u.isMarching = p < 1;
        });

        // Rhythmic marching audio cadence
        if (p < 1 && Math.floor(deploymentRef.current.marchElapsed * 3) !== Math.floor((deploymentRef.current.marchElapsed - deltaTime) * 3)) {
          gameAudio.playFootstepStone();
        }

        // Roman numeral badges smoothly fade in from 0 to 1 when p >= 0.8
        if (p >= 0.8) {
          deploymentRef.current.rankSymbolsAlpha = Math.min(1, (p - 0.8) / 0.2);
        } else {
          deploymentRef.current.rankSymbolsAlpha = 0;
        }

        if (p >= 1) {
          deploymentRef.current.stage = 'READY_ANIM';
          deploymentRef.current.readyElapsed = 0;
          deploymentRef.current.rankSymbolsAlpha = 1.0;
          attackerUnitsRef.current.forEach((u) => {
            u.marchCurrentOffsetX = 0;
            u.isMarching = false;
            u.readyAnimProgress = 0;
          });
          setBattlePhase('DEPLOYMENT_READY');
        }
      } else if (deploymentRef.current.stage === 'READY_ANIM') {
        deploymentRef.current.readyElapsed += deltaTime;
        const rp = Math.min(1, deploymentRef.current.readyElapsed / deploymentRef.current.readyDuration);

        attackerUnitsRef.current.forEach((u) => {
          u.readyAnimProgress = rp;
        });

        if (rp >= 1) {
          deploymentRef.current.stage = 'DONE';
          deploymentRef.current.active = false;
          attackerUnitsRef.current.forEach((u) => {
            u.readyAnimProgress = undefined;
          });

          gameAudio.playConfirmSelect();
          // Transition to first combat salvo phase
          const firstActive = getNextActiveCombatPhase('IDLE');
          setBattlePhase(firstActive);
          setRankStepState('READY_TO_FIRE');
          setRankSubPhase('IDLE');
          setCombatLog((prev) => [
            'All attacking divisions deployed and stationed in rank formation.',
            'Tactical salvo engagement ready to commence.',
            ...prev.slice(0, 8),
          ]);
        }
      }
    }

    // Victory Sequence Simulation:
    // Surviving friendly army marches forward & cheers; aircraft bank & ascend off-screen;
    // Fades to black after ~3.4s, then transitions to full-screen waving flag screen
    if (victorySeqRef.current.active) {
      victorySeqRef.current.elapsed += deltaTime;
      const el = victorySeqRef.current.elapsed;

      if (el < 3.4) {
        victorySeqRef.current.stage = 'CHEERING';
        victorySeqRef.current.blackFadeAlpha = 0;

        attackerUnitsRef.current.forEach((u) => {
          if (isCombatActive(u)) {
            const def = UNIT_DEFINITIONS[u.type];
            if (def.category === 'air') {
              u.victoryAdvanceX = (u.victoryAdvanceX || 0) + deltaTime * 52;
              u.victoryAscentY = (u.victoryAscentY || 0) + deltaTime * 92;
            } else {
              u.victoryAdvanceX = (u.victoryAdvanceX || 0) + deltaTime * 36;
            }
          }
        });
      } else if (el < 4.25) {
        victorySeqRef.current.stage = 'FADE_TO_BLACK';
        const fadeP = Math.min(1, (el - 3.4) / 0.85);
        victorySeqRef.current.blackFadeAlpha = fadeP;

        attackerUnitsRef.current.forEach((u) => {
          if (isCombatActive(u)) {
            const def = UNIT_DEFINITIONS[u.type];
            if (def.category === 'air') {
              u.victoryAdvanceX = (u.victoryAdvanceX || 0) + deltaTime * 52;
              u.victoryAscentY = (u.victoryAscentY || 0) + deltaTime * 92;
            } else {
              u.victoryAdvanceX = (u.victoryAdvanceX || 0) + deltaTime * 36;
            }
          }
        });
      } else {
        victorySeqRef.current.stage = 'FLAG_SCREEN';
        victorySeqRef.current.flagElapsed += deltaTime;
        victorySeqRef.current.blackFadeAlpha = Math.max(0, 1.0 - (el - 4.25) / 0.35);
      }
    }

    // Decay screen shake
    if (screenShakeRef.current > 0) {
      screenShakeRef.current = Math.max(0, screenShakeRef.current - deltaTime * 16);
    }

    // Offshore Support Battleship: very slowly drifts astern off-screen left after firing, recovers recoil
    if (offshoreBattleshipRef.current.active) {
      if (offshoreBattleshipRef.current.driftingAstern) {
        offshoreBattleshipRef.current.x -= deltaTime * 16;
      }
      if (offshoreBattleshipRef.current.recoilX < 0) {
        offshoreBattleshipRef.current.recoilX = Math.min(0, offshoreBattleshipRef.current.recoilX + deltaTime * 14);
      }
      if (offshoreBattleshipRef.current.turretRecoil > 0) {
        offshoreBattleshipRef.current.turretRecoil = Math.max(0, offshoreBattleshipRef.current.turretRecoil - deltaTime * 2.5);
      }
      if (offshoreBattleshipRef.current.muzzleFlash > 0) {
        offshoreBattleshipRef.current.muzzleFlash = Math.max(0, offshoreBattleshipRef.current.muzzleFlash - deltaTime * 4.5);
      }
    }

    // Update active unit anim recoil & sinking ship simulation
    const updateUnitSimulation = (u: CombatUnit) => {
      if (u.animRecoil > 0) u.animRecoil = Math.max(0, u.animRecoil - deltaTime * 2.4);

      // Carrier moving forward / floating back movement
      if (u.type === 'carrier') {
        if (u.carrierFloatState === 'MOVING_FORWARD') {
          if (u.carrierFloatX === undefined) u.carrierFloatX = 0;
          const targetX = u.carrierFloatTargetX || 0;
          if (u.carrierFloatX < targetX) {
            u.carrierFloatX = Math.min(targetX, u.carrierFloatX + deltaTime * 140);
            if (u.carrierFloatX === targetX) {
              u.carrierFloatState = 'IDLE';
            }
          }
        } else if (u.carrierFloatState === 'FLOATING_BACK') {
          if (u.carrierFloatX === undefined) u.carrierFloatX = 0;
          const targetX = u.carrierFloatTargetX || -210;
          if (u.carrierFloatX > targetX) {
            u.carrierFloatX = Math.max(targetX, u.carrierFloatX - deltaTime * 68);
            if (u.carrierFloatX === targetX) {
              u.carrierFloatState = 'IDLE';
            }
          }
        }
      }

      if (u.status === 'downed') {
        u.downedTime = (u.downedTime || 0) + deltaTime;

        // Air Strike Test: Planes emit smoke as they spiral down/fade away without leaving craters or oil
        if (
          currentTheaterRef.current === 'air_strike_test' &&
          (u.type === 'fighter' || u.type === 'strategic_bomber' || u.type === 'tactical_bomber')
        ) {
          u.planeSmokeTimer = (u.planeSmokeTimer || 0) - deltaTime;
          if (u.planeSmokeTimer <= 0 && (u.fadeAlpha || 0) > 0.08) {
            u.planeSmokeTimer = 0.38 + Math.random() * 0.32;
            const uPos = getUnitScreenPos(u);
            spawnSmoke(
              uPos.x + (Math.random() - 0.5) * 10,
              uPos.y - 4 + (Math.random() - 0.5) * 6,
              5,
              18,
              PALETTE.bunkerCharcoal,
              4.8,
              'crater_plume',
            );
          }
        }

        // Warship Sinking Phase (Lethal 2nd Hit)
        const isShip =
          u.type === 'battleship' ||
          u.type === 'carrier' ||
          u.type === 'cruiser' ||
          u.type === 'destroyer' ||
          u.type === 'submarine';

        if (isShip) {
          u.sinkingProgress = Math.min(1, (u.sinkingProgress || 0) + deltaTime * 0.18);
          u.sinkingY = (u.sinkingProgress || 0) * 36; // translates downward into the deep sea

          // Secondary deck explosions popping across the hull
          u.secondaryExplosionsTimer = (u.secondaryExplosionsTimer || 0) - deltaTime;
          if (u.secondaryExplosionsTimer <= 0 && (u.sinkingProgress || 0) < 0.85) {
            u.secondaryExplosionsTimer = 0.28 + Math.random() * 0.4;
            const uPos = getUnitScreenPos(u);
            if (currentTheaterRef.current !== 'air_strike_test') {
              spawnSparks(uPos.x + (Math.random() - 0.5) * 32, uPos.y - 6 + (Math.random() - 0.5) * 8, 8);
            }
            spawnSmoke(uPos.x, uPos.y - 8, 7, 24, PALETTE.bunkerCharcoal, 6, 'impact_explosion');
          }
        }
      }
    };
    attackerUnitsRef.current.forEach(updateUnitSimulation);
    defenderUnitsRef.current.forEach(updateUnitSimulation);

    // Update water geyser splash explosions
    for (let i = waterGeysersRef.current.length - 1; i >= 0; i--) {
      const g = waterGeysersRef.current[i];
      g.life -= deltaTime;
      if (g.life <= 0) {
        waterGeysersRef.current.splice(i, 1);
      }
    }

    // 2. Casualty Lifecycle Simulation (Smooth individual 3-20s fadeout for all casualties)
    for (let i = casualtyRecordsRef.current.length - 1; i >= 0; i--) {
      const rec = casualtyRecordsRef.current[i];

      // Fluid puddle expansion during initial seconds
      if (rec.fluidRx < rec.fluidMaxRx) {
        rec.fluidRx = Math.min(rec.fluidMaxRx, rec.fluidRx + deltaTime * 0.45);
      }
      if (rec.fluidRy < rec.fluidMaxRy) {
        rec.fluidRy = Math.min(rec.fluidMaxRy, rec.fluidRy + deltaTime * 0.22);
      }

      if (!rec.isConfirmed) {
        rec.spriteAlpha = 1.0;
        rec.fluidAlpha = 1.0;
        rec.smokeAlpha = 1.0;
        rec.craterAlpha = 1.0;
        continue;
      }

      rec.timeSinceConfirmed += deltaTime;
      const progress = Math.min(1, rec.timeSinceConfirmed / (rec.fadeDuration || 10));
      const currentAlpha = Math.max(0, 1.0 - progress);

      // Smoothly dissolve unit sprite, fluid puddle, smoke, and crater according to its individual timer
      rec.spriteAlpha = currentAlpha;
      rec.fluidAlpha = currentAlpha;
      rec.smokeAlpha = currentAlpha;
      rec.craterAlpha = currentAlpha;

      // Synchronize spriteAlpha to unit
      const atkUnit = attackerUnitsRef.current.find((u) => u.uid === rec.unitUid);
      if (atkUnit) {
        atkUnit.fadeAlpha = currentAlpha;
        if (currentAlpha <= 0) atkUnit.status = 'dead';
      }
      const defUnit = defenderUnitsRef.current.find((u) => u.uid === rec.unitUid);
      if (defUnit) {
        defUnit.fadeAlpha = currentAlpha;
        if (currentAlpha <= 0) defUnit.status = 'dead';
      }

      // Synchronize associated crater alpha
      const matchedCrater = cratersRef.current.find(
        (cr) =>
          cr.casualtyUid === rec.unitUid ||
          (rec.craterId && cr.id === rec.craterId) ||
          (cr.isSmallCasualtyCrater && Math.hypot(cr.x - rec.x, cr.y - (rec.y + 3)) < 6),
      );
      if (matchedCrater) {
        matchedCrater.alpha = currentAlpha;
      }

      // Clean up from memory once timer expires and alpha reaches 0
      if (progress >= 1 || currentAlpha <= 0.001) {
        casualtyRecordsRef.current.splice(i, 1);
      }
    }

    // Dynamic craters fadeout update & cleanup
    for (let i = cratersRef.current.length - 1; i >= 0; i--) {
      const cr = cratersRef.current[i];
      if (cr.fadeTimer !== undefined) {
        cr.fadeTimer -= deltaTime;
        const max = cr.maxFadeTimer || 1;
        cr.alpha = Math.max(0, Math.min(1, cr.fadeTimer / max));
        if (cr.fadeTimer <= 0 || cr.alpha <= 0.001) {
          cratersRef.current.splice(i, 1);
        }
      }
    }

    // Update persistent burning ground fires & embers from hits with smooth fade
    for (let i = groundFiresRef.current.length - 1; i >= 0; i--) {
      const fire = groundFiresRef.current[i];
      if (fire.fadeTimer !== undefined) {
        fire.fadeTimer -= deltaTime;
        const max = fire.maxFadeTimer || 1;
        fire.alpha = Math.max(0, Math.min(1, fire.fadeTimer / max));
        fire.intensity = fire.alpha;
        if (fire.fadeTimer <= 0 || fire.alpha <= 0.001) {
          groundFiresRef.current.splice(i, 1);
          continue;
        }
      }

      fire.smokeTimer -= deltaTime;
      if (fire.smokeTimer <= 0) {
        fire.smokeTimer = 0.38 + Math.random() * 0.45;
        // Spawns rich lingering billowing smoke plumes
        spawnSmoke(
          fire.x + (Math.random() - 0.5) * 8,
          fire.y - 4,
          5,
          24,
          Math.random() > 0.5 ? PALETTE.bunkerCharcoal : PALETTE.deepTaupe,
          8.0,
          'crater_plume',
        );
      }

      fire.emberTimer -= deltaTime;
      if (fire.emberTimer <= 0) {
        fire.emberTimer = 0.15 + Math.random() * 0.22;
        // Sheds glowing embers and sparks drifting upward with wind
        sparksRef.current.push({
          x: fire.x + (Math.random() - 0.5) * 8,
          y: fire.y - 2,
          vx: (Math.random() - 0.5) * 22 + 5,
          vy: -35 - Math.random() * 45,
          life: 0.65 + Math.random() * 0.4,
          maxLife: 1.1,
          color: Math.random() > 0.4 ? PALETTE.sandCream : PALETTE.mustardBrass,
          size: 2,
        });
      }
    }

    // Slowly expand & update blood puddles fade
    for (let i = bloodPuddlesRef.current.length - 1; i >= 0; i--) {
      const p = bloodPuddlesRef.current[i];
      if (p.maxRx && p.rx < p.maxRx) {
        p.rx = Math.min(p.maxRx, p.rx + deltaTime * 0.35);
      }
      if (p.maxRy && p.ry < p.maxRy) {
        p.ry = Math.min(p.maxRy, p.ry + deltaTime * 0.18);
      }
      if (p.fadeTimer !== undefined) {
        p.fadeTimer -= deltaTime;
        const max = p.maxFadeTimer || 1;
        p.alpha = Math.max(0, Math.min(1, p.fadeTimer / max));
        if (p.fadeTimer <= 0 || p.alpha <= 0.001) {
          bloodPuddlesRef.current.splice(i, 1);
        }
      }
    }

    // Update tumbling dice physics in Bottom Sea Tray
    const trayLeft = 496;
    const trayRight = 784;
    const trayBottomRail = 676; // Bottom rail of the box

    // Rhythmic dice rattle SFX while dice are actively rolling in the tray
    if (rankSubPhaseRef.current === 'ROLLING' && activeDiceRef.current.length > 0) {
      diceRattleTimerRef.current += deltaTime;
      if (diceRattleTimerRef.current >= 0.12) {
        diceRattleTimerRef.current = 0;
        gameAudio.playDiceRattle();
      }
    }

    activeDiceRef.current.forEach((die) => {
      // Decay red flash timer
      if (die.hitFlashTimer && die.hitFlashTimer > 0) {
        die.hitFlashTimer = Math.max(0, die.hitFlashTimer - deltaTime * 1.6);
      }

      if (!die.settled) {
        die.x += die.vx * deltaTime;
        die.y += die.vy * deltaTime;
        die.vy += 380 * deltaTime; // Gravity pulling downward rapidly into bottom rail
        die.rotation += die.vRot * deltaTime;

        // Rapidly cycle face numbers while in motion as if genuinely rolling
        die.faceCycleTimer = (die.faceCycleTimer || 0) + deltaTime;
        if (die.faceCycleTimer >= 0.045) {
          die.faceCycleTimer = 0;
          die.displayedValue = Math.floor(Math.random() * 6) + 1;
        }

        let bounced = false;
        if (die.x < trayLeft + 14) {
          die.x = trayLeft + 14;
          die.vx = -die.vx * 0.55;
          bounced = true;
        } else if (die.x > trayRight - 14) {
          die.x = trayRight - 14;
          die.vx = -die.vx * 0.55;
          bounced = true;
        }

        // Bounce dampening against the bottom rail of the box
        if (die.y > trayBottomRail) {
          die.y = trayBottomRail;
          die.vy = -die.vy * 0.42; // bounce dampening
          die.vx *= 0.76;
          die.vRot *= 0.7;
          bounced = true;

          // When each die lands / settles at the bottom rail:
          if (Math.abs(die.vy) < 22 && Math.abs(die.vx) < 14) {
            die.settled = true;
            die.displayedValue = die.rolledValue;

            // If it scores a HIT (<= target rank):
            if (die.isHit && !die.hasTriggeredHitVfx) {
              die.hasTriggeredHitVfx = true;
              die.hitFlashTimer = 1.0; // Flashes RED (#9A4E48 / #6F3B4A with glowing #DFCE91 accents)
              gameAudio.playStrongHitGong(); // Punchy resonant war-room hit SFX
              spawnSparks(die.x, die.y, 12);
            }
          }
        }

        if (bounced && Math.abs(die.vy) > 15 && gameTimeRef.current - lastDiceBounceTimeRef.current > 0.055) {
          lastDiceBounceTimeRef.current = gameTimeRef.current;
          gameAudio.playDiceBounce();
        }
      }
    });

    // Update floating pixel texts with smooth upward float and alpha dissipation
    for (let i = floatingTextsRef.current.length - 1; i >= 0; i--) {
      const ft = floatingTextsRef.current[i];
      ft.life -= deltaTime;
      ft.y += ft.vy * deltaTime;
      ft.vy *= 0.98;
      if (ft.life <= 0) {
        floatingTextsRef.current.splice(i, 1);
      }
    }

    // Update projectile shells
    for (let i = combatShellsRef.current.length - 1; i >= 0; i--) {
      const shell = combatShellsRef.current[i];
      shell.progress += deltaTime * 2.6;

      const currentX = shell.startX + (shell.endX - shell.startX) * shell.progress;
      const arc = Math.sin(shell.progress * Math.PI) * shell.arcHeight;
      const currentY = shell.startY + (shell.endY - shell.startY) * shell.progress - arc;
      shell.trail.push({x: currentX, y: currentY});
      if (shell.trail.length > 5) shell.trail.shift();

      if (shell.progress >= 1) {
        triggerHitImpact(shell.endX, shell.endY, shell.isHit, shell.unitType, shell.targetSide);
        combatShellsRef.current.splice(i, 1);
      }
    }

    // Update Falling Bombs dropped over enemy area
    for (let i = droppingBombsRef.current.length - 1; i >= 0; i--) {
      const b = droppingBombsRef.current[i];
      b.x += b.vx * deltaTime;
      b.y += b.vy * deltaTime;
      b.vy += 220 * deltaTime; // gravity acceleration

      if (b.y >= b.groundY) {
        triggerHitImpact(b.x, b.groundY, b.isHit, b.unitType, b.targetSide);
        droppingBombsRef.current.splice(i, 1);
      }
    }

    // Update Active Plane Sorties (strafing & bombing directly over populated enemy rows)
    for (let i = activeSortiesRef.current.length - 1; i >= 0; i--) {
      const s = activeSortiesRef.current[i];
      s.progress += deltaTime / s.duration;

      const isAtk = s.side === 'attacker';
      const p = s.progress;
      const targetRowY = s.targetY ?? (s.homeY + 28);
      const targetColX = s.targetX ?? (isAtk ? 980 : 300);

      if (isAtk) {
        // Attacker Plane Flight Profile:
        if (p < 0.42) {
          // 1. Approach swoop towards target row
          const t = p / 0.42;
          s.currentX = s.homeX + (900 - s.homeX) * t;
          s.currentY = s.homeY + (targetRowY - 32 - s.homeY) * t;
          s.currentRot = Math.cos(t * Math.PI) * 0.22;
        } else if (p < 0.65) {
          // 2. Strafing & Bombing run DIRECTLY OVER POPULATED ENEMY ROWS!
          const t = (p - 0.42) / 0.23;
          s.currentX = 900 + 240 * t;
          s.currentY = targetRowY - 32;
          s.currentRot = 0.08;

          if (s.unitType === 'fighter') {
            // Spawn independent world-space bullets/tracers from wing gun muzzles!
            if (t >= 0.25 && t <= 0.62 && (s.bulletBurstsFired || 0) < 4) {
              const burstIndex = s.bulletBurstsFired || 0;
              s.bulletBurstsFired = burstIndex + 1;
              gameAudio.playFighterGuns();

              // World coordinates of plane wing muzzles
              const muzzleX = s.currentX + (isAtk ? 14 : -14);
              const wingY1 = s.currentY - 8;
              const wingY2 = s.currentY + 8;

              // Trajectory toward target
              const dx = targetColX - muzzleX;
              const dy = targetRowY - s.currentY;
              const dist = Math.max(1, Math.hypot(dx, dy));
              const speed = 950;
              const vx = (dx / dist) * speed;
              const vy = (dy / dist) * speed;

              [wingY1, wingY2].forEach((mY, idx) => {
                planeBulletsRef.current.push({
                  id: `pbullet_${Math.random()}`,
                  x: muzzleX,
                  y: mY,
                  vx: vx + (Math.random() - 0.5) * 20,
                  vy: vy + (Math.random() - 0.5) * 15,
                  targetX: targetColX,
                  targetY: targetRowY,
                  targetSide: isAtk ? 'defender' : 'attacker',
                  isHit: s.isHit && burstIndex === 2 && idx === 0, // exactly 1 confirmed hit event
                  color: PALETTE.sandCream,
                  trail: [],
                  life: 0.35,
                  maxLife: 0.35,
                });
              });
            }
          } else {
            // Bombers drop tumbling ordnance directly onto populated enemy row
            if (!s.bombsDropped && t >= 0.3) {
              s.bombsDropped = 1;
              gameAudio.playBomberWhistleDrop();
              // Spawn exactly 1 precision falling bomb matching the 1:1 hit status
              droppingBombsRef.current.push({
                id: `bomb_${Math.random()}`,
                x: targetColX,
                y: s.currentY + 8,
                vx: 30,
                vy: 40,
                groundY: targetRowY,
                isHit: s.isHit,
                unitType: s.unitType,
                targetSide: 'defender',
              });
            }
          }
        } else if (p < 0.82) {
          // 3. Pull-up and bank off-screen right
          const t = (p - 0.65) / 0.17;
          s.currentX = 1140 + (1360 - 1140) * t;
          s.currentY = (targetRowY - 32) - t * 110;
          s.currentRot = -0.32;
        } else {
          // 4. High-altitude return glide to base
          const t = (p - 0.82) / 0.18;
          s.currentX = 1360 - (1360 - s.homeX) * t;
          s.currentY = (s.homeY - 82) + 82 * t;
          s.currentRot = Math.PI + Math.sin(t * Math.PI) * 0.25;
        }
      } else {
        // Defender Plane Mirror Flight Profile:
        if (p < 0.42) {
          const t = p / 0.42;
          s.currentX = s.homeX - (s.homeX - 380) * t;
          s.currentY = s.homeY + (targetRowY - 32 - s.homeY) * t;
          s.currentRot = -Math.cos(t * Math.PI) * 0.22;
        } else if (p < 0.65) {
          // Strafing & Bombing run DIRECTLY OVER ATTACKER POPULATED ROWS!
          const t = (p - 0.42) / 0.23;
          s.currentX = 380 - 240 * t;
          s.currentY = targetRowY - 32;
          s.currentRot = -0.08;

          if (s.unitType === 'fighter') {
            // Spawn independent world-space bullets/tracers from wing gun muzzles!
            if (t >= 0.25 && t <= 0.62 && (s.bulletBurstsFired || 0) < 4) {
              const burstIndex = s.bulletBurstsFired || 0;
              s.bulletBurstsFired = burstIndex + 1;
              gameAudio.playFighterGuns();

              const muzzleX = s.currentX - 14;
              const wingY1 = s.currentY - 8;
              const wingY2 = s.currentY + 8;

              const dx = targetColX - muzzleX;
              const dy = targetRowY - s.currentY;
              const dist = Math.max(1, Math.hypot(dx, dy));
              const speed = 950;
              const vx = (dx / dist) * speed;
              const vy = (dy / dist) * speed;

              [wingY1, wingY2].forEach((mY, idx) => {
                planeBulletsRef.current.push({
                  id: `pbullet_${Math.random()}`,
                  x: muzzleX,
                  y: mY,
                  vx: vx + (Math.random() - 0.5) * 20,
                  vy: vy + (Math.random() - 0.5) * 15,
                  targetX: targetColX,
                  targetY: targetRowY,
                  targetSide: 'attacker',
                  isHit: s.isHit && burstIndex === 2 && idx === 0,
                  color: PALETTE.sandCream,
                  trail: [],
                  life: 0.35,
                  maxLife: 0.35,
                });
              });
            }
          } else {
            if (!s.bombsDropped && t >= 0.3) {
              s.bombsDropped = 1;
              gameAudio.playBomberWhistleDrop();
              // Spawn exactly 1 precision falling bomb matching the 1:1 hit status
              droppingBombsRef.current.push({
                id: `bomb_${Math.random()}`,
                x: targetColX,
                y: s.currentY + 8,
                vx: -30,
                vy: 40,
                groundY: targetRowY,
                isHit: s.isHit,
                unitType: s.unitType,
                targetSide: 'attacker',
              });
            }
          }
        } else if (p < 0.82) {
          const t = (p - 0.65) / 0.17;
          s.currentX = 140 - (140 - -80) * t;
          s.currentY = (targetRowY - 32) - t * 110;
          s.currentRot = 0.32;
        } else {
          const t = (p - 0.82) / 0.18;
          s.currentX = -80 + (s.homeX - -80) * t;
          s.currentY = (s.homeY - 82) + 82 * t;
          s.currentRot = Math.sin(t * Math.PI) * 0.25;
        }
      }

      if (s.progress >= 1) {
        // Plane returns and lands back on its carrier!
        const carrier = [...attackerUnitsRef.current, ...defenderUnitsRef.current].find(
          (u) => u.uid === s.unitUid && u.type === 'carrier',
        );
        if (carrier) {
          carrier.planesCarried = Math.min(
            carrier.maxPlanesCarried || 2,
            (carrier.planesCarried || 0) + 1,
          );
        }
        activeSortiesRef.current.splice(i, 1);
      }
    }

    // Update Airplane Bullets & Tracers (strictly short lifetime, clean up immediately on impact or timeout)
    for (let i = planeBulletsRef.current.length - 1; i >= 0; i--) {
      const b = planeBulletsRef.current[i];
      b.life -= deltaTime;
      b.x += b.vx * deltaTime;
      b.y += b.vy * deltaTime;

      b.trail.push({x: b.x, y: b.y});
      if (b.trail.length > 4) b.trail.shift();

      const distToTarget = Math.hypot(b.targetX - b.x, b.targetY - b.y);
      const isPastTarget = (b.vx > 0 && b.x >= b.targetX) || (b.vx < 0 && b.x <= b.targetX);

      if (b.life <= 0 || distToTarget < 20 || isPastTarget) {
        if (b.isHit) {
          triggerHitImpact(b.targetX, b.targetY, true, 'fighter', b.targetSide);
        } else {
          spawnSparks(b.x, b.y, 4);
        }
        planeBulletsRef.current.splice(i, 1);
      }
    }

    // Update sparks
    for (let i = sparksRef.current.length - 1; i >= 0; i--) {
      const s = sparksRef.current[i];
      s.life -= deltaTime;
      s.x += s.vx * deltaTime;
      s.y += s.vy * deltaTime;
      s.vy += 130 * deltaTime;
      if (s.life <= 0) sparksRef.current.splice(i, 1);
    }

    // Update blood splatters
    for (let i = bloodSplattersRef.current.length - 1; i >= 0; i--) {
      const b = bloodSplattersRef.current[i];
      b.life -= deltaTime;
      b.x += b.vx * deltaTime;
      b.y += b.vy * deltaTime;
      b.vy += 200 * deltaTime; // gravity
      if (b.life <= 0) bloodSplattersRef.current.splice(i, 1);
    }

    // Update flying debris
    for (let i = flyingDebrisRef.current.length - 1; i >= 0; i--) {
      const d = flyingDebrisRef.current[i];
      d.life -= deltaTime;
      d.x += d.vx * deltaTime;
      d.y += d.vy * deltaTime;
      d.vy += 240 * deltaTime;
      d.rot += d.vRot * deltaTime;
      if (d.life <= 0) flyingDebrisRef.current.splice(i, 1);
    }

    // Update lingering smoke puffs (slow rise & wind drift & 2.0s post-casualty fade)
    for (let i = smokePuffsRef.current.length - 1; i >= 0; i--) {
      const p = smokePuffsRef.current[i];
      if (p.fadeTimer !== undefined) {
        p.fadeTimer -= deltaTime;
        if (p.fadeTimer <= 0) {
          smokePuffsRef.current.splice(i, 1);
          continue;
        }
      }
      p.life -= deltaTime;
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      p.vy *= 0.985; // rises gently, slowing down
      p.vx += 1.2 * deltaTime; // gentle eastward wind
      if (p.life <= 0) smokePuffsRef.current.splice(i, 1);
    }

    // Update shockwaves
    for (let i = shockwavesRef.current.length - 1; i >= 0; i--) {
      const sw = shockwavesRef.current[i];
      sw.life -= deltaTime;
      sw.radius += (sw.maxRadius - sw.radius) * deltaTime * 5;
      if (sw.life <= 0) shockwavesRef.current.splice(i, 1);
    }
  };

  // 🛑 Game Loop Draw Function 🛑
  const draw = (ctx: CanvasRenderingContext2D) => {
    prepareCanvas(ctx, canvasWidth, canvasHeight);

    // =========================================================================
    // VICTORY SEQUENCE: FULL-SCREEN WAVING FLAG & VICTORY MODAL STAGE
    // =========================================================================
    if (victorySeqRef.current.active && victorySeqRef.current.stage === 'FLAG_SCREEN') {
      const time = gameTimeRef.current;

      // 1. Dynamic procedural waving flag in an infinite loop fills the entire screen
      drawProceduralWavingFlag(
        ctx,
        canvasWidth,
        canvasHeight,
        time,
        currentTheaterRef.current,
      );

      // 2. Center VICTORY modal expands outward with Region banner, circular emblems, IPC counts, and button
      const {returnButtonRect} = drawVictorySequenceModal(
        ctx,
        canvasWidth,
        canvasHeight,
        time,
        victorySeqRef.current.flagElapsed,
        victorySeqRef.current.regionName,
        attackerIpcRef.current,
        defenderIpcRef.current,
      );
      returnButtonRectRef.current = returnButtonRect;

      // 3. Black fade dissipation overlay
      if (victorySeqRef.current.blackFadeAlpha > 0.01) {
        ctx.save();
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.globalAlpha = victorySeqRef.current.blackFadeAlpha;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.restore();
      }
      return;
    }

    ctx.save();
    if (screenShakeRef.current > 0) {
      const intensity = screenShakeRef.current * (getConfig('shakeIntensity') as number);
      const shakeX = (Math.random() - 0.5) * intensity;
      const shakeY = (Math.random() - 0.5) * intensity;
      ctx.translate(shakeX, shakeY);
    }

    const time = gameTimeRef.current;
    const currentPhase = battlePhaseRef.current;
    const currentStep = rankStepStateRef.current;
    const currentSub = rankSubPhaseRef.current;
    const isNavyTest = currentTheaterRef.current === 'navy_test';
    const isAirStrikeTest = currentTheaterRef.current === 'air_strike_test';
    const isMaritime = isNavyTest || isAirStrikeTest;

    // 1. Draw WWII Top-Down Battlefield Terrain (Passing dynamic craters & blood puddles)
    drawWWIIBattlefield(
      ctx,
      canvasWidth,
      canvasHeight,
      time,
      currentTheaterRef.current,
      cratersRef.current,
      bloodPuddlesRef.current,
      casualtyRecordsRef.current,
    );

    // 2. Draw Animated Sea at the edge of the troop lines (for land theaters)
    if (!isMaritime) {
      drawAnimatedSea(ctx, canvasWidth, canvasHeight, time);
    }

    // 2a. Draw Offshore Support Battleship in European Test (Coast / Forest)
    if (
      currentTheaterRef.current === 'normandy' &&
      offshoreBattleshipRef.current.active &&
      offshoreBattleshipRef.current.x > -280
    ) {
      drawOffshoreBattleship(
        ctx,
        offshoreBattleshipRef.current.x,
        offshoreBattleshipRef.current.y,
        offshoreBattleshipRef.current.recoilX,
        offshoreBattleshipRef.current.recoilTrauma,
        offshoreBattleshipRef.current.turretAngle,
        offshoreBattleshipRef.current.turretRecoil,
        offshoreBattleshipRef.current.muzzleFlash,
        time,
      );
    }

    // 2b. Draw Persistent Burning Ground Fires (omitted in AIR STRIKE TEST for "smoke but no fire")
    if (!isAirStrikeTest) {
      drawGroundFires(ctx, groundFiresRef.current, time);
    }

    // 2c. Draw Water Geyser Splash Explosions from Torpedoes & Naval Shells / Bombs
    drawWaterGeysers(ctx, waterGeysersRef.current);

    const isVictoryCheer = victorySeqRef.current.active;

    // 3. Draw Clean Top Pixel-Art Roman Numeral Badges (Completely free of column dim shading or vertical fills)
    if (!isVictoryCheer) {
      const badgeAlpha = deploymentRef.current.active
        ? deploymentRef.current.rankSymbolsAlpha
        : 1.0;

      if (badgeAlpha > 0.01) {
        const romans: ('I' | 'II' | 'III' | 'IV')[] = ['I', 'II', 'III', 'IV'];

        // Attacker Badges (Col 0: Rank IV, Col 1: Rank III, Col 2: Rank II, Col 3: Rank I)
        for (let c = 0; c < 4; c++) {
          const rankNum = 4 - c;
          const roman = romans[rankNum - 1];
          const isActive = currentPhase === `ATK_RANK_${rankNum}`;
          const colCenterX = 55 + c * 105 + 49;
          drawPixelRankBadge(ctx, colCenterX, 120, roman, isActive, 'attacker', badgeAlpha);
        }

        // Defender Badges (Col 0: Rank I, Col 1: Rank II, Col 2: Rank III, Col 3: Rank IV)
        for (let c = 0; c < 4; c++) {
          const rankNum = c + 1;
          const roman = romans[rankNum - 1];
          const isActive = currentPhase === `DEF_RANK_${rankNum}`;
          const colCenterX = 815 + c * 105 + 49;
          drawPixelRankBadge(ctx, colCenterX, 120, roman, isActive, 'defender', badgeAlpha);
        }
      }
    }

    // 4. Central Synergy Link Lines
    attackerUnitsRef.current.forEach((u) => {
      if (u.hasSynergyBonus && u.pairedWithUid && !u.isDestroyed) {
        const partner = attackerUnitsRef.current.find((p) => p.uid === u.pairedWithUid);
        if (partner && !partner.isDestroyed) {
          const uPos = getUnitScreenPos(u);
          const pPos = getUnitScreenPos(partner);

          ctx.save();
          ctx.strokeStyle = PALETTE.mustardBrass;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(uPos.x, uPos.y);
          ctx.lineTo(pPos.x, pPos.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    });

    // 5. Draw Units on Battlefield
    const badgeImg = assets['icon_combined_arms_badge'];
    const theater = THEATERS[currentTheaterRef.current];

    // Attacker units
    attackerUnitsRef.current.forEach((unit) => {
      if (unit.status === 'dead' || (unit.fadeAlpha !== undefined && unit.fadeAlpha <= 0)) return;
      const pos = getUnitScreenPos(unit);
      const isFlying = unit.type !== 'carrier' && activeSortiesRef.current.some((s) => s.unitUid === unit.uid);
      const casRec = casualtyRecordsRef.current.find((c) => c.unitUid === unit.uid);
      const smokeAlpha = casRec ? casRec.smokeAlpha : 1.0;
      drawProceduralUnit(ctx, unit, pos.x, pos.y, 1, time, theater.attackerColor, badgeImg, isFlying, smokeAlpha, currentTheaterRef.current);

      if (unit.maxHp > 1 && unit.status !== 'downed') {
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.fillRect(pos.x - 8, pos.y - 18, 16, 5);
        ctx.fillStyle = unit.currentHp === 2 ? PALETTE.fieldSage : PALETTE.crimson;
        ctx.fillRect(pos.x - 7, pos.y - 17, (unit.currentHp / unit.maxHp) * 14, 3);
      }
    });

    // Defender units
    defenderUnitsRef.current.forEach((unit) => {
      if (unit.status === 'dead' || (unit.fadeAlpha !== undefined && unit.fadeAlpha <= 0)) return;
      const pos = getUnitScreenPos(unit);
      const isFlying = unit.type !== 'carrier' && activeSortiesRef.current.some((s) => s.unitUid === unit.uid);
      const casRec = casualtyRecordsRef.current.find((c) => c.unitUid === unit.uid);
      const smokeAlpha = casRec ? casRec.smokeAlpha : 1.0;
      drawProceduralUnit(ctx, unit, pos.x, pos.y, 1, time, theater.defenderColor, badgeImg, isFlying, smokeAlpha, currentTheaterRef.current);

      if (unit.maxHp > 1 && unit.status !== 'downed') {
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.fillRect(pos.x - 8, pos.y - 18, 16, 5);
        ctx.fillStyle = unit.currentHp === 2 ? PALETTE.fieldSage : PALETTE.crimson;
        ctx.fillRect(pos.x - 7, pos.y - 17, (unit.currentHp / unit.maxHp) * 14, 3);
      }
    });

    // 6. Draw Falling Bombs tumbling onto enemy ground
    drawDroppingBombs(ctx, droppingBombsRef.current);

    // 7. Draw Active Plane Sorties (Swooping strafing / bombing flight loops with dynamic shadow fade)
    activeSortiesRef.current.forEach((sortie) => {
      const fColor = sortie.side === 'attacker' ? theater.attackerColor : theater.defenderColor;
      drawPlaneSortie(ctx, sortie, time, fColor);
    });

    // 7b. Draw Independent World-Space Plane Bullets & Tracers
    drawPlaneBullets(ctx, planeBulletsRef.current);

    // 8. Draw Projectile Shells & Tracers with Actual Radial Gradient Bloom
    combatShellsRef.current.forEach((shell) => {
      ctx.save();

      // Fast-moving white dithered torpedo wake cutting through the water
      if (shell.isTorpedo) {
        for (let i = 0; i < shell.trail.length; i++) {
          const pt = shell.trail[i];
          const alpha = (i / shell.trail.length) * 0.85;
          ctx.fillStyle = PALETTE.sandCream;
          ctx.globalAlpha = alpha;
          ctx.fillRect(Math.round(pt.x) - 1, Math.round(pt.y) - 1, 4, 2);
          if (i % 2 === 0) {
            ctx.fillStyle = PALETTE.spruceSea;
            ctx.fillRect(Math.round(pt.x) - 2, Math.round(pt.y) + 2, 2, 2);
            ctx.fillStyle = PALETTE.sandCream;
            ctx.fillRect(Math.round(pt.x) + 3, Math.round(pt.y) - 2, 2, 2);
          }
        }
        if (shell.trail.length > 0) {
          const head = shell.trail[shell.trail.length - 1];
          ctx.fillStyle = PALETTE.bunkerCharcoal;
          ctx.fillRect(Math.round(head.x) - 4, Math.round(head.y) - 1.5, 8, 3);
          ctx.fillStyle = PALETTE.sandCream;
          ctx.fillRect(Math.round(head.x) + 2, Math.round(head.y) - 1, 3, 2);
        }
        ctx.restore();
        return;
      }

      for (let i = 0; i < shell.trail.length; i++) {
        const pt = shell.trail[i];
        const alpha = (i / shell.trail.length) * 0.7;

        ctx.fillStyle = shell.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      if (shell.trail.length > 0) {
        const head = shell.trail[shell.trail.length - 1];
        const hx = Math.round(head.x);
        const hy = Math.round(head.y);

        // Actual Canvas 2D radial gradient bloom (lighter blend)
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const bloomR = 12;
        const bGrad = ctx.createRadialGradient(hx, hy, 1, hx, hy, bloomR);
        bGrad.addColorStop(0, 'rgba(255, 245, 180, 0.9)');
        bGrad.addColorStop(0.35, 'rgba(240, 180, 80, 0.5)');
        bGrad.addColorStop(0.75, 'rgba(210, 110, 40, 0.18)');
        bGrad.addColorStop(1, 'rgba(180, 60, 20, 0)');
        ctx.fillStyle = bGrad;
        ctx.beginPath();
        ctx.arc(hx, hy, bloomR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Warm mid halo
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();

        // Bright bullet core
        ctx.globalAlpha = 1;
        ctx.fillStyle = PALETTE.sandCream;
        ctx.beginPath();
        ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // 9. Draw Combat VFX: Lingering Smoke Puffs, Shockwaves, Debris, Blood Splatters, Sparks
    drawSmokePuffs(ctx, smokePuffsRef.current);
    drawShockwaves(ctx, shockwavesRef.current);
    drawFlyingDebris(ctx, flyingDebrisRef.current);
    drawBloodSplatters(ctx, bloodSplattersRef.current);

    sparksRef.current.forEach((s) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life / s.maxLife);
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
      ctx.restore();
    });

    // 10. TACTICAL DICE TRAY (Faded out during Victory Sequence)
    if (!isVictoryCheer) {
      const trayX = 490;
      const trayY = 538;
      const trayW = 300;
      const trayH = 162;

      // Brass/leather outer frame
      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(trayX - 5, trayY - 5, trayW + 10, trayH + 10);
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(trayX - 2, trayY - 2, trayW + 4, trayH + 4);

      // Deep bunker felt interior
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(trayX, trayY, trayW, trayH);

      // Corner rivet details
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(trayX + 3, trayY + 3, 3, 3);
      ctx.fillRect(trayX + trayW - 6, trayY + 3, 3, 3);
      ctx.fillRect(trayX + 3, trayY + trayH - 6, 3, 3);
      ctx.fillRect(trayX + trayW - 6, trayY + trayH - 6, 3, 3);

      // Centered "SPACE TO ROLL" when waiting to roll
      const isWaitingToRoll =
        (currentStep === 'READY_TO_FIRE' || currentPhase === 'IDLE' || currentPhase === 'ROUND_RESOLVED') &&
        currentPhase !== 'DEPLOYMENT_MARCH' &&
        currentPhase !== 'DEPLOYMENT_READY' &&
        currentPhase !== 'ALLOCATION' &&
        currentPhase !== 'AA_ALLOCATION' &&
        currentPhase !== 'ATTACKER_DECISION' &&
        activeDiceRef.current.length === 0;

      if (isWaitingToRoll) {
        const pulse = (Math.sin(time * 4) + 1) / 2;
        const textColor = pulse > 0.35 ? PALETTE.sandCream : PALETTE.sandTan;
        drawPixelString(
          ctx,
          'SPACE TO ROLL',
          trayX + Math.round(trayW / 2),
          trayY + Math.round((trayH - 15) / 2),
          3,
          textColor,
          PALETTE.bunkerCharcoal,
        );
      }

      // 11. Tumbling Pixel Dice inside the Bottom Sea Tray
      activeDiceRef.current.forEach((die) => {
        ctx.save();
        ctx.translate(die.x, die.y);
        ctx.rotate(die.rotation);

        const dSize = 20;
        const isFlashingWhite = (die.hitFlashTimer || 0) > 0.05;

        // Drop shadow in bunkerCharcoal
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.fillRect(-dSize / 2 + 2, -dSize / 2 + 2, dSize, dSize);

        if (isFlashingWhite) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(-dSize / 2, -dSize / 2, dSize, dSize);

          ctx.strokeStyle = PALETTE.sandCream;
          ctx.lineWidth = 2;
          ctx.strokeRect(-dSize / 2, -dSize / 2, dSize, dSize);

          ctx.fillStyle = PALETTE.sandCream;
          ctx.fillRect(-dSize / 2 - 2, -dSize / 2 - 2, 2, 2);
          ctx.fillRect(dSize / 2, -dSize / 2 - 2, 2, 2);
          ctx.fillRect(-dSize / 2 - 2, dSize / 2, 2, 2);
          ctx.fillRect(dSize / 2, dSize / 2, 2, 2);
        } else if (die.isHit && die.settled) {
          ctx.fillStyle = PALETTE.crimson;
          ctx.fillRect(-dSize / 2, -dSize / 2, dSize, dSize);

          ctx.strokeStyle = PALETTE.plum;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-dSize / 2, -dSize / 2, dSize, dSize);

          ctx.fillStyle = PALETTE.terracotta;
          ctx.fillRect(-dSize / 2 + 1, -dSize / 2 + 1, dSize - 2, 1);
          ctx.fillRect(-dSize / 2 + 1, -dSize / 2 + 1, 1, dSize - 2);
        } else {
          ctx.fillStyle = PALETTE.sandTan;
          ctx.fillRect(-dSize / 2, -dSize / 2, dSize, dSize);
          ctx.strokeStyle = PALETTE.deepTaupe;
          ctx.lineWidth = 1;
          ctx.strokeRect(-dSize / 2, -dSize / 2, dSize, dSize);
        }

        if (isFlashingWhite) {
          ctx.fillStyle = PALETTE.plum;
        } else if (die.isHit && die.settled) {
          ctx.fillStyle = PALETTE.sandCream;
        } else {
          ctx.fillStyle = PALETTE.bunkerCharcoal;
        }
        const drawPip = (px: number, py: number) => {
          ctx.beginPath();
          ctx.arc(px, py, 1.8, 0, Math.PI * 2);
          ctx.fill();
        };

        const val = die.displayedValue || die.rolledValue;
        if (val === 1) drawPip(0, 0);
        else if (val === 2) {
          drawPip(-4, -4);
          drawPip(4, 4);
        } else if (val === 3) {
          drawPip(-4, -4);
          drawPip(0, 0);
          drawPip(4, 4);
        } else if (val === 4) {
          drawPip(-4, -4);
          drawPip(4, -4);
          drawPip(-4, 4);
          drawPip(4, 4);
        } else if (val === 5) {
          drawPip(-4, -4);
          drawPip(4, -4);
          drawPip(0, 0);
          drawPip(-4, 4);
          drawPip(4, 4);
        } else if (val === 6) {
          drawPip(-4, -5);
          drawPip(4, -5);
          drawPip(-4, 0);
          drawPip(4, 0);
          drawPip(-4, 5);
          drawPip(4, 5);
        }

        ctx.restore();
      });

      // 11b. Draw Floating Pixel Hit Texts
      drawFloatingTexts(ctx, floatingTextsRef.current);

      // 11c. ATTACKER DECISION MENU
      if (currentPhase === 'ATTACKER_DECISION') {
        const btnW = 130;
        const btnH = 56;
        const leftBtnX = trayX - btnW - 14;
        const rightBtnX = trayX + trayW + 14;
        const btnY = trayY + Math.round((trayH - btnH) / 2);

        // LEFT BUTTON: RETREAT
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.fillRect(leftBtnX + 3, btnY + 3, btnW, btnH);
        ctx.fillStyle = PALETTE.navalSteel;
        ctx.fillRect(leftBtnX, btnY, btnW, btnH);
        ctx.fillStyle = '#637285';
        ctx.fillRect(leftBtnX, btnY, btnW, 2);
        ctx.fillRect(leftBtnX, btnY, 2, btnH);
        ctx.fillStyle = '#2d3540';
        ctx.fillRect(leftBtnX, btnY + btnH - 2, btnW, 2);
        ctx.fillRect(leftBtnX + btnW - 2, btnY, 2, btnH);
        ctx.strokeStyle = PALETTE.fieldSage;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(leftBtnX + 2, btnY + 2, btnW - 4, btnH - 4);
        ctx.fillStyle = PALETTE.sandCream;
        ctx.fillRect(leftBtnX + 4, btnY + 4, 2, 2);
        ctx.fillRect(leftBtnX + btnW - 6, btnY + 4, 2, 2);
        ctx.fillRect(leftBtnX + 4, btnY + btnH - 6, 2, 2);
        ctx.fillRect(leftBtnX + btnW - 6, btnY + btnH - 6, 2, 2);

        drawPixelString(
          ctx,
          'RETREAT',
          leftBtnX + btnW / 2,
          btnY + 14,
          3,
          PALETTE.sandCream,
          PALETTE.bunkerCharcoal,
        );

        ctx.fillStyle = PALETTE.trenchMudBone;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[ WITHDRAW ]', leftBtnX + btnW / 2, btnY + 44);

        // RIGHT BUTTON: PRESS ON
        const pulse = (Math.sin(time * 6) + 1) / 2;
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.fillRect(rightBtnX + 3, btnY + 3, btnW, btnH);
        ctx.fillStyle = PALETTE.crimson;
        ctx.fillRect(rightBtnX, btnY, btnW, btnH);
        ctx.fillStyle = '#b85f57';
        ctx.fillRect(rightBtnX, btnY, btnW, 2);
        ctx.fillRect(rightBtnX, btnY, 2, btnH);
        ctx.fillStyle = PALETTE.plum;
        ctx.fillRect(rightBtnX, btnY + btnH - 2, btnW, 2);
        ctx.fillRect(rightBtnX + btnW - 2, btnY, 2, btnH);
        ctx.strokeStyle = pulse > 0.4 ? PALETTE.sandCream : PALETTE.terracotta;
        ctx.lineWidth = 2;
        ctx.strokeRect(rightBtnX + 2, btnY + 2, btnW - 4, btnH - 4);
        ctx.fillStyle = PALETTE.sandCream;
        ctx.fillRect(rightBtnX + 4, btnY + 4, 2, 2);
        ctx.fillRect(rightBtnX + btnW - 6, btnY + 4, 2, 2);
        ctx.fillRect(rightBtnX + 4, btnY + btnH - 6, 2, 2);
        ctx.fillRect(rightBtnX + btnW - 6, btnY + btnH - 6, 2, 2);

        drawPixelString(
          ctx,
          'PRESS ON',
          rightBtnX + btnW / 2,
          btnY + 14,
          3,
          PALETTE.sandCream,
          PALETTE.plum,
        );

        ctx.fillStyle = PALETTE.sandCream;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`[ ROUND ${roundNumber + 1} ]`, rightBtnX + btnW / 2, btnY + 44);
      }

      // 11d. "YOUR LAST HITS" Tracker: Appears ONLY after player has completed their attacking shooting turn for the round
      if (playerAttackShootingCompleteRef.current && lastPlayerHitsRef.current !== null) {
        const hitsCount = lastPlayerHitsRef.current;
        const trackerText = `YOUR LAST HITS: ${hitsCount}`;
        const trackerY = trayY + trayH - 16;

        ctx.save();
        // Darkened recessed plate at the bottom of the dice tray
        ctx.fillStyle = 'rgba(35, 28, 34, 0.9)';
        ctx.fillRect(trayX + 30, trackerY - 3, trayW - 60, 14);
        ctx.strokeStyle = PALETTE.deepTaupe;
        ctx.lineWidth = 1;
        ctx.strokeRect(trayX + 30, trackerY - 3, trayW - 60, 14);

        // Smaller yellow/cream pixel text (#DFCE91 / #CAA574)
        drawPixelString(
          ctx,
          trackerText,
          trayX + Math.round(trayW / 2),
          trackerY,
          2, // smaller 2x pixel font
          PALETTE.sandCream, // #DFCE91
          PALETTE.bunkerCharcoal,
        );
        ctx.restore();
      }
    }

    // 12. Top HITS Banner Just Above the Treeline / Horizon in the Skybox
    if (!isVictoryCheer && (currentPhase !== 'IDLE' || attackerHitsRef.current > 0 || defenderHitsRef.current > 0)) {
      const isAtkTurn = currentPhase.startsWith('ATK_');
      const isDefTurn = currentPhase.startsWith('DEF_');
      const isAlloc = currentPhase === 'ALLOCATION';

      let displayHits = 0;
      let isFriendlyShooting = true;

      if (isAtkTurn) {
        displayHits = attackerHitsRef.current;
        isFriendlyShooting = true;
      } else if (isDefTurn) {
        displayHits = defenderHitsRef.current;
        isFriendlyShooting = false;
      } else if (isAlloc) {
        if (pendingAttackerHits > 0) {
          displayHits = defenderHitsRef.current;
          isFriendlyShooting = false;
        } else {
          displayHits = attackerHitsRef.current;
          isFriendlyShooting = true;
        }
      } else {
        if (defenderHitsRef.current > 0) {
          displayHits = defenderHitsRef.current;
          isFriendlyShooting = false;
        } else {
          displayHits = attackerHitsRef.current;
          isFriendlyShooting = true;
        }
      }

      ctx.save();
      const bannerW = 132;
      const bannerH = 24;
      const bannerX = Math.round((canvasWidth - bannerW) / 2);
      const bannerY = 14;

      const textColor = isFriendlyShooting ? PALETTE.sandCream : PALETTE.crimson;
      const borderColor = isFriendlyShooting ? PALETTE.mustardBrass : PALETTE.plum;

      // Drop shadow in dark charcoal
      ctx.fillStyle = 'rgba(20, 16, 22, 0.75)';
      ctx.fillRect(bannerX + 2, bannerY + 2, bannerW, bannerH);

      // Deep bunker charcoal felt plate
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(bannerX, bannerY, bannerW, bannerH);

      // Frame border with dynamic hit flash highlight
      const hitFlash = gameTimeRef.current - lastHitTimeRef.current < 0.22;
      ctx.strokeStyle = hitFlash ? PALETTE.sandCream : borderColor;
      ctx.lineWidth = hitFlash ? 2 : 1.5;
      ctx.strokeRect(bannerX, bannerY, bannerW, bannerH);

      // Corner rivets
      ctx.fillStyle = isFriendlyShooting ? PALETTE.sandCream : PALETTE.crimson;
      ctx.fillRect(bannerX + 2, bannerY + 2, 2, 2);
      ctx.fillRect(bannerX + bannerW - 4, bannerY + 2, 2, 2);
      ctx.fillRect(bannerX + 2, bannerY + bannerH - 4, 2, 2);
      ctx.fillRect(bannerX + bannerW - 4, bannerY + bannerH - 4, 2, 2);

      // Clean pixel font banner: HITS: [displayedCount]
      drawPixelString(
        ctx,
        `HITS: ${displayHits}`,
        bannerX + bannerW / 2,
        bannerY + 5,
        3,
        textColor,
        PALETTE.bunkerCharcoal,
      );
      ctx.restore();
    }

    // 13. Black Fade-out overlay for Victory Sequence transition
    if (victorySeqRef.current.blackFadeAlpha > 0.01) {
      ctx.save();
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.globalAlpha = Math.min(1.0, victorySeqRef.current.blackFadeAlpha);
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
    }

    ctx.restore();
  };

  // --- Game Loop ---
  const updateRef = useRef(update);
  const drawRef = useRef(draw);
  updateRef.current = update;
  drawRef.current = draw;

  useEffect(() => {
    let raf = 0;
    const loop = (time: number) => {
      const mult = speedMultiplierRef.current || 1;
      stepperRef.current?.(time, (dt) => updateRef.current(dt * mult));
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) drawRef.current(ctx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const isMusicPlaying = gameState.status === 'PLAYING' && !isGameMenuOpen;

  const liveAttackerCount = attackerUnits.filter(isCombatActive).length;
  const liveDefenderCount = defenderUnits.filter(isCombatActive).length;

  return (
    <div className="fixed inset-0 overflow-hidden touch-none flex flex-col bg-stone-950 text-stone-100 font-mono select-none">
      {!assetsReady && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-stone-950 text-amber-400">
          <div className="text-xl font-bold tracking-widest animate-pulse">
            INITIALIZING WAR ROOM ARCHIVES...
          </div>
        </div>
      )}

      {/* Ambient War Room March Audio */}
      <BackgroundMusic
        url={BACKGROUND_MUSIC_URL}
        isPlaying={isMusicPlaying}
        isMuted={isMusicMuted}
      />

      {/* TOP HUD: Dedicated Safe Zone Container (Fades out cleanly during Victory Sequence) */}
      <header className={`w-full bg-[#423840] border-b-2 border-[#5E4E54] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 z-20 shrink-0 text-xs transition-opacity duration-700 ${isVictorySequenceActive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex items-center gap-3">
          {/* Interactive Theater Selector with Custom Dropdown & Direct Switch */}
          <div className="relative" ref={theaterDropdownRef}>
            <button
              onClick={() => setIsTheaterMenuOpen((prev) => !prev)}
              data-testid="theater-dropdown-btn"
              title="Change Theater of War"
              className="flex items-center gap-1.5 bg-[#2b242a] hover:bg-[#5E4E54] active:scale-95 px-2.5 py-1 rounded border border-[#7D6652] text-xs font-bold transition-all cursor-pointer shadow-sm">
              <span className="text-[#DFCE91] tracking-wider">THEATER:</span>
              <span className="text-[#CAA574] uppercase max-w-[150px] truncate">
                {THEATERS[currentTheater]?.name || currentTheater}
              </span>
              <ChevronDown
                size={13}
                className={`text-[#DFCE91] transition-transform duration-150 ${isTheaterMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isTheaterMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-[#423840] border-2 border-[#A1A258] rounded-lg shadow-2xl z-50 py-1 font-mono text-xs animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2.5 py-1 border-b border-[#5E4E54] text-[10px] text-[#DFCE91] font-bold tracking-wider flex items-center justify-between">
                  <span>SELECT THEATER</span>
                  <span className="text-[9px] text-[#A69C90]">RESETS BATTLE</span>
                </div>
                {Object.values(THEATERS).map((th) => {
                  const isCurrent = th.id === currentTheater;
                  return (
                    <button
                      key={th.id}
                      onClick={() => handleSelectTheater(th.id)}
                      className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors ${
                        isCurrent
                          ? 'bg-[#5E4E54] text-[#DFCE91] font-black border-l-4 border-[#DFCE91]'
                          : 'text-[#CAA574] hover:bg-[#2b242a] hover:text-[#DFCE91]'
                      }`}>
                      <span className="truncate">{th.name}</span>
                      {isCurrent && <span className="text-[10px] text-[#A1A258] font-bold ml-2">ACTIVE</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-[#2b242a] px-2 py-1 rounded border border-[#5E4E54] text-[#A69C90] font-bold">
            ROUND <span className="text-[#DFCE91]">{roundNumber}</span>
          </div>

          <div className="bg-[#2b242a] px-2 py-1 rounded border border-[#5E4E54] text-[#A69C90] font-bold hidden sm:block">
            SCORE: <span className="text-[#8DA082]">{gameState.score}</span>
          </div>
        </div>

        {/* Center: Force Strength Tally */}
        <div className="flex items-center gap-4 bg-[#2b242a] px-3 py-1 rounded border border-[#5E4E54]">
          <div className="flex items-center gap-1.5 text-[#8DA082] font-bold">
            <Shield size={14} />
            <span>ATTACKER: {liveAttackerCount}</span>
          </div>
          <span className="text-[#A69C90] font-black">VS</span>
          <div className="flex items-center gap-1.5 text-[#B77958] font-bold">
            <Crosshair size={14} />
            <span>DEFENDER: {liveDefenderCount}</span>
          </div>
        </div>

        {/* Right: Debug Auto-Win, Auto-Roll, Speed Toggle, Army Builder & Menu Buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Auto-Roll Toggle Button */}
          <button
            onClick={() => (isAutoRolling ? setIsAutoRolling(false) : handleAutoRoll())}
            title={isAutoRolling ? 'Halt Auto-Roll' : 'Auto-Roll Salvos'}
            data-testid="autoroll-btn"
            className={`px-2 py-1 rounded font-bold text-[10px] tracking-wider transition-colors flex items-center gap-1 border shadow-sm active:scale-95 ${
              isAutoRolling
                ? 'bg-[#9A4E48] hover:bg-[#B77958] text-[#DFCE91] border-[#DFCE91] animate-pulse'
                : 'bg-[#5E4E54] hover:bg-[#7D6652] text-[#DFCE91] border-[#7D6652]'
            }`}>
            <FastForward size={12} />
            <span className="hidden sm:inline">{isAutoRolling ? 'HALT AUTO' : 'AUTO-ROLL'}</span>
          </button>

          {/* Discreet Debug Auto-Win / Kill Enemy Forces Button */}
          <button
            onClick={handleInstantKillDefenders}
            title="Debug: Auto-Win / Eliminate Enemy Forces (Shortcut: K)"
            data-testid="debug-autowin-btn"
            className="px-2 py-1 bg-[#6F3B4A]/70 hover:bg-[#9A4E48] text-[#DFCE91] border border-[#9A4E48] rounded font-bold text-[10px] tracking-wider transition-colors flex items-center gap-1 active:scale-95 shadow-sm">
            <Zap size={11} className="text-[#DFCE91]" />
            <span className="hidden sm:inline">AUTO-WIN</span>
            <span className="sm:hidden">WIN</span>
          </button>

          {/* Speed Toggle Button (Displays '>>' at 1x, '>' at 2x) */}
          <button
            onClick={toggleSpeed}
            title={speedMultiplier === 1 ? 'Double Speed 2x (Currently 1x)' : 'Normal Speed 1x (Currently 2x)'}
            data-testid="speed-toggle-btn"
            className={`min-w-[34px] h-[28px] px-2 py-0.5 rounded font-black text-xs tracking-tight transition-all flex items-center justify-center border shadow-sm active:scale-95 ${
              speedMultiplier === 2
                ? 'bg-[#A1A258] text-[#423840] border-[#DFCE91] ring-1 ring-[#DFCE91]'
                : 'bg-[#5E4E54] hover:bg-[#7D6652] text-[#DFCE91] border-[#7D6652]'
            }`}>
            {speedMultiplier === 1 ? '>>' : '>'}
          </button>

          {/* Army Builder Button */}
          <button
            onClick={() => setIsSandboxOpen((prev) => !prev)}
            className="px-2.5 py-1 bg-[#5E4E54] hover:bg-[#7D6652] text-[#DFCE91] border border-[#7D6652] rounded font-bold transition-colors flex items-center gap-1 text-[11px]">
            <RefreshCw size={13} />
            <span className="hidden md:inline">ARMY BUILDER</span>
          </button>

          <button
            onClick={() => setIsGameMenuOpen(true)}
            data-testid="menu-toggle-btn"
            className="min-w-[48px] min-h-[38px] px-3 py-1 bg-[#5E4E54] hover:bg-[#7D6652] text-[#DFCE91] border border-[#7D6652] rounded font-bold flex items-center justify-center gap-1 transition-colors">
            <Menu size={16} />
            <span>MENU</span>
          </button>
        </div>
      </header>

      {/* MAIN GAMEPLAY VIEWPORT */}
      <div className="flex-1 w-full min-h-0 relative flex items-center justify-center bg-[#423840]">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onClick={handleCanvasClick}
          style={{
            aspectRatio: `${canvasWidth} / ${canvasHeight}`,
            width: `min(100%, calc(100vh * ${canvasWidth} / ${canvasHeight}))`,
          }}
          className="h-auto max-w-full max-h-full cursor-crosshair drop-shadow-2xl"
        />

        {/* EARLY AA ATTACK CASUALTY ALLOCATION MODAL */}
        {battlePhase === 'AA_ALLOCATION' && !isVictorySequenceActive && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 z-30 pointer-events-auto">
            <div className="w-full max-w-lg bg-[#423840] border-2 border-[#9A4E48] rounded-xl p-5 shadow-2xl flex flex-col gap-3.5 text-xs font-mono animate-in fade-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-[#5E4E54] pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[#9A4E48]/30 border border-[#9A4E48] rounded text-[#DFCE91]">
                    <Crosshair size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-[#DFCE91] text-sm md:text-base tracking-wider">
                      AA ATTACK CASUALTIES
                    </h3>
                    <p className="text-[10px] text-[#A69C90]">
                      DEFENDING FLAK INTERCEPTION // AIR LOSS ALLOCATION
                    </p>
                  </div>
                </div>
                <div
                  className={`px-3 py-1.5 rounded-lg border font-black text-xs tracking-wider flex items-center gap-1.5 shadow ${
                    pendingAaHits > 0
                      ? 'bg-[#9A4E48] border-[#B77958] text-[#DFCE91] animate-pulse'
                      : 'bg-[#527A71] border-[#8DA082] text-[#DFCE91]'
                  }`}>
                  <Zap size={14} />
                  <span>
                    {pendingAaHits > 0
                      ? `${pendingAaHits} HIT${pendingAaHits > 1 ? 'S' : ''} TO ASSIGN`
                      : '0 HITS REMAINING'}
                  </span>
                </div>
              </div>

              {/* Instructions Banner */}
              <div className="bg-[#2b242a] p-3 rounded-lg border border-[#5E4E54] text-[11px] leading-relaxed">
                {pendingAaHits > 0 ? (
                  <p className="text-[#DFCE91]">
                    Defending Flak fire intercepted attacking air units! Allocate casualties specifically among your <span className="text-[#CAA574] font-bold">Aircraft</span>. Shot down planes are immediately removed from play and cannot participate in subsequent bombardment or combat rounds.
                  </p>
                ) : (
                  <p className="text-[#8DA082] font-bold">
                    ✓ All aircraft casualties allocated. Confirmed planes are removed from play. Ready to proceed to offshore bombardment / assault.
                  </p>
                )}
              </div>

              {/* Aircraft Selection Rows */}
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-bold text-[#CAA574] uppercase tracking-wider flex justify-between px-1">
                  <span>AIR WING UNITS</span>
                  <span>SELECT CASUALTY</span>
                </div>
                {(['fighter', 'tactical_bomber', 'strategic_bomber'] as UnitType[])
                  .filter((t) => attackerUnits.some((u) => (isCombatActive(u) || u.isPendingCasualty) && u.type === t))
                  .map((airType) => {
                    const def = UNIT_DEFINITIONS[airType];
                    const activeCount = attackerUnits.filter((u) => isCombatActive(u) && u.type === airType).length;
                    const pendingCount = attackerUnits.filter((u) => u.isPendingCasualty && !u.isPermanentCasualty && u.type === airType).length;
                    const canAssign = pendingAaHits > 0 && activeCount > 0;

                    return (
                      <button
                        key={airType}
                        onClick={() => handleAssignHitToAirUnit(airType)}
                        disabled={!canAssign && pendingCount === 0}
                        className={`p-2.5 rounded-lg border flex items-center justify-between text-left transition-all ${
                          canAssign
                            ? 'bg-[#2b242a] hover:bg-[#5E4E54] border-[#7D6652] text-[#DFCE91] active:scale-[0.99] cursor-pointer ring-1 ring-transparent hover:ring-[#A1A258]'
                            : pendingCount > 0
                            ? 'bg-[#9A4E48]/25 border-[#9A4E48] text-[#DFCE91] cursor-pointer'
                            : 'bg-[#2b242a]/40 border-[#5E4E54]/40 text-[#A69C90]/40 cursor-not-allowed'
                        }`}>
                        <div className="flex items-center gap-2.5">
                          <span className="font-black px-2 py-0.5 rounded bg-[#423840] border border-[#5E4E54] text-[#DFCE91] text-[10px]">
                            RANK {['I', 'II', 'III', 'IV'][def.baseAttackRank - 1]}
                          </span>
                          <div>
                            <div className="font-bold text-xs text-[#DFCE91] capitalize">
                              {def.name}
                            </div>
                            <div className="text-[9px] text-[#A69C90]">
                              {activeCount} active &bull; Cost: ${def.cost}
                              {pendingCount > 0 && (
                                <span className="text-[#DFCE91] font-bold ml-1.5 bg-[#9A4E48] px-1.5 py-0.5 rounded border border-[#6F3B4A]">
                                  {pendingCount} lost
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div>
                          {canAssign ? (
                            <span className="text-[10px] font-black px-2.5 py-1 bg-[#9A4E48] hover:bg-[#B77958] text-[#DFCE91] rounded border border-[#6F3B4A] shadow">
                              + ASSIGN HIT
                            </span>
                          ) : pendingCount > 0 ? (
                            <span className="text-[10px] font-bold px-2 py-1 bg-[#6F3B4A] text-[#DFCE91] rounded border border-[#9A4E48]">
                              {pendingCount} SELECTED
                            </span>
                          ) : (
                            <span className="text-[10px] text-[#A69C90]/60 font-bold px-2 py-1">
                              {activeCount === 0 ? 'NONE ACTIVE' : 'SECURE'}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
              </div>

              {/* Modal Footer Controls */}
              <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#5E4E54]">
                {pendingAaHits > 0 ? (
                  <button
                    onClick={handleAutoAssignAaCasualties}
                    className="min-h-[42px] px-3.5 py-1.5 bg-[#5E4E54] hover:bg-[#7D6652] active:scale-95 text-[#DFCE91] border border-[#7D6652] rounded-lg font-bold text-xs transition-colors flex items-center gap-1.5 shadow">
                    <Zap size={14} className="text-[#A1A258]" />
                    <span>AUTO-ASSIGN CHEAPEST</span>
                  </button>
                ) : (
                  <div className="text-[11px] text-[#8DA082] font-bold flex items-center gap-1">
                    <span>AIR LOSSES CONFIRMED</span>
                  </div>
                )}

                <button
                  onClick={handleFinalizeAaCasualties}
                  disabled={pendingAaHits > 0}
                  className={`min-h-[42px] px-5 py-1.5 rounded-lg font-black text-xs tracking-wider uppercase transition-all shadow flex items-center gap-1.5 border-b-4 ${
                    pendingAaHits === 0
                      ? 'bg-[#DFCE91] hover:bg-[#CAA574] text-[#423840] border-[#9E7F55] active:scale-95 animate-pulse cursor-pointer ring-2 ring-[#A1A258]'
                      : 'bg-[#5E4E54] text-[#A69C90] border-[#423840] opacity-35 cursor-not-allowed'
                  }`}>
                  <ChevronRight size={16} />
                  <span>CONFIRM CASUALTIES</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* WAR ROOM CASUALTY ALLOCATION MODAL */}
        {battlePhase === 'ALLOCATION' && !isVictorySequenceActive && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 z-30 pointer-events-auto">
            <div className="w-full max-w-lg bg-[#423840] border-2 border-[#A1A258] rounded-xl p-5 shadow-2xl flex flex-col gap-3.5 text-xs font-mono animate-in fade-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-[#5E4E54] pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[#9A4E48]/30 border border-[#9A4E48] rounded text-[#DFCE91]">
                    <Crosshair size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-[#DFCE91] text-sm md:text-base tracking-wider">
                      CASUALTY REPORT // ROUND {roundNumber}
                    </h3>
                    <p className="text-[10px] text-[#A69C90]">
                      TACTICAL LOSS ALLOCATION PROTOCOL
                    </p>
                  </div>
                </div>
                <div
                  className={`px-3 py-1.5 rounded-lg border font-black text-xs tracking-wider flex items-center gap-1.5 shadow ${
                    pendingAttackerHits > 0
                      ? 'bg-[#9A4E48] border-[#B77958] text-[#DFCE91] animate-pulse'
                      : 'bg-[#527A71] border-[#8DA082] text-[#DFCE91]'
                  }`}>
                  <Zap size={14} />
                  <span>
                    {pendingAttackerHits > 0
                      ? `${pendingAttackerHits} HIT${pendingAttackerHits > 1 ? 'S' : ''} TO ASSIGN`
                      : '0 HITS REMAINING'}
                  </span>
                </div>
              </div>

              {/* Instructions Banner */}
              <div className="bg-[#2b242a] p-3 rounded-lg border border-[#5E4E54] text-[11px] leading-relaxed">
                {pendingAttackerHits > 0 ? (
                  <p className="text-[#DFCE91]">
                    Friendly vanguard sustained incoming fire! Click any <span className="text-[#CAA574] font-bold">Rank row</span> below or click friendly units on the battlefield to assign casualties. Cheaper ranks preserve high-value armor and air wings.
                  </p>
                ) : (
                  <p className="text-[#8DA082] font-bold">
                    ✓ All casualties accounted for. Downed units will slowly fade into battlefield terrain. Ready to confirm and commence Round {roundNumber + 1}.
                  </p>
                )}
              </div>

              {/* Friendly Rank Selection Rows */}
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-bold text-[#CAA574] uppercase tracking-wider flex justify-between px-1">
                  <span>FRIENDLY FORCE RANKS</span>
                  <span>ASSIGN HIT BY ROW</span>
                </div>
                {[1, 2, 3, 4].map((rankNum) => {
                  const rankRoman = ['I', 'II', 'III', 'IV'][rankNum - 1];
                  // (BETA) Only active living units can be chosen as casualties
                  const unitsInRank = attackerUnits.filter(
                    (u) => isCombatActive(u) && u.effectiveRank === rankNum,
                  );
                  const count = unitsInRank.length;
                  // (BETA) Prior round permanent casualties never appear as pending
                  const pendingInRank = attackerUnits.filter(
                    (u) => u.isPendingCasualty && !u.isPermanentCasualty && u.effectiveRank === rankNum,
                  ).length;
                  const minCost = count > 0 ? Math.min(...unitsInRank.map((u) => UNIT_DEFINITIONS[u.type].cost)) : 0;
                  const canAssign = pendingAttackerHits > 0 && count > 0;

                  return (
                    <button
                      key={rankNum}
                      onClick={() => handleAssignHitToFriendlyRank(rankNum)}
                      disabled={!canAssign && pendingInRank === 0}
                      className={`p-2.5 rounded-lg border flex items-center justify-between text-left transition-all ${
                        canAssign
                          ? 'bg-[#2b242a] hover:bg-[#5E4E54] border-[#7D6652] text-[#DFCE91] active:scale-[0.99] cursor-pointer ring-1 ring-transparent hover:ring-[#A1A258]'
                          : pendingInRank > 0
                          ? 'bg-[#9A4E48]/25 border-[#9A4E48] text-[#DFCE91] cursor-pointer'
                          : 'bg-[#2b242a]/40 border-[#5E4E54]/40 text-[#A69C90]/40 cursor-not-allowed'
                      }`}>
                      <div className="flex items-center gap-2.5">
                        <span className="font-black px-2 py-0.5 rounded bg-[#423840] border border-[#5E4E54] text-[#DFCE91] text-[10px]">
                          RANK {rankRoman}
                        </span>
                        <div>
                          <div className="font-bold text-xs text-[#DFCE91]">
                            {rankNum === 1
                              ? 'Infantry / Light Flak'
                              : rankNum === 2
                              ? 'Howitzer Artillery / Submarines'
                              : rankNum === 3
                              ? 'Heavy Armor Tanks / Fighter Wings'
                              : 'Strategic Bombers / Battleships'}
                          </div>
                          <div className="text-[9px] text-[#A69C90]">
                            {count} active unit{count !== 1 ? 's' : ''} {count > 0 ? `• Value: $${minCost}` : ''}
                            {pendingInRank > 0 && (
                              <span className="text-[#DFCE91] font-bold ml-1.5 bg-[#9A4E48] px-1.5 py-0.5 rounded border border-[#6F3B4A]">
                                {pendingInRank} selected casualty
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        {canAssign ? (
                          <span className="text-[10px] font-black px-2.5 py-1 bg-[#9A4E48] hover:bg-[#B77958] text-[#DFCE91] rounded border border-[#6F3B4A] shadow">
                            + ASSIGN HIT
                          </span>
                        ) : pendingInRank > 0 ? (
                          <span className="text-[10px] font-bold px-2 py-1 bg-[#6F3B4A] text-[#DFCE91] rounded border border-[#9A4E48]">
                            {pendingInRank} SELECTED
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#A69C90]/60 font-bold px-2 py-1">
                            {count === 0 ? 'NO UNITS' : 'SECURE'}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Modal Footer Controls */}
              <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#5E4E54]">
                {pendingAttackerHits > 0 ? (
                  <button
                    onClick={handleAutoAssignFriendlyCasualties}
                    className="min-h-[42px] px-3.5 py-1.5 bg-[#5E4E54] hover:bg-[#7D6652] active:scale-95 text-[#DFCE91] border border-[#7D6652] rounded-lg font-bold text-xs transition-colors flex items-center gap-1.5 shadow">
                    <Zap size={14} className="text-[#A1A258]" />
                    <span>AUTO-ASSIGN CHEAPEST</span>
                  </button>
                ) : (
                  <div className="text-[11px] text-[#8DA082] font-bold flex items-center gap-1">
                    <span>SECTOR LOSSES CONFIRMED</span>
                  </div>
                )}

                <button
                  onClick={handleFinalizeCasualties}
                  disabled={pendingAttackerHits > 0}
                  className={`min-h-[42px] px-5 py-1.5 rounded-lg font-black text-xs tracking-wider uppercase transition-all shadow flex items-center gap-1.5 border-b-4 ${
                    pendingAttackerHits === 0
                      ? 'bg-[#DFCE91] hover:bg-[#CAA574] text-[#423840] border-[#9E7F55] active:scale-95 animate-pulse cursor-pointer ring-2 ring-[#A1A258]'
                      : 'bg-[#5E4E54] text-[#A69C90] border-[#423840] opacity-35 cursor-not-allowed'
                  }`}>
                  <ChevronRight size={16} />
                  <span>CONFIRM CASUALTIES</span>
                </button>
              </div>
            </div>
          </div>
        )}



        {/* Army Sandbox Drawer Overlay */}
        {isSandboxOpen && (
          <div className="absolute inset-y-0 right-0 w-80 bg-[#423840]/95 border-l-2 border-[#7D6652] p-4 overflow-y-auto touch-auto z-30 shadow-2xl flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#5E4E54] pb-2">
              <h3 className="font-black text-[#DFCE91] tracking-wider flex items-center gap-1.5">
                <RefreshCw size={14} /> WAR ROOM BUILDER
              </h3>
              <button
                onClick={() => setIsSandboxOpen(false)}
                className="p-1 hover:bg-[#5E4E54] rounded text-[#A69C90]">
                <X size={16} />
              </button>
            </div>

            <div className="text-[11px] text-[#A69C90]">
              Deploy custom divisions. Infantry pairs with Artillery for Rank II. Tactical Bombers pair with Armor or Fighters for Rank IV Combined Arms!
            </div>

            {/* Scenarios quick select */}
            <div>
              <div className="font-bold text-[#DFCE91] mb-1">HISTORICAL OPERATIONS</div>
              <div className="grid grid-cols-2 gap-1.5">
                {SCENARIOS.map((sc, idx) => (
                  <button
                    key={sc.id}
                    onClick={() => loadScenario(idx)}
                    className={`p-1.5 text-left border rounded text-[10px] font-bold ${
                      currentScenarioIndex === idx
                        ? 'border-[#DFCE91] bg-[#5E4E54] text-[#DFCE91]'
                        : 'border-[#5E4E54] hover:bg-[#5E4E54]/60 text-[#A69C90]'
                    }`}>
                    {sc.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic IPC Configuration */}
            <div className="bg-[#2b242a] p-2.5 rounded border border-[#5E4E54]">
              <div className="font-bold text-[#DFCE91] mb-1.5 text-[11px] flex items-center justify-between">
                <span>DYNAMIC IPC ECONOMY</span>
                <span className="text-[9px] text-[#A69C90]">VICTORY VALUES</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#8DA082] font-bold">ATTACKER IPC:</label>
                  <input
                    type="number"
                    value={attackerIpc}
                    onChange={(e) => setAttackerIpc(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full bg-[#423840] border border-[#7D6652] rounded px-2 py-1 text-[#DFCE91] font-bold text-center outline-none focus:border-[#DFCE91]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#B77958] font-bold">DEFENDER IPC:</label>
                  <input
                    type="number"
                    value={defenderIpc}
                    onChange={(e) => setDefenderIpc(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full bg-[#423840] border border-[#7D6652] rounded px-2 py-1 text-[#DFCE91] font-bold text-center outline-none focus:border-[#DFCE91]"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  setIsSandboxOpen(false);
                  triggerAttackerVictorySequence();
                }}
                className="mt-2 w-full py-1 bg-[#A1A258]/30 hover:bg-[#A1A258]/50 border border-[#A1A258] text-[#DFCE91] font-bold text-[10px] rounded transition-colors">
                TEST ATTACKER VICTORY SEQUENCE
              </button>
              <button
                onClick={() => {
                  setIsSandboxOpen(false);
                  handleInstantKillDefenders();
                }}
                className="mt-1.5 w-full py-1.5 bg-[#9A4E48]/60 hover:bg-[#9A4E48] border border-[#B77958] text-[#DFCE91] font-bold text-[10px] rounded transition-colors flex items-center justify-center gap-1.5 shadow-sm">
                <Zap size={12} />
                <span>DEBUG: KILL ENEMY FORCES (K)</span>
              </button>
            </div>

            {/* Attacker Roster */}
            <div>
              <div className="font-bold text-[#8DA082] mb-1.5 flex items-center gap-1">
                <Shield size={13} /> ATTACKER ROSTER ({liveAttackerCount})
              </div>
              <div className="flex flex-col gap-1">
                {(['infantry', 'artillery', 'tank', 'fighter', 'tactical_bomber', 'strategic_bomber', 'submarine', 'destroyer', 'cruiser', 'carrier', 'battleship'] as UnitType[]).map((t) => {
                  const count = attackerUnits.filter((u) => u.type === t && isCombatActive(u)).length;
                  const def = UNIT_DEFINITIONS[t];
                  return (
                    <div key={t} className="flex items-center justify-between bg-[#2b242a] p-1.5 rounded border border-[#5E4E54]">
                      <div>
                        <div className="font-bold text-[#DFCE91] capitalize">{def.name}</div>
                        <div className="text-[9px] text-[#A69C90]">Rank {def.baseAttackRank} &bull; ${def.cost}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleModifySandboxArmy('attacker', t, -1)}
                          disabled={count === 0}
                          className="w-6 h-6 bg-[#5E4E54] hover:bg-[#7D6652] disabled:opacity-30 rounded flex items-center justify-center font-bold">
                          -
                        </button>
                        <span className="w-4 text-center font-bold">{count}</span>
                        <button
                          onClick={() => handleModifySandboxArmy('attacker', t, 1)}
                          className="w-6 h-6 bg-[#72745C] hover:bg-[#8DA082] rounded flex items-center justify-center font-bold text-[#DFCE91]">
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Defender Roster */}
            <div>
              <div className="font-bold text-[#B77958] mb-1.5 flex items-center gap-1">
                <Crosshair size={13} /> DEFENDER ROSTER ({liveDefenderCount})
              </div>
              <div className="flex flex-col gap-1">
                {(['infantry', 'artillery', 'tank', 'fighter', 'tactical_bomber', 'aaa', 'submarine', 'destroyer', 'cruiser', 'carrier', 'battleship'] as UnitType[]).map((t) => {
                  const count = defenderUnits.filter((u) => u.type === t && isCombatActive(u)).length;
                  const def = UNIT_DEFINITIONS[t];
                  return (
                    <div key={t} className="flex items-center justify-between bg-[#2b242a] p-1.5 rounded border border-[#5E4E54]">
                      <div>
                        <div className="font-bold text-[#DFCE91] capitalize">{def.name}</div>
                        <div className="text-[9px] text-[#A69C90]">Rank {def.baseDefenseRank} &bull; ${def.cost}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleModifySandboxArmy('defender', t, -1)}
                          disabled={count === 0}
                          className="w-6 h-6 bg-[#5E4E54] hover:bg-[#7D6652] disabled:opacity-30 rounded flex items-center justify-center font-bold">
                          -
                        </button>
                        <span className="w-4 text-center font-bold">{count}</span>
                        <button
                          onClick={() => handleModifySandboxArmy('defender', t, 1)}
                          className="w-6 h-6 bg-[#9A4E48] hover:bg-[#B77958] rounded flex items-center justify-center font-bold text-[#DFCE91]">
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* START SCREEN OVERLAY */}
      {gameState.status === 'START' && (
        <MenuOverlay tone="neutral" zIndex={50}>
          <div className="w-full max-w-lg bg-[#423840] border-2 border-[#A1A258] rounded-xl p-6 m-4 shadow-2xl flex flex-col items-center text-center">
            <div className="flex items-center gap-2 text-[#DFCE91] mb-1">
              <Swords size={28} />
              <h1 className="text-3xl md:text-4xl font-black tracking-widest text-[#DFCE91]">
                FRONTLINE 1941
              </h1>
              <Shield size={28} />
            </div>
            <div className="text-xs uppercase tracking-widest text-[#A1A258] font-bold mb-4">
              Tactical Battle Board & Combined Arms Simulation
            </div>

            <div className="w-full bg-[#2b242a] border border-[#5E4E54] rounded-lg p-3 text-left text-xs text-[#A69C90] mb-5 space-y-1.5">
              <div className="font-bold text-[#DFCE91] border-b border-[#5E4E54] pb-1">
                COMBAT DOCTRINE & THEATER RULES:
              </div>
              <div>&bull; <strong className="text-[#DFCE91]">Sequential Salvo Phases:</strong> Attackers fire first row by row (Rank I &rarr; IV), then defenders fire back row by row (Rank I &rarr; IV)!</div>
              <div>&bull; <strong className="text-[#DFCE91]">Synchronized Audio Feedback:</strong> Tumbling dice rattle, metallic hitmarker ticks on scoring dice, and crisp tactical beeps strictly on troop impact hits.</div>
              <div>&bull; <strong className="text-[#DFCE91]">Persistent Fires & Battlefield Scars:</strong> Successful impacts leave lingering ground fires with flickering flames, glowing embers, and charred craters.</div>
              <div>&bull; <strong className="text-[#DFCE91]">Billowing Lingering Smoke:</strong> Heavy artillery and craters generate multi-layered 1-bit dithered smoke clouds drifting with the wind.</div>
              <div>&bull; <strong className="text-[#DFCE91]">Aircraft Sorties:</strong> Fighters swoop and strafe with machine guns; heavy bombers drop tumbling ordnance directly over enemy lines!</div>
            </div>

            <div className="w-full mb-5">
              <div className="text-xs font-bold text-[#A69C90] mb-2 text-left">SELECT OPERATION:</div>
              <div className="grid grid-cols-2 gap-2">
                {SCENARIOS.map((sc, idx) => (
                  <button
                    key={sc.id}
                    onClick={() => {
                      setCurrentScenarioIndex(idx);
                      setCurrentTheater(sc.theater);
                    }}
                    className={`p-2 rounded border text-left text-xs font-bold transition-all ${
                      currentScenarioIndex === idx
                        ? 'border-[#DFCE91] bg-[#5E4E54] text-[#DFCE91] shadow-md'
                        : 'border-[#5E4E54] bg-[#2b242a] hover:bg-[#5E4E54] text-[#A69C90]'
                    }`}>
                    <div className="text-[11px] text-[#DFCE91]">{sc.title}</div>
                    <div className="text-[9px] text-[#CAA574]">{THEATERS[sc.theater].name}</div>
                  </button>
                ))}
              </div>
            </div>

            <label className="w-full flex items-center justify-between text-xs text-[#A69C90] mb-3">
              Dice seed
              <input
                value={diceSeed}
                onChange={(e) => {
                  const n = Math.trunc(Number(e.target.value));
                  if (n > 0) setDiceSeed(n);
                }}
                inputMode="numeric"
                className="w-24 bg-[#2b242a] border border-[#5E4E54] rounded px-2 py-1 text-[#DFCE91]"
              />
            </label>

            <button
              onClick={() => {
                initGame();
              }}
              autoFocus
              className="w-full min-h-[48px] bg-[#DFCE91] hover:bg-[#CAA574] active:scale-95 text-[#423840] py-3 rounded-lg font-black text-lg tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 border-b-4 border-[#9E7F55]">
              <Play size={22} />
              <span>DEPLOY FORCES</span>
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* MANDATORY GAME MENU OVERLAY */}
      {isGameMenuOpen && (
        <MenuOverlay tone="neutral" zIndex={1000}>
          <div className="w-full max-w-md bg-[#423840] border-2 border-[#A1A258] rounded-xl p-6 m-4 shadow-2xl flex flex-col items-center">
            <h2 className="text-2xl font-black text-[#DFCE91] tracking-wider mb-6 flex items-center gap-2">
              <Menu size={24} /> GAME MENU
            </h2>

            <div className="w-full flex flex-col gap-3">
              <button
                onClick={() => setIsGameMenuOpen(false)}
                autoFocus
                className="w-full min-h-[48px] bg-[#DFCE91] hover:bg-[#CAA574] text-[#423840] py-2.5 rounded-lg font-black text-base transition-colors flex items-center justify-center gap-2">
                <Play size={18} /> RESUME BATTLE
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    const newMuted = gameAudio.toggleMute();
                    setSfxMuted(newMuted);
                  }}
                  className="min-h-[48px] p-2 bg-[#5E4E54] hover:bg-[#7D6652] text-[#DFCE91] border border-[#7D6652] rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-colors">
                  {sfxMuted ? <VolumeX size={16} className="text-[#9A4E48]" /> : <Volume2 size={16} className="text-[#8DA082]" />}
                  <span>SFX: {sfxMuted ? 'OFF' : 'ON'}</span>
                </button>

                <button
                  onClick={() => setIsMusicMuted((prev) => !prev)}
                  className="min-h-[48px] p-2 bg-[#5E4E54] hover:bg-[#7D6652] text-[#DFCE91] border border-[#7D6652] rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-colors">
                  {isMusicMuted ? <VolumeX size={16} className="text-[#9A4E48]" /> : <Volume2 size={16} className="text-[#8DA082]" />}
                  <span>MUSIC: {isMusicMuted ? 'OFF' : 'ON'}</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setIsGameMenuOpen(false);
                  loadScenario(currentScenarioIndex);
                }}
                className="w-full min-h-[48px] bg-[#5E4E54] hover:bg-[#7D6652] text-[#DFCE91] border border-[#7D6652] py-2.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2">
                <RotateCw size={16} /> RESTART ENGAGEMENT
              </button>

              <button
                onClick={() => setIsHowToPlayOpen(true)}
                className="w-full min-h-[48px] bg-[#5E4E54] hover:bg-[#7D6652] text-[#DFCE91] border border-[#7D6652] py-2.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2">
                <HelpCircle size={16} /> HOW TO PLAY
              </button>

              <button
                onClick={() => {
                  setIsGameMenuOpen(false);
                  setGameState((prev) => ({...prev, status: 'START'}));
                }}
                className="w-full min-h-[48px] bg-[#9A4E48] hover:bg-[#B77958] text-[#DFCE91] border border-[#6F3B4A] py-2.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2">
                <Flag size={16} /> QUIT TO MAIN MENU
              </button>
            </div>
          </div>
        </MenuOverlay>
      )}

      {/* HOW TO PLAY SCREEN */}
      {isHowToPlayOpen && (
        <MenuOverlay tone="neutral" zIndex={1001}>
          <div className="w-full max-w-lg bg-[#423840] border-2 border-[#A1A258] rounded-xl p-6 m-4 shadow-2xl flex flex-col text-left">
            <div className="flex items-center justify-between border-b border-[#5E4E54] pb-3 mb-4">
              <h2 className="text-xl font-black text-[#DFCE91] flex items-center gap-2">
                <HelpCircle size={20} /> WAR ROOM MANUAL
              </h2>
              <button
                onClick={() => setIsHowToPlayOpen(false)}
                className="p-1 hover:bg-[#5E4E54] rounded text-[#A69C90]">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-xs text-[#A69C90] leading-relaxed overflow-y-auto max-h-[60vh] pr-1">
              <div>
                <h4 className="font-bold text-[#DFCE91] text-sm">1. SEQUENTIAL COMBAT PROTOCOL</h4>
                <p>The <strong>entire Attacker side completes their offensive sequence first</strong> (Rank I &rarr; II &rarr; III &rarr; IV). Only then does the <strong>Defender conduct their return fire</strong> (Rank I &rarr; II &rarr; III &rarr; IV). Hits accumulate and are resolved during Casualty Allocation.</p>
              </div>

              <div>
                <h4 className="font-bold text-[#DFCE91] text-sm">2. TACTICAL DICE TRAY &amp; AUDIO FEEDBACK</h4>
                <p>Dice tumble in the brass tray with rhythmic rattle and bounce clicks. When dice settle, hitting dice flash brass gold and trigger metallic hitmarker ticks. When troops fire, confirmed hits trigger a distinct tactical confirmation beep!</p>
              </div>

              <div>
                <h4 className="font-bold text-[#DFCE91] text-sm">3. LINGERING SMOKE &amp; PERSISTENT GROUND FIRES</h4>
                <p>Explosions and cannon salvos leave persistent burning ground fires with flickering pixel flames and rising embers. Lingering smoke clouds billow in 1-bit dithered layers and drift across the battlefield.</p>
              </div>

              <div>
                <h4 className="font-bold text-[#DFCE91] text-sm">4. PRECISION AIR WING SORTIES</h4>
                <p>Bombers drop ordnance directly over enemy troop columns with realistic gravity arcs, while fighters strafe with discrete yellow and cream tracer bursts.</p>
              </div>

              <div>
                <h4 className="font-bold text-[#DFCE91] text-sm">5. TACTICAL CONTROLS &amp; SIMULATION SPEED</h4>
                <p>Use the <strong>&gt;&gt; / &gt;</strong> speed toggle next to the Army Builder to switch between 1x and 2x double simulation rate. Press <strong>K</strong> (or <strong>F10</strong> / <strong>[AUTO-WIN]</strong>) to instantly eliminate all enemy forces and trigger the attacker victory march.</p>
              </div>
            </div>

            <button
              onClick={() => setIsHowToPlayOpen(false)}
              className="mt-6 w-full min-h-[48px] bg-[#DFCE91] hover:bg-[#CAA574] text-[#423840] py-2.5 rounded-lg font-bold text-base transition-colors flex items-center justify-center gap-2">
              CLOSE MANUAL
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* GAME OVER SCREEN */}
      {gameState.status === 'GAME_OVER' && (
        <Overlay
          title="DEFEAT"
          description={`Forces Depleted. Final Score: ${gameState.score}`}
          actionLabel="RE-ENGAGE BATTLE"
          onAction={() => {
            loadScenario(currentScenarioIndex);
            initGame();
          }}
          icon={<RotateCw size={24} />}
          tone="danger"
        />
      )}

      {(gameState.status === 'MUTUAL' || gameState.status === 'RETREATED') && (
        <Overlay
          title={gameState.status === 'MUTUAL' ? 'MUTUAL DESTRUCTION' : 'WITHDRAWN'}
          description={
            gameState.status === 'MUTUAL'
              ? 'Both sides are destroyed. The defender holds the ground.'
              : 'The attack breaks off. Survivors withdraw and the defender holds the ground.'
          }
          actionLabel="RE-ENGAGE BATTLE"
          onAction={() => initGame()}
          icon={<RotateCw size={24} />}
          tone="neutral"
        />
      )}

      {/* VICTORY SCREEN (Superseded by custom Attacker Victory sequence) */}
      {gameState.status === 'VICTORY' && !isVictorySequenceActive && (
        <Overlay
          title="SECTOR SECURED!"
          description={`Defending Garrison Eliminated! Final Score: ${gameState.score}`}
          actionLabel="NEXT THEATER"
          onAction={() => {
            const nextIdx = (currentScenarioIndex + 1) % SCENARIOS.length;
            loadScenario(nextIdx);
            initGame();
          }}
          icon={<Award size={24} />}
          tone="victory"
        />
      )}
    </div>
  );
}
