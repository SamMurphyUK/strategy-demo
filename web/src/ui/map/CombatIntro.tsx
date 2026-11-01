import { useEffect, useRef, type MouseEvent } from "react";
import { flagMotifForFaction, type FlagMotif } from "../battle/flagMotif";
import { drawAttackBriefing, drawProceduralWavingFlag } from "../battle/unitRenderer";
import { attackBriefingLines } from "./combatCamera";
import { factionName } from "./session/event_text";
import "./battleScreen.css";

const STAGE_W = 1280;
const STAGE_H = 720;

interface IntroProps {
  attackerId: string;
  defenderId: string;
  regionName: string;
  onBegin(): void;
}

/**
 * The attacker's flag and the brass panel, on the same 1280×720 stage as the battle board.
 * Mounted after the map has faded to black. Click the button, or press Space or Enter.
 */
export function CombatIntro({ attackerId, defenderId, regionName, onBegin }: IntroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const readyRef = useRef(false);
  const begunRef = useRef(false);
  const motifRef = useRef<FlagMotif>(flagMotifForFaction(attackerId));
  const linesRef = useRef<string[]>(attackBriefingLines(factionName(attackerId), factionName(defenderId), regionName));
  const onBeginRef = useRef(onBegin);
  motifRef.current = flagMotifForFaction(attackerId);
  linesRef.current = attackBriefingLines(factionName(attackerId), factionName(defenderId), regionName);
  onBeginRef.current = onBegin;

  const begin = () => {
    if (!readyRef.current || begunRef.current) return;
    begunRef.current = true;
    onBeginRef.current();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      drawProceduralWavingFlag(ctx, STAGE_W, STAGE_H, elapsed, "eastern", motifRef.current);
      buttonRef.current = drawAttackBriefing(ctx, STAGE_W, STAGE_H, elapsed, elapsed, linesRef.current).button;
      readyRef.current = elapsed > 0.9;
      const black = Math.max(0, 1 - elapsed / 0.35);
      if (black > 0.01) {
        ctx.save();
        ctx.globalAlpha = black;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.code !== "Enter") return;
      e.preventDefault();
      begin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const button = buttonRef.current;
    if (!canvas || !button) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * STAGE_W) / rect.width;
    const y = ((e.clientY - rect.top) * STAGE_H) / rect.height;
    if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) begin();
  };

  const sentence = linesRef.current.join(" ");
  return (
    <div className="combat-cover" role="dialog" aria-label={sentence}>
      <canvas
        ref={canvasRef}
        className="combat-stage"
        width={STAGE_W}
        height={STAGE_H}
        onClick={onClick}
      />
    </div>
  );
}

/** The map fades out before the flag is shown. */
export function CombatDarken({ onDone }: { onDone(): void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), 1000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div
      className="combat-darken"
      onAnimationEnd={(e) => {
        if (e.animationName === "combat-darken") done.current();
      }}
    />
  );
}
