import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import { INFANTRY_LAYER_KEYS, LAYER_LABEL, LAYER_PAINT_ORDER, type InfantryLayerKey } from "./infantryMarch";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS } from "./starterParts";
import { blitBlueprintToSheet80x56, compileBlueprintFrame } from "./blockoutCompiler";
import {
  FRAME_LABEL,
  PALETTE_SLOT_KEYS,
  ROSTER_FACTIONS,
  SLOT_LABEL,
  blankDocument,
  buildMarchDocument,
  documentFromBlueprint,
  duplicateFrameToNext,
  duplicateLayerToNext,
  flattenRgba,
  fromPaintFile,
  loadFrameOntoCurrent,
  nudgeLayer,
  paintAt,
  placeRigFrame,
  stampWalkStance,
  solidTorsoUnderWeapon,
  placeGroundOrigin,
  placeMuzzle,
  saveMotionSprite,
  slotHex,
  toPaintFile,
  withEditingFrame,
  withEditingLayer,
  withFaction,
  type Brush,
  type UnitPaintDocument,
} from "./pixelPaint";
import { composeLayers } from "./paperDoll";
import { PaperDollPanel } from "./PaperDollPanel";
import { SPRITE_FRAME_KEYS, type MilitaryStripKey, type PaletteSlotKey, type RosterFactionId, type SpriteFrameKey, type UnitSpriteSheetBlueprint } from "./skeletonSchema";

const GRID = 48;
const ZOOMS = [6, 8, 12] as const;
const HISTORY_LIMIT = 40;

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
  const [doc, setDoc] = useState<UnitPaintDocument>(() => documentFromBlueprint(STARTER_BLUEPRINTS[0]));
  const [backup, setBackup] = useState<UnitPaintDocument | null>(null);
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
  const [rigOpen, setRigOpen] = useState(false);
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
    const blueprint = STARTER_BLUEPRINTS.find((item) => item.blueprintId === command.blueprintId);
    if (!blueprint) {
      return;
    }
    const next = documentFromBlueprint(blueprint);
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
              ? `The generated picture is on the ${LAYER_LABEL[flat.editingLayer]} layer. Erase the parts that belong on the other layers.`
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
    setNotice(`Opened the ${unitTitle(blueprint)}.`);
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
        const index = INFANTRY_LAYER_KEYS.indexOf(current.editingLayer);
        const direction = event.key === "]" ? 1 : -1;
        const next = INFANTRY_LAYER_KEYS[(index + direction + INFANTRY_LAYER_KEYS.length) % INFANTRY_LAYER_KEYS.length];
        if (!next) {
          return;
        }
        setDoc(withEditingLayer(current, next));
        setNotice(`Painting ${LAYER_LABEL[next]}.`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, commit]);

  useEffect(() => {
    drawGrid(gridRef.current, pinRef.current, doc);
    drawSheet(sheetRef.current, doc, setSheetNote);
  }, [doc]);

  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  const editingLabel = FRAME_LABEL[doc.editingFrame];
  const layerLabel = doc.layers && doc.editingLayer ? LAYER_LABEL[doc.editingLayer] : null;
  const modeLine = layerLabel
    ? `Painting ${layerLabel} on ${editingLabel}. Legs, then torso, then head, then the rifle on top. Arrow keys move this layer. [ and ] change layer.`
    : `Painting ${editingLabel}. Duplicate it onto the next frame, then nudge the treads by a pixel or two.`;
  const helpLine = hoverHelp ?? (notice || modeLine);
  const brushLabel = brush === "eraser" ? "Eraser" : `${SLOT_LABEL[brush]} ${slotHex(mapping, brush)}`;
  const toolLabel = tool === "ground" ? "Feet" : tool === "muzzle" ? "Muzzle" : brush === "eraser" ? "Eraser" : "Pencil";

  const units = STARTER_BLUEPRINTS.some((item) => item.blueprintId === doc.blueprint.blueprintId)
    ? STARTER_BLUEPRINTS
    : [...STARTER_BLUEPRINTS, doc.blueprint];

  const openUnit = (blueprintId: string) => {
    const blueprint = STARTER_BLUEPRINTS.find((item) => item.blueprintId === blueprintId);
    if (!blueprint) {
      return;
    }
    commit(documentFromBlueprint(blueprint), null);
    setNotice(`Opened the ${unitTitle(blueprint)}.`);
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
      `${LAYER_LABEL[current.editingLayer]} on ${FRAME_LABEL[current.editingFrame]} was copied onto ${FRAME_LABEL[next.editingFrame]}. The other layers stay.`,
    );
  };

  const buildMarch = () => {
    const current = docRef.current;
    if (!current.layers) {
      return;
    }
    commit(buildMarchDocument(current));
    setNotice("The march is built. Move 1 reaches, Move 2 drops a pixel, and Fire pulls the rifle back. Leg drawings already on those poses stay.");
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

  const pullWalkStance = async () => {
    try {
      const response = await fetch("/assets/units/jap_walk.png");
      if (!response.ok) {
        throw new Error("The walk sheet is missing.");
      }
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("The walk sheet could not be read.");
      }
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();
      const stamped = stampWalkStance(doc, image.data, image.width, image.height);
      if (stamped === doc) {
        setNotice("Walk frame 0 had no pixels to place.");
        return;
      }
      commit(stamped);
      setNotice(`${FRAME_LABEL[doc.editingFrame]} now shows walk frame 0. Pencil and eraser change its pixels.`);
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
          ? `The kept picture is on the ${LAYER_LABEL[current.editingLayer]} layer of ${FRAME_LABEL[current.editingFrame]}. Erase the parts that belong on the other layers.`
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
        ? `the ${LAYER_LABEL[current.editingLayer]} layer of ${FRAME_LABEL[current.editingFrame]}`
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
          {INFANTRY_LAYER_KEYS.map((layer) => (
            <button
              key={layer}
              type="button"
              aria-pressed={doc.editingLayer === layer}
              {...hint(layerHint(layer))}
              onClick={() => {
                setDoc(withEditingLayer(doc, layer));
                setNotice(`Painting ${LAYER_LABEL[layer]}.`);
              }}
            >
              {LAYER_LABEL[layer]}
            </button>
          ))}
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
            "Clear the canvas and start an empty 48 by 48 sprite for the country selected above. The unit you had open stays in the list.",
          )}
          onClick={() => {
            commit(blankDocument(docRef.current.blueprint.factionId), null);
            setNotice("Empty soldier. Paint the legs, torso, head, and the hands with the rifle, then build the march.");
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
              "Place the idle head, tunic, and rifle onto Move 1, Move 2, and Fire. A leg drawing already on Move 1 or Move 2 stays. Fire plants the idle boots a little wider, toes still pointing right.",
            )}
            onClick={buildMarch}
          >
            Build the march
          </HintButton>
        )}
        <ToolButton
          hint={hint(
            "Pin sockets on an eight-frame walk, swap the head, tunic, legs, and rifle, and bake a faction spritesheet. The pencil stays on the canvas below.",
          )}
          pressed={rigOpen}
          onClick={() => setRigOpen((open) => !open)}
        >
          Skeleton rig
        </ToolButton>
        {doc.layers && doc.editingLayer && (
          <HintButton
            hint={hint(
              `Copy the ${LAYER_LABEL[doc.editingLayer]} layer onto the next pose and select that pose. The other three layers on that pose stay.`,
            )}
            onClick={duplicateLayer}
          >
            Copy layer → next
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
        <HintButton
          hint={hint("Put frame 0 of the walk onto the pose you are painting. The feet sit on the ground mark. Pencil and eraser change every pixel.")}
          onClick={() => void pullWalkStance()}
        >
          Walk frame
        </HintButton>
        {doc.layers && (
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
      {rigOpen && (
        <PaperDollPanel
          onDrawOnSprite={(manifest, parts) => {
            try {
              const placed = placeRigFrame(doc, composeLayers(manifest, parts, "walk", 0));
              if (placed === doc) {
                setNotice("The rig had no pixels to draw.");
                return;
              }
              commit(withEditingLayer(placed, "torso"));
              setNotice(
                `${FRAME_LABEL[doc.editingFrame]} now has the legs, torso, head, and rifle. The torso is the body under the rifle. Paint it to close any hole.`,
              );
            } catch (error) {
              setNotice(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      )}

      <div className="sprite-scroll">
      <div className="sprite-workspace">
        <div className="sprite-tools" role="toolbar" aria-label="Tools">
          <ToolButton
            pressed={tool === "brush" && brush !== "eraser"}
            hint={hint(
              `Pencil. Paint ${brush === "eraser" ? "the selected colour" : brushLabel} onto ${layerLabel ? `${layerLabel} on ${editingLabel}` : editingLabel}. The rifle stays above the tunic, the tunic above the legs.`,
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
            hint={hint("Muzzle. Click where a gun flash should appear. This places the crimson mark.")}
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
                ? `${LAYER_LABEL[doc.editingLayer]} on ${FRAME_LABEL[doc.editingFrame]}. Legs under the tunic, head above it, rifle above everything. Move this layer with the arrow keys, then paint the tunic into the gap.`
                : `${FRAME_LABEL[doc.editingFrame]}. Idle, two steps, and the shot. A country recolours the slots. It does not move the pixels.`}
            </p>
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

function drawGrid(grid: HTMLCanvasElement | null, pins: HTMLCanvasElement | null, doc: UnitPaintDocument): void {
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
    for (const layer of LAYER_PAINT_ORDER) {
      paintLayer(image, stack[layer], mapping, 255);
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

function layerHint(layer: InfantryLayerKey): string {
  if (layer === "legs") {
    return "Hips and boots, under the tunic. Arrow keys move them on this pose.";
  }
  if (layer === "torso") {
    return "The body, above the legs and under the head and the rifle. Move the rifle aside, then paint the tunic into the gap so a later pose has no hole.";
  }
  if (layer === "head") {
    return "Helmet and face, above the tunic and under the rifle.";
  }
  return "Hands and the rifle, above every other layer. Arrow keys move it on this pose. Paint the tunic into the gap it leaves.";
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
  gap: 6px;
  padding: 0 14px 8px;
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
