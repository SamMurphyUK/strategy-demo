import { useEffect, useMemo, useState } from "react";
import { FrameEditor } from "./FrameEditor";
import { FIELD_PICK_KEY } from "./nativeBattleOverlay";
import { candidateShelf, groupShelf, shelfUnits, vectorShelf, type ShelfUnit } from "./unitShelf";
import { SpriteStampPanel } from "./SpriteStampPanel";
import { GraphicsSettingsPanel } from "./GraphicsSettingsPanel";

interface SavedCandidate {
  factionId: string;
  unitTypeId?: string;
  blueprintId: string;
  seed: number;
  quantized: string;
  width?: number;
  height?: number;
  promptStyle?: string;
  grade?: string;
  silhouetteIoU: number | null;
  promoted?: boolean;
}

export function UnitBakeReviewPanel() {
  const [saved, setSaved] = useState<SavedCandidate[]>([]);
  /** Undefined until the vector manifest has answered. */
  const [vectorManifest, setVectorManifest] = useState<unknown>(undefined);
  /** Bumped after Bake now, to read the manifest again and skip cached pictures. */
  const [shelfTick, setShelfTick] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [galleryKey, setGalleryKey] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/__dev/bake-candidates")
      .then((response) => response.json())
      .then((json) => {
        if (!cancel && Array.isArray(json.candidates)) {
          setSaved(json.candidates);
        }
      })
      .catch(() => undefined);
    fetch("/assets/units/vector/manifest.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!cancel) {
          setVectorManifest(json ?? null);
        }
      })
      .catch(() => {
        if (!cancel) {
          setVectorManifest(null);
        }
      });
    return () => {
      cancel = true;
    };
  }, [shelfTick]);

  const hint = (text: string) => ({ title: text });

  const library = useMemo(() => [...vectorShelf(vectorManifest), ...candidateShelf(saved)], [vectorManifest, saved]);
  const shown = useMemo(() => shelfUnits(library, showAll), [library, showAll]);
  const grouped = useMemo(() => groupShelf(shown), [shown]);
  const polishedCount = useMemo(() => shelfUnits(library, false).length, [library]);
  const galleryPick = shown.find((item) => item.key === galleryKey) ?? null;
  const savedByPath = useMemo(() => new Map(saved.map((item) => [item.quantized, item])), [saved]);

  return (
    <section className="unit-bake-review" aria-label="Unit shelf">
      <style>{PANEL_CSS}</style>
      <div className="bake-field-bar">
        <button
          type="button"
          onClick={() => {
            if (galleryPick?.fieldPick) {
              sessionStorage.setItem(FIELD_PICK_KEY, galleryPick.fieldPick);
            } else {
              sessionStorage.removeItem(FIELD_PICK_KEY);
            }
            window.location.assign("/?bake=1&field=1");
          }}
          {...hint(
            galleryPick?.fieldPick
              ? `Open ${galleryPick.polished ? "the polished pixels of " : ""}the selected unit on a battle map at its real size. Add more units there. The map starts at one screen pixel per pixel.`
              : "Open a battle map at native size. The Japanese walk starts on it, and you can add any sprite beside it.",
          )}
        >
          On a battle map
        </button>
        <p>Native size on the map. Scale the view up once you are there.</p>
      </div>
      <GraphicsSettingsPanel />
      <details className="overnight-gallery" open>
        <summary>
          {showAll ? `All units (${shown.length})` : `Polished vectors (${shown.length})`}
        </summary>
        <label className="unit-shelf-all" {...hint("Off: only units traced from a polished PNG. On: every vector and every overnight picture. Nothing is moved or deleted either way.")}>
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          Show all units
        </label>
        {shown.length === 0 && (
          <p className="sprite-generate-lead">
            {vectorManifest === undefined
              ? "Reading the vector manifest…"
              : showAll
                ? "No units yet."
                : "No polished vectors yet. Run npm run vectorize:units -- --polished."}
          </p>
        )}
        {!showAll && polishedCount > 0 && (
          <p className="sprite-generate-lead">
            {library.length - polishedCount} other pictures and vectors are hidden. They are still in their folders.
          </p>
        )}
        {grouped.map((group) => (
          <div key={group.factionId}>
            <h2>{group.factionId}</h2>
            <div className="unit-shelf-types">
              {group.types.map((type) => (
                <div key={type.unitTypeId} className="unit-shelf-type">
                  <h3>{type.label}</h3>
                  <div className="overnight-row">
                    {type.units.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        title={item.label}
                        aria-label={item.label}
                        aria-pressed={item.key === galleryKey}
                        onClick={() => setGalleryKey(item.key)}
                      >
                        <img className={item.vectorised ? "unit-shelf-vector" : undefined} src={item.preview} alt="" />
                        <small>{shelfCaption(item, savedByPath.get(item.picture ?? ""))}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {galleryPick && (
          <figure className="unit-shelf-pick">
            <figcaption>
              {galleryPick.label}
              {galleryPick.width ? ` · ${galleryPick.width}×${galleryPick.height}` : ""}
              {galleryPick.kind === "clips" ? " · idle frame" : ""}
            </figcaption>
            <img className={galleryPick.vectorised ? "unit-shelf-vector" : undefined} src={`${galleryPick.preview}${shelfTick ? `${galleryPick.preview.includes("?") ? "&" : "?"}v=${shelfTick}` : ""}`} alt="" {...galleryZoom(galleryPick)} />
            {galleryPick.vectorised && galleryPick.picture && (
              <>
                <figcaption>
                  {galleryPick.stamped ? "Stamped pixels" : galleryPick.polished ? "Polished pixels" : "Pixels"} it was traced from. On a battle map opens these.
                </figcaption>
                <img src={`/__dev/bake-file?path=${encodeURIComponent(galleryPick.picture)}${shelfTick ? `&v=${shelfTick}` : ""}`} alt="" {...galleryZoom(galleryPick)} />
              </>
            )}
            {galleryPick.kind === "vector" && galleryPick.stampSource && (
              <SpriteStampPanel
                key={galleryPick.stampSource}
                source={galleryPick.stampSource}
                factionId={galleryPick.factionId}
                onBaked={(svg) => {
                  if (svg) {
                    setGalleryKey(`vec:${svg}`);
                  }
                  setShelfTick((tick) => tick + 1);
                }}
              />
            )}
            {galleryPick.kind === "clips" && (
              <figcaption>On a battle map opens the polished walk, drawn from its PNG frames. The walk takes no stamp: a soldier wore no national emblem on his body.</figcaption>
            )}
          </figure>
        )}
      </details>
      <FrameEditor shelfPick={galleryPick} />
      <div className="sprite-editor-end" aria-hidden="true" />
    </section>
  );
}

const PANEL_CSS = `
.unit-bake-review {
  position: fixed;
  z-index: 40;
  top: 12px;
  right: 12px;
  bottom: 96px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 108px);
  padding: 16px 16px 0;
  background: #1c1917;
  color: #f5f0e6;
  overflow: auto;
  box-shadow: 0 0 0 1px #4b3d44;
}
.sprite-editor-end {
  flex: none;
  height: 220px;
}
.bake-field-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 4px 0 8px;
  background: #1c1917;
}
.bake-field-bar button {
  font: 600 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  padding: 6px 10px;
  background: #ddcf99;
  color: #1c1917;
  border: 1px solid #ddcf99;
}
.bake-field-bar p {
  margin: 0;
  color: #a99c8d;
  font: 13px/1.3 "Segoe UI", sans-serif;
}
.overnight-gallery { flex: none; }
.overnight-gallery h2 { margin: 12px 0 6px; font: 600 14px/1.2 "Segoe UI", sans-serif; }
.overnight-gallery summary { cursor: pointer; font: 600 15px/1.4 "Segoe UI", sans-serif; }
.overnight-row { display: flex; flex-wrap: wrap; gap: 8px; }
.overnight-row button { width: 96px; padding: 4px; background: #2a2420; color: #f5f0e6; border: 1px solid #4b3d44; }
.overnight-row button[aria-pressed="true"] { border-color: #ddcf99; }
.overnight-row img, .overnight-gallery figure img { image-rendering: pixelated; background: #c8c2b6; }
.overnight-row img { display: block; width: 86px; height: 48px; object-fit: contain; }
.overnight-gallery figure img { max-width: 100%; height: auto; }
.overnight-row small { display: block; color: #ddcf99; font-size: 10px; }
.overnight-row img.unit-shelf-vector, .overnight-gallery figure img.unit-shelf-vector { image-rendering: auto; }
.unit-shelf-all { display: flex; gap: 6px; align-items: center; margin: 8px 0 0; font: 13px/1.3 "Segoe UI", sans-serif; color: #f5f0e6; cursor: pointer; }
.unit-shelf-types { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: flex-start; }
.unit-shelf-type h3 { margin: 8px 0 4px; color: #a99c8d; font: 600 12px/1.2 "Segoe UI", sans-serif; }
.unit-shelf-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.unit-shelf-pick figcaption { color: #a99c8d; font: 13px/1.3 "Segoe UI", sans-serif; }
.sprite-generate-lead {
  margin: 8px 0;
  color: #a99c8d;
  font: 13px/1.4 "Segoe UI", sans-serif;
}
`;

/** The card line under a unit. An overnight picture keeps its match score, size and style. */
function shelfCaption(item: ShelfUnit, row: SavedCandidate | undefined): string {
  const seed = typeof item.seed === "number" ? ` ${item.seed}` : "";
  const kind = item.kind === "clips" ? "walk, " : "";
  if (item.vectorised) {
    return `${kind}${item.stamped ? "stamped vector" : item.polished ? "polished vector" : "vector"}${seed}${item.width ? ` · ${item.width}×${item.height}` : ""}`;
  }
  const parts = [`picture${seed}`];
  if (row?.silhouetteIoU != null) {
    parts.push(row.silhouetteIoU.toFixed(2));
  }
  if (item.width) {
    parts.push(`${item.width}×${item.height}`);
  }
  if (row?.promptStyle && row.promptStyle !== "rd_fast__default") {
    parts.push(row.promptStyle);
  }
  if (row?.grade === "outlined") {
    parts.push("outlines");
  }
  return parts.join(" · ");
}

/** Older pictures are 48 square and carry no size. */
function galleryZoom(item: { width?: number; height?: number }): { width: number; height: number } {
  const width = item.width ?? 48;
  const height = item.height ?? 48;
  const zoom = Math.max(1, Math.min(4, Math.floor(1024 / width)));
  return { width: width * zoom, height: height * zoom };
}
