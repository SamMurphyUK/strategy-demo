import { useEffect, useMemo, useRef, useState } from "react";
import { unitArtUrl } from "../assets";
import {
  baseMapRect,
  FACTORY_OFFSET,
  type HighlightMode,
  IPC_LABEL_FONT_SIZE,
  layoutRegionStacks,
  type MapGeometry,
  polygonPath,
  type Rect,
  regionFill,
  SELECTED_OUTLINE,
  SELECTED_OUTLINE_WIDTH,
  type StackEntry,
  toCss,
  UNIT_ICON_SIZE,
} from "./geometry";

export interface CombatMarker {
  regionId: string;
  count: number;
}

export interface MapViewProps {
  geometry: MapGeometry;
  baseMapUrl: string;
  owners: Record<string, string>;
  stacks: Record<string, StackEntry[]>;
  selectedRegionId: string;
  selectedStack: { regionId: string; key: string } | null;
  highlight: HighlightMode;
  combatMarkers: CombatMarker[];
  isUnmoved(regionId: string, entry: StackEntry): boolean;
  onRegionClick(regionId: string): void;
  onRegionHover(regionId: string): void;
  onStackClick(regionId: string, entry: StackEntry, key: string): void;
}

const VIEW_PADDING = 80;
const MIN_VIEW_WIDTH = 120;
const MAX_VIEW_WIDTH = 6000;
const DRAG_THRESHOLD_PX = 4;

function initialView(bounds: Rect): Rect {
  return {
    x: bounds.x - VIEW_PADDING,
    y: bounds.y - VIEW_PADDING,
    w: bounds.w + VIEW_PADDING * 2,
    h: bounds.h + VIEW_PADDING * 2,
  };
}

function useNaturalSize(url: string): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (url === "") {
      setSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    return () => {
      img.onload = null;
    };
  }, [url]);
  return size;
}

export function MapView(props: MapViewProps) {
  const { geometry } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<Rect>(() => initialView(geometry.bounds));
  const [pixelSize, setPixelSize] = useState({ w: 1, h: 1 });
  const drag = useRef<{ startX: number; startY: number; view: Rect; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const baseSize = useNaturalSize(props.baseMapUrl);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setPixelSize({ w: Math.max(1, entry.contentRect.width), h: Math.max(1, entry.contentRect.height) });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Screen pixels per map unit under preserveAspectRatio="xMidYMid meet".
  const pxPerUnit = Math.min(pixelSize.w / view.w, pixelSize.h / view.h);
  const pxPerUnitRef = useRef(pxPerUnit);
  pxPerUnitRef.current = pxPerUnit;
  const screen = (px: number) => px / pxPerUnit;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      if (!ctm) {
        return;
      }
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const w = Math.min(Math.max(v.w * factor, MIN_VIEW_WIDTH), MAX_VIEW_WIDTH);
        const k = w / v.w;
        return { x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w, h: v.h * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) {
        return;
      }
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      d.moved = true;
      setView({ ...d.view, x: d.view.x - dx / pxPerUnitRef.current, y: d.view.y - dy / pxPerUnitRef.current });
    };
    const onUp = () => {
      if (drag.current?.moved) {
        suppressClick.current = true;
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }
      drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const guard = (fn: () => void) => () => {
    if (!suppressClick.current) {
      fn();
    }
  };

  const baseRect = baseSize ? baseMapRect(baseSize.w, baseSize.h) : null;

  const placed = useMemo(() => {
    return geometry.regions.map((region) => ({
      region,
      stacks: layoutRegionStacks(region, props.stacks[region.id] ?? []),
    }));
  }, [geometry, props.stacks]);

  const iconSize = screen(UNIT_ICON_SIZE);
  const half = iconSize / 2;

  return (
    <div className="map-wrap">
      <svg
        ref={svgRef}
        className="map-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => {
          if (e.button !== 0) {
            return;
          }
          drag.current = { startX: e.clientX, startY: e.clientY, view, moved: false };
        }}
        onPointerLeave={() => props.onRegionHover("")}
      >
        {baseRect && (
          <image
            href={props.baseMapUrl}
            x={baseRect.x}
            y={baseRect.y}
            width={baseRect.w}
            height={baseRect.h}
            preserveAspectRatio="none"
            style={{ imageRendering: "pixelated" }}
          />
        )}

        <g className="regions">
          {geometry.regions.map((region) => {
            const owner = props.owners[region.id] ?? "";
            const fill = toCss(regionFill(region.id, owner, props.highlight));
            return (
              <path
                key={region.id}
                d={polygonPath(region.points)}
                fill={fill}
                className="region"
                data-region={region.id}
                onClick={guard(() => props.onRegionClick(region.id))}
                onPointerEnter={() => props.onRegionHover(region.id)}
              />
            );
          })}
        </g>

        {props.selectedRegionId !== "" &&
          geometry.regions
            .filter((r) => r.id === props.selectedRegionId)
            .map((r) => (
              <path
                key="selected"
                d={polygonPath(r.points)}
                fill="none"
                stroke={toCss(SELECTED_OUTLINE)}
                strokeWidth={SELECTED_OUTLINE_WIDTH}
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ))}

        <g className="ipc-labels" pointerEvents="none">
          {geometry.regions
            .filter((r) => r.type === "land" && r.ipc > 0)
            .map((r) => (
              <text
                key={r.id}
                x={r.centroid.x}
                y={r.centroid.y}
                fontSize={IPC_LABEL_FONT_SIZE}
                textAnchor="middle"
                dominantBaseline="central"
                className="ipc-label"
              >
                {r.ipc}
              </text>
            ))}
        </g>

        <g className="units">
          {placed.map(({ region, stacks }) => (
            <g key={region.id}>
              {region.hasFactory && (
                <FactoryIcon
                  x={region.anchor.x + FACTORY_OFFSET.x}
                  y={region.anchor.y + FACTORY_OFFSET.y}
                  size={iconSize}
                  owner={props.owners[region.id] ?? ""}
                />
              )}
              {stacks.map(({ key, entry, position }) => {
                const selected = props.selectedStack?.regionId === region.id && props.selectedStack.key === key;
                const unmoved = props.isUnmoved(region.id, entry);
                const art = unitArtUrl(entry.unit_type_id, entry.faction_id);
                return (
                  <g
                    key={key}
                    transform={`translate(${position.x} ${position.y})`}
                    className="unit-icon"
                    data-unit={`${region.id}|${key}`}
                    onClick={guard(() => props.onStackClick(region.id, entry, key))}
                  >
                    <rect x={-half} y={-half} width={iconSize} height={iconSize} fill="transparent" />
                    {art !== "" ? (
                      <image href={art} x={-half} y={-half} width={iconSize} height={iconSize} />
                    ) : (
                      <circle r={half * 0.8} fill="#444" />
                    )}
                    {(unmoved || selected) && (
                      <rect
                        x={-half - screen(3)}
                        y={-half - screen(3)}
                        width={iconSize + screen(6)}
                        height={iconSize + screen(6)}
                        fill="none"
                        stroke={selected ? toCss(SELECTED_OUTLINE) : "rgba(255,255,255,0.85)"}
                        strokeWidth={screen(selected ? 3 : 1.5)}
                        strokeDasharray={selected ? undefined : `${screen(4)} ${screen(3)}`}
                        pointerEvents="none"
                      />
                    )}
                    {entry.count > 1 && (
                      <g transform={`translate(${half - screen(4)} ${half - screen(4)})`} pointerEvents="none">
                        <circle r={screen(10)} className="count-badge" />
                        <text
                          fontSize={screen(12)}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="count-text"
                        >
                          {entry.count}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
        </g>

        <g className="combat-markers">
          {props.combatMarkers.map((m) => {
            const region = geometry.regions.find((r) => r.id === m.regionId);
            if (!region) {
              return null;
            }
            return (
              <g
                key={m.regionId}
                transform={`translate(${region.anchor.x} ${region.anchor.y - UNIT_ICON_SIZE * 0.75})`}
                pointerEvents="none"
              >
                <rect
                  x={-screen(22)}
                  y={-screen(11)}
                  width={screen(44)}
                  height={screen(22)}
                  rx={screen(6)}
                  className="combat-marker"
                />
                <text fontSize={screen(12)} textAnchor="middle" dominantBaseline="central" className="combat-text">
                  ⚔ {m.count}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="map-controls">
        <button type="button" onClick={() => setView(initialView(geometry.bounds))}>
          Fit map
        </button>
      </div>
    </div>
  );
}

function FactoryIcon(props: { x: number; y: number; size: number; owner: string }) {
  const art = unitArtUrl("factory", props.owner);
  if (art === "") {
    return null;
  }
  const half = props.size / 2;
  return (
    <image
      href={art}
      x={props.x - half}
      y={props.y - half}
      width={props.size}
      height={props.size}
      pointerEvents="none"
    />
  );
}
