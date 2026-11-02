// Web Audio playback for the Sonniss clips in /AUDIO. Decoding is per file.
// Headless runs (no AudioContext) and clips that are not ready yet stay silent.

import { SOUND_CUE_MAP, SOUND_CUES, type SoundCue } from "./audio_manifest";

export const PITCH_MIN = 0.94;
export const PITCH_MAX = 1.06;
export const GAIN_MIN = 0.85;
export const GAIN_MAX = 1.15;
export const STEP_PITCH_OFFSET = 0.04;
/**
 * Drag ticks use three pitches, from how far the hovered territory's anchor is from the one the
 * unit left. The cuts sit in the gaps of this map: under 50 is a neighbour, under 160 is a theater
 * away, and anything past that is across the board. Dragging back home drops the pitch again.
 */
export const DRAG_NEAR_DISTANCE = 50;
export const DRAG_FAR_DISTANCE = 160;
export const DRAG_PITCH_OFFSET = 0.1;

/** 0 nearby, 1 a theater away, 2 across the map. */
export function dragPitchStep(distance: number): 0 | 1 | 2 {
  if (distance < DRAG_NEAR_DISTANCE) return 0;
  if (distance < DRAG_FAR_DISTANCE) return 1;
  return 2;
}
export const MAX_CONCURRENT = 3;
export const POLYPHONY_WINDOW_MS = 180;
export const VOLLEY_GAP_MIN_MS = 20;
export const VOLLEY_GAP_MAX_MS = 40;
export const VOLLEY_CASCADE_MS = 350;
export const IMPACT_DELAY_MIN_MS = 180;
export const IMPACT_DELAY_MAX_MS = 260;

const MUTE_KEY = "strategy-demo.sfx-muted";

export interface JitteredParams {
  playbackRate: number;
  gain: number;
}

export interface VolleyShot {
  cue: SoundCue;
  delayMs: number;
}

interface AudioParamLike {
  value: number;
}

interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

interface GainLike extends AudioNodeLike {
  gain: AudioParamLike;
}

interface FilterLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
}

interface ShaperLike extends AudioNodeLike {
  curve: Float32Array | null;
  oversample: string;
}

interface CompressorLike extends AudioNodeLike {
  threshold: AudioParamLike;
  ratio: AudioParamLike;
  attack: AudioParamLike;
  release: AudioParamLike;
}

interface AudioBuf {
  getChannelData(channel: number): Float32Array;
}

interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBuf | null;
  playbackRate: AudioParamLike;
  loop: boolean;
  onended: (() => void) | null;
  start(): void;
}

interface AudioCtx {
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuf>;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuf;
  createBufferSource(): BufferSourceLike;
  createGain(): GainLike;
  createBiquadFilter(): FilterLike;
  createWaveShaper(): ShaperLike;
  createDynamicsCompressor(): CompressorLike;
}

interface FetchResponse {
  ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function audioContextCtor(): (new () => AudioCtx) | null {
  const host = globalThis as {
    AudioContext?: new () => AudioCtx;
    webkitAudioContext?: new () => AudioCtx;
  };
  return host.AudioContext ?? host.webkitAudioContext ?? null;
}

function later(fn: () => void, ms: number): void {
  const timer = (globalThis as { setTimeout?: (cb: () => void, delay: number) => unknown }).setTimeout;
  if (!timer) {
    fn();
    return;
  }
  timer(fn, ms);
}

function clipUrl(basename: string, ext: "ogg" | "m4a"): string {
  const path = basename.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `/AUDIO/${path}.${ext}`;
}

/** Pitch jitter in [0.94, 1.06], then `step * stepPitchOffset`. Gain stays in [0.85, 1.15]. */
export function computeJitteredParams(
  random: () => number = Math.random,
  step = 0,
  stepPitchOffset = STEP_PITCH_OFFSET,
): JitteredParams {
  const pitch = PITCH_MIN + clamp01(random()) * (PITCH_MAX - PITCH_MIN);
  const gain = GAIN_MIN + clamp01(random()) * (GAIN_MAX - GAIN_MIN);
  return { playbackRate: pitch + step * stepPitchOffset, gain };
}

/** Drops a cue once `MAX_CONCURRENT` copies of it are already live inside the window. */
export class PolyphonyLimiter {
  private stamps = new Map<string, number[]>();

  tryTrigger(cue: string, nowMs: number): boolean {
    const windowStart = nowMs - POLYPHONY_WINDOW_MS;
    const live = (this.stamps.get(cue) ?? []).filter((stamp) => nowMs - stamp <= POLYPHONY_WINDOW_MS && stamp >= windowStart);
    if (live.length >= MAX_CONCURRENT) {
      this.stamps.set(cue, live);
      return false;
    }
    live.push(nowMs);
    this.stamps.set(cue, live);
    return true;
  }
}

function buildVolley(cues: readonly SoundCue[], random: () => number): VolleyShot[] {
  if (cues.length === 0) return [];
  const gaps: number[] = [];
  for (let i = 1; i < cues.length; i++) {
    gaps.push(VOLLEY_GAP_MIN_MS + clamp01(random()) * (VOLLEY_GAP_MAX_MS - VOLLEY_GAP_MIN_MS));
  }
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  const scale = total > VOLLEY_CASCADE_MS ? VOLLEY_CASCADE_MS / total : 1;
  const shots: VolleyShot[] = [{ cue: cues[0], delayMs: 0 }];
  let delay = 0;
  for (let i = 0; i < gaps.length; i++) {
    delay = Math.min(VOLLEY_CASCADE_MS, delay + gaps[i] * scale);
    shots.push({ cue: cues[i + 1], delayMs: delay });
  }
  return shots;
}

/** Staggered start offsets for a battle volley. The last shot lands by 350ms. */
export function scheduleVolley(cues: readonly SoundCue[], random: () => number = Math.random): VolleyShot[] {
  return buildVolley(cues, random);
}

/** Delay from a shot to the hit flash / downed sting. */
export function impactDelayMs(random: () => number = Math.random): number {
  return IMPACT_DELAY_MIN_MS + clamp01(random()) * (IMPACT_DELAY_MAX_MS - IMPACT_DELAY_MIN_MS);
}

const cueOverrides = new Map<SoundCue, string[]>();
let cueRevision = 0;
const cueListeners = new Set<() => void>();

export function cueRevisionNow(): number {
  return cueRevision;
}

export function subscribeCueMap(listener: () => void): () => void {
  cueListeners.add(listener);
  return () => {
    cueListeners.delete(listener);
  };
}

function notifyCueMap(): void {
  cueRevision += 1;
  for (const listener of cueListeners) listener();
}

/** Files a cue plays. Live soundboard edits sit on top of the generated map. */
export function assignedFiles(cue: SoundCue): readonly string[] {
  return cueOverrides.get(cue) ?? SOUND_CUE_MAP[cue];
}

export function assignFileToCue(cue: SoundCue, filename: string): void {
  const current = [...assignedFiles(cue)];
  if (current.includes(filename)) return;
  if (current.length >= 3) current.shift();
  current.push(filename);
  cueOverrides.set(cue, current);
  notifyCueMap();
}

export function clearCueOverrides(): void {
  if (cueOverrides.size === 0) return;
  cueOverrides.clear();
  notifyCueMap();
}

export function cueMapJson(): string {
  const body: Record<string, readonly string[]> = {};
  for (const cue of SOUND_CUES) body[cue] = [...assignedFiles(cue)];
  return JSON.stringify(body, null, 2);
}

const INFANTRY = new Set(["infantry", "mech_infantry", "mech"]);
const ARTILLERY = new Set(["artillery", "aaa"]);
const ARMOR = new Set(["tank", "armor"]);
const AIRCRAFT = new Set(["fighter", "tactical_bomber", "strategic_bomber", "bomber"]);

export function volleyCueForUnit(unitType: string): SoundCue {
  if (INFANTRY.has(unitType)) return "fire_infantry";
  if (ARTILLERY.has(unitType)) return "fire_artillery";
  if (ARMOR.has(unitType)) return "fire_armor";
  if (AIRCRAFT.has(unitType)) return "fire_aircraft";
  return "fire_naval";
}

function softClipCurve(): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const drive = 1.4;
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

const clipPromises = new Map<string, Promise<AudioBuf>>();

async function fetchClip(url: string): Promise<FetchResponse> {
  const fetchImpl = (globalThis as { fetch?: (input: string) => Promise<FetchResponse> }).fetch;
  if (!fetchImpl) throw new Error("fetch unavailable");
  return fetchImpl(url);
}

function loadClip(ctx: AudioCtx, basename: string): Promise<AudioBuf> {
  const existing = clipPromises.get(basename);
  if (existing) return existing;
  const pending = (async () => {
    const ogg = await fetchClip(clipUrl(basename, "ogg"));
    const response = ogg.ok ? ogg : await fetchClip(clipUrl(basename, "m4a"));
    if (!response.ok) throw new Error(basename);
    const bytes = await response.arrayBuffer();
    return ctx.decodeAudioData(bytes.slice(0));
  })();
  clipPromises.set(basename, pending);
  pending.catch(() => {
    if (clipPromises.get(basename) === pending) clipPromises.delete(basename);
  });
  return pending;
}

let mutedCached: boolean | null = null;
const muteListeners = new Set<() => void>();

function readStoredMute(): boolean {
  try {
    const storage = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    return storage?.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function sfxMuted(): boolean {
  if (mutedCached === null) mutedCached = readStoredMute();
  return mutedCached;
}

export function subscribeSfx(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => {
    muteListeners.delete(listener);
  };
}

class SoundManager {
  private ctx: AudioCtx | null = null;
  private busInput: AudioNodeLike | null = null;
  private master: GainLike | null = null;
  private bunkerGain: GainLike | null = null;
  private windGain: GainLike | null = null;
  private noiseStarted = false;
  private outdoor = 0;
  private readonly limiter = new PolyphonyLimiter();

  /** Create the context from a click or key, then warm the cue-map clips. */
  unlock(): void {
    const ctx = this.context();
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    this.prewarm(ctx);
    this.touchBed();
  }

  play(cue: SoundCue, options?: { step?: number; delayMs?: number; stepPitchOffset?: number }): void {
    const delayMs = options?.delayMs ?? 0;
    if (delayMs > 0) {
      later(() => this.play(cue, { step: options?.step, stepPitchOffset: options?.stepPitchOffset }), delayMs);
      return;
    }
    try {
      const ctx = this.context();
      if (!ctx || sfxMuted()) return;
      if (!this.limiter.tryTrigger(cue, this.now())) return;
      const files = assignedFiles(cue);
      if (!files || files.length === 0) return;
      const basename = files[Math.floor(Math.random() * files.length)];
      const step = options?.step ?? 0;
      const stepPitchOffset = options?.stepPitchOffset;
      void loadClip(ctx, basename)
        .then((buffer) => {
          if (sfxMuted()) return;
          this.startBuffer(buffer, step, stepPitchOffset);
        })
        .catch(() => {});
    } catch {
      /* AudioContext missing or already closed. */
    }
  }

  /** Audition one file by basename, outside the cue polyphony cap. */
  previewFile(basename: string): void {
    try {
      const ctx = this.context();
      if (!ctx || sfxMuted()) return;
      void ctx.resume().catch(() => {});
      void loadClip(ctx, basename)
        .then((buffer) => {
          if (sfxMuted()) return;
          this.startBuffer(buffer, 0);
        })
        .catch(() => {});
    } catch {
      /* AudioContext missing or already closed. */
    }
  }

  /** Play a combat volley with the staggered offsets from `scheduleVolley`. */
  scheduleVolley(cues: readonly SoundCue[]): void {
    const ctx = this.context();
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    for (const shot of buildVolley(cues, Math.random)) {
      const fire = () => this.play(shot.cue);
      if (shot.delayMs <= 0) fire();
      else later(fire, shot.delayMs);
    }
  }

  /**
   * Crossfade the procedural room tone. `inBattle` forces the outdoor bed.
   * The bed is generated noise only. Sonniss clips are not looped under the menu.
   */
  updateAmbience(tiltFactor: number, inBattle: boolean): void {
    const tilt = clamp01(tiltFactor);
    this.outdoor = inBattle ? 1 : tilt;
    this.touchBed();
  }

  applyMute(): void {
    if (this.master) this.master.gain.value = sfxMuted() ? 0 : 1;
  }

  private now(): number {
    const perf = (globalThis as { performance?: { now(): number } }).performance;
    return perf ? perf.now() : Date.now();
  }

  private context(): AudioCtx | null {
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new Ctor();
      this.ensureBus(this.ctx);
      this.touchBed();
      return this.ctx;
    } catch {
      this.ctx = null;
      return null;
    }
  }

  private ensureBus(ctx: AudioCtx): void {
    if (this.master) return;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 70;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 11000;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = "2x";
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    const master = ctx.createGain();
    master.gain.value = sfxMuted() ? 0 : 1;
    highpass.connect(lowpass);
    lowpass.connect(shaper);
    shaper.connect(compressor);
    compressor.connect(master);
    master.connect(ctx.destination);
    this.busInput = highpass;
    this.master = master;
  }

  private prewarm(ctx: AudioCtx): void {
    const names = new Set<string>();
    for (const cue of SOUND_CUES) {
      for (const name of SOUND_CUE_MAP[cue]) names.add(name);
    }
    for (const name of names) {
      void loadClip(ctx, name).catch(() => {});
    }
  }

  private startBuffer(buffer: AudioBuf, step: number, stepPitchOffset?: number): void {
    const ctx = this.ctx;
    const bus = this.busInput;
    if (!ctx || !bus || sfxMuted()) return;
    const { playbackRate, gain } = computeJitteredParams(Math.random, step, stepPitchOffset ?? STEP_PITCH_OFFSET);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    source.connect(amp);
    amp.connect(bus);
    source.onended = () => {
      source.disconnect();
      amp.disconnect();
    };
    source.start();
  }

  private touchBed(): void {
    if (!this.ctx || !this.busInput) return;
    this.ensureNoise(this.ctx);
    if (this.bunkerGain) this.bunkerGain.gain.value = (1 - this.outdoor) * 0.06;
    // Close zoom (and a battle) drives `outdoor` to 1. That peak is 15% of the old 0.07.
    if (this.windGain) this.windGain.gain.value = this.outdoor * 0.0105;
  }

  private ensureNoise(ctx: AudioCtx): void {
    const bus = this.busInput;
    if (this.noiseStarted || !bus) return;
    this.noiseStarted = true;
    const buffer = seamlessNoise(ctx, 4);
    this.bunkerGain = this.loopNoise(ctx, buffer, bus, "lowpass", 280);
    this.windGain = this.loopNoise(ctx, buffer, bus, "highpass", 500);
  }

  private loopNoise(ctx: AudioCtx, buffer: AudioBuf, bus: AudioNodeLike, type: string, frequency: number): GainLike {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start();
    return gain;
  }
}

/** Brown noise with the end blended into the start, so a loop does not thump or whoosh. */
function seamlessNoise(ctx: AudioCtx, seconds: number): AudioBuf {
  const length = Math.max(2, Math.floor(ctx.sampleRate * seconds));
  const raw = new Float32Array(length);
  let brown = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    brown = brown * 0.98 + white * 0.02;
    raw[i] = brown;
  }
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = Math.min(Math.floor(length / 4), Math.floor(ctx.sampleRate * 0.25));
  const body = length - fade;
  data.set(raw.subarray(0, body));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const fadeIn = Math.sin(t * Math.PI * 0.5);
    const fadeOut = Math.cos(t * Math.PI * 0.5);
    data[body + i] = raw[body + i] * fadeOut + raw[i] * fadeIn;
  }
  return buffer;
}

export const soundManager = new SoundManager();

/** Shared flick for panel buttons. Its own cue, so the soundboard can retarget it. */
export function playUiPanelFlick(): void {
  soundManager.unlock();
  soundManager.play("ui_panel_flick");
}

export function toggleSfx(): void {
  const next = !sfxMuted();
  mutedCached = next;
  try {
    const storage = (globalThis as { localStorage?: { setItem(key: string, value: string): void } }).localStorage;
    storage?.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* private mode */
  }
  soundManager.applyMute();
  for (const listener of muteListeners) listener();
}

let soundboardOpen = false;
const soundboardListeners = new Set<() => void>();
let hotkeysInstalled = false;

export function soundboardVisible(): boolean {
  return soundboardOpen;
}

export function subscribeSoundboard(listener: () => void): () => void {
  soundboardListeners.add(listener);
  return () => {
    soundboardListeners.delete(listener);
  };
}

export function setSoundboardOpen(open: boolean): void {
  if (soundboardOpen === open) return;
  soundboardOpen = open;
  for (const listener of soundboardListeners) listener();
}

interface KeyEventLike {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: unknown;
  preventDefault(): void;
}

function typingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

function onGlobalKey(event: KeyEventLike): void {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (typingTarget(event.target)) return;
  const key = event.key;
  if (!event.shiftKey && (key === "m" || key === "M")) {
    event.preventDefault();
    const turningOn = sfxMuted();
    toggleSfx();
    if (turningOn) {
      soundManager.unlock();
      soundManager.play("ui_button_click");
    }
    return;
  }
  if (event.shiftKey && (key === "A" || key === "a")) {
    event.preventDefault();
    setSoundboardOpen(!soundboardOpen);
  }
}

function installHotkeys(): void {
  if (hotkeysInstalled) return;
  const host = globalThis as { addEventListener?: (type: string, fn: (event: KeyEventLike) => void) => void };
  if (!host.addEventListener) return;
  hotkeysInstalled = true;
  host.addEventListener("keydown", onGlobalKey);
}

installHotkeys();
