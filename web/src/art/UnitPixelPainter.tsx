import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import { ARCHETYPES, ARCHETYPE_LAYERS, UNIT_TYPE_LABEL, archetypeForUnitType, layerInfo, layerLabel, shiftsForDivisor } from "./archetypeLayers";
import { ARCHETYPE_STARTERS } from "./archetypeStarters";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import { blitBlueprintToSheet80x56, compileBlueprintFrame } from "./blockoutCompiler";
import { EDITOR_SHARED_CSS, SwatchPalette } from "./editorShared";
import {
  fromLayeredFile,
  layeredUnitRelativePath,
  normalizePlateGrain,
  readUnitFile,
  saveMotionDocument,
  savesAsLayeredUnit,
  toLayeredFile,
} from "./layeredUnit";
import { EMBLEMS, emblemBitmap, emblemById, emblemForFaction, type EmblemId, type StampCell } from "./emblems";
import { VehicleGeneratePanel } from "./VehicleGeneratePanel";
import { VehiclePartsPanel } from "./VehiclePartsPanel";
import { hasParts } from "./vehicleParts";
import {
  FRAME_LABEL,
  PALETTE_SLOT_KEYS,
  ROSTER_FACTIONS,
  SLOT_LABEL,
  blankDocument,
  buildAnimationDocument,
  cardBlockMask,
  duplicateFrameToNext,
  duplicateLayerToNext,
  fitPlate,
  flattenRgba,
  isPlate,
  linkStripes,
  loadFrameOntoCurrent,
  maskCount,
  moveRegionToLayer,
  nudgeLayer,
  paintAt,
  plateDocument,
  plateProblems,
  plateShifts,
  polygonMask,
  rectMask,
  solidTorsoUnderWeapon,
  placeGroundOrigin,
  placeMuzzle,
  slotHex,
  starterBlueprints,
  stampEmblemAt,
  stampPreviewCells,
  starterDocument,
  tagSteel,
  toPaintFile,
  withDisplayDivisor,
  withEditingFrame,
  withEditingLayer,
  withFaction,
  withMotionShifts,
  withUnitType,
  type Brush,
  type CellMask,
  type UnitPaintDocument,
} from "./pixelPaint";
import { autoGrainLabel, deupscaleToNativeArtPixels, detectPixelBlockSize, resolveGrainBlock, type GrainOverride } from "./pixelGrain";
import {
  EMBLEM_SLOT_KEYS,
  SPRITE_FRAME_KEYS,
  type MilitaryStripKey,
  type MotionShifts,
  type PaletteSlotKey,
  type RosterFactionId,
  type SpriteFrameKey,
  type UnitSpriteSheetBlueprint,
  type Vec2,
} from "./skeletonSchema";

/** Screen pixels to one canvas pixel. A plate several hundred pixels wide opens at a low step and scrolls. */
const ZOOMS = [1, 2, 3, 4, 6, 8, 12] as const;
type Zoom = (typeof ZOOMS)[number];
/** The widest the canvas opens at before it needs the scroll bars. */
const OPEN_WIDTH = 780;
/** Below this many screen pixels a cell, the pixel gridlines are left off. */
const GRIDLINE_ZOOM = 4;
const HISTORY_LIMIT = 40;
type Tool = "brush" | "ground" | "muzzle" | "select" | "lasso" | "steel" | "stamp";

interface SavedPlate {
  factionId: RosterFactionId;
  unitTypeId: string;
  path: string;
}

/** The largest step, up to 8, at which the whole canvas shows without scrolling. */
function openingZoom(width: number): Zoom {
  let best: Zoom = 1;
  for (const step of ZOOMS) {
    if (step <= 8 && width * step <= OPEN_WIDTH) {
      best = step;
    }
  }
  return best;
}
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
  emblem_dark: "Fixed. The black of a national emblem. It is the same in every country.",
  emblem_red: "Fixed. The red of a national emblem. It is the same in every country.",
  emblem_red_light: "Fixed. The lit edge of a red emblem.",
  emblem_white: "Fixed. The white of a national emblem.",
  emblem_white_shade: "Fixed. The shaded edge of a white emblem.",
  emblem_blue: "Fixed. The blue of a national emblem.",
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
  const [tool, setTool] = useState<Tool>("brush");
  const [emblemId, setEmblemId] = useState<EmblemId>(() => emblemForFaction(starterDocument(STARTERS[0]?.blueprintId ?? "")?.blueprint.factionId ?? "GER")?.id ?? "ger_balkenkreuz");
  const [emblemSize, setEmblemSize] = useState(17);
  const [emblemFlip, setEmblemFlip] = useState(false);
  const [onlySprite, setOnlySprite] = useState(true);
  const [sheetNote, setSheetNote] = useState("");
  const gridRef = useRef<HTMLCanvasElement>(null);
  const pinRef = useRef<HTMLCanvasElement>(null);
  const selectionRef = useRef<HTMLCanvasElement>(null);
  const stampRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const [hoverHelp, setHoverHelp] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [zoom, setZoom] = useState<Zoom>(8);
  const [selection, setSelection] = useState<CellMask | null>(null);
  const [heal, setHeal] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);
  const [savedPlates, setSavedPlates] = useState<SavedPlate[]>([]);
  const [grainChoice, setGrainChoice] = useState<"auto" | "1" | "2" | "3">("auto");
  const [grainDetected, setGrainDetected] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const dragStart = useRef<Vec2 | null>(null);
  const lassoPoints = useRef<Vec2[]>([]);
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
        if (!isPlate(current)) {
          commit(nudgeLayer(current, step[0], step[1]));
        } else if (current.editingFrame !== "idle") {
          setNotice(PLATE_IDLE_ONLY);
        } else {
          const nudged = nudgeLayer(current, step[0], step[1]);
          commit(nudged === current ? current : buildAnimationDocument(nudged));
        }
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

  // The stamp follows the country the sprite is filed under. A country with no emblem keeps the last pick.
  const spriteFaction = doc.blueprint.factionId;
  useEffect(() => {
    const own = emblemForFaction(spriteFaction);
    if (own) {
      setEmblemId(own.id);
    }
  }, [spriteFaction]);

  useEffect(() => {
    drawGrid(gridRef.current, pinRef.current, doc, dimOthers);
    drawSheet(sheetRef.current, doc, setSheetNote);
  }, [doc, dimOthers]);

  const { width: gridW, height: gridH } = doc.blueprint.canvasSize;
  const plate = isPlate(doc);
  const divisor = doc.blueprint.displayDivisor ?? 1;
  const liveSelection = selection && selection.width === gridW && selection.height === gridH ? selection : null;

  useEffect(() => {
    drawSelection(selectionRef.current, liveSelection);
  }, [liveSelection, gridW, gridH]);

  const emblem = emblemById(emblemId) ?? EMBLEMS[0];
  const activeSize = emblem?.sizes.some((item) => item.size === emblemSize) ? emblemSize : (emblem?.sizes[0]?.size ?? 0);
  const stampBitmap = useMemo(() => (emblem ? emblemBitmap(emblem, activeSize, emblemFlip) : null), [emblem, activeSize, emblemFlip]);

  // The hover preview: exactly the cells a click would write, so a clipped stamp shows clipped.
  useEffect(() => {
    drawStampPreview(stampRef.current, tool === "stamp" && cursor && stampBitmap ? stampPreviewCells(doc, stampBitmap, cursor.x, cursor.y, onlySprite) : [], FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId]);
  }, [tool, cursor, stampBitmap, onlySprite, doc, gridW, gridH]);

  // A canvas of another size opens at a step that shows all of it, and drops a selection made on the old one.
  useEffect(() => {
    setZoom(openingZoom(gridW));
    setSelection(null);
  }, [gridW, gridH]);

  // The check walks every beat of the plate, so it waits until the pencil has been still for a moment.
  useEffect(() => {
    if (!isPlate(doc)) {
      setProblems([]);
      return;
    }
    const timer = window.setTimeout(() => setProblems(plateProblems(doc)), 200);
    return () => window.clearTimeout(timer);
  }, [doc]);

  const refreshSavedPlates = useCallback(async () => {
    if (!import.meta.env.DEV) {
      return;
    }
    try {
      const response = await fetch("/__dev/layered-units");
      const json = await response.json();
      setSavedPlates(Array.isArray(json.units) ? (json.units as SavedPlate[]) : []);
    } catch {
      setSavedPlates([]);
    }
  }, []);

  useEffect(() => {
    void refreshSavedPlates();
  }, [refreshSavedPlates]);

  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  const editingLabel = FRAME_LABEL[doc.editingFrame];
  const skeleton = ARCHETYPES[doc.archetype];
  const openLayer = doc.layers && doc.editingLayer ? layerLabel(doc.archetype, doc.editingLayer) : null;
  const stackLine = `${skeleton.layers.map((layer) => layer.label).join(", then ")}, bottom to top`;
  const modeLine = plate
    ? `${openLayer} is open. Select a part with Box or Lasso and send it to its layer. Move 1, Move 2, and Fire are built from Idle after every change.`
    : openLayer
      ? `Painting ${openLayer} on ${editingLabel}. ${stackLine}. Arrow keys move this layer. [ and ] change layer.`
      : `Painting ${editingLabel}. Duplicate it onto the next frame, then nudge the treads by a pixel or two.`;
  const helpLine = hoverHelp ?? (notice || modeLine);
  const brushLabel = brush === "eraser" ? "Eraser" : `${SLOT_LABEL[brush]} ${slotHex(mapping, brush)}`;
  const toolLabel =
    tool === "ground"
      ? "Feet"
      : tool === "muzzle"
        ? "Muzzle"
        : tool === "select"
          ? "Box"
          : tool === "lasso"
            ? "Lasso"
            : tool === "stamp"
              ? "Stamp"
              : tool === "steel"
              ? "Steel links"
              : brush === "eraser"
                ? "Eraser"
                : "Pencil";
  const selectedCount = liveSelection ? maskCount(liveSelection) : 0;
  const shifts = plateShifts(doc);

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
      commit(isPlate(next) ? buildAnimationDocument(next) : next);
      setNotice(`This sprite is now filed as ${name}. The drawing stays. Build Animation uses that unit's rules.`);
      return;
    }
    commit(next, null);
    setNotice(`Empty ${name}, on the ${ARCHETYPES[next.archetype].label.toLowerCase()} skeleton. ${blankLine(next)} Undo brings the last sprite back.`);
  };

  const applyPointer = (event: PointerEvent<HTMLCanvasElement>, phase: "down" | "move") => {
    const point = pixelOf(event.currentTarget, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    setCursor(point);
    const current = docRef.current;
    if (tool === "brush" && event.altKey) {
      // Alt-click picks up the colour under the pointer, as it does in the infantry editor.
      const seen = current.blueprint.frames[current.editingFrame][point.y]?.[point.x] ?? null;
      if (phase === "down" && seen) {
        setBrush(seen);
        setNotice(`Picked up ${SLOT_LABEL[seen]}.`);
      }
      return;
    }
    if (tool === "select" || tool === "lasso") {
      if (phase === "down") {
        dragStart.current = point;
        lassoPoints.current = [point];
      } else if (dragStart.current) {
        const last = lassoPoints.current[lassoPoints.current.length - 1];
        if (!last || last.x !== point.x || last.y !== point.y) {
          lassoPoints.current.push(point);
        }
      }
      if (!dragStart.current) {
        return;
      }
      const { width, height } = current.blueprint.canvasSize;
      setSelection(tool === "select" ? rectMask(width, height, dragStart.current, point) : polygonMask(width, height, lassoPoints.current));
      setNotice("");
      return;
    }
    if (tool === "ground") {
      if (commit(placeGroundOrigin(current, point.x, point.y))) {
        setNotice(`Feet stand on pixel ${point.x}, ${point.y}. The drawing stays put. The game sprite shifts so the feet meet the ground.`);
      }
      return;
    }
    if (tool === "muzzle") {
      const marked = placeMuzzle(current, point.x, point.y);
      if (commit(marked !== current && isPlate(marked) ? buildAnimationDocument(marked) : marked)) {
        setNotice(`Muzzle mark set at ${point.x}, ${point.y}. Build Animation paints the flash there on Fire.`);
      }
      return;
    }
    if (isPlate(current) && current.editingFrame !== "idle") {
      setNotice(PLATE_IDLE_ONLY);
      return;
    }
    if (tool === "stamp") {
      if (phase !== "down" || !stampBitmap) {
        return;
      }
      const stamped = stampEmblemAt(current, stampBitmap, point.x, point.y, onlySprite);
      if (stamped === current) {
        setNotice(onlySprite ? "Nothing to stamp there: no part of the sprite is under the emblem. Turn off Only on the sprite to stamp on empty canvas." : "The emblem is off the canvas.");
        return;
      }
      commit(isPlate(stamped) && stamped.layers ? buildAnimationDocument(stamped) : stamped);
      setNotice(`${emblem?.name ?? "Emblem"} stamped at ${point.x}, ${point.y}${current.editingLayer ? ` on ${layerLabel(current.archetype, current.editingLayer)}` : ""}.`);
      return;
    }
    if (tool === "steel") {
      if (!current.layers || !current.editingLayer) {
        setNotice("Steel links are tagged on a layer. This unit is four flat frames.");
        return;
      }
      commit(tagSteel(current, cardBlockMask(current, point.x, point.y)));
      setNotice("");
      return;
    }
    if (!commit(paintAt(current, point.x, point.y, brush))) {
      setNotice(`That square is outside the ${FRAME_LABEL[current.editingFrame]} frame.`);
    } else {
      setNotice("");
    }
  };

  /** A drag is over. A plate's other poses follow the idle pose, so they are built again once the pencil lifts. */
  const endStroke = () => {
    const current = docRef.current;
    if (stroking.current && gestureSaved.current && tool === "brush" && isPlate(current) && current.layers && current.editingFrame === "idle") {
      commit(buildAnimationDocument(current));
    }
    stroking.current = false;
    gestureSaved.current = false;
    dragStart.current = null;
    setPainting(false);
  };

  const sendSelection = (layer: string) => {
    const current = docRef.current;
    if (!liveSelection || !current.layers) {
      return;
    }
    const result = moveRegionToLayer(current, liveSelection, layer, heal);
    const label = layerLabel(current.archetype, layer);
    if (result.moved === 0) {
      setNotice(`Nothing in the selection shows on another layer. ${label} already has it, or the selection is empty canvas.`);
      return;
    }
    commit(withEditingLayer(result.doc, layer));
    setSelection(null);
    setNotice(
      `${result.moved} pixels are now on ${label}. ${heal ? "The layers under it were filled in where the part sat inside them. " : ""}Idle looks the same. The other poses were built again.`,
    );
  };

  const tagSelection = (stripes: boolean) => {
    const current = docRef.current;
    if (!liveSelection || !current.layers || !current.editingLayer) {
      return;
    }
    const region = stripes ? linkStripes(liveSelection, current.blueprint.groundOrigin.x, current.blueprint.displayDivisor ?? 1) : liveSelection;
    commit(tagSteel(current, region));
    setNotice(
      stripes
        ? `Every other card pixel of ${layerLabel(current.archetype, current.editingLayer)} in the selection is steel. Move 1 steps those links along.`
        : `The ${layerLabel(current.archetype, current.editingLayer)} ink in the selection is steel. Move 1 steps it along.`,
    );
  };

  const changeDivisor = (value: number) => {
    const current = docRef.current;
    if (!Number.isInteger(value) || value < 1 || value === (current.blueprint.displayDivisor ?? 1)) {
      return;
    }
    // Shifts that were one card pixel stay one card pixel. Shifts typed in by hand are left alone and checked.
    const followed = sameShifts(plateShifts(current), shiftsForDivisor(current.blueprint.displayDivisor ?? 1));
    const resized = withDisplayDivisor(current, value);
    commit(followed ? withMotionShifts(resized, shiftsForDivisor(value)) : resized);
    setNotice(`${value} by ${value} plate pixels make one card pixel.`);
  };

  const changeShift = (key: keyof MotionShifts, value: number) => {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    const current = docRef.current;
    commit(withMotionShifts(current, { ...plateShifts(current), [key]: value }));
  };

  const fitCard = () => {
    const current = docRef.current;
    const next = fitPlate(current);
    commit(next);
    setNotice(
      `Divisor ${next.blueprint.displayDivisor}: the smallest at which every beat fits the card, with one card pixel of bob and tread and two of recoil.`,
    );
  };

  const openPlate = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const current = docRef.current;
    const archetype = archetypeForUnitType(current.blueprint.unitTypeId);
    if (!archetype || archetype === "infantry") {
      setNotice("Set Type to the vehicle, aircraft, or ship in the picture first. A rifleman is drawn on the 48 canvas.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await rgbaFromUrl(url);
      const detected = detectPixelBlockSize(image.data, image.width, image.height);
      const override: GrainOverride = grainChoice === "auto" ? "auto" : (Number(grainChoice) as 1 | 2 | 3);
      const native = deupscaleToNativeArtPixels(image.data, image.width, image.height, resolveGrainBlock(detected, override));
      setGrainDetected(detected);
      const next = plateDocument({
        factionId: current.blueprint.factionId,
        unitTypeId: current.blueprint.unitTypeId,
        rgba: native.rgba,
        width: native.width,
        height: native.height,
        title: `${FACTION_NAME[current.blueprint.factionId]} ${(UNIT_TYPE_LABEL[current.blueprint.unitTypeId] ?? current.blueprint.unitTypeId).toLowerCase()}`,
        sourcePath: file.name,
      });
      commit(next, null);
      const grainNote =
        native.blockSize <= 1
          ? "It is already one art pixel per pixel."
          : detected === native.blockSize
            ? `Pixel grain ${native.blockSize}× collapsed to 1× before the colours were snapped.`
            : `Detected ${detected}×, forced ${native.blockSize}×, and collapsed to 1× before the colours were snapped.`;
      setNotice(
        `${file.name} is ${native.width} by ${native.height} art pixels. ${grainNote} The plate is ${next.blueprint.canvasSize.width} by ${next.blueprint.canvasSize.height}, all on ${layerLabel(next.archetype, next.editingLayer ?? "")}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const normalizeOpenPlate = () => {
    const current = docRef.current;
    if (!isPlate(current) || !current.layers || current.archetype === "infantry") {
      setNotice("Pixel grain trim is for a plate. A 48 canvas is already one art pixel per pixel.");
      return;
    }
    const grain = normalizePlateGrain(current, grainChoice === "auto" ? undefined : Number(grainChoice));
    setGrainDetected(grain.detected);
    if (grain.applied <= 1) {
      setNotice(
        `This plate is already 1×, ${current.blueprint.canvasSize.width} by ${current.blueprint.canvasSize.height}. Choose Force 2× or Force 3× to snap it anyway.`,
      );
      return;
    }
    commit(grain.doc, null);
    const { width, height } = grain.doc.blueprint.canvasSize;
    setNotice(`Collapsed ${grain.applied}× grain to 1×. ${width} by ${height}. The feet, the muzzle, and the shifts moved with the pixels.`);
  };

  const openSavedPlate = async (saved: SavedPlate) => {
    try {
      const response = await fetch(`/__dev/layered-units?faction=${saved.factionId}&unit=${saved.unitTypeId}`);
      const json: unknown = await response.json();
      if (!response.ok) {
        throw new Error((json as { error?: string }).error ?? `Open failed with ${response.status}`);
      }
      const next = fromLayeredFile(json);
      commit(next, null);
      setNotice(`Opened ${saved.path}: ${next.blueprint.canvasSize.width} by ${next.blueprint.canvasSize.height}, divisor ${next.blueprint.displayDivisor}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
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
    const layered = savesAsLayeredUnit(doc);
    try {
      const response = await fetch(layered ? "/__dev/save-layered" : "/__dev/save-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layered ? toLayeredFile(doc) : toPaintFile(doc)),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error || `Save failed with ${response.status}`);
      }
      if (layered) {
        void refreshSavedPlates();
        setNotice(`Saved the plate at ${json.path}. npm run animate:batch exports its card strip from that file.`);
      } else {
        setNotice(`Saved this drawing in the project at ${json.path}.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const exportJson = () => {
    const layered = savesAsLayeredUnit(doc);
    const text = layered ? JSON.stringify(toLayeredFile(doc), null, 1) : JSON.stringify(toPaintFile(doc), null, 2);
    const name = layered ? `${doc.blueprint.factionId}_${doc.blueprint.unitTypeId}.layered.json` : `${doc.blueprint.blueprintId}.json`;
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${name}. Another player can open that file here.`);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      commit(readUnitFile(parsed), null);
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

  /** A change made by the parts or the generate panel. It is one step for Undo. */
  const takeDocument = (next: UnitPaintDocument, note: string) => {
    commit(next);
    setNotice(note);
  };

  const hint = (text: string) => ({
    title: text,
    onMouseEnter: () => setHoverHelp(text),
    onMouseLeave: () => setHoverHelp(null),
    onFocus: () => setHoverHelp(text),
    onBlur: () => setHoverHelp(null),
  });

  const cell = zoom;
  /** The checkerboard behind the canvas stays readable when a plate is shown small. */
  const checker = Math.max(cell, 4);

  return (
    <div
      className={dropping ? "sprite-editor sprite-editor-drop" : "sprite-editor"}
      aria-label="Unit pixel painter"
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropping(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        const file = [...event.dataTransfer.files].find((item) => item.type === "image/png" || item.name.toLowerCase().endsWith(".png"));
        if (!file) {
          setNotice("Drop a PNG to import it as a plate.");
          return;
        }
        void openPlate(file);
      }}
    >
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
              try {
                saveMotionDocument(docRef.current);
              } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return;
              }
              window.location.assign("/?anim=1");
            }}
          >
            Watch them move
          </HintButton>
        )}
        {import.meta.env.DEV && (
          <HintButton
            hint={hint(
              "Put this drawing on a battle map, at the size it was painted, on the same ground line as the vector unit. One pixel of the drawing is one pixel of the board.",
            )}
            onClick={() => {
              try {
                saveMotionDocument(docRef.current);
              } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return;
              }
              window.location.assign("/?field=1");
            }}
          >
            On a battle map
          </HintButton>
        )}
        <HintButton
          hint={hint("Clear the canvas and start an empty 48 by 48 sprite of the type and country selected above. The unit you had open stays in the list.")}
          onClick={() => {
            const current = docRef.current;
            const name = (UNIT_TYPE_LABEL[current.blueprint.unitTypeId] ?? current.blueprint.unitTypeId).toLowerCase();
            const next = blankDocument(current.blueprint.factionId, current.archetype, current.blueprint.unitTypeId);
            commit(next, null);
            setNotice(`Empty ${name}. ${blankLine(next)}`);
          }}
        >
          New sprite
        </HintButton>
        {!plate && (
          <HintButton
            hint={hint(
              "Copy the frame you are painting onto the next pose, then select that pose. Nudge the boots, the treads, or the rifle by a pixel or two.",
            )}
            onClick={duplicateNext}
          >
            Duplicate Frame → Next
          </HintButton>
        )}
        {doc.layers && (
          <HintButton
            hint={hint(
              doc.archetype === "infantry"
                ? "Place the idle head, tunic, and rifle onto Move 1, Move 2, and Fire. A leg drawing already on Move 1 or Move 2 stays. Fire plants the idle boots a little wider, toes still pointing right."
                : `Write Move 1, Move 2, and Fire from the Idle layers. Layers shift by whole pixels and nothing turns. ${skeleton.motion} What is on those three poses now is replaced.${plate ? " A plate does this by itself after every change." : ""}`,
            )}
            onClick={buildAnimation}
          >
            Build Animation
          </HintButton>
        )}
        {!plate && doc.layers && doc.editingLayer && (
          <HintButton
            hint={hint(`Copy the ${openLayer} layer onto the next pose and select that pose. The other layers on that pose stay.`)}
            onClick={duplicateLayer}
          >
            {"Copy Layer -> Next Pose"}
          </HintButton>
        )}
        {!plate && (
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
        )}
        {import.meta.env.DEV && (
          <HintButton
            hint={hint(
              plate
                ? `Write this plate into the project at ${layeredUnitRelativePath(doc.blueprint.factionId, doc.blueprint.unitTypeId)}. The file holds the Idle layers, the feet, the muzzle, the divisor, and the shifts. The card strip is exported from it.`
                : "Write this drawing into the project as JSON, under assets/units/authored. You can keep working on it from the dev server.",
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
        {!plate && (
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
        )}
        {savedPlates.length > 0 && (
          <label
            className="sprite-open"
            {...hint(
              "Open a plate saved in the project under assets/layered. A plate is a vehicle, an aircraft, or a ship at the size it was baked, cut into layers.",
            )}
          >
            Saved plates
            <select
              aria-label="Saved plates"
              defaultValue=""
              onChange={(event) => {
                const saved = savedPlates.find((item) => item.path === event.target.value);
                event.target.value = "";
                if (saved) {
                  void openSavedPlate(saved);
                }
              }}
            >
              <option value="">Choose a plate</option>
              {savedPlates.map((item) => (
                <option key={item.path} value={item.path}>
                  {FACTION_NAME[item.factionId] ?? item.factionId} · {UNIT_TYPE_LABEL[item.unitTypeId] ?? item.unitTypeId}
                </option>
              ))}
            </select>
          </label>
        )}
        <label
          className="sprite-open"
          {...hint("Auto collapses a 2× or 3× Retro Diffusion block to one art pixel. Force a size when the picture is already 1×, or when the guess is wrong.")}
        >
          Pixel grain
          <select aria-label="Pixel grain" value={grainChoice} onChange={(event) => setGrainChoice(event.target.value as "auto" | "1" | "2" | "3")}>
            <option value="auto">{autoGrainLabel(grainDetected)}</option>
            <option value="1">Force 1×</option>
            <option value="2">Force 2×</option>
            <option value="3">Force 3×</option>
          </select>
        </label>
        {grainDetected != null && (
          <span className="sprite-grain-badge">{grainChoice === "auto" ? autoGrainLabel(grainDetected) : `Detected ${grainDetected}×`}</span>
        )}
        <label
          className="sprite-open"
          {...hint(
            "Open a baked picture at its art-pixel size, as a new plate. A 2× or 3× block is collapsed before the colours are snapped and the feet are placed. Set Type and Colours of to the unit in the picture first. You can also drop a PNG on this editor.",
          )}
        >
          Import Native Plate PNG
          <input
            type="file"
            accept="image/png,.png"
            aria-label="Import Native Plate PNG"
            onChange={(event) => {
              void openPlate(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <HintButton
          hint={hint(
            "Snap the plate open now. Auto collapses a real 2× or 3× block grid. Force 2× or Force 3× divides a plate that is already one pixel per pixel, such as the 206 by 130 UK tank down to 103 by 65. The feet, the muzzle, and the shifts move with the pixels.",
          )}
          onClick={normalizeOpenPlate}
        >
          De-Upscale Existing Layered JSON (÷2 / ÷3)
        </HintButton>
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
        {!plate && (
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
        )}
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
      {hasParts(doc) && <VehiclePartsPanel doc={doc} onChange={takeDocument} onNote={setNotice} hint={hint} />}
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
          <ToolButton
            pressed={tool === "stamp"}
            hint={hint(
              "Stamp. Put the national emblem of the country on the sprite. Pick the emblem and size on the right. Click to stamp; the faint picture follows the pointer. Undo takes it off.",
            )}
            onClick={() => setTool("stamp")}
          >
            <span aria-hidden="true">★</span>
            Stamp
          </ToolButton>
          {doc.layers && (
            <>
              <ToolButton
                pressed={tool === "select"}
                hint={hint(
                  "Box. Drag a rectangle round a part, such as the tracks or the turret. Then send what it holds to a layer with the buttons under Selection.",
                )}
                onClick={() => setTool("select")}
              >
                <span aria-hidden="true">▭</span>
                Box
              </ToolButton>
              <ToolButton
                pressed={tool === "lasso"}
                hint={hint(
                  "Lasso. Draw round a part that a box does not fit, such as a turret with a sloped side. The shape closes when you let go. Then send it to a layer.",
                )}
                onClick={() => setTool("lasso")}
              >
                <span aria-hidden="true">◌</span>
                Lasso
              </ToolButton>
              <ToolButton
                pressed={tool === "steel"}
                hint={hint(
                  `Steel links. Drag along the tread or the propeller on the open layer. The ink under the brush turns to steel${plate ? `, ${divisor} by ${divisor} pixels at a time, which is one card pixel` : ""}. Build Animation steps steel along on Move 1. Empty canvas stays empty.`,
                )}
                onClick={() => setTool("steel")}
              >
                <span aria-hidden="true">▚</span>
                Steel links
              </ToolButton>
            </>
          )}
        </div>

        <div className="sprite-stage-column">
          <div className="sprite-canvas-bar">
            <span>
              {gridW} × {gridH} pixels{plate ? ` · ${divisor} × ${divisor} to a card pixel` : ""}
            </span>
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
                  {...hint(
                    `Show each pixel as a ${step} pixel square. The sprite is still ${gridW} by ${gridH}. A canvas wider than the window scrolls.`,
                  )}
                  onClick={() => setZoom(step)}
                >
                  {step}×
                </button>
              ))}
            </span>
          </div>
          <div className="sprite-draw">
          <div className="sprite-viewport">
          <div
            className="sprite-stage"
            style={{
              width: gridW * cell,
              height: gridH * cell,
              backgroundSize: `${checker * 2}px ${checker * 2}px`,
              backgroundPosition: `0 0, 0 ${checker}px, ${checker}px ${-checker}px, ${-checker}px 0`,
            }}
          >
            <canvas
              ref={gridRef}
              className="sprite-pixels"
              width={gridW}
              height={gridH}
              aria-label={`${gridW} by ${gridH} pixel grid`}
              onPointerDown={(event) => {
                stroking.current = true;
                gestureSaved.current = false;
                setPainting(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                applyPointer(event, "down");
              }}
              onPointerMove={(event) => {
                const point = pixelOf(event.currentTarget, event.clientX, event.clientY);
                setCursor(point);
                if (painting || stroking.current) {
                  applyPointer(event, "move");
                }
              }}
              onPointerUp={endStroke}
              onPointerLeave={() => {
                endStroke();
                setCursor(null);
              }}
            />
            {cell >= GRIDLINE_ZOOM && (
              <div
                className="sprite-gridlines"
                style={{ backgroundSize: `${cell}px ${cell}px` }}
              />
            )}
            {plate && divisor > 1 && divisor * cell >= 6 && (
              <div
                className="sprite-gridlines sprite-cardlines"
                aria-hidden="true"
                style={{
                  backgroundSize: `${divisor * cell}px ${divisor * cell}px`,
                  backgroundPosition: `${(doc.blueprint.groundOrigin.x % divisor) * cell}px ${((doc.blueprint.groundOrigin.y + 1) % divisor) * cell}px`,
                }}
              />
            )}
            <canvas ref={selectionRef} className="sprite-selection" width={gridW} height={gridH} />
            <canvas ref={stampRef} className="sprite-stamp-preview" width={gridW} height={gridH} />
            <canvas ref={pinRef} className="sprite-pins" width={gridW} height={gridH} />
          </div>
          </div>
          <p className="sprite-canvas-note">
            Cream cross: where the feet stand ({doc.blueprint.groundOrigin.x}, {doc.blueprint.groundOrigin.y}). Crimson cross: muzzle
            {doc.blueprint.muzzlePoint ? ` (${doc.blueprint.muzzlePoint.x}, ${doc.blueprint.muzzlePoint.y})` : ""}.
            {plate && divisor > 1 ? " The darker lines are card pixels." : ""}
            {" Alt-click picks up a colour."}
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
                {skeleton.label} skeleton: {stackLine}.{" "}
                {plate
                  ? "This is a plate, drawn at the size it was baked. The card is scaled down from it."
                  : `Fits ${skeleton.footprint.width} by ${skeleton.footprint.height} pixels beside the 26-pixel rifleman.`}
              </p>
            )}
          </section>
          {doc.layers && (
            <section>
              <h3>Selection</h3>
              <p className="sprite-side-lead">
                {selectedCount > 0
                  ? `${selectedCount} pixels selected. Send what shows in them to a layer.`
                  : "Drag with Box or Lasso to select a part. Each pixel is taken from whichever layer shows there."}
              </p>
              <div className="sprite-send">
                {skeleton.layers.map((layer) => (
                  <button
                    key={layer.key}
                    type="button"
                    disabled={selectedCount === 0}
                    {...hint(
                      `Move what shows inside the selection onto ${layer.label}, at the same pixels. Idle looks the same afterwards. ${layer.hint}`,
                    )}
                    onClick={() => sendSelection(layer.key)}
                  >
                    To {layer.label}
                  </button>
                ))}
              </div>
              <label
                className="sprite-check"
                {...hint(
                  "When a part is lifted to a higher layer, paint the layer under it where the part sat inside that layer's shape. The turret can then kick back without showing a gap in the hull. A barrel that sticks out past the hull leaves nothing behind.",
                )}
              >
                <input type="checkbox" checked={heal} onChange={(event) => setHeal(event.target.checked)} />
                Fill the hole underneath
              </label>
              <div className="sprite-send">
                <button
                  type="button"
                  disabled={selectedCount === 0 || !doc.editingLayer}
                  {...hint(
                    `Turn every other ${plate ? "card pixel" : "pixel"} of ${openLayer ?? "the open layer"} inside the selection to steel: link, gap, link, gap. Select the top or bottom run of the tread first. Move 1 steps the links along.`,
                  )}
                  onClick={() => tagSelection(true)}
                >
                  Make steel links
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0 || !doc.editingLayer}
                  {...hint(`Turn all the ${openLayer ?? "open layer"} ink inside the selection to steel. Use it for a propeller blur or a wheel hub.`)}
                  onClick={() => tagSelection(false)}
                >
                  All steel
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  {...hint("Drop the selection. Nothing on the canvas changes.")}
                  onClick={() => setSelection(null)}
                >
                  Clear
                </button>
              </div>
            </section>
          )}
          {plate && (
            <section>
              <h3>Card fit</h3>
              <p className="sprite-side-lead">
                The card is 80 by 56. The plate is scaled down by a whole number, with the feet on the card&apos;s ground line. Each shift is in plate
                pixels and has to be a whole number of card pixels.
              </p>
              <div className="sprite-fields">
                <NumberField
                  label="Divisor"
                  value={divisor}
                  min={1}
                  hint={hint(
                    "How many plate pixels make one card pixel, each way. A bigger number makes the unit smaller on the card. Fit to card picks the smallest that fits.",
                  )}
                  onChange={changeDivisor}
                />
                <NumberField
                  label="Bob"
                  value={shifts.bobPx}
                  min={0}
                  step={divisor}
                  hint={hint(`How far the body drops or rises on Move 2 and under a shot, in plate pixels. A multiple of ${divisor}.`)}
                  onChange={(value) => changeShift("bobPx", value)}
                />
                <NumberField
                  label="Recoil"
                  value={shifts.recoilPx}
                  min={0}
                  step={divisor * 2}
                  hint={hint(
                    `How far the gun kicks back on Fire, in plate pixels. What carries the gun takes half. A multiple of ${divisor * 2}, because the windup and the recovery use half of it.`,
                  )}
                  onChange={(value) => changeShift("recoilPx", value)}
                />
                <NumberField
                  label="Tread stride"
                  value={shifts.treadStride}
                  min={1}
                  step={divisor}
                  hint={hint(`How far the steel links and the propeller dashes step on Move 1, in plate pixels. A multiple of ${divisor}.`)}
                  onChange={(value) => changeShift("treadStride", value)}
                />
              </div>
              <button
                type="button"
                {...hint(
                  "Set the smallest divisor at which every beat fits the card: the two steps, the windup, the shot with its flash, and the foam. The shifts become one card pixel of bob and tread and two of recoil.",
                )}
                onClick={fitCard}
              >
                Fit to card
              </button>
              {problems.length > 0 ? (
                <ul className="sprite-problems">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : (
                <p className="sprite-side-lead">Every beat fits the card and every shift is a whole card pixel.</p>
              )}
            </section>
          )}
          {tool === "stamp" && emblem && (
            <section>
              <h3>Stamp</h3>
              <label className="sprite-field" {...hint("Which national emblem to stamp. It follows the country the sprite is filed under until you pick another.")}>
                Emblem
                <select value={emblem.id} onChange={(event) => setEmblemId(event.target.value as EmblemId)}>
                  {EMBLEMS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {FACTION_NAME[item.faction]}: {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sprite-send" role="group" aria-label="Emblem size">
                {emblem.sizes.filter((item) => item.height * 3 <= gridH * 2).map((item) => (
                  <button
                    key={item.size}
                    type="button"
                    aria-pressed={activeSize === item.size}
                    {...hint(`${item.label}: ${item.width} by ${item.height} pixels. Each size is drawn by hand, not scaled from another.`)}
                    onClick={() => setEmblemSize(item.size)}
                  >
                    {item.label} {item.width}×{item.height}
                  </button>
                ))}
              </div>
              <label className="sprite-check" {...hint("Mirror the emblem left to right. Aircraft wear it the same way on both wings, so this only shows in the lit edges.")}>
                <input type="checkbox" checked={emblemFlip} onChange={(event) => setEmblemFlip(event.target.checked)} />
                Flip left to right
              </label>
              <label
                className="sprite-check"
                {...hint("Stamp only where the sprite already has a pixel on any layer of this pose, so the emblem cannot hang off the hull. Turn it off to stamp on empty canvas.")}
              >
                <input type="checkbox" checked={onlySprite} onChange={(event) => setOnlySprite(event.target.checked)} />
                Only on the sprite
              </label>
              <p className="sprite-side-lead">{emblem.basis}</p>
              <p className="sprite-side-lead">
                The colours are fixed, so the emblem stays the same whichever country the sprite is filed under. It goes on {openLayer ?? editingLabel}
                {plate ? ", Idle only. The other poses are built from it" : ""}.
              </p>
            </section>
          )}
          <section>
            <h3>Colours</h3>
            <SwatchPalette
              swatches={PALETTE_SLOT_KEYS.map((slot) => ({
                key: slot,
                label: SLOT_LABEL[slot],
                hex: slotHex(mapping, slot),
                help: `${SLOT_LABEL[slot]}, ${slotHex(mapping, slot)}. ${SLOT_HELP[slot]}`,
              }))}
              picked={tool === "brush" && brush !== "eraser" ? brush : null}
              onPick={(slot) => {
                setTool("brush");
                setBrush(slot);
              }}
              hint={hint}
            />
            <p className="sprite-side-lead">Seven slots, in the colours of {FACTION_NAME[doc.blueprint.factionId]}. Emblem colours are fixed and come only from the Stamp tool.</p>
          </section>
        </aside>
      </div>
      </div>
      {import.meta.env.DEV && hasParts(doc) && (
        <VehicleGeneratePanel doc={doc} selection={liveSelection} onChange={takeDocument} hint={hint} />
      )}

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

/** A whole-number box. A value that is not a whole number of at least `min` stays in the box and is not applied. */
function NumberField({
  label,
  value,
  min,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step?: number;
  hint: ReturnType<typeof hintProps>;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <label className="sprite-field" {...hint}>
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        step={step ?? 1}
        value={draft}
        aria-label={label}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed !== value) {
            onChange(parsed);
          }
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}

const PLATE_IDLE_ONLY = "A plate's Move 1, Move 2, and Fire are built from Idle. Open Idle to paint, and they follow.";

function sameShifts(left: MotionShifts, right: MotionShifts): boolean {
  return left.bobPx === right.bobPx && left.recoilPx === right.recoilPx && left.treadStride === right.treadStride;
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
  const { width, height } = doc.blueprint.canvasSize;
  const image = ctx.createImageData(width, height);
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
    for (let i = 0; i < keys.length && i < width * height; i++) {
      const key = keys[i];
      if (key == null) {
        continue;
      }
      writePixel(image.data, i * 4, MILITARY[key], 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  pinCtx.clearRect(0, 0, width, height);
  // On a plate one canvas pixel is small on screen, so the cross is a card pixel thick.
  const arm = doc.blueprint.displayDivisor ?? 1;
  stampPin(pinCtx, doc.blueprint.groundOrigin.x, doc.blueprint.groundOrigin.y, "#f5f0e6", arm);
  if (doc.blueprint.muzzlePoint) {
    stampPin(pinCtx, doc.blueprint.muzzlePoint.x, doc.blueprint.muzzlePoint.y, "#9c524e", arm);
  }
}

/** The emblem about to be stamped, drawn faint over the sprite. The canvas is one pixel a cell. */
function drawStampPreview(canvas: HTMLCanvasElement | null, cells: readonly StampCell[], mapping: (typeof FACTION_MILITARY_MAPPINGS)[RosterFactionId]): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (cells.length === 0) {
    return;
  }
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (const { x, y, slot } of cells) {
    writePixel(image.data, (y * canvas.width + x) * 4, slotHex(mapping, slot), 190);
  }
  ctx.putImageData(image, 0, 0);
}

/** Tint the selected cells. The canvas is one pixel a cell and is scaled up by the stage. */
function drawSelection(canvas: HTMLCanvasElement | null, selection: CellMask | null): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!selection || selection.width !== canvas.width || selection.height !== canvas.height) {
    return;
  }
  const image = ctx.createImageData(selection.width, selection.height);
  for (let index = 0; index < selection.cells.length; index += 1) {
    if (selection.cells[index] === 0) {
      continue;
    }
    const x = index % selection.width;
    const y = Math.floor(index / selection.width);
    const has = (cx: number, cy: number) =>
      cx >= 0 && cy >= 0 && cx < selection.width && cy < selection.height && selection.cells[cy * selection.width + cx] !== 0;
    // The rim of the selection is drawn solid, the inside as a light wash.
    const rim = !has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1);
    writePixel(image.data, index * 4, "#ddcf99", rim ? 235 : 70);
  }
  ctx.putImageData(image, 0, 0);
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
  // A plate has tens of thousands of cells, so each slot's colour is looked up once and not once a pixel.
  const colours = new Map<PaletteSlotKey, number>(
    [...PALETTE_SLOT_KEYS, ...EMBLEM_SLOT_KEYS].map((slot) => [slot, Number.parseInt(slotHex(mapping, slot).slice(1), 16)]),
  );
  const data = image.data;
  for (let y = 0; y < image.height; y += 1) {
    const row = grid[y];
    if (!row) {
      continue;
    }
    for (let x = 0; x < image.width; x += 1) {
      const slot = row[x];
      if (slot == null) {
        continue;
      }
      const rgb = colours.get(slot) ?? 0;
      const offset = (y * image.width + x) * 4;
      data[offset] = (rgb >> 16) & 255;
      data[offset + 1] = (rgb >> 8) & 255;
      data[offset + 2] = rgb & 255;
      data[offset + 3] = alpha;
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

/** A cross centred on one pixel. `arm` is how many pixels each arm reaches. */
function stampPin(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string, arm = 1): void {
  ctx.fillStyle = hex;
  ctx.fillRect(x - arm, y, arm * 2 + 1, 1);
  ctx.fillRect(x, y - arm, 1, arm * 2 + 1);
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
.sprite-editor-drop { outline: 2px dashed #ddcf99; outline-offset: 4px; }
.sprite-grain-badge {
  align-self: center;
  padding: 4px 8px;
  color: #1c1917;
  background: #ddcf99;
  font: 12px/1.3 "Segoe UI", sans-serif;
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
.sprite-gridlines, .sprite-pins, .sprite-selection, .sprite-stamp-preview {
  pointer-events: none;
}
.sprite-gridlines {
  background-image:
    linear-gradient(to right, rgba(28, 25, 23, 0.22) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(28, 25, 23, 0.22) 1px, transparent 1px);
}
.sprite-cardlines {
  background-image:
    linear-gradient(to right, rgba(28, 25, 23, 0.32) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(28, 25, 23, 0.32) 1px, transparent 1px);
}
.sprite-draw {
  min-width: 0;
  max-width: 100%;
}
.sprite-viewport {
  max-width: 100%;
  max-height: 72vh;
  overflow: auto;
}
.sprite-stage {
  flex: none;
}
.sprite-send {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.sprite-check {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: #a99c8d;
  font-size: 12px;
}
.sprite-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 8px 0;
}
.sprite-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #a99c8d;
  font-size: 12px;
}
.sprite-field input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
}
.sprite-problems {
  margin: 8px 0 0;
  padding: 6px 8px 6px 24px;
  border-left: 3px solid #9c524e;
  background: #2a2420;
  color: #f5f0e6;
  font-size: 12px;
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
.sprite-side .editor-swatch-name {
  margin-top: 6px;
  font-size: 12px;
}
.sprite-side .editor-swatches + .editor-swatch-name + .sprite-side-lead {
  margin-top: 6px;
}
${EDITOR_SHARED_CSS}`;
