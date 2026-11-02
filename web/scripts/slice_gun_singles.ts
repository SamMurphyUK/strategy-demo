// Cuts one file per gunshot out of the multi-shot recordings in public/AUDIO.
// The original clip stays in place. A burst keeps every round; a quieter crack
// a few dozen milliseconds later stays inside that shot instead of becoming its own file.
// Run from strategy-demo/web:
//   node --experimental-strip-types scripts/slice_gun_singles.ts
//
// Pass --analyze to print the cut points and write nothing.

import { spawnSync } from "node:child_process";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const audioRoot = join(webRoot, "public", "AUDIO");
const analyzeOnly = process.argv.includes("--analyze");

const SAMPLE_RATE = 48000;
const HOP_SEC = 0.001;

/** Already one shot, or not a gun being fired. */
const SKIP = new Set([
  "Automatic Cannon - MK44 - 03 - Single Shot with Report 03.ogg",
  "ShotgunShell_Land_Concrete_02.ogg",
  "ShotgunShell_Land_Lino_03.ogg",
  "T-34_foley_cannon_height_adjustment.ogg",
]);

interface Peak {
  time: number;
  value: number;
}

function isGunFile(name: string): boolean {
  if (!name.toLowerCase().endsWith(".ogg") || SKIP.has(name) || / single \d+\.ogg$/i.test(name)) return false;
  return /gun|rifle|burst|shot|enfield|fal|lisle|mp5|tommy|scorpion|wesson|assault/i.test(name);
}

function decodeMono(file: string): Float32Array {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg decode failed for ${file}: ${result.stderr.toString()}`);
  }
  const bytes = result.stdout as Buffer;
  const samples = new Float32Array(bytes.length / 4);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
  return samples;
}

function transientPeaks(samples: Float32Array): Peak[] {
  const hop = Math.floor(SAMPLE_RATE * HOP_SEC);
  const win = Math.floor(SAMPLE_RATE * 0.004);
  const frames = Math.floor((samples.length - win) / hop);
  const env = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop;
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const previous = start + i > 0 ? samples[start + i - 1] : 0;
      const delta = samples[start + i] - previous;
      sum += delta * delta;
    }
    env[frame] = Math.sqrt(sum / win);
  }

  const minFrames = Math.round(0.05 / HOP_SEC);
  const maxima: Peak[] = [];
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < env[i - 1] || env[i] <= env[i + 1]) continue;
    const time = i * HOP_SEC;
    const last = maxima[maxima.length - 1];
    if (last && time - last.time < minFrames * HOP_SEC) {
      if (env[i] > last.value) maxima[maxima.length - 1] = { time, value: env[i] };
      continue;
    }
    maxima.push({ time, value: env[i] });
  }
  return maxima;
}

/**
 * Separate rounds from the bolt slap and the echo that ride behind a single crack.
 * Rounds inside a burst stay split, because those cracks keep arriving at the same short gap.
 */
function detectShots(peaks: Peak[]): Peak[] {
  if (peaks.length === 0) return [];
  const loudest = Math.max(...peaks.map((peak) => peak.value));
  const candidates = peaks.filter((peak) => peak.value >= loudest * 0.42);
  const champions = candidates.filter((peak) => {
    if (peak.value < loudest * 0.55) return false;
    return !candidates.some(
      (other) => other !== peak && Math.abs(other.time - peak.time) <= 0.1 && other.value > peak.value,
    );
  });

  // Bursts stay split. An echo tail gets quieter after the crack, so those peaks stay out.
  const strong = candidates.filter((peak) => peak.value >= loudest * 0.55);
  const burst: Peak[] = [];
  let run: Peak[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const runLoudest = Math.max(...run.map((peak) => peak.value));
      const crest = run.findIndex((peak) => peak.value === runLoudest);
      const kept = run.filter((peak, index) =>
        index <= crest ? peak.value >= runLoudest * 0.55 : peak.value >= runLoudest * 0.72,
      );
      const tightTriplet = kept.length === 3 && kept[2].time - kept[0].time < 0.15;
      const fadedTail = kept.length >= 4 && kept[kept.length - 1].value < runLoudest * 0.65;
      if (kept.length >= 3 && !tightTriplet && !fadedTail) burst.push(...kept);
    }
    run = [];
  };
  for (const peak of strong) {
    const previous = run[run.length - 1];
    if (previous && peak.time - previous.time >= 0.12) flush();
    run.push(peak);
  }
  flush();

  const shots = new Map<number, Peak>();
  for (const peak of [...champions, ...burst]) shots.set(peak.time, peak);
  for (const shot of [...shots.values()]) {
    let cursor = shot.time;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const peak = candidates[i];
      if (peak.time >= cursor - 0.001) continue;
      if (cursor - peak.time >= 0.12 || peak.value < loudest * 0.55) break;
      shots.set(peak.time, peak);
      cursor = peak.time;
    }
  }
  return [...shots.values()].sort((a, b) => a.time - b.time);
}

function sliceBounds(shots: Peak[], duration: number): { start: number; end: number }[] {
  const bounds: { start: number; end: number }[] = [];
  let cursor = 0;
  shots.forEach((shot, index) => {
    const next = shots[index + 1]?.time ?? duration;
    const gap = next - shot.time;
    const tail = gap > 0.28 ? Math.min(0.34, gap - 0.02) : Math.max(0.05, gap - 0.01);
    const start = Math.max(cursor, Math.max(0, shot.time - 0.012));
    const end = Math.min(duration, Math.max(start + 0.045, shot.time + tail));
    bounds.push({ start, end });
    cursor = end;
  });
  return bounds;
}

function writeSlice(source: string, dest: string, start: number, duration: number): void {
  const fadeOut = Math.min(0.018, duration / 4);
  const fadeOutAt = Math.max(0, duration - fadeOut);
  const end = start + duration;
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      source,
      "-af",
      `atrim=start=${start.toFixed(4)}:end=${end.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.004,afade=t=out:st=${fadeOutAt.toFixed(4)}:d=${fadeOut.toFixed(4)}`,
      "-c:a",
      "libvorbis",
      "-q:a",
      "5",
      dest,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg slice failed for ${dest}: ${result.stderr.toString()}`);
  }
}

function singleName(stem: string, index: number, total: number): string {
  const width = String(total).length;
  return `${stem} single ${String(index + 1).padStart(width, "0")}`;
}

function gunFiles(): string[] {
  return readdirSync(audioRoot)
    .filter((name) => statSync(join(audioRoot, name)).isFile() && isGunFile(name))
    .sort((a, b) => a.localeCompare(b));
}

if (!analyzeOnly) {
  for (const name of readdirSync(audioRoot)) {
    if (/ single \d+\.ogg$/i.test(name)) unlinkSync(join(audioRoot, name));
  }
}

let written = 0;
for (const name of gunFiles()) {
  const source = join(audioRoot, name);
  const samples = decodeMono(source);
  const duration = samples.length / SAMPLE_RATE;
  const shots = detectShots(transientPeaks(samples));
  const bounds = sliceBounds(shots, duration);
  const stem = name.replace(/\.ogg$/i, "");
  console.log(`${name}  ${shots.length} single${shots.length === 1 ? "" : "s"}`);
  bounds.forEach((bound, index) => {
    console.log(`  ${index + 1}  ${bound.start.toFixed(3)}-${bound.end.toFixed(3)} (${(bound.end - bound.start).toFixed(3)}s)`);
  });
  if (analyzeOnly || shots.length < 2) continue;
  bounds.forEach((bound, index) => {
    writeSlice(source, join(audioRoot, `${singleName(stem, index, bounds.length)}.ogg`), bound.start, bound.end - bound.start);
    written += 1;
  });
}

if (!analyzeOnly) console.log(`Wrote ${written} single shots`);
