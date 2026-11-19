import { useEffect, useRef, useState } from "react";
import { compileBlueprintFrame } from "./blockoutCompiler";
import { poseFiring, poseFrameAt, poseStep } from "./motionPreview";
import { FRAME_LABEL, loadMotionSprite } from "./pixelPaint";
import type { ArchetypeKey } from "./archetypeLayers";
import { ARCHETYPE_STARTERS } from "./archetypeStarters";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS } from "./starterParts";
import type { UnitSpriteSheetBlueprint } from "./skeletonSchema";
import { MILITARY } from "../ui/theme/militaryPalette";

interface Actor {
  id: string;
  blueprint: UnitSpriteSheetBlueprint;
  name: string;
  detail: string;
  depth: number;
  phase: number;
}

const SKELETON_DETAIL: Record<ArchetypeKey, string> = {
  infantry: "the march",
  tank: "tread, bounce, and recoil",
  mech_infantry: "tread and a lifting body",
  artillery: "settle and recoil",
  aircraft: "propeller and guns",
  ship: "foam, swell, and broadside",
};

/** One lane for each skeleton. Every lane plays the four flat frames and nothing else. */
const FIELD: Omit<Actor, "depth">[] = [
  actor("ger-idle", "ger_infantry_43", "German rifleman", SKELETON_DETAIL.infantry, 0),
  ...ARCHETYPE_STARTERS.map((item, index) => ({
    id: item.blueprint.blueprintId,
    blueprint: item.blueprint,
    name: item.title,
    detail: SKELETON_DETAIL[item.archetype],
    phase: (index + 1) % 3,
  })),
];

function actor(id: string, blueprintId: string, name: string, detail: string, phase: number): Omit<Actor, "depth"> {
  const blueprint = STARTER_BLUEPRINTS.find((item) => item.blueprintId === blueprintId);
  if (!blueprint) {
    throw new Error(`No starter blueprint ${blueprintId}`);
  }
  return { id, blueprint, name, detail, phase };
}

function withDepths(actors: Omit<Actor, "depth">[]): Actor[] {
  const count = actors.length;
  return actors.map((item, index) => ({
    ...item,
    depth: count === 1 ? 0.7 : 0.2 + (0.72 * index) / (count - 1),
  }));
}

function editorActor(blueprint: UnitSpriteSheetBlueprint): Omit<Actor, "depth"> {
  return {
    id: "editor",
    blueprint,
    name: "From the editor",
    detail: "the sprite open in the editor",
    phase: 1,
  };
}

/**
 * Four-frame march. The pose clock steps idle, move 1, idle, move 2.
 * The figure itself moves one whole pixel at a time.
 */
export function MotionTestLevel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [caption, setCaption] = useState("Marching");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }
    let stopped = false;
    let frame = 0;
    let pausedTotal = 0;
    let pauseStarted: number | null = null;
    const origin = performance.now();
    const editor = loadMotionSprite();
    const actors = withDepths(editor ? [editorActor(editor.blueprint), ...FIELD] : FIELD);
    const dust = new Map<string, { x: number; y: number; life: number }[]>();
    const lastStep = new Map<string, number>();

    const tick = (now: number) => {
      if (stopped) {
        return;
      }
      if (pausedRef.current) {
        if (pauseStarted === null) {
          pauseStarted = now;
        }
      } else if (pauseStarted !== null) {
        pausedTotal += now - pauseStarted;
        pauseStarted = null;
      }
      const clock = pauseStarted ?? now;
      const elapsed = (clock - origin - pausedTotal) / 1000;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      const nextW = Math.max(1, Math.floor(cssW * dpr));
      const nextH = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;

      const grounds = actors.map((item) => item.depth * cssH);
      const gap = (grounds[1] ?? cssH) - (grounds[0] ?? 0);
      const scale = Math.max(2, Math.min(4, Math.floor((gap - 8) / 48)));
      const left = 200;
      const right = Math.max(left + 48, cssW - 80);
      const span = Math.max(1, Math.floor(right - left));
      const bands = [MILITARY.sage, MILITARY.khaki, MILITARY.brown, MILITARY.taupe];

      ctx.fillStyle = MILITARY.bone;
      ctx.fillRect(0, 0, cssW, grounds[0] ?? 0);
      actors.forEach((item, index) => {
        const top = grounds[index] ?? 0;
        const bottom = grounds[index + 1] ?? cssH;
        ctx.fillStyle = item.blueprint.category === "sea" ? MILITARY.steel : (bands[index % bands.length] ?? MILITARY.brown);
        ctx.fillRect(0, top, cssW, bottom - top);
      });

      ctx.font = "13px Segoe UI, sans-serif";
      ctx.textBaseline = "middle";
      let lead = "Marching";

      actors.forEach((item, index) => {
        const time = elapsed + item.phase * 0.4;
        const firing = poseFiring(time);
        const pose = poseFrameAt(time, firing);
        const step = poseStep(time);
        const travel = step % (span * 2);
        const goingRight = travel < span;
        const along = goingRight ? travel : span * 2 - travel;
        const facing: 1 | -1 = goingRight ? 1 : -1;
        const kick = firing ? item.blueprint.recoilOffsetPx : 0;
        const groundY = Math.round(grounds[index] ?? 0);
        const footX = left + along;
        const compiled = compileBlueprintFrame(item.blueprint, pose, FACTION_MILITARY_MAPPINGS[item.blueprint.factionId]);
        const sheet = compiled.canvas;
        const ground = item.blueprint.groundOrigin;

        ctx.fillStyle = MILITARY.charcoal;
        ctx.fillRect(0, groundY, cssW, 2);
        ctx.fillStyle = "#1c1917";
        ctx.fillText(item.name, 16, groundY - 22);
        ctx.fillText(`${item.detail} · ${FRAME_LABEL[pose]}`, 16, groundY - 6);

        if (sheet) {
          ctx.save();
          ctx.translate(footX - kick * facing * scale, groundY);
          ctx.scale(scale * facing, scale);
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = "#1A1614";
          ctx.fillRect(-6, 0, 12, 1);
          ctx.globalAlpha = 1;
          ctx.drawImage(sheet, -ground.x, -ground.y);
          ctx.restore();
        }

        const specks = dust.get(item.id) ?? [];
        const onLand = item.blueprint.category === "land";
        if (onLand && !firing && (pose === "move_1" || pose === "move_2") && lastStep.get(item.id) !== step) {
          specks.push({ x: footX - facing * 8, y: groundY - 1, life: 6 });
        }
        lastStep.set(item.id, step);
        const alive = specks
          .map((speck) => ({ ...speck, life: speck.life - 1, x: speck.x - facing }))
          .filter((speck) => speck.life > 0);
        dust.set(item.id, alive);
        ctx.fillStyle = MILITARY.bone;
        for (const speck of alive) {
          const size = speck.life > 3 ? 2 : 1;
          ctx.fillRect(Math.round(speck.x), Math.round(speck.y), size, size);
        }

        if (firing && item.blueprint.muzzlePoint && sheet) {
          const muzzle = item.blueprint.muzzlePoint;
          const tipX = footX + facing * (muzzle.x - ground.x - kick) * scale;
          const tipY = groundY + (muzzle.y - ground.y) * scale;
          ctx.fillStyle = MILITARY.cream;
          ctx.fillRect(tipX, tipY, facing * 3 * scale, 2 * scale);
          ctx.fillStyle = MILITARY.brass;
          ctx.fillRect(tipX, tipY + scale, facing * 2 * scale, scale);
        }

        if (index === 0) {
          lead = firing ? "Firing" : "Marching";
        }
      });

      setCaption((current) => (current === lead ? current : lead));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      event.preventDefault();
      pausedRef.current = !pausedRef.current;
      setPaused(pausedRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section className="motion-test" aria-label="Motion test">
      <header className="motion-test-bar">
        <div>
          <p className="motion-test-kicker">Motion test</p>
          <h2>{caption}</h2>
        </div>
        <div className="motion-test-actions">
          <a href="/?bake=1">Back to the editor</a>
          <button
            type="button"
            onClick={() => {
              pausedRef.current = !pausedRef.current;
              setPaused(pausedRef.current);
            }}
          >
            {paused ? "Play" : "Pause"}
          </button>
        </div>
      </header>
      <canvas ref={canvasRef} />
      <p className="motion-test-note">
        One lane for each skeleton: infantry, tank, mechanised infantry, artillery, aircraft, ship. Idle, move 1, idle, move 2,
        eleven poses a second. The figure steps one pixel at a time. Fire kicks back and flashes. Space pauses.
      </p>
      <style>{STYLE}</style>
    </section>
  );
}

const STYLE = `
.motion-test {
  position: fixed;
  inset: 12px;
  z-index: 45;
  display: flex;
  flex-direction: column;
  background: #1c1917;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.motion-test-bar, .motion-test-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.motion-test-bar { padding: 10px 14px 8px; }
.motion-test-kicker {
  margin: 0;
  font: 11px/1.2 "Segoe UI", sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a99c8d;
}
.motion-test h2 { margin: 2px 0 0; font: 600 18px/1.2 "Segoe UI", sans-serif; }
.motion-test button, .motion-test a {
  font: 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  text-decoration: none;
  padding: 6px 10px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
  border-radius: 2px;
}
.motion-test canvas { flex: 1; width: 100%; min-height: 0; display: block; background: #a99c8d; }
.motion-test-note {
  margin: 0;
  padding: 8px 14px 10px;
  font: 13px/1.4 "Segoe UI", sans-serif;
  color: #1c1917;
  background: #f5f0e6;
}
`;
