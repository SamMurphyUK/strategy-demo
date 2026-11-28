import { Anchor, Crosshair, Factory, Package, Plane, Radar } from "lucide-react";
import type { ReactNode } from "react";
import type { OpIcon } from "./specialOps";

const ICONS: Record<OpIcon, typeof Factory> = {
  factory: Factory,
  airbase: Plane,
  harbor: Anchor,
  depot: Package,
  raid: Crosshair,
  patrol: Radar,
};

export function OpGlyph({ icon, size = 16 }: { icon: OpIcon; size?: number }) {
  const Icon = ICONS[icon];
  return <Icon size={size} strokeWidth={2.2} aria-hidden="true" />;
}

export interface BubbleOption {
  id: string;
  icon: OpIcon;
  label: string;
  /** The mode this option has switched on. */
  active?: boolean;
  /** A small count beside the icon: patrol fighters, or escorts. */
  badge?: string;
}

/** Pointer events on an overlay stay on it: the map under it must not take a click meant for a chip. */
function stop(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

/**
 * The action bubble over the selected unit: one icon for each special operation the engine offers it this turn, and no other. It is
 * an upright screen-space card with a tail toward the unit, so it stands the same however far the camera tilts. An escort stepper
 * shows beside a raid on a factory that fighters could escort.
 */
export function ActionBubble({
  x,
  y,
  options,
  onOption,
  escorts,
}: {
  x: number;
  y: number;
  options: readonly BubbleOption[];
  onOption(id: string): void;
  escorts?: ReactNode;
}) {
  return (
    <div className="ops-bubble" style={{ left: x, top: y }} onPointerDown={stop} onPointerUp={stop} onClick={stop} role="toolbar" aria-label="Special operations">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.active ? "ops-chip is-active" : "ops-chip"}
          title={option.label}
          aria-label={option.label}
          aria-pressed={option.active === true}
          onClick={() => onOption(option.id)}
        >
          <OpGlyph icon={option.icon} />
          {option.badge ? <span className="ops-badge">{option.badge}</span> : null}
        </button>
      ))}
      {escorts}
    </div>
  );
}

/** The matching icon on a region the engine says is a valid target of the chosen operation. Clicking it commits the order. */
export function TargetMarker({ x, y, icon, label, onPick }: { x: number; y: number; icon: OpIcon; label: string; onPick(): void }) {
  return (
    <button
      type="button"
      className="ops-marker"
      style={{ left: x, top: y }}
      title={label}
      aria-label={label}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={(event) => {
        event.stopPropagation();
        onPick();
      }}
    >
      <OpGlyph icon={icon} size={18} />
    </button>
  );
}

/** The patrol icon that stays over fighters on patrol, through the turn and the turns after, until they stand down. */
export function PatrolMark({ x, y, count, pending }: { x: number; y: number; count: number; pending?: boolean }) {
  return (
    <span className={pending ? "ops-patrol is-pending" : "ops-patrol"} style={{ left: x, top: y }} title={`Air patrol: ${count} fighter${count === 1 ? "" : "s"}${pending ? " (set this turn)" : ""}`} aria-label={`Air patrol, ${count}`}>
      <OpGlyph icon="patrol" size={14} />
      <span className="ops-badge">{count}</span>
    </span>
  );
}
