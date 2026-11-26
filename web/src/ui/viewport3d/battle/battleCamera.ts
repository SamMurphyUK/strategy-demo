// The battle stage's camera, as pure numbers. The scene is z-up like the board: x across, y into the scene, z up.
// A preset (skins/battleSkin.ts) gives the pitch, the field of view, where it looks and how close it stands; this fits the stage to the frame.
import type { CameraPreset } from "../skins/battleSkin";
import { STAGE_DEPTH, STAGE_WIDTH, toWorld } from "./battleLanes";

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
  distance: number;
}

/** Height above the table the camera aims at: a little over a standing figure, so the line and the air above it share the frame. */
const AIM_HEIGHT = 0.8;
/** Tallest thing the frame must hold above the table: the banking aircraft and the landmark. */
const CONTENT_HEIGHT = 3.2;

/** The distance at which the stage fills the frame for a pitch, a field of view and an aspect. */
export function fitDistance(preset: Pick<CameraPreset, "pitchDeg" | "fovDeg">, aspect: number): number {
  const pitch = (preset.pitchDeg * Math.PI) / 180;
  const vHalf = (preset.fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.3, aspect));
  const needW = (STAGE_WIDTH * 0.68) / Math.tan(hHalf);
  // What the pitched stage covers on screen: its depth foreshortened by the pitch, and the height of what stands on it.
  const needH = ((STAGE_DEPTH * Math.sin(pitch) + CONTENT_HEIGHT * Math.cos(pitch)) * 0.56) / Math.tan(vHalf);
  return Math.max(needW, needH);
}

/** Where the camera stands and looks for a preset. `zoom` below 1 is closer. */
export function cameraPose(preset: CameraPreset, aspect: number): CameraPose {
  const distance = fitDistance(preset, aspect) * preset.zoom;
  const pitch = (preset.pitchDeg * Math.PI) / 180;
  const target = toWorld(preset.lookX * (STAGE_WIDTH / 2), preset.lookZ, AIM_HEIGHT);
  // The camera stands toward the front lip (-y) and above, looking into the scene.
  const position: [number, number, number] = [
    target[0],
    target[1] - Math.cos(pitch) * distance,
    target[2] + Math.sin(pitch) * distance,
  ];
  return { position, target, fovDeg: preset.fovDeg, distance };
}

/** The angle the camera looks down at, from the horizontal, in degrees. */
export function pitchOf(pose: CameraPose): number {
  const dy = pose.target[1] - pose.position[1];
  const dz = pose.position[2] - pose.target[2];
  return (Math.atan2(dz, dy) * 180) / Math.PI;
}

/** Eases one preset toward another by `t` (0 to 1). */
export function blendPresets(a: CameraPreset, b: CameraPreset, t: number): CameraPreset {
  const k = Math.min(1, Math.max(0, t));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    pitchDeg: mix(a.pitchDeg, b.pitchDeg),
    fovDeg: mix(a.fovDeg, b.fovDeg),
    lookX: mix(a.lookX, b.lookX),
    lookZ: mix(a.lookZ, b.lookZ),
    zoom: mix(a.zoom, b.zoom),
  };
}
