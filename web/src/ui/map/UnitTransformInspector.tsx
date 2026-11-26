// The unit transform inspector: press T with a unit selected. It moves the detailed figures on their
// bases, by preset, for all units, one faction, or one unit type, and for a stack of one, two, or
// three and more. The presets are kept in this browser, and the JSON can be copied or downloaded to
// lock a set in for a future build.
import { useState, useSyncExternalStore } from "react";
import { getUnitTransformRev, getUnitTransforms, resetUnitPresets, setUnitPreset, subscribeUnitTransforms } from "./unitTransformStore";
import {
  bucketOf,
  isTransform,
  NO_TRANSFORM,
  presetKey,
  serializeTransforms,
  type StackBucket,
  TRANSFORM_RANGES,
  type TransformScope,
  type UnitTransform,
} from "./unitTransforms";

export interface TransformTarget {
  factionId: string;
  unitType: string;
  count: number;
  /** The unit as the tooltip names it. */
  label: string;
}

const FIELDS: readonly { key: keyof UnitTransform; label: string; unit: string; step: number }[] = [
  { key: "dx", label: "X", unit: "px", step: 0.5 },
  { key: "dy", label: "Y", unit: "px", step: 0.5 },
  { key: "dz", label: "Z", unit: "px", step: 0.5 },
  { key: "tilt", label: "Tilt", unit: "deg", step: 1 },
  { key: "rot", label: "Rotate", unit: "deg", step: 1 },
];

const SCOPES: readonly { id: TransformScope; label: string }[] = [
  { id: "all", label: "All units" },
  { id: "faction", label: "Faction" },
  { id: "archetype", label: "Unit type" },
];

const BUCKETS: readonly { id: StackBucket; label: string }[] = [
  { id: 1, label: "1 unit" },
  { id: 2, label: "2 units" },
  { id: 3, label: "3+ units" },
];

const panel = {
  position: "fixed",
  right: 12,
  bottom: 56,
  zIndex: 45,
  width: 268,
  padding: 10,
  font: "12px monospace",
  color: "#e9dfc9",
  background: "rgba(43,33,36,0.95)",
  border: "1px solid #ddcf99",
  borderRadius: 4,
} as const;

const button = {
  font: "12px monospace",
  color: "#e9dfc9",
  background: "#4b3d44",
  border: "1px solid #8c7c79",
  borderRadius: 3,
  padding: "2px 8px",
  cursor: "pointer",
} as const;

export function UnitTransformInspector({ target, onClose }: { target: TransformTarget | null; onClose(): void }) {
  useSyncExternalStore(subscribeUnitTransforms, getUnitTransformRev, getUnitTransformRev);
  if (!target) {
    return (
      <div style={panel} role="dialog" aria-label="Unit transform inspector">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <strong>UNIT TRANSFORM</strong>
          <button type="button" style={button} onClick={onClose} title="Close (T)">
            x
          </button>
        </div>
        <p style={{ margin: "8px 0 0" }}>Point at a unit, or click one, then press T. The stack's name shows here.</p>
      </div>
    );
  }
  return <UnitTransformEditor target={target} onClose={onClose} />;
}

function UnitTransformEditor({ target, onClose }: { target: TransformTarget; onClose(): void }) {
  const [scope, setScope] = useState<TransformScope>("archetype");
  const [bucket, setBucket] = useState<StackBucket>(bucketOf(target.count));
  const id = scope === "faction" ? target.factionId : target.unitType;
  const key = presetKey(scope, id, bucket);
  const set = getUnitTransforms();
  const current = set.presets[key] ?? NO_TRANSFORM;
  const json = JSON.stringify(serializeTransforms(set), null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Without the clipboard, the download still works.
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "unit-transforms.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={panel} role="dialog" aria-label="Unit transform inspector">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong>UNIT TRANSFORM</strong>
        <button type="button" style={button} onClick={onClose} title="Close (T)">
          x
        </button>
      </div>
      <div style={{ marginBottom: 6, opacity: 0.85 }}>{target.label}</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {SCOPES.map((item) => (
          <button
            key={item.id}
            type="button"
            style={{ ...button, background: scope === item.id ? "#ddcf99" : "#4b3d44", color: scope === item.id ? "#2b2124" : "#e9dfc9" }}
            onClick={() => setScope(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {BUCKETS.map((item) => (
          <button
            key={item.id}
            type="button"
            style={{ ...button, background: bucket === item.id ? "#ddcf99" : "#4b3d44", color: bucket === item.id ? "#2b2124" : "#e9dfc9" }}
            onClick={() => setBucket(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {FIELDS.map((field) => {
        const [low, high] = TRANSFORM_RANGES[field.key];
        return (
          <label key={field.key} style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0" }}>
            <span style={{ width: 44 }}>{field.label}</span>
            <input
              type="range"
              min={low}
              max={high}
              step={field.step}
              value={current[field.key]}
              aria-label={`${field.label} (${field.unit})`}
              style={{ flex: 1 }}
              onChange={(event) => setUnitPreset(key, { ...current, [field.key]: Number(event.target.value) })}
            />
            <span style={{ width: 46, textAlign: "right" }}>
              {current[field.key].toFixed(field.step < 1 ? 1 : 0)}
              {field.unit === "deg" ? "°" : ""}
            </span>
          </label>
        );
      })}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button type="button" style={button} disabled={!isTransform(current)} onClick={() => setUnitPreset(key, NO_TRANSFORM)}>
          Reset
        </button>
        <button type="button" style={button} onClick={resetUnitPresets} title="Clear every preset">
          Reset all
        </button>
        <button type="button" style={button} onClick={copy} title="Copy the presets as JSON">
          Copy
        </button>
        <button type="button" style={button} onClick={download} title="Download the presets as JSON">
          Save
        </button>
      </div>
      <div style={{ marginTop: 6, opacity: 0.6 }}>The unit type beats the faction, and the faction beats all units. Each stack size has its own.</div>
    </div>
  );
}
