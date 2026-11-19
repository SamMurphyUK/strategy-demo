import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ARCHETYPES, layerLabel } from "./archetypeLayers";
import { imageRgba, loadImage, putRgba, slotGridRgba, type EditorHint } from "./editorShared";
import { withEditingLayer, type UnitPaintDocument } from "./pixelPaint";
import type { FactionMilitaryMapping, SpriteFrameGrid } from "./skeletonSchema";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import {
  addVehiclePart,
  copyVehiclePart,
  gridFromPicture,
  partPreview,
  removeVehicleBuild,
  removeVehiclePart,
  renameVehiclePart,
  saveVehicleBuild,
  vehicleBuildGaps,
  wardrobeOf,
  wearVehicleBuild,
  wearVehiclePart,
  wornVehicleBuild,
} from "./vehicleParts";

/** The longest side a thumbnail shows at, in screen pixels. */
const THUMB_WIDTH = 168;
const THUMB_HEIGHT = 104;

/** A slot grid at its own size, shown as large as the thumbnail box allows in whole steps. */
export function GridThumb({ grid, mapping }: { grid: SpriteFrameGrid; mapping: FactionMilitaryMapping }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  useEffect(() => putRgba(ref.current, slotGridRgba(grid, mapping), width, height), [grid, mapping, width, height]);
  const fit = Math.min(THUMB_WIDTH / Math.max(1, width), THUMB_HEIGHT / Math.max(1, height));
  const scale = fit >= 1 ? Math.min(4, Math.floor(fit)) : fit;
  return <canvas ref={ref} width={width} height={height} style={{ width: Math.round(width * scale), height: Math.round(height * scale) }} />;
}

/**
 * The parts each layer of a vehicle can wear: a list for every layer, the saved builds, and the
 * open layer's parts as pictures. It is the vehicle editor's copy of the infantry editor's Parts,
 * Builds, and shelf rows.
 */
export function VehiclePartsPanel({
  doc,
  onChange,
  onNote,
  hint,
}: {
  doc: UnitPaintDocument;
  /** Take the changed document, with a line that says what happened. */
  onChange: (next: UnitPaintDocument, note: string) => void;
  onNote: (note: string) => void;
  hint: EditorHint;
}) {
  const [partName, setPartName] = useState("");
  const [buildName, setBuildName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const wardrobe = useMemo(() => wardrobeOf(doc), [doc]);
  // The pictures follow the pencil a moment later, so a long stroke on a large plate stays smooth.
  const settled = useDeferredValue(doc);
  const skeleton = ARCHETYPES[doc.archetype];
  const layer = doc.editingLayer ?? skeleton.layers[0]?.key ?? "";
  const label = layerLabel(doc.archetype, layer);
  const lower = label.toLowerCase();
  const mapping = FACTION_MILITARY_MAPPINGS[settled.blueprint.factionId];
  const shelf = useMemo(() => {
    const shown = settled.editingLayer ?? layer;
    const current = wardrobeOf(settled);
    return current.parts
      .filter((part) => part.layer === shown)
      .map((part) => ({ part, worn: current.wearing[shown] === part.id, pixels: partPreview(settled, shown, part.grid) }));
  }, [settled, layer]);
  const worn = wardrobe.parts.find((part) => part.id === wardrobe.wearing[layer]) ?? null;
  const siblings = wardrobe.parts.filter((part) => part.layer === layer);
  const savedBuild = useMemo(() => wornVehicleBuild(doc), [doc]);

  /** Run a change and report it. A refusal shows as the note and leaves the document alone. */
  const attempt = (change: () => UnitPaintDocument, note: (next: UnitPaintDocument) => string): boolean => {
    try {
      const next = change();
      onChange(next, note(next));
      return true;
    } catch (error) {
      onNote(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const wear = (onLayer: string, id: string) => {
    const name = wardrobe.parts.find((part) => part.id === id)?.name ?? id;
    attempt(
      () => withEditingLayer(wearVehiclePart(doc, onLayer, id), onLayer),
      () => `The ${layerLabel(doc.archetype, onLayer).toLowerCase()} now wears “${name}”. Move 1, Move 2, and Fire were built again from it.`,
    );
  };

  const openPicture = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      const grid = gridFromPicture(doc, imageRgba(image), image.naturalWidth, image.naturalHeight);
      const name = partName.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 40);
      if (attempt(
        () => addVehiclePart(doc, layer, name, grid),
        () => `“${name}” is in the parts and the ${lower} is wearing it. Its colours were matched to the seven slots.`,
      )) {
        setPartName("");
      }
    } catch (error) {
      onNote(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <section className="editor-panel" aria-label="Parts and builds">
      <div className="editor-row editor-parts" role="group" aria-label="Parts">
        <strong>Parts</strong>
        {skeleton.layers.map((item) => (
          <label key={item.key}>
            {item.label}
            <select
              aria-label={`${item.label} part`}
              value={wardrobe.wearing[item.key] ?? ""}
              {...hint(`Swap the ${item.label.toLowerCase()}. The other layers stay, and Move 1, Move 2, and Fire are built again.`)}
              onChange={(event) => wear(item.key, event.target.value)}
            >
              {wardrobe.parts
                .filter((part) => part.layer === item.key)
                .map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>

      <div className="editor-row editor-parts" role="group" aria-label="Builds">
        <strong>Builds</strong>
        <label>
          Saved
          <select
            aria-label="Saved build"
            value={savedBuild?.id ?? ""}
            {...hint("Put a saved build's parts and its country's colours on.")}
            onChange={(event) => {
              const build = wardrobe.builds.find((item) => item.id === event.target.value);
              if (!build) {
                return;
              }
              const gaps = vehicleBuildGaps(doc, build).map((name) => layerLabel(doc.archetype, name).toLowerCase());
              attempt(
                () => wearVehicleBuild(doc, build.id),
                () =>
                  gaps.length === 0
                    ? `Wearing “${build.name}”.`
                    : `Wearing “${build.name}”, except the ${gaps.join(" and ")}: that part has been deleted, so the layer keeps what it had.`,
              );
            }}
          >
            <option value="">{wardrobe.builds.length === 0 ? "None saved yet" : "Not a saved build"}</option>
            {wardrobe.builds.map((build) => (
              <option key={build.id} value={build.id}>
                {build.name}
              </option>
            ))}
          </select>
        </label>
        <input
          type="text"
          aria-label="Build name"
          placeholder="Name for this build"
          value={buildName}
          onChange={(event) => setBuildName(event.target.value)}
        />
        <button
          type="button"
          {...hint("Save the part every layer is wearing, and the country's colours, under the name. A name already in use is saved over.")}
          onClick={() => {
            const existed = wardrobe.builds.some((build) => build.name.toLowerCase() === buildName.trim().toLowerCase());
            if (attempt(
              () => saveVehicleBuild(doc, buildName),
              () => `${existed ? "Saved over" : "Saved"} the build “${buildName.trim()}”. Save into the project writes it to disk.`,
            )) {
              setBuildName("");
            }
          }}
        >
          Save build
        </button>
        <button
          type="button"
          disabled={!savedBuild}
          {...hint("Delete the saved build that is on now. Its parts stay in the library.")}
          onClick={() => {
            if (savedBuild) {
              attempt(
                () => removeVehicleBuild(doc, savedBuild.id),
                () => `Deleted the build “${savedBuild.name}”. Its parts stay in the library. Ctrl+Z brings it back.`,
              );
            }
          }}
        >
          Delete build
        </button>
      </div>

      <div className="editor-shelf" role="group" aria-label={`${label} parts`}>
        {shelf.map(({ part, worn: on, pixels }) => (
          <button
            key={part.id}
            type="button"
            className="editor-part"
            aria-pressed={on}
            {...hint(`Wear “${part.name}” on the ${lower}.`)}
            onClick={() => wear(part.layer, part.id)}
          >
            <GridThumb grid={pixels} mapping={mapping} />
            <small>{part.name}</small>
          </button>
        ))}
      </div>

      <div className="editor-row" role="group" aria-label={`The ${lower} part`}>
        <input
          type="text"
          aria-label="Part name"
          placeholder={`Name for a ${lower} part`}
          value={partName}
          onChange={(event) => setPartName(event.target.value)}
        />
        <button
          type="button"
          {...hint(`Copy the ${lower} being worn under the name and wear the copy. Paint the copy and “${worn?.name ?? "the first one"}” stays as it is.`)}
          onClick={() => {
            const name = partName.trim();
            if (attempt(
              () => copyVehiclePart(doc, layer, partName),
              () => `“${name}” is a copy of “${worn?.name ?? lower}”, and the ${lower} is wearing it. Painting changes the copy.`,
            )) {
              setPartName("");
            }
          }}
        >
          Copy this part
        </button>
        <button
          type="button"
          disabled={!worn}
          {...hint(`Give the ${lower} being worn the name in the box.`)}
          onClick={() => {
            const name = partName.trim();
            if (worn && attempt(() => renameVehiclePart(doc, worn.id, partName), () => `“${worn.name}” is now “${name}”.`)) {
              setPartName("");
            }
          }}
        >
          Rename this part
        </button>
        <button
          type="button"
          disabled={!worn || siblings.length < 2}
          {...hint(`Take the ${lower} being worn out of the library. The layer wears the part next to it. A layer keeps at least one part.`)}
          onClick={() => {
            if (worn) {
              attempt(
                () => removeVehiclePart(doc, worn.id),
                () => `Took “${worn.name}” out of the parts. Ctrl+Z brings it back.`,
              );
            }
          }}
        >
          Delete this part
        </button>
        <button
          type="button"
          {...hint(
            `Open a PNG the size of the canvas, ${doc.blueprint.canvasSize.width} by ${doc.blueprint.canvasSize.height}, as a new ${lower} part. Its colours are matched to the seven slots. It takes the name in the box, or the file's name.`,
          )}
          onClick={() => fileRef.current?.click()}
        >
          New part from a picture
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,.png"
          hidden
          aria-label="New part from a picture"
          onChange={(event) => {
            void openPicture(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
