import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_AUDIO_FILES, BATTLE_CUES, SOUND_CUE_MAP, SOUND_CUES } from "../../src/audio/audio_manifest";
import {
  assignedFiles,
  assignFileToCue,
  clearCueOverrides,
  computeJitteredParams,
  DRAG_FAR_DISTANCE,
  DRAG_NEAR_DISTANCE,
  DRAG_PITCH_OFFSET,
  dragPitchStep,
  impactDelayMs,
  PolyphonyLimiter,
  scheduleVolley,
  soundManager,
  VOLLEY_CASCADE_MS,
} from "../../src/audio/sound_manager";
import type { SoundCue } from "../../src/audio/audio_manifest";

/** Stems left behind when an earlier encode treated an internal dot as the extension. */
const LEGACY_TRUNCATED = [
  "Enfield_L85_rifle_5",
  "Enfield_L86_LSW_5",
  "De_Lisle_Carbine_",
  "FN_FAL_7",
  "FN_FAL_7.62x51mm_1",
  "M1918_Browning_Automatic_Rifle_",
  "M1918_Browning_Automatic_Rifle_.30cal_0",
  "M1919A4_Browning_Machine_Gun_",
  "M1928A1_Thompson_Submachine_Gun_",
  "M1928A1_Thompson_Submachine_Gun_.45cal_0",
  "M3_Submachine_Grease_Gun_",
  "M3_Submachine_Grease_Gun_.45cal_0",
  "Smith_&_Wesson_M29_",
  "Smith_&_Wesson_M29_.44_Magnum_1",
  "Vz61_Scorpion_9mm_1",
  "EFX SD GORE Chop 02 C",
];

describe("audio manifest", () => {
  it("points every cue at one real clip and keeps the full Sonniss names", () => {
    expect(ALL_AUDIO_FILES).toHaveLength(82);
    expect(new Set(ALL_AUDIO_FILES).size).toBe(82);
    for (const truncated of LEGACY_TRUNCATED) {
      expect(ALL_AUDIO_FILES).not.toContain(truncated);
    }
    expect(ALL_AUDIO_FILES).toContain(
      "Enfield_L85_rifle_5.56mm_1m_left_off_axis_MKH416_clean_Five_shots_x_1",
    );
    expect(ALL_AUDIO_FILES).toContain("Impacts/Impact 038");
    const radio = "vintage_radio_button_006";
    const interfaceCues = [
      "ui_button_click",
      "split_wheel_tick",
      "waypoint_tick",
      "order_cancel",
      "token_pickup",
      "token_drop",
      "battle_arrow_lock",
    ] as const;
    for (const cue of interfaceCues) {
      expect(SOUND_CUE_MAP[cue]).toEqual([radio]);
    }
    expect(SOUND_CUE_MAP.ui_panel_flick).toEqual(["Placing Pieces on the Board 2"]);
    expect(SOUND_CUE_MAP.fire_infantry).toEqual(["Bullet_Drop_Leaves_03"]);
    expect(SOUND_CUE_MAP.fire_aircraft).toEqual([
      "M1928A1_Thompson_Submachine_Gun_.45cal_0.3m_to_side_ORTF_Burst_of_four_x_1",
    ]);
    expect(SOUND_CUE_MAP.assign_casualty).toEqual(["Bullet_Drop_Wood_04"]);
    expect(BATTLE_CUES).toContain("assign_casualty");
    expect(BATTLE_CUES).toContain("dice_rattle");
    expect(BATTLE_CUES).toContain("rifle_crack");
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const battleSources = [
      readFileSync(join(root, "src/ui/battle/App.tsx"), "utf8"),
      readFileSync(join(root, "src/ui/battle/utils/helper.tsx"), "utf8"),
    ].join("\n");
    expect(battleSources).not.toContain("assign_casualty");
    expect(SOUND_CUE_MAP.fire_artillery).toEqual([
      "Automatic Cannon - MK44 - 03 - Single Shot with Report 03",
    ]);
    expect(SOUND_CUE_MAP.fire_armor).toEqual(SOUND_CUE_MAP.fire_artillery);
    expect(SOUND_CUE_MAP.fire_naval).toEqual(SOUND_CUE_MAP.fire_artillery);
    expect(SOUND_CUE_MAP.hit_impact).toEqual(["Impacts/Impact 059"]);
    expect(SOUND_CUE_MAP.unit_destroyed).toEqual(["Impacts/Impact_Boom_Distorted_02"]);
    for (const cue of SOUND_CUES) {
      const files = SOUND_CUE_MAP[cue];
      expect(files).toHaveLength(1);
      expect(ALL_AUDIO_FILES).toContain(files[0]);
    }
    for (const cue of BATTLE_CUES) {
      expect(SOUND_CUES).toContain(cue);
    }
  });
});

describe("computeJitteredParams", () => {
  it("stays inside the pitch and gain bands and adds the step offset", () => {
    const low = computeJitteredParams(() => 0, 0);
    expect(low.playbackRate).toBe(0.94);
    expect(low.gain).toBe(0.85);
    const high = computeJitteredParams(() => 1, 0);
    expect(high.playbackRate).toBe(1.06);
    expect(high.gain).toBe(1.15);
    const stepped = computeJitteredParams(() => 0, 3, 0.04);
    expect(stepped.playbackRate).toBeCloseTo(0.94 + 3 * 0.04);
    for (let i = 0; i < 40; i++) {
      const params = computeJitteredParams(Math.random, 0);
      expect(params.playbackRate).toBeGreaterThanOrEqual(0.94);
      expect(params.playbackRate).toBeLessThanOrEqual(1.06);
      expect(params.gain).toBeGreaterThanOrEqual(0.85);
      expect(params.gain).toBeLessThanOrEqual(1.15);
    }
  });
});

describe("drag pitch", () => {
  it("uses three steps from distance to the starting territory and never climbs past the far one", () => {
    expect(dragPitchStep(0)).toBe(0);
    expect(dragPitchStep(DRAG_NEAR_DISTANCE - 1)).toBe(0);
    expect(dragPitchStep(DRAG_NEAR_DISTANCE)).toBe(1);
    expect(dragPitchStep(DRAG_FAR_DISTANCE - 1)).toBe(1);
    expect(dragPitchStep(DRAG_FAR_DISTANCE)).toBe(2);
    expect(dragPitchStep(800)).toBe(2);
    const near = computeJitteredParams(() => 1, dragPitchStep(10), DRAG_PITCH_OFFSET);
    const far = computeJitteredParams(() => 0, dragPitchStep(400), DRAG_PITCH_OFFSET);
    expect(far.playbackRate).toBeGreaterThan(near.playbackRate);
  });
});

describe("polyphony limiter", () => {
  it("allows three copies of a cue, blocks the fourth, and still plays a different cue", () => {
    const limiter = new PolyphonyLimiter();
    const now = 1_000;
    expect(limiter.tryTrigger("fire_infantry", now)).toBe(true);
    expect(limiter.tryTrigger("fire_infantry", now)).toBe(true);
    expect(limiter.tryTrigger("fire_infantry", now)).toBe(true);
    expect(limiter.tryTrigger("fire_infantry", now)).toBe(false);
    expect(limiter.tryTrigger("hit_impact", now)).toBe(true);
  });
});

describe("scheduleVolley", () => {
  it("spaces shots in order and keeps the cascade inside the window", () => {
    expect(scheduleVolley([])).toEqual([]);
    const tight = scheduleVolley(["fire_infantry", "fire_armor"], () => 0);
    expect(tight.map((shot) => shot.delayMs)).toEqual([0, 20]);
    const wide = scheduleVolley(["fire_infantry", "fire_armor"], () => 1);
    expect(wide.map((shot) => shot.delayMs)).toEqual([0, 40]);
    const cues = Array.from({ length: 12 }, () => "fire_infantry" as SoundCue);
    const shots = scheduleVolley(cues, () => 1);
    expect(shots).toHaveLength(cues.length);
    expect(shots[0].delayMs).toBe(0);
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].delayMs).toBeGreaterThan(shots[i - 1].delayMs);
    }
    expect(shots[shots.length - 1].delayMs).toBeLessThanOrEqual(VOLLEY_CASCADE_MS);
  });
});

describe("impact delay", () => {
  it("lands between the shot and the hit flash", () => {
    expect(impactDelayMs(() => 0)).toBe(180);
    expect(impactDelayMs(() => 1)).toBe(260);
    for (let i = 0; i < 20; i++) {
      const delay = impactDelayMs(Math.random);
      expect(delay).toBeGreaterThanOrEqual(180);
      expect(delay).toBeLessThanOrEqual(260);
    }
  });
});

describe("live cue assignment", () => {
  it("keeps the generated map and layers a browser reassignment on top", () => {
    const original = [...SOUND_CUE_MAP.token_pickup];
    assignFileToCue("token_pickup", "Dice 9");
    assignFileToCue("token_pickup", "Backgammon Piece 21");
    assignFileToCue("token_pickup", "Domino Box 15");
    expect(SOUND_CUE_MAP.token_pickup).toEqual(original);
    expect(assignedFiles("token_pickup")).toEqual(["Dice 9", "Backgammon Piece 21", "Domino Box 15"]);
    clearCueOverrides();
    expect(assignedFiles("token_pickup")).toEqual(original);
  });
});

describe("soundManager without Web Audio", () => {
  it("does not throw when AudioContext is unavailable", () => {
    expect(() => {
      soundManager.play("token_pickup");
      soundManager.scheduleVolley(["fire_infantry", "fire_naval"]);
      soundManager.updateAmbience(0, false);
      soundManager.updateAmbience(1, true);
    }).not.toThrow();
  });
});
