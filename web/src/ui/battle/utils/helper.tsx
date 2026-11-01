// tslint:disable
/* eslint-disable */
import React, {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';

/**  --- Overlay component ---
 * A full-screen UI overlay component used to display game states
 * such as Start Menus, Pause Screens, Game Over, and Victory screens.
 * It renders a semi-transparent background with a title, optional description,
 * and a primary action button.
 */

type OverlayTone = 'neutral' | 'danger' | 'victory';

interface OverlayProps {
  title: string;
  description?: string;
  actionLabel: string;
  onAction: () => void;
  icon?: React.ReactNode;
  tone?: OverlayTone;
  autoFocus?: boolean;
}

const TONE_CLASS: Record<OverlayTone, string> = {
  neutral: 'bg-black/70',
  danger: 'bg-red-900/80',
  victory: 'bg-emerald-900/80',
};

const BUTTON_CLASS: Record<OverlayTone, string> = {
  neutral: 'hover:bg-yellow-400',
  danger: 'hover:bg-red-400',
  victory: 'hover:bg-emerald-400',
};

/**
 * @param title - The main, large heading text to display (e.g., "GAME OVER").
 * @param description - Optional subtitle text to display below the title (e.g., "Final Score: 42").
 * @param actionLabel - The text to display inside the primary action button (e.g., "PLAY AGAIN").
 * @param onAction - Callback function executed when the user clicks the primary action button.
 * @param icon - Optional React node (like a Lucide icon) rendered inside the action button next to the label.
 * @param tone - The visual theme of the overlay which dictates background and hover colors. Defaults to 'neutral'. ('neutral' | 'danger' | 'victory')
 */
/** Focuses the referenced element on mount to ensure Enter works. */
export function useAutoFocus<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    // Only focus if enabled is true
    if (enabled && ref.current) {
      ref.current.focus();
    }
  }, [enabled]);
  return ref;
}

export function Overlay({
  title,
  description,
  actionLabel,
  onAction,
  icon,
  tone = 'neutral',
  autoFocus = true,
}: OverlayProps) {
  const buttonRef = useAutoFocus<HTMLButtonElement>(autoFocus);

  return (
    <div
      className={`absolute inset-0 ${TONE_CLASS[tone]} overflow-y-auto touch-auto`}>
      <div className="min-h-full flex flex-col items-center p-4">
        <div className="m-auto flex flex-col items-center w-full max-w-md">
          <h1 className="text-3xl md:text-5xl font-black mb-4 text-yellow-400 text-center">
            {title}
          </h1>
          {description && (
            <p className="text-lg md:text-2xl mb-8 text-center">
              {description}
            </p>
          )}
          <button
            ref={buttonRef}
            autoFocus={autoFocus}
            onClick={onAction}
            data-testid="start-button"
            className={`bg-white text-black px-6 md:px-8 py-2 md:py-3 rounded-full font-bold text-lg md:text-xl transition-colors flex items-center gap-2 ${BUTTON_CLASS[tone]}`}>
            {icon}
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface MenuOverlayProps {
  children: React.ReactNode;
  tone?: OverlayTone;
  zIndex?: number;
}

/**
 * A highly resilient menu wrapper that statically decouples scrolling from flexbox alignment.
 * It strictly avoids the clipping bug on mobile by preventing flex justify-center from being assigned
 * to the overflow-y-auto boundary. Plugs seamlessly into the AI's generation workflows.
 * The inner children should provide their own box styling (e.g., w-full max-w-md bg-slate-900 rounded).
 */
export function MenuOverlay({
  children,
  tone = 'neutral',
  zIndex = 40,
}: MenuOverlayProps) {
  return (
    <div
      className={`absolute inset-0 ${TONE_CLASS[tone]} overflow-y-auto touch-auto`}
      style={{zIndex}}>
      <div className="min-h-full flex flex-col items-center p-4">
        <div className="m-auto w-full max-w-md flex flex-col items-center">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Actions that can be triggered by the user. */
export type InputAction =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'confirm'
  | 'cancel'
  | 'tap';

/** Represents the state of the pointer (mouse or touch). */
export interface PointerState {
  /** The X coordinate of the pointer. */
  x: number;
  /** The Y coordinate of the pointer. */
  y: number;
  /** Whether the pointer is currently pressed down. */
  down: boolean;
}

/** A snapshot of the input state at a specific frame. */
export interface InputSnapshot {
  /** Map of actions to their active state. */
  actions: Record<InputAction, boolean>;
  /** The current state of the pointer. */
  pointer: PointerState;
}

interface LogicalSize {
  width: number;
  height: number;
}

const ACTION_KEYS: Record<string, InputAction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  a: 'left',
  d: 'right',
  w: 'up',
  s: 'down',
  Enter: 'confirm',
  ' ': 'confirm',
  Escape: 'cancel',
};

/**
 * Initializes all input actions to a default 'false' state.
 */
const createEmptyActions = (): Record<InputAction, boolean> => ({
  left: false,
  right: false,
  up: false,
  down: false,
  confirm: false,
  cancel: false,
  tap: false,
});

/**
 * Calculates the pointer's logical X/Y coordinates on the canvas.
 */
const getPointerPosition = (
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  logicalSize?: LogicalSize,
): {x: number; y: number} => {
  const rect = canvas.getBoundingClientRect();
  const width = logicalSize?.width ?? rect.width;
  const height = logicalSize?.height ?? rect.height;
  const x = (event.clientX - rect.left) * (width / rect.width);
  const y = (event.clientY - rect.top) * (height / rect.height);
  return {x, y};
};

/**
 * Hook to capture and manage user input (keyboard and pointer).
 * @param canvasRef Reference to the game canvas element.
 * @param enabled Whether input capture is enabled.
 * @param logicalSize Optional logical size of the canvas for coordinate scaling.
 * @returns A mutable ref containing the current input snapshot.
 */
export const useInput = (
  canvasRef: RefObject<HTMLCanvasElement>,
  enabled = true,
  logicalSize?: LogicalSize,
): MutableRefObject<InputSnapshot> => {
  const inputRef = useRef<InputSnapshot>({
    actions: createEmptyActions(),
    pointer: {x: 0, y: 0, down: false},
  });

  useEffect(() => {
    if (!enabled) {
      inputRef.current.actions = createEmptyActions();
      inputRef.current.pointer = {x: 0, y: 0, down: false};
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const action = ACTION_KEYS[event.key];
      if (!action) return;
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(
          event.key,
        )
      ) {
        event.preventDefault();
      }
      inputRef.current.actions[action] = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const action = ACTION_KEYS[event.key];
      if (!action) return;
      inputRef.current.actions[action] = false;
    };

    const canvas = canvasRef.current;
    const handlePointerDown = (event: PointerEvent) => {
      if (!canvas) return;
      if (typeof canvas.setPointerCapture === 'function') {
        canvas.setPointerCapture(event.pointerId);
      }
      inputRef.current.pointer = {
        ...getPointerPosition(event, canvas, logicalSize),
        down: true,
      };
      inputRef.current.actions.tap = true;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!canvas) return;
      inputRef.current.pointer = {
        ...getPointerPosition(event, canvas, logicalSize),
        down: inputRef.current.pointer.down,
      };
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!canvas) return;
      if (
        typeof canvas.releasePointerCapture === 'function' &&
        canvas.hasPointerCapture(event.pointerId)
      ) {
        canvas.releasePointerCapture(event.pointerId);
      }
      inputRef.current.pointer = {
        ...getPointerPosition(event, canvas, logicalSize),
        down: false,
      };
      inputRef.current.actions.tap = false;
    };

    const handleBlur = () => {
      inputRef.current.actions = createEmptyActions();
      if (inputRef.current.pointer) {
        inputRef.current.pointer.down = false;
      }
      inputRef.current.actions.tap = false;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleBlur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (canvas) {
      canvas.addEventListener('pointerdown', handlePointerDown);
      canvas.addEventListener('pointermove', handlePointerMove);
      canvas.addEventListener('pointerup', handlePointerUp);
      canvas.addEventListener('pointercancel', handlePointerUp);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (canvas) {
        canvas.removeEventListener('pointerdown', handlePointerDown);
        canvas.removeEventListener('pointermove', handlePointerMove);
        canvas.removeEventListener('pointerup', handlePointerUp);
        canvas.removeEventListener('pointercancel', handlePointerUp);
      }
    };
  }, [canvasRef, enabled]);

  return inputRef;
};

/**
 * audio.ts — procedural sound effects via the Web Audio API.
 *
 * No asset files, no network: every sound is synthesized on the fly. Import the
 * shared `gameAudio` singleton, insert required SFX methods, and call them:
 *
 *   import { gameAudio } from './utils/helper';
 *
 *   // After inserting playArcadeLaser:
 *   gameAudio.playArcadeLaser();         // on shoot
 *
 * Autoplay: browsers block audio until the first user gesture. This module
 * unlocks itself on the first pointer/key/touch event, and every play call also
 * resumes the context — so it is safe to call any method at any time; calls made
 * before the first interaction simply no-op instead of throwing.
 *
 * Volume & mute are global (master): gameAudio.setVolume(0.4),
 * gameAudio.toggleMute().
 */

interface Beat {
  ctx: AudioContext;
  out: GainNode;
  now: number;
}

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxMaster: GainNode | null = null;
  private muted = false; // SFX muted
  private volume = 0.6; // master volume, 0..1

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('playground-mute', (e: Event) => {
        const customEvent = e as CustomEvent<{muted: boolean}>;
        this.setMuted(customEvent.detail.muted);
      });
    }
  }

  // --- Context lifecycle -----------------------------------------------------

  /**
   * Lazily create the AudioContext + master gain on first use. Returns null when
   * Web Audio is unavailable (e.g. during SSR), in which case all play calls
   * become no-ops.
   */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;

    const Ctor =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext})
        .webkitAudioContext;
    if (!Ctor) {
      console.warn('[audio] Web Audio API not supported');
      return null;
    }

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.sfxMaster = this.ctx.createGain();
    this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    this.sfxMaster.gain.setValueAtTime(
      this.muted ? 0 : 1,
      this.ctx.currentTime,
    );
    this.sfxMaster.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.attachUnlock();
    return this.ctx;
  }

  /** Resume the context on the first user gesture (one-shot). */
  private attachUnlock() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      void this.ctx?.resume().catch(() => {});
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  /** Manually resume the context — call from a click handler if needed. */
  resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  /** Prepare to play a one-shot. Returns null when muted or unavailable. */
  private begin(): Beat | null {
    const ctx = this.ensure();
    const out = this.sfxMaster;
    if (!ctx || !out || this.muted) return null;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return {ctx, out, now: ctx.currentTime};
  }

  // --- Master controls -------------------------------------------------------

  /** Set master volume (0..1). Affects SFX. */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  /** Toggle global SFX mute. Returns the new muted state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.sfxMaster && this.ctx) {
      this.sfxMaster.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime);
    }
  }

  getMuteState(): boolean {
    return this.muted;
  }

  // --- Synthesis helpers -----------------------------------------------------

  /** Schedule one enveloped oscillator. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private blip(
    b: Beat,
    at: number,
    o: {
      freq: number;
      freqTo?: number;
      dur: number;
      type?: OscillatorType;
      gain?: number;
      glide?: 'exp' | 'lin';
    },
  ) {
    const {ctx, out} = b;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = o.type ?? 'square';
    osc.frequency.setValueAtTime(o.freq, at);
    if (o.freqTo !== undefined) {
      if ((o.glide ?? 'exp') === 'lin') {
        osc.frequency.linearRampToValueAtTime(o.freqTo, at + o.dur);
      } else {
        // Exponential ramps cannot target 0.
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(1, o.freqTo),
          at + o.dur,
        );
      }
    }

    const peak = o.gain ?? 0.15;
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);

    osc.connect(g);
    g.connect(out);
    osc.start(at);
    osc.stop(at + o.dur + 0.02);
  }

  /** Schedule a filtered white-noise burst (impacts, explosions). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private noiseBurst(
    b: Beat,
    at: number,
    o: {dur: number; gain?: number; from?: number; to?: number},
  ) {
    const {ctx, out} = b;
    const len = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(o.from ?? 1000, at);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(1, o.to ?? 80),
      at + o.dur,
    );

    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.18, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    src.start(at);
    src.stop(at + o.dur);
  }

  /** Small random multiplier so rapid-fire sounds don't feel robotic. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private vary(amount = 0.05): number {
    return 1 + (Math.random() * 2 - 1) * amount;
  }

  // --- Sound effects ---------------------------------------------------------

  /** Generic one-shot tone — escape hatch for custom blips. */
  playTone(o: {
    type?: OscillatorType;
    freq: number;
    freqTo?: number;
    dur?: number;
    gain?: number;
  }) {
    const b = this.begin();
    if (!b) return;
    this.blip(b, b.now, {
      type: o.type,
      freq: o.freq,
      freqTo: o.freqTo,
      dur: o.dur ?? 0.15,
      gain: o.gain,
    });
  }

  // INSERT_SFX_HERE
  playFootstepStone() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.noiseBurst(b, b.now, { dur: 0.05, gain: 0.08, from: 1000 * v, to: 600 * v });
    this.blip(b, b.now, { type: 'triangle', freq: 300 * v, dur: 0.03, gain: 0.04 });
  }

  playDiceRattle() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.08);
    // Rapid rhythmic wooden & brass tumbling dice clatter
    this.blip(b, b.now, { type: 'triangle', freq: 540 * v, freqTo: 220 * v, dur: 0.022, gain: 0.14 });
    this.noiseBurst(b, b.now, { dur: 0.025, gain: 0.1, from: 2800 * v, to: 700 * v });
    this.blip(b, b.now + 0.032, { type: 'sine', freq: 920 * v, dur: 0.02, gain: 0.12 });
    this.noiseBurst(b, b.now + 0.032, { dur: 0.02, gain: 0.08, from: 3400 * v, to: 900 * v });
  }

  playDiceBounce() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.12);
    this.blip(b, b.now, { type: 'triangle', freq: 680 * v, freqTo: 260 * v, dur: 0.02, gain: 0.1 });
    this.noiseBurst(b, b.now, { dur: 0.018, gain: 0.07, from: 3000 * v, to: 900 * v });
  }

  playStrongHitGong() {
    const b = this.begin();
    if (!b) return;
    const {ctx, out, now} = b;
    const v = this.vary(0.04);

    // 1. Sharp initial impact snap/transient
    this.blip(b, now, { type: 'sine', freq: 980 * v, freqTo: 240 * v, dur: 0.05, gain: 0.32 });
    this.noiseBurst(b, now, { dur: 0.06, gain: 0.22, from: 3400 * v, to: 260 * v });

    // 2. Powerful resonant low-mid war-room impact/gong with harmonic ring
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g1 = ctx.createGain();
    const g2 = ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(140 * v, now);
    osc1.frequency.exponentialRampToValueAtTime(58 * v, now + 0.44);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(280 * v, now);
    osc2.frequency.exponentialRampToValueAtTime(116 * v, now + 0.36);

    g1.gain.setValueAtTime(0.35, now);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);

    g2.gain.setValueAtTime(0.22, now);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    osc1.connect(g1);
    g1.connect(out);
    osc2.connect(g2);
    g2.connect(out);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.5);
    osc2.stop(now + 0.5);
  }

  playPlaneEngineFlyby(duration = 3.6, isBomber = false) {
    const b = this.begin();
    if (!b) return;
    const {ctx, out, now} = b;

    const basePitch = isBomber ? 85 : 125;
    const peakPitch = isBomber ? 140 : 220;
    const endPitch = isBomber ? 62 : 88;

    // Carrier Oscillator (Engine cylinder roar)
    const carrier = ctx.createOscillator();
    carrier.type = isBomber ? 'sawtooth' : 'triangle';

    // Modulator Oscillator (Propeller blade chop / humming throttle)
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(isBomber ? 24 : 34, now);

    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(32, now);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    // Doppler pitch envelope: swoops in, peaks near target column, then downshifts
    const swoopTime = now + duration * 0.45;
    carrier.frequency.setValueAtTime(basePitch, now);
    carrier.frequency.exponentialRampToValueAtTime(peakPitch, swoopTime);
    carrier.frequency.exponentialRampToValueAtTime(endPitch, now + duration);

    // Propeller rush noise buffer
    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(1.8, now);
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(980, swoopTime);
    filter.frequency.exponentialRampToValueAtTime(200, now + duration);

    // Amplitude envelopes with natural rise and decay
    const engineGain = ctx.createGain();
    engineGain.gain.setValueAtTime(0.001, now);
    engineGain.gain.linearRampToValueAtTime(0.24, swoopTime);
    engineGain.gain.linearRampToValueAtTime(0.0001, now + duration);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.18, swoopTime);
    noiseGain.gain.linearRampToValueAtTime(0.0001, now + duration);

    carrier.connect(engineGain);
    engineGain.connect(out);

    noiseSrc.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(out);

    mod.start(now);
    carrier.start(now);
    noiseSrc.start(now);

    mod.stop(now + duration + 0.05);
    carrier.stop(now + duration + 0.05);
    noiseSrc.stop(now + duration + 0.05);
  }

  playHitmarkerTick(pitchMultiplier = 1) {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.03) * pitchMultiplier;
    // Crisp high-frequency metallic tick/chime indicating hitting die evaluated
    this.blip(b, b.now, { type: 'sine', freq: 2450 * v, dur: 0.035, gain: 0.18 });
    this.blip(b, b.now, { type: 'triangle', freq: 4900 * v, dur: 0.025, gain: 0.1 });
    this.noiseBurst(b, b.now, { dur: 0.012, gain: 0.08, from: 6400 * v, to: 2400 * v });
  }

  playTacticalHitBeep() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.02);
    // Crisp, clean tactical confirmation 'beep' (~1080Hz pure sine ping with 45ms envelope)
    this.blip(b, b.now, { type: 'sine', freq: 1080 * v, dur: 0.045, gain: 0.24 });
    this.blip(b, b.now + 0.008, { type: 'triangle', freq: 2160 * v, dur: 0.02, gain: 0.08 });
  }

  playCrispClick() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 1200 * v, dur: 0.015, gain: 0.1 });
  }

  playGunshotBlast() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 120 * v, freqTo: 40 * v, dur: 0.15, gain: 0.2 });
    this.noiseBurst(b, b.now, { dur: 0.08, gain: 0.15, from: 4000 * v, to: 1000 * v });
  }

  playChiptuneExplosion() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.noiseBurst(b, b.now, { dur: 0.4, gain: 0.2, from: 1000, to: 100 });
    this.blip(b, b.now, { type: 'triangle', freq: 160 * v, freqTo: 30 * v, dur: 0.35, gain: 0.25 });
  }

  playCoinPickup() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'square', freq: 987.77 * v, dur: 0.1, gain: 0.08 });
    this.blip(b, b.now + 0.08, { type: 'square', freq: 1318.51 * v, dur: 0.2, gain: 0.08 });
  }

  playVictoryFanfare() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, i) => {
      this.blip(b, b.now + i * 0.1, { type: 'sawtooth', freq: freq * v, dur: 0.4, gain: 0.06 });
      this.blip(b, b.now + i * 0.1, { type: 'sine', freq: freq * v, dur: 0.4, gain: 0.04 });
    });
    const chordTime = notes.length * 0.1;
    notes.forEach((freq) => {
      this.blip(b, b.now + chordTime, { type: 'triangle', freq: freq * v, dur: 0.8, gain: 0.06 });
    });
  }

  playDefeatMotif() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    const notes = [311.13, 261.63, 246.94, 196.00];
    notes.forEach((freq, i) => {
      this.blip(b, b.now + i * 0.15, { type: 'sawtooth', freq: freq * v, dur: 0.3, gain: 0.08 });
      this.blip(b, b.now + i * 0.15, { type: 'sine', freq: freq * 0.5 * v, dur: 0.35, gain: 0.06 });
    });
  }

  playConfirmSelect() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 523.25 * v, dur: 0.1, gain: 0.08 });
    this.blip(b, b.now + 0.08, { type: 'sine', freq: 783.99 * v, dur: 0.15, gain: 0.1 });
  }

  playShieldBlock() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 100 * v, freqTo: 30 * v, dur: 0.2, gain: 0.2 });
    this.noiseBurst(b, b.now, { dur: 0.15, gain: 0.12, from: 500, to: 100 });
  }

  playRifleCrack() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'triangle', freq: 1600 * v, freqTo: 220 * v, dur: 0.05, gain: 0.22 });
    this.noiseBurst(b, b.now, { dur: 0.09, gain: 0.25, from: 5500 * v, to: 1200 * v });
    this.blip(b, b.now + 0.12, { type: 'square', freq: 880 * v, dur: 0.02, gain: 0.08 });
  }

  playAaaFlakFire() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.05);
    // Rapid twin mechanical flak muzzle bark
    this.blip(b, b.now, { type: 'triangle', freq: 1100 * v, freqTo: 180 * v, dur: 0.045, gain: 0.28 });
    this.noiseBurst(b, b.now, { dur: 0.07, gain: 0.3, from: 4800 * v, to: 900 * v });
    this.blip(b, b.now + 0.055, { type: 'triangle', freq: 1250 * v, freqTo: 200 * v, dur: 0.045, gain: 0.26 });
    this.noiseBurst(b, b.now + 0.055, { dur: 0.07, gain: 0.28, from: 5200 * v, to: 1000 * v });
  }

  playFlakBurstSky() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.08);
    // Heavy concussive airburst 'whump' in sky
    this.blip(b, b.now, { type: 'sine', freq: 160 * v, freqTo: 35 * v, dur: 0.32, gain: 0.35 });
    this.noiseBurst(b, b.now, { dur: 0.38, gain: 0.32, from: 2200 * v, to: 120 * v });
    // Shrapnel ping
    this.blip(b, b.now + 0.04, { type: 'square', freq: 2800 * v, dur: 0.025, gain: 0.12 });
  }

  playArtilleryBoom() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 110 * v, freqTo: 28 * v, dur: 0.55, gain: 0.35 });
    this.noiseBurst(b, b.now, { dur: 0.6, gain: 0.3, from: 1800 * v, to: 80 * v });
  }

  playTankBlast() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 150 * v, freqTo: 35 * v, dur: 0.45, gain: 0.3 });
    this.blip(b, b.now + 0.02, { type: 'triangle', freq: 620 * v, freqTo: 180 * v, dur: 0.18, gain: 0.15 });
    this.noiseBurst(b, b.now, { dur: 0.35, gain: 0.26, from: 3200 * v, to: 150 * v });
  }

  playFighterGuns() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    for (let i = 0; i < 4; i++) {
      const t = b.now + i * 0.045;
      this.blip(b, t, { type: 'square', freq: 440 * v, dur: 0.02, gain: 0.12 });
      this.noiseBurst(b, t, { dur: 0.035, gain: 0.18, from: 4000 * v, to: 800 * v });
    }
  }

  playBomberWhistleDrop() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 2200 * v, freqTo: 450 * v, dur: 0.45, gain: 0.14 });
    this.noiseBurst(b, b.now + 0.35, { dur: 0.7, gain: 0.35, from: 1400 * v, to: 60 * v });
    this.blip(b, b.now + 0.35, { type: 'sine', freq: 85 * v, freqTo: 24 * v, dur: 0.6, gain: 0.38 });
  }

  playNavalSalvo() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 90 * v, freqTo: 22 * v, dur: 0.65, gain: 0.35 });
    this.blip(b, b.now + 0.05, { type: 'sine', freq: 110 * v, freqTo: 25 * v, dur: 0.6, gain: 0.3 });
    this.noiseBurst(b, b.now, { dur: 0.6, gain: 0.32, from: 2200 * v, to: 90 * v });
  }

  playTorpedoWhoosh() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.noiseBurst(b, b.now, { dur: 0.35, gain: 0.22, from: 2400 * v, to: 400 * v });
    this.blip(b, b.now, { type: 'triangle', freq: 180 * v, freqTo: 340 * v, dur: 0.25, gain: 0.12 });
  }

  playWaterGeyserSplash() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sine', freq: 95 * v, freqTo: 22 * v, dur: 0.6, gain: 0.38 });
    this.noiseBurst(b, b.now, { dur: 0.75, gain: 0.32, from: 1600 * v, to: 60 * v });
    this.noiseBurst(b, b.now + 0.15, { dur: 0.5, gain: 0.2, from: 3200 * v, to: 800 * v });
  }

  playSoldierScream() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.2);
    const baseFreq = 420 * v;
    this.blip(b, b.now, { type: 'sawtooth', freq: baseFreq, freqTo: baseFreq * 0.45, dur: 0.32, gain: 0.15 });
    this.blip(b, b.now, { type: 'sine', freq: baseFreq * 1.5, freqTo: baseFreq * 0.7, dur: 0.3, gain: 0.08 });
    this.noiseBurst(b, b.now, { dur: 0.22, gain: 0.08, from: 1800 * v, to: 300 * v });
  }

  playSoldierCheer() {
    const b = this.begin();
    if (!b) return;
    const {ctx, out, now} = b;
    // Chorus of enthusiastic soldier shouts & cheers
    const cheerCount = 5;
    for (let i = 0; i < cheerCount; i++) {
      const stagger = i * 0.07;
      const v = this.vary(0.15);
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      const baseFreq = (260 + i * 40) * v;
      osc.frequency.setValueAtTime(baseFreq, now + stagger);
      osc.frequency.linearRampToValueAtTime(baseFreq * 1.35, now + stagger + 0.22);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.85, now + stagger + 0.7);

      filter.type = 'bandpass';
      filter.Q.setValueAtTime(2.6, now + stagger);
      filter.frequency.setValueAtTime(800 * v, now + stagger);
      filter.frequency.linearRampToValueAtTime(1400 * v, now + stagger + 0.3);

      gain.gain.setValueAtTime(0.01, now + stagger);
      gain.gain.linearRampToValueAtTime(0.12, now + stagger + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + stagger + 0.75);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(out);

      osc.start(now + stagger);
      osc.stop(now + stagger + 0.8);
    }
    this.noiseBurst(b, now, { dur: 0.85, gain: 0.1, from: 1800, to: 600 });
  }

  playBugleChime() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.02);
    // Triumphant bugle charge call (G3 -> C4 -> E4 -> G4 -> C5)
    const bugleNotes = [
      { f: 196.0, dur: 0.14, offset: 0 },
      { f: 261.63, dur: 0.14, offset: 0.13 },
      { f: 329.63, dur: 0.14, offset: 0.26 },
      { f: 392.0, dur: 0.26, offset: 0.39 },
      { f: 523.25, dur: 0.58, offset: 0.65 },
    ];
    bugleNotes.forEach((note) => {
      this.blip(b, b.now + note.offset, {
        type: 'sawtooth',
        freq: note.f * v,
        dur: note.dur,
        gain: 0.14,
      });
      this.blip(b, b.now + note.offset, {
        type: 'sine',
        freq: note.f * v * 2,
        dur: note.dur * 0.8,
        gain: 0.07,
      });
    });
  }

  playInfantryGroan() {
    const b = this.begin();
    if (!b) return;
    const {ctx, out, now} = b;
    const v = this.vary(0.08);

    // Vocal distress groan: formant-filtered sawtooth/triangle with descending vocal pitch
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160 * v, now);
    osc.frequency.exponentialRampToValueAtTime(88 * v, now + 0.62);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(3.6, now);
    filter.frequency.setValueAtTime(640 * v, now);
    filter.frequency.exponentialRampToValueAtTime(360 * v, now + 0.62);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);

    osc.start(now);
    osc.stop(now + 0.68);
  }

  playVehicleWreckCreak() {
    const b = this.begin();
    if (!b) return;
    const {ctx, out, now} = b;
    const v = this.vary(0.06);

    // Metallic creaking friction
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';

    osc1.frequency.setValueAtTime(360 * v, now);
    osc1.frequency.linearRampToValueAtTime(170 * v, now + 0.48);

    osc2.frequency.setValueAtTime(530 * v, now);
    osc2.frequency.linearRampToValueAtTime(240 * v, now + 0.48);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(4.2, now);
    filter.frequency.setValueAtTime(780 * v, now);
    filter.frequency.exponentialRampToValueAtTime(260 * v, now + 0.52);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(out);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.55);
    osc2.stop(now + 0.55);

    // Engine splutter / cough dying out
    this.noiseBurst(b, now + 0.12, { dur: 0.32, gain: 0.15, from: 550 * v, to: 70 * v });
    this.blip(b, now + 0.18, { type: 'square', freq: 44 * v, freqTo: 16 * v, dur: 0.28, gain: 0.14 });
  }

  playArtilleryCookoff() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary(0.08);

    // Initial rupture snap
    this.blip(b, b.now, { type: 'sawtooth', freq: 460 * v, freqTo: 120 * v, dur: 0.1, gain: 0.22 });
    this.noiseBurst(b, b.now, { dur: 0.14, gain: 0.2, from: 2600 * v, to: 320 * v });

    // Secondary ammo cookoff crackle (staggered rapid pops)
    [0.12, 0.24, 0.36].forEach((offset, idx) => {
      const popV = 1 + (idx - 1) * 0.15;
      this.blip(b, b.now + offset, {
        type: 'square',
        freq: (920 + idx * 280) * popV,
        freqTo: 160,
        dur: 0.035,
        gain: 0.15,
      });
      this.noiseBurst(b, b.now + offset, {
        dur: 0.05,
        gain: 0.14,
        from: 3600 * popV,
        to: 600,
      });
    });

    // Lingering propellant burn hiss
    this.noiseBurst(b, b.now + 0.38, { dur: 0.32, gain: 0.12, from: 1500 * v, to: 110 * v });
  }

  playMetalCrunch() {
    const b = this.begin();
    if (!b) return;
    const v = this.vary();
    this.blip(b, b.now, { type: 'sawtooth', freq: 320 * v, freqTo: 80 * v, dur: 0.25, gain: 0.18 });
    this.blip(b, b.now, { type: 'triangle', freq: 740 * v, freqTo: 210 * v, dur: 0.2, gain: 0.12 });
    this.noiseBurst(b, b.now, { dur: 0.3, gain: 0.24, from: 3000 * v, to: 200 * v });
  }
}

/** Shared singleton — import and use anywhere. */
export const gameAudio = new GameAudio();

// ============================================================================
// GENERAL UTILITIES & MATH HELPERS
// ============================================================================

export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export const shuffle = <T,>(items: T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export const formatTime = (seconds: number): string => {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  const remaining = clamped % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
};

export const prepareCanvas = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void => {
  const scale = window.devicePixelRatio || 1;
  const displayWidth = Math.floor(width * scale);
  const displayHeight = Math.floor(height * scale);

  if (
    ctx.canvas.width !== displayWidth ||
    ctx.canvas.height !== displayHeight
  ) {
    ctx.canvas.width = displayWidth;
    ctx.canvas.height = displayHeight;
  }

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
};

export const createFixedStepper = (stepMs: number, maxSubSteps = 5) => {
  let lastTime = 0;
  let accumulator = 0;

  return (time: number, onStep: (deltaSeconds: number) => void): void => {
    if (lastTime === 0) {
      lastTime = time;
      return;
    }

    const frameMs = Math.min(time - lastTime, stepMs * maxSubSteps);
    lastTime = time;
    accumulator += frameMs;

    let steps = 0;
    while (accumulator >= stepMs && steps < maxSubSteps) {
      onStep(stepMs / 1000);
      accumulator -= stepMs;
      steps += 1;
    }
  };
};

/**
 * A 2D coordinate representing a position in the game world.
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * An entity within the game.
 */
export interface Entity extends Position {
  id: string;
  type: string;
  width: number;
  height: number;
  vx: number;
  vy: number;
  [key: string]: any; // Allow flexible properties
}

/**
 * The current phase of the game.
 */
export type GamePhase =
  | 'START'
  | 'PLAYING'
  | 'PAUSED'
  | 'GAME_OVER'
  | 'VICTORY'
  | 'LEVEL_COMPLETE'
  | 'MUTUAL'
  | 'RETREATED';

/**
 * The overall state of the game.
 */
export interface GameState {
  status: GamePhase;
  score: number;
  level: number;
  timer?: number;
  moves?: number;
  lives?: number;
  [key: string]: any; // Allow flexible properties
}

/**
 * The music track to be used in the game.
 */
export interface MusicTrack {
  name: string;
  url: string;
  description: string;
}

declare global {
  interface Window {
    PlaygroundSDK: any;
  }
}

/**
 * Configuration for a sprite sheet.
 */
export interface SpriteConfig {
  url: string;
  frameWidth?: number;
  frameHeight?: number;
  frameCount?: number;
}

/**
 * Preloads all assets defined in the manifest.
 * Returns a dictionary of loaded images (keyed by manifest ID) and a loading state.
 *
 * WARNING: Generated sprites already have transparent backgrounds removed server-side.
 * Do not run client-side `ctx.getImageData()` loops to strip backgrounds. If you ever
 * call `ctx.getImageData()`, wrap it in `try / catch` and fall back to raw `ctx.drawImage()`
 * in case an external asset fell back to `no-cors` loading.
 */
export function useAssets(manifest: Record<string, string>) {
  const [assets, setAssets] = useState<Record<string, HTMLImageElement | null>>(
    {},
  );
  const [isReady, setIsReady] = useState(false);

  // Stringify the manifest to prevent infinite re-renders if an inline object is passed
  const manifestStr = JSON.stringify(manifest);

  useEffect(() => {
    const currentManifest = JSON.parse(manifestStr) as Record<string, string>;
    const urls = Object.entries(currentManifest);
    if (urls.length === 0) {
      setIsReady(true);
      return;
    }

    let loadedCount = 0;
    const loadedAssets: Record<string, HTMLImageElement | null> = {};

    urls.forEach(([id, url]) => {
      const img = new Image();
      let retriedWithoutCors = false;
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loadedAssets[id] = img; // Keyed by manifest ID for easy lookup
        loadedCount++;
        if (loadedCount === urls.length) {
          setAssets(loadedAssets);
          setIsReady(true);
        }
      };
      img.onerror = () => {
        if (!retriedWithoutCors) {
          retriedWithoutCors = true;
          img.removeAttribute('crossorigin');
          img.src = url;
          return;
        }
        console.warn(`[AssetPreloader] Failed to load asset: ${id} at ${url}`);
        loadedAssets[id] = null;
        loadedCount++;
        if (loadedCount === urls.length) {
          setAssets(loadedAssets);
          setIsReady(true);
        }
      };
      img.src = url;
    });
  }, [manifestStr]);

  return {assets, isReady};
}

/**
 * Safely draws an entire image asset on the canvas. If the asset failed to load,
 * falls back to rendering a primitive geometric shape to prevent crashing.
 *
 * Note: Draws from top-left (consistent with standard Canvas drawImage).
 *
 * WARNING: This draws the WHOLE source image (5-arg drawImage) and does not support
 * frame extraction. For animated spritesheets, use the `html-sprite-renderer` skill
 * (`SpriteRenderer` class) instead.
 */
export function drawAsset(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  fallbackDraw: (ctx: CanvasRenderingContext2D) => void,
) {
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    fallbackDraw(ctx);
  }
}

/**
 * Robust background drawing function.
 * If a background image is provided, it draws it covering the full canvas width and height.
 * If camera coordinates are provided, it can optionally do parallax scrolling.
 * If the image fails to load, it falls back to a solid color.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  bgImg: HTMLImageElement | null | undefined,
  canvasWidth: number,
  canvasHeight: number,
  fallbackColor = '#222222',
  camX = 0,
  camY = 0,
) {
  if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
    // Parallax logic: scroll the background slightly slower than the camera
    const parallaxFactor = 0.5;
    const bgX = (camX * parallaxFactor) % canvasWidth;
    const bgY = (camY * parallaxFactor) % canvasHeight;

    // Draw a 2x2 grid of the background image to ensure the whole screen is covered during scrolling
    ctx.drawImage(bgImg, -bgX, -bgY, canvasWidth, canvasHeight);
    ctx.drawImage(bgImg, -bgX + canvasWidth, -bgY, canvasWidth, canvasHeight);
    ctx.drawImage(bgImg, -bgX, -bgY + canvasHeight, canvasWidth, canvasHeight);
    ctx.drawImage(
      bgImg,
      -bgX + canvasWidth,
      -bgY + canvasHeight,
      canvasWidth,
      canvasHeight,
    );
  } else {
    // Fallback to solid color
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }
}

/**
 * Detect mobile/touch devices.
 * Checks user agent, pointer capability, and viewport width.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    const ua =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
    const touch =
      window.matchMedia('(pointer: coarse)').matches ||
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0;
    const small = window.innerWidth < 768;
    return ua || touch || small;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(
        window.innerWidth < 768 ||
          window.matchMedia('(pointer: coarse)').matches ||
          'ontouchstart' in window ||
          navigator.maxTouchPoints > 0,
      );
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}
