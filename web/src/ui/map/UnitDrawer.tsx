import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { renderUnitToken } from "../theme/tokens/drawUnitToken";
import { getTokenArtVersion, subscribeTokenArt } from "../theme/tokens/tokenArt";
import type { StackEntry } from "./geometry";
import { type DomainGroup, domainLabel, drawerRows } from "./unitStacks";

const CHIP_PX = 32;
/** The pointer has to travel this far from a row before it counts as dragging the unit out. */
const DRAG_START_PX = 5;

/** A unit token as a small canvas. */
function UnitChip({ entry, size = CHIP_PX }: { entry: StackEntry; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useSyncExternalStore(subscribeTokenArt, getTokenArtVersion); // repaint when the token art arrives
  const dpr = window.devicePixelRatio || 1;
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ref.current || !ctx) {
      return;
    }
    const token = renderUnitToken({ unitTypeId: entry.unit_type_id, factionId: entry.faction_id, size: CHIP_PX, dpr });
    ref.current.width = Math.round(size * dpr);
    ref.current.height = Math.round(size * dpr);
    ctx.clearRect(0, 0, ref.current.width, ref.current.height);
    ctx.drawImage(token.canvas, 0, 0, ref.current.width, ref.current.height);
  });
  return <canvas ref={ref} className="unit-chip" style={{ width: size, height: size }} />;
}

export interface UnitDrawerProps {
  group: DomainGroup;
  /** Pixel position of the drawer's anchor point, relative to the map. */
  x: number;
  y: number;
  /** "above" puts the drawer over the bubble, "below" flips it under when there is no room above. */
  placement: "above" | "below";
  selectedKey: string | null;
  isUnmoved(entry: StackEntry): boolean;
  /** A click on a row: pick that unit type for an order (toggles). */
  onSelect(entry: StackEntry, key: string): void;
  /** The pointer left a row and is dragging it: pick the stack so the legal targets light up. */
  onDragStart(entry: StackEntry, key: string): void;
  /** The drag ended at this client point. */
  onDragEnd(entry: StackEntry, key: string, clientX: number, clientY: number): void;
}

/**
 * The expanded unit drawer: every unit type and count in one collapsed domain. Click a row to select it for a
 * move or attack, or drag it out onto a region to order it there. The map closes it on a click elsewhere and
 * on Escape.
 */
export function UnitDrawer(props: UnitDrawerProps) {
  const { group } = props;
  const rows = drawerRows(group);
  const [drag, setDrag] = useState<{ key: string; x: number; y: number } | null>(null);
  const press = useRef<{ key: string; startX: number; startY: number; dragging: boolean } | null>(null);

  return (
    <div
      className={`unit-drawer unit-drawer-${props.placement}`}
      style={{ left: props.x, top: props.y }}
      role="dialog"
      aria-label={`${domainLabel(group.domain)} units`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="unit-drawer-head">
        <span>{domainLabel(group.domain)}</span>
        <b className="mono">{group.total}</b>
      </div>
      <ul>
        {rows.map((row) => {
          const selected = props.selectedKey === row.key;
          const unmoved = props.isUnmoved(row.entry);
          return (
            <li key={row.key}>
              <button
                type="button"
                className={`unit-drawer-row${selected ? " selected" : ""}${unmoved ? "" : " spent"}`}
                title="Click to select. Drag onto a region to order it there."
                onPointerDown={(e) => {
                  if (e.button !== 0) {
                    return;
                  }
                  press.current = { key: row.key, startX: e.clientX, startY: e.clientY, dragging: false };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const p = press.current;
                  if (!p || p.key !== row.key) {
                    return;
                  }
                  if (!p.dragging && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) >= DRAG_START_PX) {
                    p.dragging = true;
                    props.onDragStart(row.entry, row.key);
                  }
                  if (p.dragging) {
                    setDrag({ key: row.key, x: e.clientX, y: e.clientY });
                  }
                }}
                onPointerUp={(e) => {
                  const p = press.current;
                  press.current = null;
                  setDrag(null);
                  if (!p || p.key !== row.key) {
                    return;
                  }
                  if (p.dragging) {
                    props.onDragEnd(row.entry, row.key, e.clientX, e.clientY);
                  } else {
                    props.onSelect(row.entry, row.key);
                  }
                }}
                onPointerCancel={() => {
                  press.current = null;
                  setDrag(null);
                }}
              >
                <UnitChip entry={row.entry} />
                <span className="unit-drawer-name">{row.label}</span>
                <b className="mono">{"\u00d7"}{row.count}</b>
              </button>
              {drag?.key === row.key &&
                // A portal, because the drawer is transformed and would re-anchor a fixed child.
                createPortal(
                  <div className="unit-drag-ghost" style={{ left: drag.x, top: drag.y }}>
                    <UnitChip entry={row.entry} size={36} />
                  </div>,
                  document.body,
                )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
