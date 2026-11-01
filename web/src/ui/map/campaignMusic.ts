// Map bed is the strategy march. The combat phase crossfades to the battle march and back
// when the phase ends. Both tracks loop; only their gains move.

import { createSeamlessLoopBuffer, scanAudioBoundaries } from "../battle/utils/BackgroundMusic";

const MAP_URL = "/AUDIO/bgm_strategy_march.mp3";
const BATTLE_URL = "/battle-assets/audio/bgm_war_room_march.mp3";
const VOLUME = 0.15;
const BED_FADE_SEC = 2;
const MUTE_FADE_SEC = 0.35;

export type CampaignBed = "map" | "battle" | "off";

interface BedAudio {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

let ctx: AudioContext | null = null;
let mapBed: BedAudio | null = null;
let battleBed: BedAudio | null = null;
let bed: CampaignBed = "map";
let muted = false;
let armed = false;
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
  if (bed === next) return;
  bed = next;
  ramp(BED_FADE_SEC);
}

/** Browsers stay silent until a gesture. The first one fades in whichever bed is current. */
export function armCampaignMusic(): void {
  const audio = context();
  if (!audio) return;
  armed = true;
  if (audio.state === "suspended") {
    void audio.resume().then(() => ramp(BED_FADE_SEC));
  }
  ramp(BED_FADE_SEC);
}

function context(): AudioContext | null {
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  mapBed = { gain: ctx.createGain(), source: null };
  battleBed = { gain: ctx.createGain(), source: null };
  mapBed.gain.gain.value = 0;
  battleBed.gain.gain.value = 0;
  mapBed.gain.connect(ctx.destination);
  battleBed.gain.connect(ctx.destination);
  void loadBed(MAP_URL, mapBed);
  void loadBed(BATTLE_URL, battleBed);
  document.addEventListener("visibilitychange", onVisibility);
  return ctx;
}

function onVisibility(): void {
  if (!ctx) return;
  if (document.hidden) {
    if (ctx.state === "running") void ctx.suspend();
    return;
  }
  if (armed && ctx.state === "suspended") void ctx.resume();
}

async function loadBed(url: string, slot: BedAudio): Promise<void> {
  const audio = ctx;
  if (!audio) return;
  try {
    const bytes = await prefetch(url);
    if (ctx !== audio || audio.state === "closed") return;
    const decoded = await audio.decodeAudioData(bytes.slice(0));
    const loop = createSeamlessLoopBuffer(audio, decoded, scanAudioBoundaries(decoded));
    const source = audio.createBufferSource();
    source.buffer = loop.buffer;
    source.loop = true;
    source.loopStart = loop.loopStartSec;
    source.loopEnd = loop.loopEndSec;
    source.connect(slot.gain);
    source.start();
    slot.source = source;
    ramp(BED_FADE_SEC);
  } catch {
    // A missing track leaves that bed silent.
  }
}

function level(slot: BedAudio, which: Exclude<CampaignBed, "off">): number {
  if (!armed || muted || bed !== which || !slot.source) return 0;
  return VOLUME;
}

function ramp(seconds: number): void {
  if (!ctx || !mapBed || !battleBed || ctx.state === "closed") return;
  const now = ctx.currentTime;
  const span = Math.max(seconds, 0.01);
  fade(mapBed.gain, level(mapBed, "map"), now, span);
  fade(battleBed.gain, level(battleBed, "battle"), now, span);
}

function fade(node: GainNode, target: number, now: number, seconds: number): void {
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(target, now + seconds);
}
