import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { renderUnitToken } from "./drawUnitToken";
import { getTokenArtVersion, subscribeTokenArt } from "./tokenArt";
import { TOKEN_WIDTH_RATIO } from "./tokenGeometry";
import "./unitToken.css";

interface Props {
  unit: string;
  faction: string;
  /** Circle diameter in px. The silhouette may overhang the circle sideways. */
  size?: number;
  title?: string;
  className?: string;
}

/** A faction-coloured unit chit for trays, menus and inspectors. Layout box is the circle, size x size. */
export function UnitToken({ unit, faction, size = 48, title, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const artVersion = useSyncExternalStore(subscribeTokenArt, getTokenArtVersion);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  useLayoutEffect(() => {
    const target = ref.current;
    const ctx = target?.getContext("2d");
    if (!target || !ctx) return;
    const { canvas } = renderUnitToken({ unitTypeId: unit, factionId: faction, size, dpr });
    target.width = canvas.width;
    target.height = canvas.height;
    ctx.drawImage(canvas, 0, 0);
  }, [unit, faction, size, dpr, artVersion]);

  const bleed = (size * (TOKEN_WIDTH_RATIO - 1)) / 2;
  return (
    <span
      className={className ? `unit-token ${className}` : "unit-token"}
      role="img"
      aria-label={title ?? `${faction} ${unit}`}
      title={title}
      style={{ width: size, height: size }}
    >
      <canvas ref={ref} style={{ left: -bleed, width: size * TOKEN_WIDTH_RATIO, height: size }} />
    </span>
  );
}
