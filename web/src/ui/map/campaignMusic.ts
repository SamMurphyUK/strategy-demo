// Orchestral beds. The map loops strategist 1. The combat phase crossfades to strategist 2
// and back when the phase ends. The battle screen parks strategist 2 and plays the attacker's
// faction theme. A victory pauses that theme for strategist 3, then fades the theme back in
// at the same moment. Leaving the battle fades strategist 2 back in where it was parked.

import { createSeamlessLoopBuffer, scanAudioBoundaries, type SeamlessLoopResult } from "../battle/utils/BackgroundMusic";

const MAP_URL = "/AUDIO/ost/strategist-1.mp3";
const BATTLE_URL = "/AUDIO/ost/strategist-2.mp3";
const VICTORY_URL = "/AUDIO/ost/strategist-3.mp3";
const VOLUME = 0.15;
const BED_FADE_SEC = 2;
const VICTORY_FADE_SEC = 1.4;
const MUTE_FADE_SEC = 0.35;

export type CampaignBed = "map" | "battle" | "off";

interface BedAudio {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  loop: SeamlessLoopResult | null;
  startedAt: number;
  startOffset: number;
  heldOffset: number | null;
}

let ctx: AudioContext | null = null;
let mapBed: BedAudio | null = null;
let battleBed: BedAudio | null = null;
let victoryGain: GainNode | null = null;
let victorySource: AudioBufferSourceNode | null = null;
let bed: CampaignBed = "map";
let muted = false;
let armed = false;
let victoryOn = false;
let battleHeld = false;
/** Strategist 2 is parked while a faction theme owns the battle screen. */
let themeHolding = false;
let themeToken = 0;
let bedsRequested = false;
let victoryToken = 0;
const listeners = new Set<() => void>();
const prefetched = new Map<string, Promise<ArrayBuffer>>();

export function campaignMusicMuted(): boolean {
  return muted;
}

export function subscribeCampaignMusic(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function prefetch(url: string): Promise<ArrayBuffer> {
  let job = prefetched.get(url);
  if (!job) {
    job = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    });
    prefetched.set(url, job);
  }
  return job;
}

export function setCampaignMusicMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  notify();
  ramp(MUTE_FADE_SEC);
}

export function setCampaignBed(next: CampaignBed): void {
  prefetch(MAP_URL);
  prefetch(BATTLE_URL);
  prefetch(VICTORY_URL);
  if (bed === next) return;
  bed = next;
  if (ctx) {
    ensureBeds();
    ramp(BED_FADE_SEC);
  }
}

/** Browsers stay silent until a gesture. The first one fades in whichever bed is current. */
export function armCampaignMusic(): void {
  const audio = context();
  if (!audio) return;
  armed = true;
  ensureBeds();
  if (audio.state === "suspended") {
    void audio.resume().then(() => ramp(BED_FADE_SEC));
  }
  ramp(BED_FADE_SEC);
}

/**
 * Pause the battle bed and play the victory piece. Leaving the flag calls
 * `endCampaignVictory`, which fades the battle bed back in where it stopped.
 */
export function beginCampaignVictory(): void {
  prefetch(VICTORY_URL);
  const audio = context();
  if (!audio || victoryOn) return;
  victoryOn = true;
  victoryToken += 1;
  const token = victoryToken;
  holdBattle();
  ramp(VICTORY_FADE_SEC);
  void startVictory(token);
  if (audio.state === "suspended") void audio.resume();
}

/** Fade the victory piece out and resume the battle bed at the held moment. */
export function endCampaignVictory(): void {
  if (!victoryOn && !victorySource) return;
  victoryOn = false;
  const token = ++victoryToken;
  resumeBattle();
  ramp(VICTORY_FADE_SEC);
  window.setTimeout(() => {
    if (token !== victoryToken) return;
    stopVictory();
  }, VICTORY_FADE_SEC * 1000 + 40);
}

/** The shared music context. A faction theme renders into this so a gesture that armed the map covers it. */
export function campaignAudioContext(): AudioContext | null {
  const audio = context();
  if (audio && audio.state === "suspended") void audio.resume();
  return audio;
}

function context(): AudioContext | null {
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  mapBed = makeBed(ctx);
  battleBed = makeBed(ctx);
  victoryGain = ctx.createGain();
  victoryGain.gain.value = 0;
  victoryGain.connect(ctx.destination);
  document.addEventListener("visibilitychange", onVisibility);
  return ctx;
}

function ensureBeds(): void {
  if (bedsRequested || !mapBed || !battleBed) return;
  bedsRequested = true;
  void loadBed(MAP_URL, mapBed);
  void loadBed(BATTLE_URL, battleBed);
}

function makeBed(audio: AudioContext): BedAudio {
  const gain = audio.createGain();
  gain.gain.value = 0;
  gain.connect(audio.destination);
  return { gain, source: null, loop: null, startedAt: 0, startOffset: 0, heldOffset: null };
}

function onVisibility(): void {
  if (!ctx) return;
  if (document.hidden) {
    if (ctx.state === "running") void ctx.suspend();
    return;
  }
  if ((armed || themeHolding) && ctx.state === "suspended") void ctx.resume();
}

async function loadBed(url: string, slot: BedAudio): Promise<void> {
  const audio = ctx;
  if (!audio) return;
  try {
    const bytes = await prefetch(url);
    if (ctx !== audio || audio.state === "closed") return;
    const decoded = await audio.decodeAudioData(bytes.slice(0));
    slot.loop = createSeamlessLoopBuffer(audio, decoded, scanAudioBoundaries(decoded));
    const held = slot === battleBed && (victoryOn || themeHolding);
    if (!held) startLoop(slot, 0);
    ramp(BED_FADE_SEC);
  } catch {
    // A missing track leaves that bed silent.
  }
}

async function startVictory(token: number): Promise<void> {
  const audio = ctx;
  const gain = victoryGain;
  if (!audio || !gain) return;
  try {
    const bytes = await prefetch(VICTORY_URL);
    if (token !== victoryToken || !victoryOn || ctx !== audio || audio.state === "closed") return;
    const decoded = await audio.decodeAudioData(bytes.slice(0));
    if (token !== victoryToken || !victoryOn) return;
    stopVictory();
    const source = audio.createBufferSource();
    source.buffer = decoded;
    source.loop = false;
    source.connect(gain);
    source.onended = () => {
      if (victorySource === source) victorySource = null;
    };
    source.start();
    victorySource = source;
    const now = audio.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(victoryLevel(), now + VICTORY_FADE_SEC);
  } catch {
    // The victory piece stays silent if it cannot be decoded.
  }
}

/** Park strategist 2 for a faction theme. A second call does not move the saved moment. */
export function holdCampaignBattle(): void {
  if (!themeHolding && battleBed?.source) {
    battleBed.heldOffset = captureOffset(battleBed);
  }
  themeHolding = true;
  ramp(VICTORY_FADE_SEC);
  const token = ++themeToken;
  window.setTimeout(() => {
    if (token !== themeToken || !themeHolding || !battleBed?.source) return;
    stopSource(battleBed);
  }, VICTORY_FADE_SEC * 1000 + 30);
}

/** Bring strategist 2 back at the moment the battle screen took over, unless a victory is still up. */
export function releaseCampaignBattle(): void {
  const offset = battleBed?.heldOffset ?? null;
  themeHolding = false;
  themeToken += 1;
  if (victoryOn || !battleBed || !ctx || bed !== "battle" || offset === null) return;
  battleBed.gain.gain.cancelScheduledValues(ctx.currentTime);
  battleBed.gain.gain.setValueAtTime(0, ctx.currentTime);
  startLoop(battleBed, offset);
  ramp(VICTORY_FADE_SEC);
}

function holdBattle(): void {
  battleHeld = false;
  if (themeHolding || !battleBed?.source) return;
  battleBed.heldOffset = captureOffset(battleBed);
  battleHeld = true;
  const token = victoryToken;
  window.setTimeout(() => {
    if (token !== victoryToken || !battleBed?.source) return;
    stopSource(battleBed);
  }, VICTORY_FADE_SEC * 1000 + 30);
}

function resumeBattle(): void {
  if (themeHolding) {
    battleHeld = false;
    return;
  }
  if (!battleHeld || !battleBed || !ctx || bed !== "battle") {
    battleHeld = false;
    return;
  }
  battleBed.gain.gain.cancelScheduledValues(ctx.currentTime);
  battleBed.gain.gain.setValueAtTime(0, ctx.currentTime);
  startLoop(battleBed, battleBed.heldOffset ?? 0);
  battleHeld = false;
}

/** Where a looping bed is, in seconds, counting the seamless turnaround. */
function captureOffset(slot: BedAudio): number {
  const loop = slot.loop;
  const audio = ctx;
  if (!loop || !audio) return slot.heldOffset ?? 0;
  const elapsed = Math.max(0, audio.currentTime - slot.startedAt);
  return loopPosition(slot.startOffset + elapsed, loop.loopStartSec, loop.loopEndSec);
}

function loopPosition(position: number, loopStart: number, loopEnd: number): number {
  if (position < loopEnd) return Math.max(0, position);
  const span = loopEnd - loopStart;
  if (span <= 0.001) return loopStart;
  return loopStart + ((position - loopEnd) % span);
}

function startLoop(slot: BedAudio, offset: number): void {
  const audio = ctx;
  const loop = slot.loop;
  if (!audio || !loop) return;
  const at = loopPosition(offset, loop.loopStartSec, Math.max(loop.loopEndSec - 0.01, loop.loopStartSec));
  stopSource(slot);
  const source = audio.createBufferSource();
  source.buffer = loop.buffer;
  source.loop = true;
  source.loopStart = loop.loopStartSec;
  source.loopEnd = loop.loopEndSec;
  source.connect(slot.gain);
  source.start(0, at);
  slot.source = source;
  slot.startedAt = audio.currentTime;
  slot.startOffset = at;
}

function stopSource(slot: BedAudio): void {
  const source = slot.source;
  slot.source = null;
  if (!source) return;
  try {
    source.onended = null;
    source.stop();
    source.disconnect();
  } catch {
    // The node may already have ended.
  }
}

function stopVictory(): void {
  const source = victorySource;
  victorySource = null;
  if (!source) return;
  try {
    source.onended = null;
    source.stop();
    source.disconnect();
  } catch {
    // The piece may already have finished.
  }
}

function level(slot: BedAudio, which: Exclude<CampaignBed, "off">): number {
  if (!armed || muted || bed !== which || !slot.source) return 0;
  if (which === "battle" && (victoryOn || themeHolding)) return 0;
  return VOLUME;
}

function victoryLevel(): number {
  if (muted || !victoryOn) return 0;
  return VOLUME;
}

function ramp(seconds: number): void {
  if (!ctx || !mapBed || !battleBed || !victoryGain || ctx.state === "closed") return;
  const now = ctx.currentTime;
  const span = Math.max(seconds, 0.01);
  fade(mapBed.gain, level(mapBed, "map"), now, span);
  fade(battleBed.gain, level(battleBed, "battle"), now, span);
  fade(victoryGain, victoryLevel(), now, span);
}

function fade(node: GainNode, target: number, now: number, seconds: number): void {
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(target, now + seconds);
}
