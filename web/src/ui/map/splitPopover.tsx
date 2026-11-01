import { type Ref, type KeyboardEvent, type PointerEvent } from "react";
import { clampMoveCount, halfStack } from "./moveDrag";

const SPLIT_W = 260;
const SPLIT_H = 158;

export interface SplitStackPopoverProps {
  title: string;
  count: number;
  max: number;
  x: number;
  y: number;
  boundsW: number;
  boundsH: number;
  panelRef?: Ref<HTMLDivElement>;
  onCount(count: number): void;
  onConfirm(): void;
  onCancel(): void;
}

export function SplitStackPopover(props: SplitStackPopoverProps) {
  const pills = [
    ["1", 1],
    ["2", Math.min(2, props.max)],
    ["Half", halfStack(props.max)],
    ["All", props.max],
  ] as const;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      props.onConfirm();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  return (
    <div
      className="split-popover"
      role="dialog"
      aria-label={`Split ${props.title}`}
      tabIndex={-1}
      ref={props.panelRef}
      style={{
        left: Math.min(Math.max(8, props.x), Math.max(8, props.boundsW - SPLIT_W - 8)),
        top: Math.min(Math.max(8, props.y), Math.max(8, props.boundsH - SPLIT_H - 8)),
      }}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <p className="split-title">
        {props.title} <b className="mono">{props.count}</b> of {props.max}
      </p>
      <div className="split-pills">
        {pills.map(([label, n]) => (
          <button
            key={label}
            type="button"
            className={props.count === n ? "active" : ""}
            disabled={label === "2" && props.max < 2}
            onClick={() => props.onCount(n)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="split-stepper stepper">
        <button
          type="button"
          onClick={() => props.onCount(clampMoveCount(props.count - 1, props.max))}
          disabled={props.count <= 1}
          aria-label="Fewer"
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={props.max}
          value={props.count}
          aria-label="Units to move"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) {
              return;
            }
            props.onCount(clampMoveCount(n, props.max));
          }}
        />
        <button
          type="button"
          onClick={() => props.onCount(clampMoveCount(props.count + 1, props.max))}
          disabled={props.count >= props.max}
          aria-label="More"
        >
          +
        </button>
      </div>
      <div className="split-actions">
        <button type="button" className="primary" onClick={props.onConfirm}>
          Confirm
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
