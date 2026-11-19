import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import { ARCHETYPES, ARCHETYPE_LAYERS, UNIT_TYPE_LABEL, layerInfo, layerLabel } from "./archetypeLayers";
import { ARCHETYPE_STARTERS } from "./archetypeStarters";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import { blitBlueprintToSheet80x56, compileBlueprintFrame } from "./blockoutCompiler";
import {
  FRAME_LABEL,
  PALETTE_SLOT_KEYS,
  ROSTER_FACTIONS,
  SLOT_LABEL,
  blankDocument,
  buildAnimationDocument,
  duplicateFrameToNext,
  duplicateLayerToNext,
  flattenRgba,
  fromPaintFile,
  loadFrameOntoCurrent,
  nudgeLayer,
  paintAt,
  solidTorsoUnderWeapon,
  placeGroundOrigin,
  placeMuzzle,
  saveMotionSprite,
  slotHex,
  starterBlueprints,
  starterDocument,
  toPaintFile,
  withEditingFrame,
  withEditingLayer,
  withFaction,
  withUnitType,
  type Brush,
  type UnitPaintDocument,
} from "./pixelPaint";
import { SPRITE_FRAME_KEYS, type MilitaryStripKey, type PaletteSlotKey, type RosterFactionId, type SpriteFrameKey, type UnitSpriteSheetBlueprint } from "./skeletonSchema";

const GRID = 48;
const ZOOMS = [6, 8, 12] as const;
const HISTORY_LIMIT = 40;
/** How strongly the layers you are not painting show while they are dimmed, out of 255. */
const DIMMED_ALPHA = 84;
/** The riflemen, a layered starter for each other skeleton, then the flat tanks. */
const STARTERS = starterBlueprints();
const UNIT_TYPE_KEYS = Object.keys(UNIT_TYPE_LABEL);

interface HistoryStep {
  doc: UnitPaintDocument;
  backup: UnitPaintDocument | null;
}

const UNIT_TITLE: Record<string, string> = {
  ger_infantry_43: "German rifleman",
  ussr_infantry_43: "Soviet rifleman",
  uk_infantry_43: "British rifleman",
  us_infantry_43: "American rifleman",
  jap_infantry_43: "Japanese rifleman",
  minor_infantry_43: "Minor rifleman",
  ger_tank_pz4: "Panzer IV",
  ussr_tank_t34: "T-34",
  uk_tank_cromwell: "Cromwell",
  us_tank_sherman: "Sherman",
  jap_tank_chi_ha: "Type 97 Chi-Ha",
  minor_tank_lt38: "LT vz. 38",
  custom_unit: "New sprite",
  ...Object.fromEntries(ARCHETYPE_STARTERS.map((item) => [item.blueprint.blueprintId, item.title])),
};

const FACTION_NAME: Record<RosterFactionId, string> = {
  GER: "Germany",
  USSR: "Soviet Union",
  UK: "Britain",
  US: "United States",
  JAP: "Japan",
  MINOR: "Minor power",
};

const SLOT_HELP: Record<PaletteSlotKey, string> = {
  primary_uniform_or_hull:
    "Main cloth or armour. Pick a country above and this colour changes on the whole figure. The pixels stay in this slot.",
  secondary_trim_or_webbing: "Straps, packs, and trim. A country can paint this a different colour from the main cloth.",
  metallic_steel: "Gun metal, buckles, and tools.",
  metallic_brass_or_track: "Tank treads, or brass fittings on a soldier.",
  wood_or_leather: "Boots, belts, and rifle wood.",
  skin_stand_in: "Face and hands.",
  insignia_accent: "A small mark: a collar tab, a star, or a roundel.",
};

export interface PaintCommand {
  id: number;
  action: "edit" | "candidate";
  blueprintId: string;
  candidateBase64?: string | null;
}

export function UnitPixelPainter({
  command,
  onDocument,
}: {
  command: PaintCommand | null;
  onDocument?: (doc: UnitPaintDocument) => void;
}) {
  const [doc, setDoc] = useState<UnitPaintDocument>(() => starterDocument(STARTERS[0]?.blueprintId ?? "") ?? blankDocument("GER"));
  const [backup, setBackup] = useState<UnitPaintDocument | null>(null);
  const [dimOthers, setDimOthers] = useState(true);
  const [brush, setBrush] = useState<Brush>("primary_uniform_or_hull");
  const [tool, setTool] = useState<"brush" | "ground" | "muzzle">("brush");
  const [sheetNote, setSheetNote] = useState("");
  const gridRef = useRef<HTMLCanvasElement>(null);
  const pinRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const [hoverHelp, setHoverHelp] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(8);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [painting, setPainting] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const history = useRef<HistoryStep[]>([]);
  const docRef = useRef(doc);
  const backupRef = useRef(backup);
  const stroking = useRef(false);
  const gestureSaved = useRef(false);
  docRef.current = doc;
  backupRef.current = backup;

  const remember = useCallback(() => {
    history.current.push({ doc: docRef.current, backup: backupRef.current });
    if (history.current.length > HISTORY_LIMIT) {
      history.current.shift();
    }
    setCanUndo(true);
  }, []);

  const commit = useCallback((next: UnitPaintDocument, nextBackup?: UnitPaintDocument | null) => {
    const backupChanges = nextBackup !== undefined && nextBackup !== backupRef.current;
    if (next === docRef.current && !backupChanges) {
      return false;
    }
    if (!gestureSaved.current) {
      remember();
      if (stroking.current) {
        gestureSaved.current = true;
      }
    }
    if (next !== docRef.current) {
      docRef.current = next;
      setDoc(next);
    }
    if (nextBackup !== undefined) {
      backupRef.current = nextBackup;
      setBackup(nextBackup);
    }
    return true;
  }, [remember]);

  const undo = useCallback(() => {
    const step = history.current.pop();
    if (!step) {
      return;
    }
    docRef.current = step.doc;
    backupRef.current = step.backup;
    setDoc(step.doc);
    setBackup(step.backup);
    setCanUndo(history.current.length > 0);
    setNotice("Undid the last change.");
  }, []);

  useEffect(() => {
    if (!command || command.id === 0) {
      return;
    }
    const next = starterDocument(command.blueprintId);
    if (!next) {
      return;
    }
    if (command.action === "candidate" && command.candidateBase64) {
      const base64 = command.candidateBase64;
      void flattenCandidate(base64, next)
        .then((flat) => {
          remember();
          docRef.current = flat;
          backupRef.current = next;
          setBackup(next);
          setDoc(flat);
          setNotice(
            flat.layers && flat.editingLayer
              ? `The generated picture is on the ${layerLabel(flat.archetype, flat.editingLayer)} layer. Erase the parts that belong on the other layers.`
              : "The generated picture is on this frame.",
          );
        })
        .catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    remember();
    docRef.current = next;
    backupRef.current = null;
    setBackup(null);
    setDoc(next);
    setNotice(`Opened the ${unitTitle(next.blueprint)}.`);
  }, [command, remember]);

  useEffect(() => {
    onDocument?.(doc);
  }, [doc, onDocument]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (target instanceof Element && target.closest(".rig-panel")) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      const current = docRef.current;
      if (!current.layers || !current.editingLayer) {
        return;
      }
      const step = ARROW_STEP[event.key];
      if (step) {
        event.preventDefault();
        commit(nudgeLayer(current, step[0], step[1]));
        return;
      }
      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        const stack = ARCHETYPE_LAYERS[current.archetype];
        const index = stack.indexOf(current.editingLayer);
        const direction = event.key === "]" ? 1 : -1;
        const next = stack[(index + direction + stack.length) % stack.length];
        if (!next) {
          return;
        }
        setDoc(withEditingLayer(current, next));
        setNotice(`Painting ${layerLabel(current.archetype, next)}.`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, commit]);

  useEffect(() => {
    drawGrid(gridRef.current, pinRef.current, doc, dimOthers);
    drawSheet(sheetRef.current, doc, setSheetNote);
  }, [doc, dimOthers]);

  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  const editingLabel = FRAME_LABEL[doc.editingFrame];
  const skeleton = ARCHETYPES[doc.archetype];
  const openLayer = doc.layers && doc.editingLayer ? layerLabel(doc.archetype, doc.editingLayer) : null;
  const stackLine = `${skeleton.layers.map((layer) => layer.label).join(", then ")}, bottom to top`;
  const modeLine = openLayer
    ? `Painting ${openLayer} on ${editingLabel}. ${stackLine}. Arrow keys move this layer. [ and ] change layer.`
    : `Painting ${editingLabel}. Duplicate it onto the next frame, then nudge the treads by a pixel or two.`;
  const helpLine = hoverHelp ?? (notice || modeLine);
  const brushLabel = brush === "eraser" ? "Eraser" : `${SLOT_LABEL[brush]} ${slotHex(mapping, brush)}`;
  const toolLabel = tool === "ground" ? "Feet" : tool === "muzzle" ? "Muzzle" : brush === "eraser" ? "Eraser" : "Pencil";

  const units = STARTERS.some((item) => item.blueprintId === doc.blueprint.blueprintId) ? STARTERS : [...STARTERS, doc.blueprint];
  const unitTypes = UNIT_TYPE_KEYS.includes(doc.blueprint.unitTypeId) ? UNIT_TYPE_KEYS : [...UNIT_TYPE_KEYS, doc.blueprint.unitTypeId];

  const openUnit = (blueprintId: string) => {
    const next = starterDocument(blueprintId);
    if (!next) {
      return;
    }
    commit(next, null);
    setNotice(`Opened the ${unitTitle(next.blueprint)}. ${next.layers ? `It is drawn in ${ARCHETYPE_LAYERS[next.archetype].length} layers.` : "It is four flat frames."}`);
  };

  const changeUnitType = (unitTypeId: string) => {
    const current = docRef.current;
    const next = withUnitType(current, unitTypeId);
    if (next === current) {
      return;
    }
    const name = (UNIT_TYPE_LABEL[unitTypeId] ?? unitTypeId).toLowerCase();
    if (next.archetype === current.archetype) {
      commit(next);
      setNotice(`This sprite is now filed as ${name}. The drawing stays. Build Animation uses that unit's rules.`);
      return;
    }
    commit(next, null);
    setNotice(`Empty ${name}, on the ${ARCHETYPES[next.archetype].label.toLowerCase()} skeleton. ${blankLine(next)} Undo brings the last sprite back.`);
  };

  const applyPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pixelOf(event.currentTarget, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    setCursor(point);
    const current = docRef.current;
    if (tool === "ground") {
      if (commit(placeGroundOrigin(current, point.x, point.y))) {
        setNotice(`Feet stand on pixel ${point.x}, ${point.y}. The drawing stays put. The game sprite shifts so the feet meet the ground.`);
      }
      return;
    }
    if (tool === "muzzle") {
      if (commit(placeMuzzle(current, point.x, point.y))) {
        setNotice(`Muzzle mark set at ${point.x}, ${point.y}. A gun flash can appear here later.`);
      }
      return;
    }
    if (!commit(paintAt(current, point.x, point.y, brush))) {
      setNotice(`That square is outside the ${FRAME_LABEL[current.editingFrame]} frame.`);
    } else {
      setNotice("");
    }
  };

  const duplicateNext = () => {
    const current = docRef.current;
    const next = duplicateFrameToNext(current);
    commit(next);
    setNotice(`${FRAME_LABEL[current.editingFrame]} was copied onto ${FRAME_LABEL[next.editingFrame]}. Nudge that pose.`);
  };

  const duplicateLayer = () => {
    const current = docRef.current;
    if (!current.layers || !current.editingLayer) {
      return;
    }
    const next = duplicateLayerToNext(current);
    commit(next);
    setNotice(
      `${layerLabel(current.archetype, current.editingLayer)} on ${FRAME_LABEL[current.editingFrame]} was copied onto ${FRAME_LABEL[next.editingFrame]}. The other layers stay.`,
    );
  };

  const buildAnimation = () => {
    const current = docRef.current;
    if (!current.layers) {
      return;
    }
    if (!ARCHETYPE_LAYERS[current.archetype].some((layer) => current.layers?.idle[layer]?.some((row) => row.some((slot) => slot != null)))) {
      setNotice("Idle is empty. Paint the Idle layers first. Build Animation writes the other three poses from them.");
      return;
    }
    commit(buildAnimationDocument(current));
    setNotice(`The animation is built from Idle. ${ARCHETYPES[current.archetype].motion}`);
  };

  const save = async () => {
    try {
      const response = await fetch("/__dev/save-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPaintFile(doc)),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error || `Save failed with ${response.status}`);
      }
      setNotice(`Saved this drawing in the project at ${json.path}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(toPaintFile(doc), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.blueprint.blueprintId}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${doc.blueprint.blueprintId}.json. Another player can open that file here.`);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      commit(fromPaintFile(parsed), null);
      setNotice(`Opened ${file.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const loadPromoted = async () => {
    const url = `/assets/units/promoted/${doc.blueprint.factionId}/${doc.blueprint.blueprintId}.png`;
    try {
      const image = await rgbaFromUrl(url);
      const current = docRef.current;
      commit(flattenRgba(current, image.data, image.width, image.height, mapping), current);
      setNotice(
        current.layers && current.editingLayer
          ? `The kept picture is on the ${layerLabel(current.archetype, current.editingLayer)} layer of ${FRAME_LABEL[current.editingFrame]}. Erase the parts that belong on the other layers.`
          : `The kept picture is on ${FRAME_LABEL[current.editingFrame]}. The other three frames are unchanged.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const openPicture = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await rgbaFromUrl(url);
      const current = docRef.current;
      commit(flattenRgba(current, image.data, image.width, image.height, FACTION_MILITARY_MAPPINGS[current.blueprint.factionId]), current);
      const where = current.layers && current.editingLayer
        ? `the ${layerLabel(current.archetype, current.editingLayer)} layer of ${FRAME_LABEL[current.editingFrame]}`
        : FRAME_LABEL[current.editingFrame];
      setNotice(`${file.name} is on ${where}. Erase the parts that belong elsewhere.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const hint = (text: string) => ({
    title: text,
    onMouseEnter: () => setHoverHelp(text),
    onMouseLeave: () => setHoverHelp(null),
    onFocus: () => setHoverHelp(text),
    onBlur: () => setHoverHelp(null),
  });

  const cell = zoom;

  return (
    <div className="sprite-editor" aria-label="Unit pixel painter">
      <style>{PAINTER_CSS}</style>
      <header className="sprite-titlebar">
        <div>
          <p className="sprite-kicker">Sprite editor</p>
          <h2>{unitTitle(doc.blueprint)}</h2>
        </div>
        <label {...hint("Choose which soldier or vehicle to draw. Opening one loads its parts onto the canvas.")}>
          Unit
          <select value={doc.blueprint.blueprintId} onChange={(event) => openUnit(event.target.value)}>
            {units.map((item) => (
              <option key={item.blueprintId} value={item.blueprintId}>
                {unitTitle(item)}
              </option>
            ))}
          </select>
        </label>
        <label
          {...hint(
            "Which unit this sprite is. A type on the same skeleton keeps the drawing: a field gun can become a flak gun. A type on another skeleton starts an empty sprite with that skeleton's layers.",
          )}
        >
          Type
          <select value={doc.blueprint.unitTypeId} onChange={(event) => changeUnitType(event.target.value)}>
            {unitTypes.map((unitTypeId) => (
              <option key={unitTypeId} value={unitTypeId}>
                {UNIT_TYPE_LABEL[unitTypeId] ?? unitTypeId}
              </option>
            ))}
          </select>
        </label>
        <label
          {...hint(
            "Recolour the seven slots for this country. A German tunic and an American tunic are the same pixels in different colours.",
          )}
        >
          Colours of
          <select
            value={doc.blueprint.factionId}
            onChange={(event) => {
              const factionId = event.target.value as RosterFactionId;
              commit(withFaction(docRef.current, factionId));
              setNotice(`Colours are now ${FACTION_NAME[factionId]}. The pixels stay in the same slots.`);
            }}
          >
            {ROSTER_FACTIONS.map((faction) => (
              <option key={faction} value={faction}>
                {FACTION_NAME[faction]}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="sprite-frames" role="toolbar" aria-label="Frames">
        {SPRITE_FRAME_KEYS.map((frame) => (
          <button
            key={frame}
            type="button"
            aria-pressed={doc.editingFrame === frame}
            {...hint(`Paint the ${FRAME_LABEL[frame]} pose. The same slots recolour for every country.`)}
            onClick={() => {
              setDoc(withEditingFrame(doc, frame));
              setNotice(`Painting ${FRAME_LABEL[frame]}.`);
            }}
          >
            {FRAME_LABEL[frame]}
          </button>
        ))}
      </div>
      {doc.layers && (
        <div className="sprite-frames" role="toolbar" aria-label="Layers">
          {skeleton.layers.map((layer) => (
            <button
              key={layer.key}
              type="button"
              aria-pressed={doc.editingLayer === layer.key}
              {...hint(layer.hint)}
              onClick={() => {
                setDoc(withEditingLayer(doc, layer.key));
                setNotice(`Painting ${layer.label}.`);
              }}
            >
              {layer.label}
            </button>
          ))}
          <button
            type="button"
            className="sprite-dim"
            aria-pressed={dimOthers}
            {...hint(
              "Fade the layers you are not painting, so the open layer stands out and shows in full where another layer covers it. This only changes the editor. The game sprite on the right stays whole.",
            )}
            onClick={() => {
              setDimOthers(!dimOthers);
              setNotice(dimOthers ? "Every layer shows at full strength, in paint order." : `Only ${openLayer ?? "the open layer"} shows at full strength.`);
            }}
          >
            Dim other layers
          </button>
        </div>
      )}

      <div className="sprite-file" role="toolbar" aria-label="File">
        <HintButton
          hint={hint("Step back one change. One drag of the pencil, the eraser, or a pin is a single step. Ctrl+Z does this too.")}
          onClick={undo}
          disabled={!canUndo}
        >
          Undo
        </HintButton>
        {import.meta.env.DEV && (
          <HintButton
            hint={hint(
              "Open a short field where this sprite marches. Idle, two steps, then the shot. The rifle kicks back when it fires.",
            )}
            onClick={() => {
              saveMotionSprite(docRef.current);
              window.location.assign("/?anim=1");
            }}
          >
            Watch them move
          </HintButton>
        )}
        <HintButton
          hint={hint(
            "Clear the canvas and start an empty 48 by 48 sprite of the type and country selected above. The unit you had open stays in the list.",
          )}
          onClick={() => {
            const current = docRef.current;
            const next = blankDocument(current.blueprint.factionId, current.archetype, current.blueprint.unitTypeId);
            commit(next, null);
            setNotice(`Empty ${(UNIT_TYPE_LABEL[next.blueprint.unitTypeId] ?? next.blueprint.unitTypeId).toLowerCase()}. ${blankLine(next)}`);
          }}
        >
          New sprite
        </HintButton>
        <HintButton
          hint={hint(
            "Copy the frame you are painting onto the next pose, then select that pose. Nudge the boots, the treads, or the rifle by a pixel or two.",
          )}
          onClick={duplicateNext}
        >
          Duplicate Frame → Next
        </HintButton>
        {doc.layers && (
          <HintButton
            hint={hint(
              doc.archetype === "infantry"
                ? "Place the idle head, tunic, and rifle onto Move 1, Move 2, and Fire. A leg drawing already on Move 1 or Move 2 stays. Fire plants the idle boots a little wider, toes still pointing right."
                : `Write Move 1, Move 2, and Fire from the Idle layers. Layers shift by whole pixels and nothing turns. ${skeleton.motion} What is on those three poses now is replaced.`,
            )}
            onClick={buildAnimation}
          >
            Build Animation
          </HintButton>
        )}
        {doc.layers && doc.editingLayer && (
          <HintButton
            hint={hint(`Copy the ${openLayer} layer onto the next pose and select that pose. The other layers on that pose stay.`)}
            onClick={duplicateLayer}
          >
            {"Copy Layer -> Next Pose"}
          </HintButton>
        )}
        <HintButton
          hint={hint(
            doc.layers
              ? "Load the picture you previously kept for this unit onto the layer you are painting. Erase the parts that belong on the other layers."
              : "Load the picture you previously kept for this unit, if there is one, onto the frame you are painting.",
          )}
          onClick={() => void loadPromoted()}
        >
          Open kept picture
        </HintButton>
        {import.meta.env.DEV && (
          <HintButton
            hint={hint(
              "Write this drawing into the project as JSON, under assets/units/authored. You can keep working on it from the dev server.",
            )}
            onClick={() => void save()}
          >
            Save into the project
          </HintButton>
        )}
        <HintButton
          hint={hint("Download a unit file. Another player can open it with Open a unit file and paint the same sprite.")}
          onClick={exportJson}
        >
          Download JSON
        </HintButton>
        <label
          className="sprite-open"
          {...hint("Copy another pose onto the frame you are painting. Idle can start from a step, then you change the pixels.")}
        >
          Load sprite
          <select
            aria-label="Load sprite"
            defaultValue=""
            onChange={(event) => {
              const source = event.target.value as SpriteFrameKey;
              event.target.value = "";
              if (!SPRITE_FRAME_KEYS.includes(source) || source === doc.editingFrame) {
                return;
              }
              commit(loadFrameOntoCurrent(doc, source));
              setNotice(`${FRAME_LABEL[source]} is now on ${FRAME_LABEL[doc.editingFrame]}. Edit it into this pose.`);
            }}
          >
            <option value="">Choose a frame</option>
            {SPRITE_FRAME_KEYS.filter((frame) => frame !== doc.editingFrame).map((frame) => (
              <option key={frame} value={frame}>
                {FRAME_LABEL[frame]}
              </option>
            ))}
          </select>
        </label>
        {doc.layers && doc.archetype === "infantry" && (
          <HintButton
            hint={hint(
              "Fill the tunic behind the rifle on this pose, and select the torso. The rifle stays on top. A step or a shot then shows the body instead of a hole.",
            )}
            onClick={() => {
              const filled = solidTorsoUnderWeapon(doc);
              if (filled === doc && doc.editingLayer === "torso") {
                setNotice("The tunic already sits under the rifle.");
                return;
              }
              commit(filled.editingLayer === "torso" ? filled : withEditingLayer(filled, "torso"));
              setNotice(`Painting the torso on ${FRAME_LABEL[doc.editingFrame]}. It is the body under the rifle.`);
            }}
          >
            Torso under rifle
          </HintButton>
        )}
        <label
          className="sprite-open"
          {...hint(
            doc.layers
              ? "Open a picture you have already separated, onto the layer and pose you are painting. It needs to be 48 by 48."
              : "Open a 48 by 48 picture onto the frame you are painting.",
          )}
        >
          {doc.layers ? "Open a picture onto this layer" : "Open a picture onto this frame"}
          <input
            type="file"
            accept="image/png,.png"
            aria-label={doc.layers ? "Open a picture onto this layer" : "Open a picture onto this frame"}
            onChange={(event) => {
              void openPicture(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <label
          className="sprite-open"
          {...hint("Open a unit file from another player. The canvas becomes the sprite in that file.")}
        >
          Open a unit file
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Open a unit file"
            onChange={(event) => {
              void importJson(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="sprite-scroll">
      <div className="sprite-workspace">
        <div className="sprite-tools" role="toolbar" aria-label="Tools">
          <ToolButton
            pressed={tool === "brush" && brush !== "eraser"}
            hint={hint(
              `Pencil. Paint ${brush === "eraser" ? "the selected colour" : brushLabel} onto ${openLayer ? `${openLayer} on ${editingLabel}. Layers further along the row stay on top of it` : editingLabel}.`,
            )}
            onClick={() => {
              setTool("brush");
              if (brush === "eraser") {
                setBrush("primary_uniform_or_hull");
              }
            }}
          >
            <span aria-hidden="true">✎</span>
            Pencil
          </ToolButton>
          <ToolButton
            pressed={tool === "brush" && brush === "eraser"}
            hint={hint(`Eraser. Delete the pixel you see on ${editingLabel}. The square goes empty, including colour that sits on another layer.`)}
            onClick={() => {
              setTool("brush");
              setBrush("eraser");
            }}
          >
            <span aria-hidden="true">⌫</span>
            Eraser
          </ToolButton>
          <ToolButton
            pressed={tool === "ground"}
            hint={hint(
              "Feet. Click where the boots or treads stand. The pixels stay where they are. The game sprite moves so those feet sit on the ground line.",
            )}
            onClick={() => setTool("ground")}
          >
            <span aria-hidden="true">⌖</span>
            Feet
          </ToolButton>
          <ToolButton
            pressed={tool === "muzzle"}
            hint={hint(
              "Muzzle. Click the tip of the gun on the Idle pose. This places the crimson mark. Build Animation paints the flash there on Fire for a tank, an aircraft, and a ship.",
            )}
            onClick={() => setTool("muzzle")}
          >
            <span aria-hidden="true">◎</span>
            Muzzle
          </ToolButton>
        </div>

        <div className="sprite-stage-column">
          <div className="sprite-canvas-bar">
            <span>48 × 48 pixels</span>
            <span>
              {toolLabel}
              {tool === "brush" && brush !== "eraser" ? ` · ${brushLabel}` : ""}
            </span>
            <span>{cursor ? `${cursor.x}, ${cursor.y}` : "—, —"}</span>
            <span className="sprite-zoom" role="group" aria-label="Zoom">
              {ZOOMS.map((step) => (
                <button
                  key={step}
                  type="button"
                  aria-pressed={zoom === step}
                  {...hint(`Show each pixel as a ${step} pixel square. The sprite is still 48 by 48.`)}
                  onClick={() => setZoom(step)}
                >
                  {step}×
                </button>
              ))}
            </span>
          </div>
          <div className="sprite-draw">
          <div
            className="sprite-stage"
            style={{
              width: GRID * cell,
              height: GRID * cell,
              backgroundSize: `${cell * 2}px ${cell * 2}px`,
              backgroundPosition: `0 0, 0 ${cell}px, ${cell}px ${-cell}px, ${-cell}px 0`,
            }}
          >
            <canvas
              ref={gridRef}
              className="sprite-pixels"
              width={GRID}
              height={GRID}
              aria-label="48 by 48 pixel grid"
              onPointerDown={(event) => {
                stroking.current = true;
                gestureSaved.current = false;
                setPainting(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                applyPointer(event);
              }}
              onPointerMove={(event) => {
                const point = pixelOf(event.currentTarget, event.clientX, event.clientY);
                setCursor(point);
                if (painting || stroking.current) {
                  applyPointer(event);
                }
              }}
              onPointerUp={() => {
                stroking.current = false;
                gestureSaved.current = false;
                setPainting(false);
              }}
              onPointerLeave={() => {
                stroking.current = false;
                gestureSaved.current = false;
                setPainting(false);
                setCursor(null);
              }}
            />
            <div
              className="sprite-gridlines"
              style={{ backgroundSize: `${cell}px ${cell}px` }}
            />
            <canvas ref={pinRef} className="sprite-pins" width={GRID} height={GRID} />
          </div>
          <p className="sprite-canvas-note">
            Cream cross: where the feet stand ({doc.blueprint.groundOrigin.x}, {doc.blueprint.groundOrigin.y}). Crimson cross: muzzle
            {doc.blueprint.muzzlePoint ? ` (${doc.blueprint.muzzlePoint.x}, ${doc.blueprint.muzzlePoint.y})` : ""}.
          </p>
          </div>
          <section
            className="sprite-game"
            {...hint("The sprite as the game will hold it: 80 by 56, feet on the ground line.")}
          >
            <h3>In the game</h3>
            <canvas ref={sheetRef} className="sprite-sheet" width={SPRITE_BAKE.width} height={SPRITE_BAKE.height} />
            <p className="sprite-side-lead">{sheetNote || "Feet on the ground line."}</p>
          </section>
        </div>

        <aside className="sprite-side">
          <section>
            <h3>{doc.layers ? "Layers" : "Frames"}</h3>
            <p className="sprite-side-lead">
              {doc.layers && doc.editingLayer
                ? `${openLayer} on ${FRAME_LABEL[doc.editingFrame]}. ${layerInfo(doc.archetype, doc.editingLayer)?.hint ?? ""}`
                : `${FRAME_LABEL[doc.editingFrame]}. Idle, two steps, and the shot. A country recolours the slots. It does not move the pixels.`}
            </p>
            {doc.layers && (
              <p className="sprite-side-lead">
                {skeleton.label} skeleton: {stackLine}. Fits {skeleton.footprint.width} by {skeleton.footprint.height} pixels beside the 26-pixel rifleman.
              </p>
            )}
          </section>
          <section>
            <h3>Colours</h3>
            <ul className="sprite-swatches">
              {PALETTE_SLOT_KEYS.map((slot) => {
                const hex = slotHex(mapping, slot);
                return (
                  <li key={slot}>
                    <button
                      type="button"
                      aria-pressed={tool === "brush" && brush === slot}
                      {...hint(`${SLOT_LABEL[slot]}, ${hex}. ${SLOT_HELP[slot]}`)}
                      onClick={() => {
                        setTool("brush");
                        setBrush(slot);
                      }}
                    >
                      <i style={{ background: hex }} />
                      <span>{SLOT_LABEL[slot]}</span>
                      <code>{hex}</code>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
      </div>

      <footer className="sprite-help" aria-live="polite">
        {helpLine}
      </footer>
    </div>
  );
}

function HintButton({
  hint,
  children,
  onClick,
  disabled,
}: {
  hint: ReturnType<typeof hintProps>;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} {...hint}>
      {children}
    </button>
  );
}

function ToolButton({
  hint,
  children,
  onClick,
  pressed,
}: {
  hint: ReturnType<typeof hintProps>;
  children: ReactNode;
  onClick: () => void;
  pressed: boolean;
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} {...hint}>
      {children}
    </button>
  );
}

function hintProps(text: string) {
  return {
    title: text,
    onMouseEnter: () => undefined as void,
    onMouseLeave: () => undefined as void,
    onFocus: () => undefined as void,
    onBlur: () => undefined as void,
  };
}

function unitTitle(blueprint: Pick<UnitSpriteSheetBlueprint, "blueprintId" | "historicalEraTag">): string {
  return UNIT_TITLE[blueprint.blueprintId] ?? blueprint.historicalEraTag ?? blueprint.blueprintId;
}

/** What to paint first on an empty sprite, by skeleton. */
function blankLine(doc: UnitPaintDocument): string {
  const labels = ARCHETYPES[doc.archetype].layers.map((layer) => layer.label.toLowerCase());
  const facing = doc.archetype === "aircraft" ? "from above, nose to the right" : doc.archetype === "ship" ? "in side profile, bow to the right" : "facing right";
  return `Paint the Idle pose ${facing}: ${labels.join(", ")}. Then Build Animation.`;
}

function drawGrid(grid: HTMLCanvasElement | null, pins: HTMLCanvasElement | null, doc: UnitPaintDocument, dimOthers: boolean): void {
  if (!grid || !pins) {
    return;
  }
  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  const ctx = grid.getContext("2d");
  const pinCtx = pins.getContext("2d");
  if (!ctx || !pinCtx) {
    return;
  }
  const image = ctx.createImageData(GRID, GRID);
  if (doc.layers && doc.editingLayer) {
    const stack = doc.layers[doc.editingFrame];
    const order = ARCHETYPE_LAYERS[doc.archetype];
    if (dimOthers) {
      // Onion skin: the other layers go down faded, in paint order, and the open layer goes over them in full.
      for (const layer of order) {
        const cells = stack[layer];
        if (cells && layer !== doc.editingLayer) {
          paintLayer(image, cells, mapping, DIMMED_ALPHA);
        }
      }
      const open = stack[doc.editingLayer];
      if (open) {
        paintLayer(image, open, mapping, 255);
      }
    } else {
      for (const layer of order) {
        const cells = stack[layer];
        if (cells) {
          paintLayer(image, cells, mapping, 255);
        }
      }
    }
  } else {
    let keys: (MilitaryStripKey | null)[] = [];
    try {
      keys = compileBlueprintFrame(doc.blueprint, doc.editingFrame, mapping).albedoKeys;
    } catch {
      keys = [];
    }
    for (let i = 0; i < keys.length && i < GRID * GRID; i++) {
      const key = keys[i];
      if (key == null) {
        continue;
      }
      writePixel(image.data, i * 4, MILITARY[key], 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  pinCtx.clearRect(0, 0, GRID, GRID);
  stampPin(pinCtx, doc.blueprint.groundOrigin.x, doc.blueprint.groundOrigin.y, "#f5f0e6");
  if (doc.blueprint.muzzlePoint) {
    stampPin(pinCtx, doc.blueprint.muzzlePoint.x, doc.blueprint.muzzlePoint.y, "#9c524e");
  }
}

function drawSheet(canvas: HTMLCanvasElement | null, doc: UnitPaintDocument, setSheetNote: (note: string) => void): void {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, SPRITE_BAKE.width, SPRITE_BAKE.height);
  try {
    const sheet = blitBlueprintToSheet80x56(
      doc.blueprint,
      FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId],
      doc.editingFrame,
    );
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, 0, 0);
    setSheetNote(`${FRAME_LABEL[doc.editingFrame]}. Feet on the ground line.`);
  } catch (error) {
    setSheetNote(error instanceof Error ? error.message : String(error));
  }
}

function paintLayer(
  image: ImageData,
  grid: UnitPaintDocument["blueprint"]["frames"]["idle"],
  mapping: (typeof FACTION_MILITARY_MAPPINGS)[RosterFactionId],
  alpha: number,
): void {
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const slot = grid[y]?.[x];
      if (slot == null) {
        continue;
      }
      writePixel(image.data, (y * GRID + x) * 4, slotHex(mapping, slot), alpha);
    }
  }
}

function writePixel(data: Uint8ClampedArray, offset: number, hex: string, alpha: number): void {
  const rgb = Number.parseInt(hex.slice(1), 16);
  data[offset] = (rgb >> 16) & 255;
  data[offset + 1] = (rgb >> 8) & 255;
  data[offset + 2] = rgb & 255;
  data[offset + 3] = alpha;
}

const ARROW_STEP: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function stampPin(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string): void {
  ctx.fillStyle = hex;
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x - 1, y, 1, 1);
  ctx.fillRect(x + 1, y, 1, 1);
  ctx.fillRect(x, y - 1, 1, 1);
  ctx.fillRect(x, y + 1, 1, 1);
}

function pixelOf(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    return null;
  }
  return { x, y };
}

async function flattenCandidate(base64: string, source: UnitPaintDocument): Promise<UnitPaintDocument> {
  const image = await rgbaFromUrl(`data:image/png;base64,${base64}`);
  return flattenRgba(source, image.data, image.width, image.height, FACTION_MILITARY_MAPPINGS[source.blueprint.factionId]);
}

async function rgbaFromUrl(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The picture could not be read.");
  }
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: imageData.data };
}

const PAINTER_CSS = `
.sprite-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 0 0 auto;
  color: #f5f0e6;
  font: 14px/1.4 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
}
.sprite-editor button,
.sprite-editor select,
.sprite-editor label {
  font: 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
}
.sprite-editor button {
  padding: 6px 10px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
  border-radius: 2px;
  box-shadow: none;
}
.sprite-editor button:hover:not(:disabled) {
  background: #3a342c;
  border-color: #ddcf99;
}
.sprite-editor button[aria-pressed="true"] {
  background: #4b3d44;
  border-color: #ddcf99;
  color: #f5f0e6;
}
.sprite-editor button:disabled {
  opacity: 0.45;
}
.sprite-frames {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 14px 8px;
}
.sprite-frames .sprite-dim {
  margin-left: 18px;
}
.sprite-frames button {
  font: 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  padding: 6px 10px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
}
.sprite-frames button[aria-pressed="true"] {
  border-color: #ddcf99;
  background: #4b3d44;
}
.sprite-titlebar, .sprite-file {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}
.sprite-kicker {
  margin: 0;
  color: #a99c8d;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.sprite-titlebar h2 {
  margin: 0;
  font: 600 22px/1.2 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
}
.sprite-titlebar label, .sprite-open {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #a99c8d;
  font-size: 12px;
}
.sprite-titlebar select, .sprite-open select {
  min-width: 180px;
  padding: 6px 8px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
}
.sprite-scroll {
  flex: none;
  overflow: visible;
}
.sprite-workspace {
  display: grid;
  grid-template-columns: 104px minmax(280px, 1fr) 250px;
  gap: 16px;
  align-items: start;
}
.sprite-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sprite-tools button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 52px;
}
.sprite-tools button span {
  font-size: 16px;
}
.sprite-stage-column {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: start;
  min-width: 0;
}
.sprite-canvas-bar {
  flex: 1 0 100%;
}
.sprite-draw {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sprite-game {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sprite-game h3 {
  margin: 0;
  font: 600 12px/1 "Segoe UI", sans-serif;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a99c8d;
}
.sprite-canvas-bar, .sprite-zoom {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  color: #a99c8d;
  font-size: 12px;
}
.sprite-zoom {
  margin-left: auto;
}
.sprite-zoom button {
  min-width: 36px;
  padding: 4px 6px;
}
.sprite-stage {
  position: relative;
  background-color: #c8c2b6;
  background-image:
    linear-gradient(45deg, #8d877c 25%, transparent 25%),
    linear-gradient(-45deg, #8d877c 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #8d877c 75%),
    linear-gradient(-45deg, transparent 75%, #8d877c 75%);
  cursor: crosshair;
  box-shadow: inset 0 0 0 1px #1c1917;
}
.sprite-stage canvas, .sprite-gridlines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
.sprite-gridlines, .sprite-pins {
  pointer-events: none;
}
.sprite-gridlines {
  background-image:
    linear-gradient(to right, rgba(28, 25, 23, 0.22) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(28, 25, 23, 0.22) 1px, transparent 1px);
}
.sprite-canvas-note, .sprite-side-lead, .sprite-note {
  margin: 0;
  color: #a99c8d;
  font-size: 12px;
}
.sprite-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sprite-side h3 {
  margin: 0 0 6px;
  font: 600 12px/1 "Segoe UI", sans-serif;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a99c8d;
}
.sprite-parts, .sprite-swatches {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sprite-parts button, .sprite-swatches button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  text-align: left;
}
.sprite-parts small {
  margin-left: auto;
  color: #ddcf99;
  font-size: 11px;
}
.sprite-swatches i {
  width: 18px;
  height: 18px;
  border: 1px solid #1c1917;
  flex: none;
}
.sprite-swatches code {
  margin-left: auto;
  color: #a99c8d;
  font-size: 11px;
}
.sprite-sheet {
  width: 160px;
  height: 112px;
  image-rendering: pixelated;
  background: #d9d0c1;
  box-shadow: inset 0 0 0 1px #1c1917;
}
.sprite-help {
  flex: none;
  margin: 0;
  padding: 10px 12px;
  background: #f5f0e6;
  color: #1c1917;
  font-size: 14px;
  line-height: 1.4;
}
.sprite-open input {
  display: block;
  margin-top: 4px;
  color: #f5f0e6;
}
@media (max-width: 980px) {
  .sprite-workspace {
    grid-template-columns: 104px 1fr;
  }
  .sprite-side {
    grid-column: 1 / -1;
  }
}
`;
