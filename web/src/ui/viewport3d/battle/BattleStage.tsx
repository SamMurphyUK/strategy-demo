// The 3D battle stage: a react-three-fiber canvas laid over the battle screen's 2D canvas. The 2D board keeps running underneath (it is where the
// rolls, the casualties and the phases live), and this stage only reads its units and draws them as a tabletop diorama. See battleFeed.ts.
//
// The engine is a plain object (battleStageEngine.ts), created once per battle and driven from one useFrame: there is no React state in the frame
// loop. React is used only to mount the canvas, to build and dispose the engine, and for the look panel.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useState, useSyncExternalStore } from "react";
import type * as THREE from "three";
import { BATTLE_SKINS, battleSkinDisables, battleSkinFor } from "../skins/battleSkin";
import {
  BATTLE_VISUAL_RANGES,
  battleVisuals,
  getBattleVisualRev,
  resetBattleVisuals,
  setBattleVisual,
  subscribeBattleVisuals,
  type BattleVisualKey,
} from "../skins/battleVisualConfig";
import type { FeedUnit } from "./battleFeed";
import { hashString, landmarkFor, terrainFor, type TerrainInput } from "./battleScatter";
import BattleInspectors from "./BattleInspectors";
import { skyModeFor } from "./battleSky";
import { BattleStageEngine } from "./battleStageEngine";

export interface BattleStageProps {
  /** Reads the battle screen's units. Called every frame: it must be cheap and must not write. */
  getUnits: () => readonly FeedUnit[];
  regionId?: string;
  regionName?: string;
  theater?: string;
  scene?: TerrainInput["scene"];
  attackerFaction: string;
  defenderFaction: string;
  coastal?: boolean;
  bombard?: boolean;
  amphibious?: boolean;
  /** The battle's phase name, read-only, for the active column's pulse. */
  getPhase?: () => string;
}

function Driver({ engine }: { engine: BattleStageEngine }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  // Priority 1 takes over the render: the engine draws its own scene through the tilt-shift pass.
  useFrame((_, delta) => {
    const dpr = gl.getPixelRatio();
    engine.update(delta, camera as THREE.PerspectiveCamera, size.width / Math.max(1, size.height));
    engine.render(gl, camera, size.width * dpr, size.height * dpr);
  }, 1);
  return null;
}

interface SliderSpec {
  key: BattleVisualKey;
  label: string;
  title: string;
}

const SLIDERS: SliderSpec[] = [
  { key: "battleDepthScale", label: "Depth scale", title: "Size of the rear lanes against the front" },
  { key: "battleDepthDesat", label: "Depth desat", title: "Colour drawn out of the rear lanes" },
  { key: "battleScatterDensity", label: "Scatter", title: "How thickly the terrain is dressed" },
  { key: "battleSmokeStrength", label: "Smoke", title: "Persistent battle smoke and mist" },
  { key: "battleValleyMist", label: "Valley mist", title: "Mist tint over the rear lanes and the horizon" },
  { key: "battleTiltShift", label: "Tilt-shift", title: "Blur of the foreground lip and the horizon" },
  { key: "battleRecoilPitch", label: "Recoil", title: "Spring recoil on a firing unit" },
  { key: "battleHitStopFrames", label: "Hit-stop", title: "Frames the stage holds on a heavy hit" },
  { key: "battleCameraThud", label: "Camera thud", title: "Damped camera dip on a heavy hit" },
  { key: "battleMuzzleLight", label: "Muzzle light", title: "Warm light of a muzzle burst" },
];

/** The look panel: a slider for each setting, dimmed and locked when the active skin does not own it. Mirrors the board's look panel. */
function LookPanel({ skinId }: { skinId: string }) {
  useSyncExternalStore(subscribeBattleVisuals, getBattleVisualRev, getBattleVisualRev);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "absolute", top: 8, right: 8, zIndex: 20, pointerEvents: "auto", font: "11px 'Courier New', monospace", color: "#DDCF99" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ background: "#4B3D44", border: "1px solid #846D59", color: "#DDCF99", padding: "3px 8px", cursor: "pointer", font: "inherit" }}
      >
        {open ? "Stage look ▾" : "Stage look ▸"}
      </button>
      {open && (
        <div style={{ marginTop: 4, padding: 8, width: 230, background: "rgba(30,27,24,0.92)", border: "1px solid #645355" }}>
          <div style={{ opacity: 0.7, marginBottom: 6 }}>{BATTLE_SKINS[skinId as keyof typeof BATTLE_SKINS]?.label ?? skinId} skin</div>
          {SLIDERS.map((s) => {
            const [min, max] = BATTLE_VISUAL_RANGES[s.key];
            const foreign = battleSkinDisables(skinId, s.key);
            return (
              <label key={s.key} title={s.title} style={{ display: "block", marginBottom: 5, opacity: foreign ? 0.4 : 1 }}>
                <span style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{s.label}</span>
                  <span>{battleVisuals[s.key].toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  aria-label={s.title}
                  min={min}
                  max={max}
                  step="any"
                  value={battleVisuals[s.key]}
                  disabled={foreign}
                  onChange={(event) => setBattleVisual(s.key, Number(event.target.value))}
                  style={{ width: "100%" }}
                />
              </label>
            );
          })}
          <button type="button" onClick={resetBattleVisuals} style={{ background: "none", border: "1px solid #645355", color: "#DDCF99", cursor: "pointer", font: "inherit", padding: "2px 6px" }}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

export default function BattleStage(props: BattleStageProps) {
  const { getUnits, regionId, regionName, theater, scene, attackerFaction, defenderFaction, coastal, bombard, amphibious, getPhase } = props;
  const skinId = battleSkinFor(theater, scene?.kind === "land" ? scene.biome : undefined);
  const [engine, setEngine] = useState<BattleStageEngine | null>(null);

  useEffect(() => {
    const skin = BATTLE_SKINS[skinId];
    const terrain = terrainFor({ regionId, regionName, theater, scene });
    const next = new BattleStageEngine({
      skin,
      terrain,
      landmarkId: landmarkFor({ regionId, regionName }),
      seed: hashString(`${regionId ?? ""}|${regionName ?? ""}|${theater ?? ""}`) || 1,
      factions: { attacker: attackerFaction, defender: defenderFaction },
      getUnits,
      coastal,
      bombard,
      amphibious,
      getPhase,
      skyMode: skyModeFor(theater, new URLSearchParams(window.location.search).get("sky")),
    });
    setEngine(next);
    return () => {
      next.dispose();
      setEngine(null);
    };
    // The scene is a plain object the screen rebuilds; its region id is what identifies the territory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skinId, regionId, regionName, theater, attackerFaction, defenderFaction, coastal, bombard, amphibious]);

  return (
    <>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }} data-battle-stage={skinId}>
      <Canvas
        flat
        frameloop="always"
        dpr={Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1)}
        camera={{ fov: 35, near: 0.5, far: 120, up: [0, 0, 1], position: [0, -20, 14] }}
        gl={{ antialias: false, alpha: false, depth: true, stencil: false, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {engine && <Driver engine={engine} />}
      </Canvas>
      </div>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}>
        <LookPanel skinId={skinId} />
        <BattleInspectors />
      </div>
    </>
  );
}
