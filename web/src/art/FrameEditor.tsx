import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import {
  AS_DRAWN_LUT,
  CLIP_KEYS,
  LAYER_NAME,
  LAYER_ORDER,
  cardRgba,
  clipsFromWalkSheet,
  frameFileName,
  frameRgba,
  fromFrameFile,
  readClipsFile,
  type ClipKey,
  type FrameClips,
  type SpriteFrame,
} from "./frameClips";
import {
  EDITOR_SHARED_CSS,
  SentPicture,
  SwatchPalette,
  imageRgba,
  loadImage,
  money,
  pictureCount as pictures,
  pngBase64,
  pngBlob,
  putRgba,
} from "./editorShared";
import { EMBLEMS, emblemBitmap, emblemById, emblemForFaction, type EmblemId } from "./emblems";
import { frameSlotsFor, frameStampCells, stampFramePart, stampPreviewRgba } from "./frameStamp";
import { maskCount, polygonMask, rectMask, type CellMask } from "./pixelPaint";
import { autoGrainLabel, deupscaleToNativeArtPixels, detectPixelBlockSize, resolveGrainBlock, type GrainOverride } from "./pixelGrain";
import { editorSchemeForRig, editorSchemeForUnitType, unitTypeFromRigId } from "./editorScheme";
import { FRAME_ZOOMS, viewFrameZoom, zoomLabel } from "./frameView";
import { isVehicleUnitType, steelToolFor, type SteelTool } from "./archetypeLayers";
import type { ShelfUnit } from "./unitShelf";
import { FACTION_LUTS, FACTION_PRESET_LABEL, SLOT_LABELS, type FactionPresetId, type PartCategory } from "./paperDoll";
import { GEN_ROOM_MAX, harvestPart, planGeneration, type GenPicture, type GenPlan, type GenSheet, type GenSpread } from "./partGen";
import { purpleSheet } from "./purpleSheet";
import { polishedPngFor, readStampSidecar, type StampPlacement } from "./spriteStamps";
import {
  assembleRig,
  breathFrame,
  buildGaps,
  buildMotion,
  claimBrush,
  claimUnselected,
  paintSteel,
  clearMoves,
  copyPart,
  clipTitle,
  describeFrames,
  isVehicleClipSet,
  erasePart,
  feedIdleCopies,
  fillLayerInk,
  fillPart,
  fillTorsoUnderWeapon,
  framesOnPose,
  idleSource,
  moveLayer,
  muzzlePoints,
  outlineFit,
  ownPose,
  paintBrush,
  paintCoveringStamps,
  paintedSelection,
  paintPart,
  partFromDrawings,
  partFromPicture,
  partStrip,
  partsOf,
  placePicture,
  removeBuild,
  removePart,
  renamePart,
  resolveFrame,
  retakeOutline,
  rigBundle,
  rigFromBundle,
  rigFromClips,
  frameMuzzles,
  renameEmptyParts,
  rigFromPicture,
  seatPicture,
  toggleMuzzle,
  withVehicleClips,
  saveBuild,
  sendShownToLayer,
  shiftCells,
  slideDrawing,
  spreadDrawing,
  toPartFile,
  toRigFile,
  trimToOutline,
  wearBuild,
  wearPart,
  withRigFrame,
  wornBuild,
  wornPart,
  type PartRig,
  type RigFrame,
  type RigPart,
} from "./partRig";

const UNIT_ID = "jap_infantry";
const WALK_SHEET_URL = "/assets/units/jap_walk.png";
const FRAMES_URL = `/assets/units/frames/${UNIT_ID}`;
const RIG_URL = `/assets/units/rigs/${UNIT_ID}`;
const FACTIONS = Object.keys(FACTION_LUTS) as FactionPresetId[];

type ColourSet = FactionPresetId | "SHEET";
/** The country whose emblem the Stamp picks first. jap_walk.png is a Japanese soldier. */
const SHEET_FACTION: FactionPresetId = "JAP";
const UNDO_LIMIT = 100;
const GENERATE_URL = "/__dev/generate-part";
const CANDIDATE_ID = "candidate";

function isColourSet(value: string): value is ColourSet {
  return value === "SHEET" || (FACTIONS as readonly string[]).includes(value);
}

/** A part that came back from Retro Diffusion and has not been kept yet. */
interface Candidate {
  key: number;
  layer: PartCategory;
  name: string;
  seed: number;
  drawings: number[][];
  cost: number;
  path: string;
}

interface Quote {
  /** Dollars for one picture. */
  each: number;
  seconds: number | null;
}

const GEN_HELP: Record<PartCategory, (room: number, each: boolean) => string> = {
  legs: () =>
    "Every pose is sent with the weapon taken off. Only the legs' outline is open to repainting, so the new legs have the same shape on every pose.",
  torso: () =>
    "Every pose is sent with the weapon taken off. Only the torso's outline is open to repainting, so the new torso has the same shape on every pose.",
  head: (room, each) =>
    `${each ? "Every pose" : "This pose"} is sent with the weapon taken off. The head and ${room} pixels of empty space around it are open to repainting. The body is not.`,
  weapon: (room, each) =>
    `The weapon is sent on its own${each ? ", once for every pose" : ""}. The weapon and ${room} pixels around it are open to repainting.`,
};

type Tool = "layer" | "sprite" | "pipette" | "fill" | "eraser" | "erasefill" | "feet" | "muzzle" | "stamp" | "box" | "lasso" | "drag";

/** A light wash so each layer reads apart while the sprite's own colours stay recognisable. */
const LAYER_WASH: Record<PartCategory, { rgb: readonly [number, number, number]; tint: string }> = {
  legs: { rgb: [70, 130, 210], tint: "blue" },
  torso: { rgb: [70, 160, 90], tint: "green" },
  head: { rgb: [210, 180, 60], tint: "gold" },
  weapon: { rgb: [200, 70, 60], tint: "red" },
};

function washRgb(hex: string, tint: readonly [number, number, number]): [number, number, number] {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const mix = 0.34;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return [
    Math.round(red * (1 - mix) + tint[0] * mix),
    Math.round(green * (1 - mix) + tint[1] * mix),
    Math.round(blue * (1 - mix) + tint[2] * mix),
  ];
}

const PENCIL_SIZES = [1, 2, 3, 4, 5] as const;

const TOOLS: readonly { id: Tool; label: string; help: string }[] = [
  {
    id: "layer",
    label: "Layer pencil",
    help: "Move painted pixels onto the picked layer. That square is taken off the other layers. The colour stays. Empty ground is left alone. The size under the tools sets how many pixels it covers. Alt-click picks up the layer and the colour.",
  },
  {
    id: "sprite",
    label: "Sprite pencil",
    help: "Paint the picked colour onto this layer. That square is taken off the other layers. Empty ground gains a pixel, and a pixel already on this layer changes colour. The size under the tools sets how many pixels it covers. Alt-click picks up a colour.",
  },
  {
    id: "pipette",
    label: "Pipette",
    help: "Click a painted pixel to pick its colour. The sprite pencil is then selected.",
  },
  {
    id: "fill",
    label: "Fill",
    help: "Replace every connected square of the same colour on the picked layer's part, and take those squares off the other layers. A fill of empty ground leaves the other layers. Squares join by their edges. One click is one undo step.",
  },
  { id: "eraser", label: "Eraser", help: "Clear the square on every layer's part." },
  {
    id: "erasefill",
    label: "Eraser fill",
    help: "Clear every connected square of the same colour on the picked layer's part. Squares join by their edges. Other layers stay. One click is one undo step.",
  },
  {
    id: "feet",
    label: "Feet",
    help: "Click where the boots stand. The game puts this point on the ground line. It is the same for every frame.",
  },
  {
    id: "muzzle",
    label: "Muzzle",
    help: "Click the end of a barrel on this frame. Click that pixel again to take the muzzle off. Each gun can have its own. On a soldier, a frame with none uses the tip of the weapon.",
  },
  {
    id: "stamp",
    label: "Stamp",
    help: "Put an emblem or a marking on the picked layer's part, centred on the click. Squares the emblem covers are taken off the other layers. The faint picture follows the pointer. One click is one undo step.",
  },
  {
    id: "box",
    label: "Box",
    help: "Drag a rectangle around pixels. Empty ground is left out. Then send what shows inside it onto a layer.",
  },
  {
    id: "lasso",
    label: "Lasso",
    help: "Draw around a part a box does not fit. Empty ground is left out. The shape closes when you let go. Then send what shows inside it onto a layer.",
  },
  {
    id: "drag",
    label: "Drag layer",
    help: "Drag the picked layer on this frame. The drawing stays put, so the other frames keep it where it was. Arrow keys do the same one pixel at a time.",
  },
];

/** The file's JSON, or null when it is missing. The dev server answers a missing file with the page itself. */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  return response.json().catch(() => null);
}

async function walkSheetClips(): Promise<FrameClips> {
  const image = await loadImage(WALK_SHEET_URL);
  return clipsFromWalkSheet(imageRgba(image), image.naturalWidth, image.naturalHeight, UNIT_ID);
}

/** The frames saved before parts existed. They are read, never written. */
async function savedFrames(): Promise<FrameClips | null> {
  const json = await fetchJson(`${FRAMES_URL}/clips.json`);
  if (json === null) {
    return null;
  }
  const file = readClipsFile(json);
  const clips = { idle: [], walk: [], fire: [], damaged: [] } as Record<ClipKey, SpriteFrame[]>;
  for (const key of CLIP_KEYS) {
    for (const name of file.clips[key]) {
      clips[key].push(fromFrameFile(await fetchJson(`${FRAMES_URL}/${name}.json`)));
    }
  }
  return { unitId: file.unitId, width: file.width, height: file.height, feet: file.feet, clips };
}

async function savedRigAt(id: string): Promise<PartRig | null> {
  const base = `/assets/units/rigs/${id}`;
  const json = await fetchJson(`${base}/rig.json`);
  if (!json || typeof json !== "object") {
    return null;
  }
  const listed = (json as { parts?: { id?: unknown }[] }).parts;
  if (!Array.isArray(listed)) {
    return null;
  }
  const parts: unknown[] = [];
  for (const part of listed) {
    const file = await fetchJson(`${base}/part_${String(part.id)}.json`);
    if (file === null) {
      return null;
    }
    parts.push(file);
  }
  try {
    return assembleRig(json, parts);
  } catch {
    return null;
  }
}

async function savedRig(): Promise<PartRig | null> {
  return savedRigAt(UNIT_ID);
}

/** The stamps placed on this picture. Missing and unreadable files count as none. */
async function stampsForPicture(picture: string): Promise<StampPlacement[]> {
  const polished = polishedPngFor(picture);
  if (!polished) {
    return [];
  }
  const response = await fetch(`/__dev/unit-stamps?path=${encodeURIComponent(polished)}`).catch(() => null);
  if (!response?.ok) {
    return [];
  }
  const json = (await response.json().catch(() => null)) as { file?: unknown } | null;
  if (!json?.file) {
    return [];
  }
  try {
    return readStampSidecar(json.file).stamps;
  } catch {
    return [];
  }
}

function cellsRgba(cells: readonly number[], lut: readonly string[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cells.length * 4);
  cells.forEach((slot, index) => {
    const hex = lut[slot];
    if (slot === 0 || !hex) {
      return;
    }
    const rgb = Number.parseInt(hex.slice(1, 7), 16);
    out.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], index * 4);
  });
  return out;
}

/** A part's strip in the sheet's own colours, so the picture opens again as the same part. */
function partStripRgba(rig: PartRig, part: RigPart): { rgba: Uint8ClampedArray; width: number; height: number } {
  const strip = partStrip(rig, part);
  return { rgba: cellsRgba(strip.cells, AS_DRAWN_LUT), width: strip.width, height: strip.height };
}

function withClip(rig: PartRig, clip: ClipKey, frames: RigFrame[]): PartRig {
  return { ...rig, clips: { ...rig.clips, [clip]: frames } };
}

function editorLayerLabel(unitId: string, layer: PartCategory): string {
  return editorSchemeForRig(unitId).layers.find((item) => item.id === layer)?.label ?? LAYER_NAME[layer];
}

function movementText(frame: RigFrame, labelFor: (layer: PartCategory) => string): string {
  const moved = LAYER_ORDER.filter((layer) => frame.move[layer].x !== 0 || frame.move[layer].y !== 0);
  if (moved.length === 0) {
    return "No movement on this frame.";
  }
  const signed = (value: number) => (value < 0 ? `−${-value}` : String(value));
  return `Movement on this frame: ${moved.map((layer) => `${labelFor(layer)} ${signed(frame.move[layer].x)}, ${signed(frame.move[layer].y)}`).join(" · ")}.`;
}

function editorZoomBox(host: HTMLElement | null): { width: number; height: number } {
  const measured = host?.clientWidth ?? 0;
  return {
    width: measured > 80 ? measured - 8 : 720,
    height: Math.max(200, Math.min(520, window.innerHeight - 280)),
  };
}

function FrameThumb({ frame, lut }: { frame: SpriteFrame; lut: readonly string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => putRgba(ref.current, frameRgba(frame, lut), frame.width, frame.height), [frame, lut]);
  return <canvas ref={ref} width={frame.width} height={frame.height} />;
}

/** The rig wearing drawings that are not in the library, to show them before they are kept. */
function tryOn(rig: PartRig, layer: PartCategory, drawings: number[][]): PartRig {
  return {
    ...rig,
    parts: [...rig.parts, { id: CANDIDATE_ID, name: CANDIDATE_ID, layer, drawings }],
    wearing: { ...rig.wearing, [layer]: CANDIDATE_ID },
  };
}

function rigIdFor(pick: ShelfUnit): string {
  const raw = `${pick.factionId}_${pick.unitTypeId}_seed${pick.seed ?? 1}`.toLowerCase();
  const id = raw.replace(/[^a-z0-9_-]/g, "");
  return id || "loaded_sprite";
}

export function FrameEditor({ shelfPick = null }: { shelfPick?: ShelfUnit | null }) {
  const [rig, setRigState] = useState<PartRig | null>(null);
  const [clip, setClip] = useState<ClipKey>("idle");
  const [section, setSection] = useState("idle");
  const [index, setIndex] = useState(0);
  const [layer, setLayer] = useState<PartCategory>("torso");
  const [sheetOn, setSheetOn] = useState<PartCategory[]>([...LAYER_ORDER]);
  const [tool, setTool] = useState<Tool>("sprite");
  const [pencilSize, setPencilSize] = useState(1);
  const [slot, setSlot] = useState(2);
  const [faction, setFaction] = useState<ColourSet>("SHEET");
  const [zoom, setZoom] = useState<number>(8);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [emblemId, setEmblemId] = useState<EmblemId>(() => emblemForFaction(SHEET_FACTION)?.id ?? "jap_hinomaru");
  const [emblemSize, setEmblemSize] = useState(0);
  const [emblemFlip, setEmblemFlip] = useState(false);
  const [emblemTurn, setEmblemTurn] = useState(false);
  const [onlySprite, setOnlySprite] = useState(true);
  const [selection, setSelection] = useState<CellMask | null>(null);
  const [heal, setHeal] = useState(true);
  const [bob, setBob] = useState(1);
  const [recoil, setRecoil] = useState(2);
  const [stride, setStride] = useState(1);
  const [along, setAlong] = useState<"x" | "y">("x");
  const [steelTool, setSteelTool] = useState<SteelTool | null>("soldier");
  const [grain, setGrain] = useState<GrainOverride>("auto");
  const [dropping, setDropping] = useState(false);
  const [dimOthers, setDimOthers] = useState(false);
  const [pixelGrid, setPixelGrid] = useState(false);
  const [onion, setOnion] = useState(false);
  const [gridGround, setGridGround] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [addFrom, setAddFrom] = useState("walk:0");
  const [partName, setPartName] = useState("");
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [fps, setFps] = useState(6);
  const [note, setNote] = useState("Opening the rig…");
  const [busy, setBusy] = useState(false);
  const [buildName, setBuildName] = useState("");
  const [genPrompt, setGenPrompt] = useState("");
  const [genSeed, setGenSeed] = useState(1);
  const [genRoom, setGenRoom] = useState(2);
  const [genEach, setGenEach] = useState(false);
  const [genBusy, setGenBusy] = useState<"" | "price" | "paint">("");
  const [genNote, setGenNote] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const candidateKeyRef = useRef(0);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<PartRig | null>(null);
  const undoRef = useRef<PartRig[]>([]);
  const strokeRef = useRef(false);
  const strokeSavedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stampRef = useRef<HTMLCanvasElement>(null);
  const selectRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragLayerRef = useRef<{ x: number; y: number; mx: number; my: number } | null>(null);
  const lassoPoints = useRef<{ x: number; y: number }[]>([]);
  const rigFileRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLCanvasElement>(null);
  const layerFileRef = useRef<HTMLInputElement>(null);
  const partFileRef = useRef<HTMLInputElement>(null);
  const lut = faction === "SHEET" ? AS_DRAWN_LUT : FACTION_LUTS[faction];
  const swatches = useMemo(
    () => SLOT_LABELS.map((label, value) => ({ key: value, label, hex: lut[value] ?? "#000000" })).slice(1),
    [lut],
  );
  const vehicleClips = rig ? isVehicleUnitType(unitTypeFromRigId(rig.unitId)) && isVehicleClipSet(rig.clips) : false;
  const titleFor = (key: ClipKey) => clipTitle(key, vehicleClips);
  const sections = useMemo(() => {
    if (!rig) {
      return [];
    }
    const indexes = (key: ClipKey, pred: (frame: RigFrame) => boolean) =>
      rig.clips[key].flatMap((frame, at) => (pred(frame) ? [at] : []));
    const list: { id: string; clip: ClipKey; label: string; at: number[] }[] = [
      { id: "idle", clip: "idle", label: "Idle", at: indexes("idle", (frame) => frame.name !== "Idle 2") },
    ];
    const idle2 = indexes("idle", (frame) => frame.name === "Idle 2");
    if (idle2.length > 0) {
      list.push({ id: "idle2", clip: "idle", label: "Idle 2", at: idle2 });
    }
    list.push(
      { id: "walk", clip: "walk", label: titleFor("walk"), at: indexes("walk", () => true) },
      { id: "fire", clip: "fire", label: "Firing", at: indexes("fire", () => true) },
    );
    const damage1 = indexes("damaged", (frame) => frame.name === "Damage 1");
    const damage2 = indexes("damaged", (frame) => frame.name === "Damage 2");
    const otherDamage = indexes("damaged", (frame) => frame.name !== "Damage 1" && frame.name !== "Damage 2");
    if (damage1.length > 0) {
      list.push({ id: "damage1", clip: "damaged", label: "Damage 1", at: damage1 });
    }
    if (damage2.length > 0) {
      list.push({ id: "damage2", clip: "damaged", label: "Damage 2", at: damage2 });
    }
    if (otherDamage.length > 0) {
      list.push({ id: "damaged", clip: "damaged", label: titleFor("damaged"), at: otherDamage });
    }
    return list;
  }, [rig, vehicleClips]);
  const board = sections.find((item) => item.id === section) ?? sections[0] ?? null;
  const frames = rig?.clips[clip] ?? [];
  const frameIndex = frames.length === 0 ? -1 : Math.min(index, frames.length - 1);
  const frame = frames[frameIndex] ?? null;
  const shown = useMemo(() => (rig ? rig.clips[clip].map((item) => resolveFrame(rig, item)) : []), [rig, clip]);
  const shownFrame = shown[frameIndex] ?? null;
  const worn = rig ? wornPart(rig, layer) : null;
  const outlined = layer === "legs" || layer === "torso";
  const genSpread: GenSpread = outlined || genEach ? "each" : "one";
  const posePicked = frame?.pose ?? -1;
  const genPlan = useMemo((): { plan: GenPlan | null; error: string } => {
    if (!rig || posePicked < 0) {
      return { plan: null, error: "Pick a frame first." };
    }
    try {
      return { plan: planGeneration(rig, { layer, spread: genSpread, pose: posePicked, room: genRoom }), error: "" };
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [rig, posePicked, layer, genSpread, genRoom]);
  /** Every part of the picked layer, as the soldier looks wearing it on this frame. */
  const shelf = useMemo(
    () => (rig && frame ? partsOf(rig, layer).map((part) => ({ part, pixels: resolveFrame(wearPart(rig, layer, part.id), frame) })) : []),
    [rig, layer, frame],
  );
  const tried = useMemo(
    () =>
      candidates.map((candidate) => ({
        candidate,
        pixels: rig && frame ? resolveFrame(tryOn(rig, candidate.layer, candidate.drawings), frame) : null,
      })),
    [candidates, rig, frame],
  );

  const emblem = emblemById(emblemId) ?? EMBLEMS[0] ?? null;
  const activeSize = emblem?.sizes.some((item) => item.size === emblemSize) ? emblemSize : (emblem?.sizes[0]?.size ?? 0);
  const stampBitmap = useMemo(
    () => (emblem ? emblemBitmap(emblem, activeSize, emblemFlip, emblemTurn) : null),
    [emblem, activeSize, emblemFlip, emblemTurn],
  );

  const setRig = useCallback((next: PartRig) => {
    rigRef.current = next;
    setRigState(next);
  }, []);

  // A new unit starts with every visible layer ticked for the purple sheet.
  const sheetUnitId = rig?.unitId ?? "";
  useEffect(() => {
    setSheetOn(editorSchemeForRig(sheetUnitId).layers.map((item) => item.id));
  }, [sheetUnitId]);

  // A frame of another size opens at a step that shows all of it.
  const rigWidth = rig?.width ?? 0;
  const rigHeight = rig?.height ?? 0;
  useEffect(() => {
    if (rigWidth > 0 && rigHeight > 0) {
      setZoom(viewFrameZoom(rigWidth, rigHeight, editorZoomBox(canvasHostRef.current)));
    }
  }, [rigWidth, rigHeight]);

  // The stamp follows the colour set's country. A country with no emblem keeps the last pick.
  useEffect(() => {
    const own = emblemForFaction(faction === "SHEET" ? SHEET_FACTION : faction);
    if (own) {
      setEmblemId(own.id);
    }
  }, [faction]);

  // The hover preview: exactly the cells a click would write, so a clipped stamp shows clipped.
  useEffect(() => {
    const canvas = stampRef.current;
    if (!canvas || !rig) {
      return;
    }
    const cells = tool === "stamp" && cursor && frame && stampBitmap ? frameStampCells(rig, frame, layer, stampBitmap, cursor.x, cursor.y, onlySprite, frameSlotsFor(emblemId)) : [];
    putRgba(canvas, stampPreviewRgba(cells, rig.width, rig.height, lut), rig.width, rig.height);
  }, [tool, cursor, frame, stampBitmap, rig, layer, onlySprite, lut, emblemId]);

  useEffect(() => {
    const canvas = selectRef.current;
    if (!canvas || !rig) {
      return;
    }
    const rgba = new Uint8ClampedArray(rig.width * rig.height * 4);
    if (selection && selection.width === rig.width && selection.height === rig.height) {
      for (let index = 0; index < selection.cells.length; index += 1) {
        if (selection.cells[index] === 0) {
          continue;
        }
        const offset = index * 4;
        rgba[offset] = 221;
        rgba[offset + 1] = 207;
        rgba[offset + 2] = 153;
        rgba[offset + 3] = 56;
      }
    }
    putRgba(canvas, rgba, rig.width, rig.height);
  }, [selection, rig]);

  const remember = useCallback(() => {
    const current = rigRef.current;
    if (current) {
      undoRef.current = [...undoRef.current.slice(-(UNDO_LIMIT - 1)), current];
    }
  }, []);

  const commit = useCallback(
    (next: PartRig) => {
      if (next !== rigRef.current) {
        remember();
        setRig(next);
      }
    },
    [remember, setRig],
  );

  const undo = useCallback(() => {
    const previous = undoRef.current.pop();
    if (previous) {
      setRig(previous);
      setNote("Undone.");
    }
  }, [setRig]);

  /** Change the rig, with the frame on the canvas to hand. */
  const edit = useCallback(
    (change: (current: PartRig, target: RigFrame) => PartRig) => {
      const current = rigRef.current;
      const target = current?.clips[clip][frameIndex];
      if (!current || !target) {
        return;
      }
      try {
        commit(change(current, target));
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      }
    },
    [clip, commit, frameIndex],
  );

  const editFrame = useCallback(
    (change: (target: RigFrame) => RigFrame) => edit((current, target) => withRigFrame(current, clip, frameIndex, change(target))),
    [clip, edit, frameIndex],
  );

  const openRig = useCallback(
    (next: PartRig, tool: SteelTool | null, message: string) => {
      undoRef.current = [];
      setRig(next);
      setClip("idle");
      setSection("idle");
      setIndex(0);
      setPlaying(false);
      setSelection(null);
      setLayer(editorSchemeForRig(next.unitId).picture);
      setFaction("SHEET");
      setSteelTool(tool);
      setAlong(tool === "propeller" ? "y" : "x");
      setZoom(viewFrameZoom(next.width, next.height, editorZoomBox(canvasHostRef.current)));
      setNote(message);
    },
    [setRig],
  );

  const startFresh = useCallback(async () => {
    const fresh = rigFromClips(await walkSheetClips());
    openRig(fresh, "soldier", "Split jap_walk.png into eight poses. The fourth sheet frame leads the walk, and Idle is that pose.");
  }, [openRig]);

  const loadShelf = useCallback(async () => {
    if (!shelfPick) {
      setNote("Pick a unit on the shelf first.");
      return;
    }
    if (shelfPick.kind === "clips") {
      if (shelfPick.key.endsWith("/jap_infantry_v2")) {
        const savedV2 = await savedRigAt("jap_infantry_v2");
        if (savedV2) {
          if (!window.confirm("Load Japanese walk v2? It replaces what is open. Ctrl+Z does not bring the open sprite back.")) {
            return;
          }
          openRig(savedV2, "soldier", "Opened Japanese walk v2 with the layers saved on it.");
          return;
        }
      }
      if (!window.confirm("Load the Japanese walk? It replaces what is open. Ctrl+Z does not bring the open sprite back.")) {
        return;
      }
      await startFresh();
      return;
    }
    if (!shelfPick.picture) {
      setNote(`${shelfPick.label} has no pixel picture to open.`);
      return;
    }
    const id = rigIdFor(shelfPick);
    const vehicle = isVehicleUnitType(shelfPick.unitTypeId);
    const scheme = editorSchemeForUnitType(shelfPick.unitTypeId);
    const body = scheme.layers.find((item) => item.id === scheme.picture)?.label.toLowerCase() ?? "torso";
    const saved = await savedRigAt(id);
    if (saved) {
      if (!window.confirm(`Load ${shelfPick.label}? It opens the layers saved on this sprite. Ctrl+Z does not bring the open sprite back.`)) {
        return;
      }
      const baked = paintCoveringStamps(saved, await stampsForPicture(shelfPick.picture), scheme.picture);
      const marks = baked === saved ? "" : " Stamps are on the layer they cover.";
      openRig(baked, steelToolFor(shelfPick.unitTypeId), `Opened ${shelfPick.label} with the layers saved on it.${marks}`);
      return;
    }
    const agreed = window.confirm(
      `Load ${shelfPick.label}? The whole picture goes on the ${body}, at its own size. Save layers writes public/assets/units/rigs/${id} and leaves the Japanese walk where it is. The editor has 13 colours, so a few of the picture's colours share a slot. Ctrl+Z does not bring the open sprite back.${vehicle ? " Idle, Moving, Firing, and Damaged start as copies of this picture: 4, 8, 2, and 2." : ""}`,
    );
    if (!agreed) {
      return;
    }
    try {
      const response = await fetch(`/__dev/bake-file?path=${encodeURIComponent(shelfPick.picture)}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Could not open ${shelfPick.picture}.`);
      }
      const url = URL.createObjectURL(await response.blob());
      try {
        const image = await loadImage(url);
        let rgba = imageRgba(image);
        let width = image.naturalWidth;
        let height = image.naturalHeight;
        const block = resolveGrainBlock(detectPixelBlockSize(rgba, width, height), grain);
        if (block > 1) {
          const native = deupscaleToNativeArtPixels(rgba, width, height, block);
          rgba = native.rgba;
          width = native.width;
          height = native.height;
        }
        const seated = renameEmptyParts(seatPicture(rigFromPicture(id, rgba, width, height), scheme.picture), (layer) =>
          scheme.layers.find((item) => item.id === layer)?.label ?? null,
        );
        const prepared = scheme.muzzle === "weapon" ? seated : { ...seated, muzzleLayer: scheme.muzzle };
        const next = paintCoveringStamps(vehicle ? withVehicleClips(prepared) : prepared, await stampsForPicture(shelfPick.picture), scheme.picture);
        const tool = steelToolFor(shelfPick.unitTypeId);
        const steel =
          tool === "tread"
            ? " Steel links are on, and they step along the tread."
            : tool === "propeller"
              ? " Steel is on, and it steps toward the wingtip."
              : tool === "soldier"
                ? " Steel links are on."
                : " This kind of unit has no steel links.";
        const copies = vehicle
          ? " Idle has 4 frames, Moving has 8, Firing has 2, and Damaged has 2. Each frame is this picture."
          : "";
        const resting = scheme.layers.filter((item) => item.id !== scheme.picture).map((item) => item.label.toLowerCase());
        const listed =
          shelfPick.unitTypeId === "infantry"
            ? "Legs, head, and weapon are empty."
            : resting.length === 1
              ? `${resting[0]} is empty.`
              : `${resting.slice(0, -1).join(", ")} and ${resting[resting.length - 1]} are empty.`;
        const empty = listed.charAt(0).toUpperCase() + listed.slice(1);
        openRig(
          next,
          tool,
          `Opened ${shelfPick.label} at ${width}×${height}. The whole picture is on the ${body}. ${empty}${steel}${copies} Save layers writes public/assets/units/rigs/${id}.`,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  }, [grain, openRig, shelfPick, startFresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await savedRig();
        if (cancelled) {
          return;
        }
        if (saved) {
          setRig(saved);
          // The rig file holds the parts being worn. When they are a saved build, open in that build's colours.
          const build = saved.builds.find((item) => LAYER_ORDER.every((name) => item.wearing[name] === saved.wearing[name]));
          if (build && isColourSet(build.colours)) {
            setFaction(build.colours);
          }
          setNote(`Opened the saved rig from public${RIG_URL}${build ? `, wearing the build “${build.name}”` : ""}.`);
          return;
        }
        const old = await savedFrames();
        if (cancelled) {
          return;
        }
        if (old) {
          const built = rigFromClips(old);
          setRig(built);
          setNote(
            `Built the rig from your saved frames: ${built.poses} poses, with one part for each layer. Save writes it to public${RIG_URL}. The frames folder is left as it is.`,
          );
          return;
        }
        await startFresh();
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setRig, startFresh]);

  useEffect(() => {
    if (!playing || frames.length < 2) {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [playing, fps, frames.length]);

  const sectionShown = board ? board.at.map((at) => shown[at]).filter((item): item is NonNullable<typeof item> => item !== undefined) : shown;
  const cardFrame = playing && sectionShown.length > 0 ? sectionShown[tick % sectionShown.length] : shownFrame;

  useEffect(() => {
    if (!rig || !cardFrame) {
      putRgba(cardRef.current, new Uint8ClampedArray(SPRITE_BAKE.width * SPRITE_BAKE.height * 4), SPRITE_BAKE.width, SPRITE_BAKE.height);
      return;
    }
    putRgba(cardRef.current, cardRgba(cardFrame, lut, rig.feet), SPRITE_BAKE.width, SPRITE_BAKE.height);
  }, [cardFrame, rig, lut]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !rig) {
      return;
    }
    const width = rig.width;
    const height = rig.height;
    const scale = zoom < 1 ? 1 : zoom;
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    ctx.imageSmoothingEnabled = false;
    if (gridGround) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          ctx.fillStyle = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? "#3a332e" : "#2f2925";
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    } else {
      ctx.fillStyle = "#ff00ff";
      ctx.fillRect(0, 0, width * scale, height * scale);
    }
    if (!frame || !shownFrame) {
      return;
    }
    if (tool === "layer") {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let owner: PartCategory | null = null;
          let slotIndex = 0;
          for (let index = LAYER_ORDER.length - 1; index >= 0; index -= 1) {
            const name = LAYER_ORDER[index] ?? "legs";
            const value = shownFrame.layers[name][y * width + x] ?? 0;
            if (value !== 0) {
              owner = name;
              slotIndex = value;
              break;
            }
          }
          const hex = owner ? lut[slotIndex] : undefined;
          if (!owner || !hex) {
            continue;
          }
          const [red, green, blue] = washRgb(hex, LAYER_WASH[owner].rgb);
          ctx.globalAlpha = dimOthers && owner !== layer ? 0.28 : 1;
          ctx.fillStyle = `rgb(${red},${green},${blue})`;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
      ctx.globalAlpha = 1;
    } else {
      const only: SpriteFrame = dimOthers
        ? { ...shownFrame, layers: { legs: [], torso: [], head: [], weapon: [], [layer]: shownFrame.layers[layer] } }
        : shownFrame;
      const ghost = dimOthers ? frameRgba(shownFrame, lut) : null;
      const rgba = frameRgba(only, lut);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4;
          const source = (rgba[offset + 3] ?? 0) > 0 ? rgba : ghost && (ghost[offset + 3] ?? 0) > 0 ? ghost : null;
          if (!source) {
            continue;
          }
          ctx.globalAlpha = source === rgba ? 1 : 0.3;
          ctx.fillStyle = `rgb(${source[offset]},${source[offset + 1]},${source[offset + 2]})`;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (onion && shown.length > 1 && frameIndex >= 0) {
      const current = frameRgba(shownFrame, lut);
      const paintGhost = (sprite: SpriteFrame, alpha: number) => {
        const rgba = frameRgba(sprite, lut);
        ctx.globalAlpha = alpha;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4;
            if ((rgba[offset + 3] ?? 0) === 0) {
              continue;
            }
            const same =
              (current[offset + 3] ?? 0) > 0 &&
              current[offset] === rgba[offset] &&
              current[offset + 1] === rgba[offset + 1] &&
              current[offset + 2] === rgba[offset + 2];
            if (same) {
              continue;
            }
            ctx.fillStyle = `rgb(${rgba[offset]},${rgba[offset + 1]},${rgba[offset + 2]})`;
            ctx.fillRect(x * scale, y * scale, scale, scale);
          }
        }
      };
      const count = shown.length;
      const previous = (frameIndex - 1 + count) % count;
      const following = (frameIndex + 1) % count;
      const behind = shown[previous];
      if (behind) {
        paintGhost(behind, 0.55);
      }
      const ahead = shown[following];
      if (ahead && following !== previous) {
        paintGhost(ahead, 0.4);
      }
      ctx.globalAlpha = 1;
    }
    if (pixelGrid && scale >= 2) {
      const minor = gridGround ? "rgba(28, 25, 23, 0.28)" : "rgba(60, 0, 60, 0.32)";
      const major = gridGround ? "rgba(12, 10, 9, 0.9)" : "rgba(40, 0, 40, 0.92)";
      const strokeLines = (style: string, every: number) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 1) {
          if (x % 4 !== 0 && every === 4) {
            continue;
          }
          if (x % 4 === 0 && every === 1) {
            continue;
          }
          ctx.moveTo(x * scale + 0.5, 0);
          ctx.lineTo(x * scale + 0.5, height * scale);
        }
        for (let y = 0; y <= height; y += 1) {
          if (y % 4 !== 0 && every === 4) {
            continue;
          }
          if (y % 4 === 0 && every === 1) {
            continue;
          }
          ctx.moveTo(0, y * scale + 0.5);
          ctx.lineTo(width * scale, y * scale + 0.5);
        }
        ctx.stroke();
      };
      strokeLines(minor, 1);
      strokeLines(major, 4);
    }
    const outline = showOutline && (layer === "legs" || layer === "torso") ? rig.outlines[layer][frame.pose] : undefined;
    if (outline) {
      const placed = shiftCells(outline, width, height, frame.move[layer].x, frame.move[layer].y);
      const painted = shownFrame.layers[layer];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const inside = placed[y * width + x] === 1;
          const filled = (painted[y * width + x] ?? 0) !== 0;
          if (inside && !filled) {
            ctx.fillStyle = "rgba(221, 207, 153, 0.45)";
            ctx.fillRect(x * scale, y * scale, scale, scale);
          } else if (!inside && filled) {
            ctx.strokeStyle = MILITARY.crimson;
            ctx.lineWidth = 2;
            ctx.strokeRect(x * scale + 1, y * scale + 1, Math.max(1, scale - 2), Math.max(1, scale - 2));
          }
        }
      }
    }
    const cross = (x: number, y: number, colour: string) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      const mark = Math.max(1, scale - 2);
      ctx.strokeRect(x * scale + 1, y * scale + 1, mark, mark);
      ctx.beginPath();
      ctx.moveTo((x - 1) * scale, (y + 0.5) * scale);
      ctx.lineTo((x + 2) * scale, (y + 0.5) * scale);
      ctx.moveTo((x + 0.5) * scale, (y - 1) * scale);
      ctx.lineTo((x + 0.5) * scale, (y + 2) * scale);
      ctx.stroke();
    };
    cross(rig.feet.x, rig.feet.y, MILITARY.cream);
    if (frame) {
      for (const muzzle of frameMuzzles(rig, frame)) {
        cross(muzzle.x, muzzle.y, MILITARY.crimson);
      }
      if (frame.smoke) {
        const exhaustX = frame.smoke.x + frame.move.torso.x;
        const exhaustY = frame.smoke.y + frame.move.torso.y;
        ctx.fillStyle = MILITARY.feldgrau;
        ctx.fillRect(exhaustX * scale, exhaustY * scale, Math.max(1, scale), Math.max(1, scale));
      }
    }
  }, [rig, dimOthers, frame, frameIndex, shown, shownFrame, layer, lut, showOutline, zoom, gridGround, pixelGrid, onion, tool]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === "[" || event.key === "]") {
        const order = editorSchemeForRig(rig?.unitId ?? "jap_infantry").layers.map((item) => item.id);
        const step = event.key === "]" ? 1 : order.length - 1;
        setLayer((current) => {
          const at = order.indexOf(current);
          return order[(at < 0 ? 0 : at + step) % order.length] ?? current;
        });
        return;
      }
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const move = moves[event.key];
      if (!move) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        edit((current, target) => slideDrawing(current, layer, target.pose, move[0], move[1]));
      } else {
        editFrame((target) => moveLayer(target, layer, move[0], move[1]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit, editFrame, layer, rig?.unitId, undo]);

  const cellAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = rigRef.current?.width ?? 1;
    const height = rigRef.current?.height ?? 1;
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: -1, y: -1 };
    }
    return {
      x: Math.floor(((event.clientX - rect.left) / rect.width) * width),
      y: Math.floor(((event.clientY - rect.top) / rect.height) * height),
    };
  };

  const applyTool = (x: number, y: number, first: boolean, alt: boolean) => {
    const current = rigRef.current;
    const target = current?.clips[clip][frameIndex];
    if (!current || !target || x < 0 || y < 0 || x >= current.width || y >= current.height) {
      return;
    }
    if (alt) {
      const pixels = resolveFrame(current, target);
      for (const name of [...LAYER_ORDER].reverse()) {
        const found = pixels.layers[name][y * current.width + x] ?? 0;
        if (found !== 0) {
          setSlot(found);
          setLayer(name);
          setNote(`Picked ${SLOT_LABELS[found]} on the ${editorLayerLabel(rigRef.current?.unitId ?? "", name)} layer.`);
          return;
        }
      }
      return;
    }
    if (tool === "pipette" && first) {
      const pixels = resolveFrame(current, target);
      for (const name of [...LAYER_ORDER].reverse()) {
        const found = pixels.layers[name][y * current.width + x] ?? 0;
        if (found !== 0) {
          setSlot(found);
          setTool("sprite");
          setNote(`Picked ${SLOT_LABELS[found]}. Sprite pencil is ready.`);
          return;
        }
      }
      setNote("No painted pixel there.");
      return;
    }
    let next = current;
    if (tool === "sprite") {
      next = paintBrush(current, target, layer, x, y, slot, pencilSize);
    } else if (tool === "layer") {
      next = claimBrush(current, target, layer, x, y, pencilSize, heal);
    } else if (tool === "fill" && first) {
      const partX = x - target.move[layer].x;
      const partY = y - target.move[layer].y;
      const onPart = partX >= 0 && partY >= 0 && partX < current.width && partY < current.height;
      next = onPart ? fillPart(current, target, layer, x, y, slot) : current;
      if (onPart) {
        setNote(
          next === current
            ? `That square is already ${SLOT_LABELS[slot]}.`
            : `Filled the connected squares on “${wornPart(current, layer).name}”, pose ${target.pose}. Ctrl+Z takes it back.`,
        );
      }
    } else if (tool === "erasefill" && first) {
      const partX = x - target.move[layer].x;
      const partY = y - target.move[layer].y;
      const onPart = partX >= 0 && partY >= 0 && partX < current.width && partY < current.height;
      next = onPart ? fillPart(current, target, layer, x, y, 0) : current;
      if (onPart) {
        setNote(
          next === current
            ? "Nothing to erase there."
            : `Erased the connected squares on “${wornPart(current, layer).name}”, pose ${target.pose}. Ctrl+Z puts them back.`,
        );
      }
    } else if (tool === "eraser") {
      next = erasePart(current, target, x, y);
    } else if (tool === "feet" && first) {
      next = current.feet.x === x && current.feet.y === y ? current : { ...current, feet: { x, y } };
    } else if (tool === "muzzle" && first) {
      const muzzleLayer = current.muzzleLayer ?? editorSchemeForRig(current.unitId).muzzle;
      const before = muzzlePoints(target).length;
      next = withRigFrame(current, clip, frameIndex, toggleMuzzle(target, muzzleLayer, x, y));
      const after = next.clips[clip][frameIndex];
      const count = after ? muzzlePoints(after).length : 0;
      setNote(
        count < before
          ? `Took the muzzle off ${x}, ${y}. ${count} left on this frame.`
          : `Muzzle at ${x}, ${y}. ${count} on this frame. Click a muzzle again to take it off.`,
      );
    } else if (tool === "stamp" && first && stampBitmap) {
      next = stampFramePart(current, target, layer, stampBitmap, x, y, onlySprite, frameSlotsFor(emblemId));
      setNote(
        next === current
          ? onlySprite
            ? "Nothing to stamp there: the soldier has no pixel under the emblem. Turn off Only on the sprite to stamp on empty canvas."
            : "The emblem is off the frame."
          : `${emblem?.name ?? "Emblem"} stamped at ${x}, ${y} on “${wornPart(current, layer).name}”, pose ${target.pose}. Ctrl+Z takes it off.`,
      );
    }
    if (next === current) {
      return;
    }
    if (!strokeSavedRef.current) {
      remember();
      strokeSavedRef.current = true;
    }
    setRig(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
    strokeRef.current = true;
    strokeSavedRef.current = false;
    const point = cellAt(event);
    if (tool === "box" && rig) {
      dragStart.current = point;
      const target = rig.clips[clip][frameIndex];
      const mask = rectMask(rig.width, rig.height, point, point);
      setSelection(target ? paintedSelection(resolveFrame(rig, target), mask) : mask);
      return;
    }
    if (tool === "lasso" && rig) {
      lassoPoints.current = [point];
      const target = rig.clips[clip][frameIndex];
      const mask = polygonMask(rig.width, rig.height, lassoPoints.current);
      setSelection(target ? paintedSelection(resolveFrame(rig, target), mask) : mask);
      return;
    }
    if (tool === "drag") {
      const target = rig?.clips[clip][frameIndex];
      if (target) {
        dragLayerRef.current = { x: point.x, y: point.y, mx: target.move[layer].x, my: target.move[layer].y };
      }
      return;
    }
    applyTool(point.x, point.y, true, event.altKey);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = cellAt(event);
    const inside = rig !== null && point.x >= 0 && point.y >= 0 && point.x < rig.width && point.y < rig.height;
    setCursor((seen) => (!inside ? null : seen && seen.x === point.x && seen.y === point.y ? seen : point));
    if (!strokeRef.current || !rig) {
      return;
    }
    if (tool === "box" && dragStart.current) {
      const target = rig.clips[clip][frameIndex];
      const mask = rectMask(rig.width, rig.height, dragStart.current, point);
      setSelection(target ? paintedSelection(resolveFrame(rig, target), mask) : mask);
      return;
    }
    if (tool === "lasso") {
      const last = lassoPoints.current[lassoPoints.current.length - 1];
      if (!last || last.x !== point.x || last.y !== point.y) {
        lassoPoints.current = [...lassoPoints.current, point];
        const target = rig.clips[clip][frameIndex];
        const mask = polygonMask(rig.width, rig.height, lassoPoints.current);
        setSelection(target ? paintedSelection(resolveFrame(rig, target), mask) : mask);
      }
      return;
    }
    if (tool === "drag" && dragLayerRef.current) {
      const origin = dragLayerRef.current;
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const current = rigRef.current;
      const target = current?.clips[clip][frameIndex];
      if (!current || !target) {
        return;
      }
      const moved = { ...target.move[layer], x: origin.mx + dx, y: origin.my + dy };
      if (target.move[layer].x === moved.x && target.move[layer].y === moved.y) {
        return;
      }
      if (!strokeSavedRef.current) {
        remember();
        strokeSavedRef.current = true;
      }
      setRig(withRigFrame(current, clip, frameIndex, { ...target, move: { ...target.move, [layer]: moved } }));
      return;
    }
    if ((tool !== "sprite" && tool !== "layer" && tool !== "eraser") || event.altKey) {
      return;
    }
    applyTool(point.x, point.y, false, false);
  };

  const endStroke = () => {
    strokeRef.current = false;
    dragLayerRef.current = null;
  };

  const leaveCanvas = () => {
    endStroke();
    setCursor(null);
  };

  const allFrames = useMemo(
    () =>
      rig
        ? CLIP_KEYS.flatMap((key) =>
            rig.clips[key].map((_, at) => ({
              value: `${key}:${at}`,
              label: `${clipTitle(key, vehicleClips)} ${at}`,
            })),
          )
        : [],
    [rig],
  );

  const insertFrame = (made: RigFrame, label: string) => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const list = current.clips[clip].slice();
    const at = frameIndex < 0 ? list.length : frameIndex + 1;
    list.splice(at, 0, made);
    commit(withClip(current, clip, list));
    setIndex(at);
    setPlaying(false);
    setNote(`${label} is ${clipTitle(clip, isVehicleUnitType(unitTypeFromRigId(current.unitId)) && isVehicleClipSet(current.clips))} ${at}.`);
  };

  const addCopy = () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const [key, at] = addFrom.split(":") as [ClipKey, string];
    const source = current.clips[key]?.[Number(at)];
    if (source) {
      insertFrame({ ...source, move: { ...source.move } }, `A copy of ${clipTitle(key, isVehicleUnitType(unitTypeFromRigId(current.unitId)) && isVehicleClipSet(current.clips))} ${at}`);
    }
  };

  const deleteFrame = () => {
    const current = rigRef.current;
    if (!current || frameIndex < 0) {
      return;
    }
    const list = current.clips[clip].filter((_, at) => at !== frameIndex);
    commit(withClip(current, clip, list));
    setIndex(Math.max(0, frameIndex - 1));
    setNote(`Deleted ${clipTitle(clip, isVehicleUnitType(unitTypeFromRigId(current.unitId)) && isVehicleClipSet(current.clips))} ${frameIndex}. Ctrl+Z brings it back.`);
  };

  const moveFrame = (step: number) => {
    const current = rigRef.current;
    const to = frameIndex + step;
    if (!current || frameIndex < 0 || to < 0 || to >= current.clips[clip].length) {
      return;
    }
    const list = current.clips[clip].slice();
    const [moved] = list.splice(frameIndex, 1);
    list.splice(to, 0, moved!);
    commit(withClip(current, clip, list));
    setIndex(to);
  };

  const readPicture = async (file: File, use: (rgba: Uint8ClampedArray, width: number, height: number) => void) => {
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      let rgba = imageRgba(image);
      let width = image.naturalWidth;
      let height = image.naturalHeight;
      const block = resolveGrainBlock(detectPixelBlockSize(rgba, width, height), grain);
      if (block > 1) {
        const native = deupscaleToNativeArtPixels(rgba, width, height, block);
        rgba = native.rgba;
        width = native.width;
        height = native.height;
      }
      use(rgba, width, height);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const openOntoLayer = (file: File) =>
    readPicture(file, (rgba, width, height) => {
      edit((current, target) => placePicture(current, target, layer, rgba, width, height));
      setNote(`Put ${file.name} on this pose of the ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} part. Ctrl+Z takes it off.`);
    });

  const newPartFromPicture = (file: File) =>
    readPicture(file, (rgba, width, height) => {
      const current = rigRef.current;
      if (!current) {
        return;
      }
      try {
        const name = partName.trim() || file.name.replace(/\.png$/i, "");
        const next = partFromPicture(current, layer, name, rgba, width, height);
        commit(next);
        setPartName("");
        setNote(
          width === current.width
            ? `“${wornPart(next, layer).name}” is one drawing, placed on all ${current.poses} poses by the skeleton. Repaint a pose where it needs its own drawing.`
            : `“${wornPart(next, layer).name}” has its own drawing for each of the ${current.poses} poses.`,
        );
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      }
    });

  const paintSteelSelection = (stripes: boolean) => {
    const current = rigRef.current;
    const target = current?.clips[clip][frameIndex];
    if (!current || !target || !selection || maskCount(selection) === 0) {
      setNote("Draw a box or a lasso first.");
      return;
    }
    try {
      const next = paintSteel(current, target, layer, selection, stripes);
      if (next === current) {
        setNote(`No ink on the ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} in the selection.`);
        return;
      }
      commit(next);
      setNote(
        stripes
          ? `Every other column of the ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} in the selection is gun metal. Build animation steps it.`
          : `The ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} ink in the selection is gun metal. Build animation steps it.`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const buildFromPose = () => {
    const current = rigRef.current;
    const target = current?.clips[clip][frameIndex];
    if (!current || !target) {
      return;
    }
    const name = editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase();
    const moving = clipTitle("walk", isVehicleUnitType(unitTypeFromRigId(current.unitId)) && isVehicleClipSet(current.clips));
    if (
      !window.confirm(
        `Replace ${moving} and Firing from this pose? Idle stays. The first walk frame steps the gun metal on the ${name}. Ctrl+Z brings the old clips back.`,
      )
    ) {
      return;
    }
    commit(buildMotion(current, target, { bob, recoil, stride, along, links: layer }));
    setClip("walk");
    setSection("walk");
    setIndex(0);
    setPlaying(false);
    setNote(
      `${moving} is two frames and Firing is the shot. Gun metal on the ${name} steps ${Math.max(1, Math.floor(stride))} pixel${stride === 1 ? "" : "s"} ${along === "x" ? "along the tread" : "toward the wingtip"}.`,
    );
  };

  const sendSelection = () => {
    const current = rigRef.current;
    if (!current || !selection || maskCount(selection) === 0) {
      setNote("Draw a box or a lasso first.");
      return;
    }
    try {
      const source = idleSource(current);
      const sent = sendShownToLayer(current, source, selection, layer, heal);
      if (sent.moved === 0) {
        setNote("What shows in the selection is already on this layer.");
        return;
      }
      commit(feedIdleCopies(current, sent.rig));
      setNote(
        `Moved ${sent.moved} pixel${sent.moved === 1 ? "" : "s"} from Idle 0 onto the ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()}. Every frame that still shows that picture follows. Ctrl+Z puts them back.`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const claimLayer = () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const name = editorLayerLabel(current.unitId, layer).toLowerCase();
    try {
      const source = idleSource(current);
      const sent = claimUnselected(current, source, layer, selection, editorSchemeForRig(current.unitId).picture);
      if (sent.moved === 0) {
        setNote(`Nothing left on the sprite to put on the ${name}.`);
        return;
      }
      commit(feedIdleCopies(current, sent.rig));
      setNote(
        `The ${name} took ${sent.moved} pixel${sent.moved === 1 ? "" : "s"} from Idle 0. Every frame that still shows that picture follows. Ctrl+Z puts them back.`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const fillWithinLayer = () => {
    const current = rigRef.current;
    const target = current?.clips[clip][frameIndex];
    if (!current || !target) {
      return;
    }
    const name = editorLayerLabel(current.unitId, layer).toLowerCase();
    const next = fillLayerInk(current, target, layer, slot);
    if (next === current) {
      setNote(`The ${name} has no pixels to fill.`);
      return;
    }
    commit(next);
    setNote(
      layer === "legs" || layer === "torso"
        ? `Filled the ${name} inside its outline with ${SLOT_LABELS[slot]}.`
        : `Filled every pixel of the ${name} with ${SLOT_LABELS[slot]}.`,
    );
  };

  const downloadRig = () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const blob = new Blob([JSON.stringify(rigBundle(current))], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${current.unitId}.rig.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNote(`Downloaded ${current.unitId}.rig.json. Open rig file reads it back.`);
  };

  const openRigFile = async (file: File) => {
    try {
      const opened = rigFromBundle(JSON.parse(await file.text()));
      undoRef.current = [];
      setRig(opened);
      setIndex(0);
      setSelection(null);
      setNote(`Opened ${file.name}. ${opened.width}×${opened.height}, ${opened.parts.length} parts.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const dropPicture = (file: File | undefined) => {
    if (!file) {
      return;
    }
    if (file.name.toLowerCase().endsWith(".json")) {
      void openRigFile(file);
      return;
    }
    readPicture(file, (rgba, width, height) => {
      const current = rigRef.current;
      if (!current) {
        return;
      }
      if (width === current.width && height === current.height) {
        edit((next, target) => placePicture(next, target, layer, rgba, width, height));
        setNote(`Put ${file.name} on this pose of the ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} part. Ctrl+Z takes it off.`);
        return;
      }
      try {
        const name = partName.trim() || file.name.replace(/\.png$/i, "");
        const next = partFromPicture(current, layer, name, rgba, width, height);
        commit(next);
        setPartName("");
        setNote(
          width === current.width
            ? `“${wornPart(next, layer).name}” is one drawing, placed on all ${current.poses} poses by the skeleton.`
            : `“${wornPart(next, layer).name}” has its own drawing for each of the ${current.poses} poses.`,
        );
      } catch (error) {
        setNote(
          error instanceof Error
            ? error.message
            : `${file.name} is ${width}×${height}. This frame is ${current.width}×${current.height}.`,
        );
      }
    });
  };

  const copyWornPart = () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const next = copyPart(current, layer, partName);
    commit(next);
    setPartName("");
    setNote(
      `“${wornPart(next, layer).name}” is a copy of “${wornPart(current, layer).name}”. It is being worn now, so painting changes the copy.`,
    );
  };

  const renameWornPart = () => {
    const current = rigRef.current;
    if (!current || partName.trim() === "") {
      setNote("Type the new name first.");
      return;
    }
    commit(renamePart(current, wornPart(current, layer).id, partName));
    setPartName("");
  };

  const deleteWornPart = () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    try {
      const gone = wornPart(current, layer);
      const next = removePart(current, gone.id);
      commit(next);
      setNote(
        `Took “${gone.name}” out of the parts. The ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} now wears “${wornPart(next, layer).name}”. Ctrl+Z brings it back.`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const downloadWornPart = async () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const part = wornPart(current, layer);
    const strip = partStripRgba(current, part);
    const url = URL.createObjectURL(await pngBlob(strip.rgba, strip.width, strip.height));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${part.id}.png`;
    link.click();
    URL.revokeObjectURL(url);
    setNote(
      `Downloaded “${part.name}” as a ${strip.width}×${strip.height} strip, one drawing per pose. New part from a picture opens a strip like it.`,
    );
  };

  const putOnBuild = (id: string) => {
    const current = rigRef.current;
    const build = current?.builds.find((item) => item.id === id);
    if (!current || !build) {
      return;
    }
    commit(wearBuild(current, id));
    if (isColourSet(build.colours)) {
      setFaction(build.colours);
    }
    const gaps = buildGaps(current, build).map((name) => editorLayerLabel(rigRef.current?.unitId ?? "", name).toLowerCase());
    setNote(
      gaps.length === 0
        ? `Wearing “${build.name}” in every frame of every clip.`
        : `Wearing “${build.name}”, except the ${gaps.join(" and ")}: that part has been deleted, so the layer keeps what it had.`,
    );
  };

  const saveLayerCopy = () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const name = buildName.trim();
    if (name.length === 0) {
      setNote("Type a name for the copy first.");
      return;
    }
    try {
      const existed = current.builds.some((build) => build.name.toLowerCase() === name.toLowerCase());
      const next = saveBuild(current, name, faction);
      const stored = next.builds.find((build) => build.name.toLowerCase() === name.toLowerCase());
      commit(next);
      setBuildName("");
      const label = stored?.name ?? name;
      void save(
        existed
          ? `Saved over the copy “${label}”. This sprite still has these layers, and loading it again keeps the copy.`
          : `Saved a copy called “${label}”. This sprite still has these layers, and loading it again keeps the copy.`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteBuild = (id: string) => {
    const current = rigRef.current;
    const build = current?.builds.find((item) => item.id === id);
    if (!current || !build) {
      return;
    }
    commit(removeBuild(current, id));
    setNote(`Deleted the copy “${build.name}”. This sprite keeps the layers it has now. Ctrl+Z brings the copy back.`);
  };

  /** Post one picture and its mask to the dev server. A dry run asks the price and spends nothing. */
  const sendSheet = async (plan: GenPlan, sheet: GenSheet, extra: { dryRunOnly: true } | { agreedCost: number }) => {
    const response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unitId: UNIT_ID,
        layer: plan.layer,
        prompt: genPrompt.trim(),
        seed: genSeed,
        inputBase64: await pngBase64(sheet.input, sheet.width, sheet.height),
        maskBase64: await pngBase64(sheet.mask, sheet.width, sheet.height),
        ...extra,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      cost?: number | null;
      seconds?: number | null;
      path?: string;
      mime?: string;
      base64?: string;
    };
    if (!response.ok || json.ok === false) {
      throw new Error(json.error || `The dev server answered ${response.status}.`);
    }
    return json;
  };

  const askPrice = async (plan: GenPlan): Promise<Quote> => {
    const first = plan.sheets[0];
    if (!first) {
      throw new Error("There is nothing to send.");
    }
    const json = await sendSheet(plan, first, { dryRunOnly: true });
    if (typeof json.cost !== "number") {
      throw new Error("Retro Diffusion gave no price.");
    }
    const asked = { each: json.cost, seconds: json.seconds ?? null };
    setQuote(asked);
    return asked;
  };

  const readyToSend = (): GenPlan | null => {
    if (!genPlan.plan) {
      setGenNote(genPlan.error);
      return null;
    }
    if (genPrompt.trim() === "") {
      setGenNote("Say what to draw first.");
      return null;
    }
    if (!Number.isSafeInteger(genSeed) || genSeed < 0) {
      setGenNote("The seed must be a whole number.");
      return null;
    }
    return genPlan.plan;
  };

  const checkPrice = async () => {
    const plan = readyToSend();
    if (!plan) {
      return;
    }
    setGenBusy("price");
    try {
      const asked = await askPrice(plan);
      setGenNote(`Asked the price: ${money(asked.each * plan.sheets.length)} for ${pictures(plan.sheets.length)}. Nothing was spent.`);
    } catch (error) {
      setGenNote(error instanceof Error ? error.message : String(error));
    } finally {
      setGenBusy("");
    }
  };

  const generate = async () => {
    const snapshot = rigRef.current;
    const plan = readyToSend();
    if (!snapshot || !plan) {
      return;
    }
    const kept: string[] = [];
    setGenBusy("price");
    try {
      const asked = await askPrice(plan);
      const total = asked.each * plan.sheets.length;
      const wait = asked.seconds ? ` Each picture takes about ${Math.round(asked.seconds)} seconds.` : "";
      if (!window.confirm(`This spends ${money(total)} of Retro Diffusion credit for ${pictures(plan.sheets.length)}.${wait} Go ahead?`)) {
        setGenNote("Nothing was sent, and nothing was spent.");
        return;
      }
      setGenBusy("paint");
      const back: GenPicture[] = [];
      let cost = 0;
      for (const [at, sheet] of plan.sheets.entries()) {
        setGenNote(`Waiting for picture ${at + 1} of ${plan.sheets.length}. Keep this page open.`);
        const json = await sendSheet(plan, sheet, { agreedCost: asked.each });
        cost += json.cost ?? asked.each;
        if (json.path) {
          kept.push(`web/${json.path}`);
        }
        const image = await loadImage(`data:${json.mime ?? "image/png"};base64,${json.base64 ?? ""}`);
        back.push({ rgba: imageRgba(image), width: image.naturalWidth, height: image.naturalHeight });
      }
      const result = harvestPart(snapshot, plan, back);
      candidateKeyRef.current += 1;
      const candidate: Candidate = {
        key: candidateKeyRef.current,
        layer: plan.layer,
        name: genPrompt.trim().slice(0, 40),
        seed: genSeed,
        drawings: result.drawings,
        cost,
        path: kept.join(", "),
      };
      setCandidates((list) => [...list, candidate]);
      setGenSeed((value) => value + 1);
      setGenNote(
        `Seed ${candidate.seed} came back for ${money(cost)}: ${result.painted} pixels read${result.kept > 0 ? `, ${result.kept} outline pixels kept from the worn part` : ""}. The picture is at ${candidate.path}. The seed moved on, so Generate again gives a different one.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGenNote(kept.length > 0 ? `${message} What was paid for is kept at ${kept.join(", ")}.` : message);
    } finally {
      setGenBusy("");
    }
  };

  const keepCandidate = (candidate: Candidate) => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    try {
      const next = partFromDrawings(current, candidate.layer, candidate.name, candidate.drawings);
      commit(next);
      setLayer(candidate.layer);
      setCandidates((list) => list.filter((item) => item.key !== candidate.key));
      setNote(
        `“${wornPart(next, candidate.layer).name}” is in the parts and the ${editorLayerLabel(rigRef.current?.unitId ?? "", candidate.layer).toLowerCase()} is wearing it. Save writes it to disk.`,
      );
    } catch (error) {
      setGenNote(error instanceof Error ? error.message : String(error));
    }
  };

  const save = async (done?: string) => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    setBusy(true);
    try {
      const parts = [];
      for (const part of current.parts) {
        const strip = partStripRgba(current, part);
        parts.push({ file: toPartFile(current, part), pngBase64: await pngBase64(strip.rgba, strip.width, strip.height) });
      }
      const pictures = [];
      for (const key of CLIP_KEYS) {
        for (const [at, item] of current.clips[key].entries()) {
          const pixels = resolveFrame(current, item);
          pictures.push({ name: frameFileName(key, at), pngBase64: await pngBase64(frameRgba(pixels, lut), pixels.width, pixels.height) });
        }
      }
      const response = await fetch("/__dev/save-rig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rig: toRigFile(current), parts, frames: pictures }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error || `Saving failed (${response.status}).`);
      }
      setNote(done ?? `Saved the layers on ${current.unitId}. Loading this sprite again opens them.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!rig) {
    return (
      <section className="frame-editor" aria-label="Sprite editor">
        <style>{FRAME_EDITOR_CSS}</style>
        <p className="frame-editor-note">{note}</p>
      </section>
    );
  }

  const fit = worn && frame ? outlineFit(rig, worn, frame.pose) : null;
  const fitAll = worn ? outlineFit(rig, worn) : null;
  const sharing = frame ? framesOnPose(rig, frame.pose) : [];
  const savedBuild = wornBuild(rig, faction);
  const scheme = editorSchemeForRig(rig.unitId);
  const shownLayers = scheme.layers.map((item) => item.id);
  const infantryScheme = unitTypeFromRigId(rig.unitId) === "infantry";
  const sheetLayers = shownLayers.filter((id) => sheetOn.includes(id));

  const downloadPurple = async (which: "all" | "picked") => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const picked = which === "all" ? shownLayers : sheetLayers;
    const clipFrames = current.clips[clip];
    if (picked.length === 0 || clipFrames.length === 0) {
      return;
    }
    const sheet = purpleSheet(
      clipFrames.map((item) => resolveFrame(current, item)),
      picked,
      lut,
      { flash: which === "all" },
    );
    const url = URL.createObjectURL(await pngBlob(sheet.rgba, sheet.width, sheet.height));
    const link = document.createElement("a");
    link.href = url;
    const names = picked.map((id) => editorLayerLabel(current.unitId, id).toLowerCase().replace(/\s+/g, "_"));
    link.download = which === "all" ? `${current.unitId}_${clip}_purple.png` : `${current.unitId}_${clip}_purple_${names.join("-")}.png`;
    link.click();
    URL.revokeObjectURL(url);
    const frameWord = clipFrames.length === 1 ? "frame" : "frames";
    setNote(
      which === "all"
        ? `Downloaded ${titleFor(clip)} as a ${sheet.width}×${sheet.height} magenta sheet, ${clipFrames.length} ${frameWord}. The 16 colours sit under the grid.`
        : `Downloaded ${titleFor(clip)} with ${names.join(", ").replace(/_/g, " ")} as a ${sheet.width}×${sheet.height} magenta sheet. Everything else is magenta.`,
    );
  };

  return (
    <section className="frame-editor" aria-label="Sprite editor">
      <style>{FRAME_EDITOR_CSS}</style>
      <header className="frame-editor-head">
        <h2>Sprite editor</h2>
        <button
          type="button"
          disabled={!shelfPick}
          onClick={() => void loadShelf()}
          title={
            shelfPick
              ? `Open ${shelfPick.label} at its own pixel size. The picture sits on the torso. Save writes a new rig folder.`
              : "Pick a unit on the shelf first."
          }
        >
          {shelfPick ? `Load ${shelfPick.label.split(",")[0]}` : "Load a sprite"}
        </button>
        <label>
          Colours
          <select value={faction} onChange={(event) => setFaction(event.target.value as ColourSet)}>
            <option value="SHEET">{rig.unitId === UNIT_ID ? "As drawn (jap_walk.png)" : "As drawn"}</option>
            {FACTIONS.map((id) => (
              <option key={id} value={id}>
                {FACTION_PRESET_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
        <label className="frame-editor-check" title="The sprite sits on magenta. Turn this on for the dark grid.">
          <input type="checkbox" checked={gridGround} onChange={(event) => setGridGround(event.target.checked)} />
          Grid
        </label>
        <div className="frame-editor-zoom" role="group" aria-label="Zoom">
          {FRAME_ZOOMS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={zoom === value}
              title={`${zoomLabel(value)} on the frame's own pixels.`}
              onClick={() => setZoom(value)}
            >
              {zoomLabel(value)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setZoom(viewFrameZoom(rig.width, rig.height, editorZoomBox(canvasHostRef.current)))}
            title="Fit the whole sprite in the editor."
          >
            Fit
          </button>
        </div>
        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            title={`Write the rig, every part and a picture of every frame to public/assets/units/rigs/${rig.unitId}. Part pictures use the sheet's colours. jap_walk.png is never written.`}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                "Start again from jap_walk.png? Every part and frame made here is dropped from the editor. Saved files stay until the next Save.",
              )
            ) {
              void startFresh().catch((error) => setNote(String(error)));
            }
          }}
          title="Drop this rig and split jap_walk.png again. Ctrl+Z does not undo this."
        >
          Start again from the walk sheet
        </button>
        <button
          type="button"
          onClick={downloadRig}
          title="Download this rig and every part as one JSON file. Open rig file reads it back. Save still writes the project files."
        >
          Download rig
        </button>
        <button type="button" onClick={() => rigFileRef.current?.click()} title="Open a rig JSON from Download rig.">
          Open rig file
        </button>
        <input
          ref={rigFileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void openRigFile(file);
            }
          }}
        />
      </header>

      <div className="frame-editor-clips" role="tablist" aria-label="Clips">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === board?.id}
            onClick={() => {
              setSection(item.id);
              setClip(item.clip);
              setIndex(item.at[0] ?? 0);
              setTick(0);
            }}
          >
            {item.label} <small>{item.at.length}</small>
          </button>
        ))}
      </div>

      <div className="frame-editor-strip" role="group" aria-label={`${board?.label ?? titleFor(clip)} frames`}>
        {(board?.at ?? []).map((at, local) => (
          <button
            key={at}
            type="button"
            aria-pressed={at === frameIndex}
            aria-label={`${board?.label ?? titleFor(clip)} ${local}`}
            onClick={() => {
              setIndex(at);
              setPlaying(false);
            }}
          >
            {shown[at] && <FrameThumb frame={shown[at]} lut={lut} />}
            <small>
              {local} · pose {frames[at]?.pose}
            </small>
          </button>
        ))}
        {(board?.at.length ?? 0) === 0 && <p className="frame-editor-note">No frames yet. Add one below.</p>}
      </div>

      <div className="frame-editor-row frame-editor-parts" role="group" aria-label="Purple sheet">
        <strong>Purple sheet</strong>
        {scheme.layers.map((item) => (
          <label key={item.id} className="frame-editor-check">
            <input
              type="checkbox"
              checked={sheetOn.includes(item.id)}
              onChange={() =>
                setSheetOn((current) =>
                  current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
                )
              }
            />
            {item.label}
          </label>
        ))}
        <button
          type="button"
          disabled={frames.length === 0}
          title="Download this clip, every layer, on magenta. The 16-colour palette is the row under the frames. Send that picture to Gemini."
          onClick={() => void downloadPurple("all")}
        >
          Full sheet
        </button>
        <button
          type="button"
          disabled={frames.length === 0 || sheetLayers.length === 0}
          title="Download this clip with only the ticked layers painted. The rest of each frame is magenta."
          onClick={() => void downloadPurple("picked")}
        >
          Selected layers
        </button>
      </div>
      <p className="frame-editor-note">
        This clip, on magenta, with the 16 colours in a row underneath. Full sheet paints every layer. Selected layers paints only the ticked ones.
      </p>

      <div className="frame-editor-row" role="group" aria-label="Frame actions">
        <label>
          Add frame from
          <select value={addFrom} onChange={(event) => setAddFrom(event.target.value)}>
            {allFrames.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={addCopy} title="Put that frame's pose and movement after the current frame in this clip.">
          Add frame
        </button>
        {infantryScheme && (
          <button
            type="button"
            disabled={!frame}
            onClick={() => frame && insertFrame(breathFrame(frame), "A breath frame")}
            title="Copy this frame with the head and torso moved one pixel up. The movement stays when a part is swapped."
          >
            Add breath frame
          </button>
        )}
        <button
          type="button"
          disabled={!frame}
          onClick={() =>
            frame &&
            insertFrame(
              { ...moveLayer(frame, scheme.muzzle, -2, 0), flash: true },
              "A shot frame",
            )
          }
          title={`Copy this frame with the ${editorLayerLabel(rig.unitId, scheme.muzzle).toLowerCase()} moved two pixels back and the muzzle flash on. The movement stays when a part is swapped.`}
        >
          Add shot frame
        </button>
        <button type="button" disabled={frameIndex <= 0} onClick={() => moveFrame(-1)}>
          Move left
        </button>
        <button type="button" disabled={!frame || frameIndex >= frames.length - 1} onClick={() => moveFrame(1)}>
          Move right
        </button>
        <button type="button" disabled={!frame} onClick={deleteFrame}>
          Delete frame
        </button>
      </div>

      <div className="frame-editor-row frame-editor-parts" role="group" aria-label="Parts">
        <strong>Parts</strong>
        {shownLayers.map((name) => (
          <label key={name}>
            {editorLayerLabel(rigRef.current?.unitId ?? "", name)}
            <select
              aria-label={`${editorLayerLabel(rigRef.current?.unitId ?? "", name)} part`}
              value={rig.wearing[name]}
              title={`Swap the ${editorLayerLabel(rigRef.current?.unitId ?? "", name).toLowerCase()} in every frame of every clip.`}
              onChange={(event) => {
                const next = wearPart(rig, name, event.target.value);
                commit(next);
                setLayer(name);
                setNote(`The ${editorLayerLabel(rigRef.current?.unitId ?? "", name).toLowerCase()} now wears “${wornPart(next, name).name}” in every frame of every clip.`);
              }}
            >
              {partsOf(rig, name).map((part) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="frame-editor-row frame-editor-parts" role="group" aria-label="This sprite">
        <strong>This sprite</strong>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          title="Write these layers onto this sprite. Loading it again opens them."
        >
          Save layers
        </button>
        <input
          type="text"
          aria-label="Copy name"
          placeholder="Name for a copy"
          value={buildName}
          onChange={(event) => setBuildName(event.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={saveLayerCopy}
          title="Keep these layers as a named copy, written with this sprite. The sprite stays as it is."
        >
          Save a copy
        </button>
        <label>
          Copies
          <select
            aria-label="Saved copy"
            value={savedBuild?.id ?? ""}
            title="Put a copy's layers and colours on this sprite."
            onChange={(event) => putOnBuild(event.target.value)}
          >
            <option value="">{rig.builds.length === 0 ? "No copies yet" : "This sprite"}</option>
            {rig.builds.map((build) => (
              <option key={build.id} value={build.id}>
                {build.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!savedBuild}
          onClick={() => savedBuild && deleteBuild(savedBuild.id)}
          title="Delete the selected copy. The sprite keeps the layers it has now."
        >
          Delete copy
        </button>
      </div>

      <div className="frame-editor-strip frame-editor-shelf" role="group" aria-label={`${editorLayerLabel(rigRef.current?.unitId ?? "", layer)} parts`}>
        {shelf.map(({ part, pixels }) => (
          <button
            key={part.id}
            type="button"
            aria-pressed={part.id === rig.wearing[layer]}
            title={`Wear “${part.name}” in every frame of every clip.`}
            onClick={() => {
              commit(wearPart(rig, layer, part.id));
              setNote(`The ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} now wears “${part.name}” in every frame of every clip.`);
            }}
          >
            <FrameThumb frame={pixels} lut={lut} />
            <small>{part.name}</small>
          </button>
        ))}
      </div>

      <div className="frame-editor-body">
        <aside className="frame-editor-tools">
          <h3>Tool</h3>
          <div role="group" aria-label="Tools">
            {TOOLS.map((item) => (
              <Fragment key={item.id}>
                <button type="button" aria-pressed={tool === item.id} title={item.help} onClick={() => setTool(item.id)}>
                  {item.label}
                </button>
                {item.id === "fill" && (
                  <button
                    type="button"
                    onClick={fillWithinLayer}
                    title="Fill every painted pixel of this layer that sits inside its outline. A layer with no outline fills all of its pixels. Empty ground stays empty."
                  >
                    Fill within layer
                  </button>
                )}
              </Fragment>
            ))}
          </div>
          {(tool === "sprite" || tool === "layer") && (
            <div className="frame-editor-zoom" role="group" aria-label="Pencil size">
              {PENCIL_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={pencilSize === size}
                  title={`The pencil covers a ${size}×${size} square.`}
                  onClick={() => setPencilSize(size)}
                >
                  {size}
                </button>
              ))}
            </div>
          )}
          {tool === "layer" && (
            <label
              className="frame-editor-check"
              title="When a pixel is lifted onto a layer above, fill the hole if that part still touches the square. A part moved off entirely is not painted back."
            >
              <input type="checkbox" checked={heal} onChange={(event) => setHeal(event.target.checked)} />
              Fill the hole underneath
            </label>
          )}
          {tool === "stamp" && emblem && (
            <>
              <h3>Stamp</h3>
              <label title="Which emblem or marking to stamp. A country's emblem is picked with the colour set until you choose another.">
                Emblem
                <select aria-label="Emblem" value={emblem.id} onChange={(event) => setEmblemId(event.target.value as EmblemId)}>
                  {EMBLEMS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.kind === "marking" ? item.name : `${item.faction}: ${item.name}`}
                    </option>
                  ))}
                </select>
              </label>
              <div role="group" aria-label="Emblem size">
                {emblem.sizes.map((item) => (
                  <button
                    key={item.size}
                    type="button"
                    aria-pressed={activeSize === item.size}
                    title={`${item.label}: ${item.width} by ${item.height} pixels. Each size is drawn by hand, not scaled from another.`}
                    onClick={() => setEmblemSize(item.size)}
                  >
                    {item.width}×{item.height}
                  </button>
                ))}
              </div>
              <label className="frame-editor-check">
                <input type="checkbox" checked={emblemFlip} onChange={(event) => setEmblemFlip(event.target.checked)} />
                Flip left to right
              </label>
              <label className="frame-editor-check" title="Turn the emblem a quarter turn, so a wide mark stands on its side.">
                <input type="checkbox" checked={emblemTurn} onChange={(event) => setEmblemTurn(event.target.checked)} />
                On its side
              </label>
              <label
                className="frame-editor-check"
                title="Stamp only where the soldier already has a pixel on any layer of this frame. Turn it off to stamp on empty canvas."
              >
                <input type="checkbox" checked={onlySprite} onChange={(event) => setOnlySprite(event.target.checked)} />
                Only on the sprite
              </label>
              <p className="frame-editor-note">
                The smallest emblem is {emblem.sizes[0]?.width}×{emblem.sizes[0]?.height}, already large on a {rig.width}×{rig.height} soldier.
                It goes on the {editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} part, so every frame on this pose shows it.
              </p>
              <p className="frame-editor-note">
                {emblem.id === "jap_hinomaru_darker"
                  ? "The disc is terracotta and the rim is tan, the Japan uniform colours. They are exact when the colour set is JAP Tan."
                  : "A frame holds the 13 soldier colours, and none is the emblem's crimson or cream. The red is painted as gear plum and the white as skin tan, the same in every colour set."}
              </p>
            </>
          )}
          {(tool === "box" || tool === "lasso" || (selection !== null && maskCount(selection) > 0)) && (
            <>
              <h3>Selection</h3>
              <p className="frame-editor-note">{selection ? `${maskCount(selection)} pixels` : "Draw on the frame."}</p>
              <label
                className="frame-editor-check"
                title="When a pixel is lifted onto a layer above, fill the hole if that part still touches the square. A part moved off entirely is not painted back."
              >
                <input type="checkbox" checked={heal} onChange={(event) => setHeal(event.target.checked)} />
                Fill the hole underneath
              </label>
              <button
                type="button"
                onClick={sendSelection}
                title="Move the pixels that show inside the selection onto the picked layer."
              >
                Send to {editorLayerLabel(rigRef.current?.unitId ?? "", layer)}
              </button>
              {(steelTool === "soldier" || steelTool === "tread") && (
                <button
                  type="button"
                  onClick={() => paintSteelSelection(true)}
                  title="Turn every other column of this layer's ink in the selection into gun metal: link, gap, link, gap. Build animation steps those links."
                >
                  Make steel links
                </button>
              )}
              {steelTool !== null && (
                <button
                  type="button"
                  onClick={() => paintSteelSelection(false)}
                  title={
                    steelTool === "propeller"
                      ? "Turn this layer's ink in the selection into gun metal. Build animation steps it toward the wingtip."
                      : "Turn this layer's ink in the selection into gun metal. Use it for a wheel hub or a solid link."
                  }
                >
                  All steel
                </button>
              )}
              <button type="button" onClick={() => setSelection(null)} title="Drop the box or lasso. The drawing stays.">
                Clear selection
              </button>
            </>
          )}
          <h3>Layer</h3>
          <div role="group" aria-label="Layers">
            {scheme.layers.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={layer === item.id}
                title={`Sprite pencil paints the ${item.label.toLowerCase()}. Layer pencil moves pixels onto it. Arrow keys move it on this frame. Shift and an arrow key slide the drawing. [ and ] switch layers. Underneath to on top: ${scheme.layers.map((layerItem) => layerItem.label).join(", ")}.`}
                onClick={() => setLayer(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tool === "layer" && (
            <p className="frame-editor-note">
              Each pixel is tinted with the layer that owns it. A covered layer does not show through.{" "}
              {scheme.layers.map((item) => `${item.label} ${LAYER_WASH[item.id].tint}`).join(", ")}.
            </p>
          )}
          <button
            type="button"
            onClick={claimLayer}
            title="Painted pixels still on the layer the picture was loaded onto move onto this layer. Pixels already on another layer stay. A selection keeps its pixels where they are. Empty ground is left alone."
          >
            Fill all unselected areas with this layer
          </button>
          <label className="frame-editor-check">
            <input type="checkbox" checked={dimOthers} onChange={(event) => setDimOthers(event.target.checked)} />
            Fade other layers
          </label>
          <label className="frame-editor-check" title="Draw a line between every pixel, and a stronger line every 4. It shows from 2× zoom up.">
            <input type="checkbox" checked={pixelGrid} onChange={(event) => setPixelGrid(event.target.checked)} />
            Pixel grid
          </label>
          <label
            className="frame-editor-check"
            title="Show the previous frame of this clip faintly, and the next frame lighter, wherever those frames differ from this one. Matching pixels stay as they are. The clip loops, so the first frame sits on the last."
          >
            <input type="checkbox" checked={onion} onChange={(event) => setOnion(event.target.checked)} />
            Onion skin
          </label>
          <label className="frame-editor-check">
            <input
              type="checkbox"
              checked={frame?.flash ?? false}
              disabled={!frame}
              onChange={(event) => editFrame((target) => ({ ...target, flash: event.target.checked }))}
            />
            Muzzle flash
          </label>
          <p className="frame-editor-note">{frame ? movementText(frame, (id) => editorLayerLabel(rig.unitId, id)) : ""}</p>
          <button
            type="button"
            disabled={!frame || clearMoves(frame) === frame}
            onClick={() => editFrame(clearMoves)}
            title="Put every layer back where the pose has it on this frame."
          >
            Clear movement
          </button>
          <button
            type="button"
            disabled={!frame || (sharing.length <= 1 && clearMoves(frame) === frame)}
            onClick={() => {
              edit((current) => ownPose(current, clip, frameIndex));
              setNote(
                `${titleFor(clip)} ${frameIndex} has its own pose now. Painting it changes no other frame. Every part got a drawing for the new pose.`,
              );
            }}
            title="Give this frame a pose of its own, with its movement drawn in, so it can be repainted without changing the frames it was copied from."
          >
            Give this frame its own pose
          </button>

          <h3>{editorLayerLabel(rigRef.current?.unitId ?? "", layer)} part</h3>
          <p className="frame-editor-note">{worn ? `“${worn.name}”` : ""}</p>
          <input
            type="text"
            aria-label="Part name"
            placeholder="Name for a new part"
            value={partName}
            onChange={(event) => setPartName(event.target.value)}
          />
          <button
            type="button"
            onClick={copyWornPart}
            title="Copy the worn part under the name above and wear the copy. It keeps the same outline on every pose, so recolour or repaint it into a new uniform."
          >
            Copy this part
          </button>
          <button
            type="button"
            onClick={() => partFileRef.current?.click()}
            title={`Make a ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} part from a PNG. ${rig.width}×${rig.height} is one drawing, placed on every pose by the skeleton. ${rig.width * rig.poses}×${rig.height} is a strip with one drawing per pose.`}
          >
            New part from a picture
          </button>
          <input
            ref={partFileRef}
            type="file"
            accept="image/png"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void newPartFromPicture(file);
              }
            }}
          />
          <button type="button" onClick={renameWornPart} title="Give the worn part the name above.">
            Rename this part
          </button>
          <button
            type="button"
            disabled={partsOf(rig, layer).length <= 1}
            onClick={deleteWornPart}
            title="Take the worn part out of the parts. A layer keeps at least one."
          >
            Delete this part
          </button>
          <button
            type="button"
            onClick={() => void downloadWornPart()}
            title="Download the worn part as one strip PNG, a frame wide for each pose."
          >
            Download this part
          </button>
          <button
            type="button"
            disabled={!frame}
            onClick={() => layerFileRef.current?.click()}
            title={`Open an ${rig.width}×${rig.height} PNG onto this pose of the worn ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} part.`}
          >
            Open a picture onto this pose
          </button>
          <label title="A picture made of 2× or 3× blocks is collapsed to one pixel a block before it is placed. Auto reads the picture.">
            Pixel grain
            <select aria-label="Pixel grain" value={String(grain)} onChange={(event) => setGrain(event.target.value === "auto" ? "auto" : (Number(event.target.value) as GrainOverride))}>
              <option value="auto">{autoGrainLabel(null)}</option>
              <option value="1">1×, leave it</option>
              <option value="2">2× blocks</option>
              <option value="3">3× blocks</option>
            </select>
          </label>
          <input
            ref={layerFileRef}
            type="file"
            accept="image/png"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void openOntoLayer(file);
              }
            }}
          />
          <button
            type="button"
            disabled={!frame}
            onClick={() => {
              edit((current, target) => spreadDrawing(current, layer, target.pose));
              setNote(`Every pose of “${worn?.name}” now uses this pose's drawing, placed by the skeleton.`);
            }}
            title="Copy this pose's drawing onto every other pose of the worn part, moved to where the skeleton puts this layer. Use it for a head or a weapon drawn once."
          >
            Use this drawing on every pose
          </button>
          {infantryScheme && (
            <button
              type="button"
              onClick={() => {
                const current = rigRef.current;
                if (!current) {
                  return;
                }
                const next = fillTorsoUnderWeapon(current);
                commit(next);
                setNote(
                  next === current
                    ? "The torso already runs under the weapon on every pose."
                    : "Painted the torso under the weapon on every pose. Any weapon can sit over it now.",
                );
              }}
              title="Paint the worn torso under the worn weapon on every pose, so a moved or swapped weapon leaves no hole."
            >
              Fill torso under weapon
            </button>
          )}
          {fit && fitAll && (
            <>
              <p className="frame-editor-note">
                {fit.outside === 0 && fit.missing === 0
                  ? "This pose fits the outline."
                  : `This pose: ${fit.outside} outside the outline, ${fit.missing} empty inside it.`}{" "}
                {fitAll.outside === 0 && fitAll.missing === 0
                  ? "Every pose fits."
                  : `All poses: ${fitAll.outside} outside, ${fitAll.missing} empty.`}
              </p>
              <label className="frame-editor-check">
                <input type="checkbox" checked={showOutline} onChange={(event) => setShowOutline(event.target.checked)} />
                Show outline
              </label>
              <button
                type="button"
                disabled={fitAll.outside === 0}
                onClick={() => commit(trimToOutline(rig, layer))}
                title="Clear every pixel of the worn part that falls outside the skeleton's outline, on all poses."
              >
                Trim to the outline
              </button>
              <button
                type="button"
                onClick={() => {
                  const current = rigRef.current;
                  if (!current) {
                    return;
                  }
                  const next = retakeOutline(current, layer);
                  commit(next);
                  setNote(
                    next === current
                      ? `The outline already follows “${wornPart(current, layer).name}” on every pose.`
                      : `The ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} outline now follows “${wornPart(current, layer).name}” on every pose. New ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} parts are held to it.`,
                  );
                }}
                title="Take the skeleton's outline again from the worn part, on all poses. Use it after the walk itself has been cleaned up. A torso's outline also covers what the worn weapon hides."
              >
                Use this part as the outline
              </button>
            </>
          )}

          <h3>Motion</h3>
          <label title="How far the other layers shift on the second walk frame and on the shot. Positive is down.">
            Bob
            <input
              aria-label="Bob"
              type="number"
              value={bob}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                setBob(Number.isFinite(parsed) ? Math.trunc(parsed) : 0);
              }}
            />
          </label>
          <label title="How far the weapon kicks back on the shot. The torso takes half.">
            Recoil
            <input
              aria-label="Recoil"
              type="number"
              min={0}
              value={recoil}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                setRecoil(Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0);
              }}
            />
          </label>
          {steelTool !== null && (
            <>
              <label title="How far the gun metal steps on the first walk frame.">
                Tread stride
                <input
                  aria-label="Tread stride"
                  type="number"
                  min={1}
                  value={stride}
                  onChange={(event) => setStride(Math.max(1, Math.trunc(Number(event.target.value)) || 1))}
                />
              </label>
              <label title="Across a tread the links step sideways. Toward the wingtip, propeller dashes step down.">
                Step
                <select aria-label="Step" value={along} onChange={(event) => setAlong(event.target.value === "y" ? "y" : "x")}>
                  <option value="x">Along the tread</option>
                  <option value="y">Toward the wingtip</option>
                </select>
              </label>
            </>
          )}
          <button
            type="button"
            disabled={!frame}
            onClick={buildFromPose}
            title={`Write ${titleFor("walk")} and Firing from this pose. The picked layer's gun metal steps on the first walk frame. Idle stays.`}
          >
            Build animation
          </button>
          <p className="frame-editor-note">
            {steelTool === "propeller"
              ? "Gun metal on the picked layer steps toward the wingtip. "
              : steelTool === "tread"
                ? "Gun metal on the picked layer steps along the tread. "
                : steelTool === "soldier"
                  ? `Gun metal on the ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} steps. `
                  : ""}
            The other layers bob, then the weapon kicks back.
          </p>
        </aside>

        <div className="frame-editor-stage-wrap">
        <div
          ref={canvasHostRef}
          className={dropping ? "frame-editor-canvas frame-editor-drop" : "frame-editor-canvas"}
          onDragOver={(event) => {
            event.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropping(false);
            dropPicture(event.dataTransfer.files[0]);
          }}
        >
          <p className="frame-editor-bar">
            <span>
              {rig.width} × {rig.height} pixels, the frame&apos;s own size. Drop a PNG or a rig file here.
            </span>
            <span>{cursor ? `${cursor.x}, ${cursor.y}` : "—, —"}</span>
          </p>
          {frame ? (
            <div className="frame-editor-stage" style={{ width: rig.width * zoom, height: rig.height * zoom }}>
              <canvas
                ref={canvasRef}
                aria-label={`${titleFor(clip)} ${frameIndex}, ${editorLayerLabel(rigRef.current?.unitId ?? "", layer)} layer`}
                style={{ width: rig.width * zoom, height: rig.height * zoom }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onPointerLeave={leaveCanvas}
              />
              <canvas
                ref={stampRef}
                className="frame-editor-stamp-preview"
                width={rig.width}
                height={rig.height}
                aria-hidden="true"
                style={{ width: rig.width * zoom, height: rig.height * zoom }}
              />
              <canvas
                ref={selectRef}
                className="frame-editor-select"
                width={rig.width}
                height={rig.height}
                aria-hidden="true"
                style={{ width: rig.width * zoom, height: rig.height * zoom }}
              />
            </div>
          ) : (
            <p className="frame-editor-note">Pick a frame, or add one to {titleFor(clip)}.</p>
          )}
          {frame && worn && (
            <p className="frame-editor-note">
              Painting changes “{worn.name}” on pose {frame.pose}. That pose shows on {describeFrames(sharing, titleFor)}.
            </p>
          )}
          <p className="frame-editor-note">{note}</p>
        </div>
          <div className="frame-editor-colours">
            <h3>Colour</h3>
            <SwatchPalette
              swatches={swatches}
              picked={slot}
              onPick={(value) => {
                setSlot(value);
                setTool((current) => (current === "fill" || current === "layer" ? current : "sprite"));
              }}
            />
          </div>
        </div>

        <figure className="frame-editor-card">
          <figcaption>In the game</figcaption>
          <canvas ref={cardRef} width={SPRITE_BAKE.width} height={SPRITE_BAKE.height} aria-label="In the game" />
          <div className="frame-editor-row">
            <button type="button" disabled={frames.length < 2} onClick={() => setPlaying((value) => !value)}>
              {playing ? "Pause" : "Play"}
            </button>
            <label>
              Speed
              <select value={fps} onChange={(event) => setFps(Number(event.target.value))}>
                {[2, 4, 6, 8, 10, 12].map((value) => (
                  <option key={value} value={value}>
                    {value} fps
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="frame-editor-note">
            The cream cross is the feet. The game stands them on the card's ground point. The red crosses are the muzzles. The grey square is the exhaust.
          </p>
        </figure>
      </div>

      {import.meta.env.DEV && (
        <section className="frame-editor-gen" aria-label="Generate a part">
          <h3>Generate a {editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()} part</h3>
          <p className="frame-editor-note">
            {GEN_HELP[layer](genRoom, genEach)} What comes back is matched to the 13 colours, so the words change the shape and the shading.
            The colour set changes the hue.
          </p>
          <div className="frame-editor-row">
            <label>
              What to draw
              <input
                type="text"
                className="frame-editor-wide"
                aria-label="What to draw"
                placeholder={`Describe the ${editorLayerLabel(rigRef.current?.unitId ?? "", layer).toLowerCase()}`}
                value={genPrompt}
                onChange={(event) => setGenPrompt(event.target.value)}
              />
            </label>
            <label>
              Seed
              <input
                type="number"
                aria-label="Seed"
                min={0}
                step={1}
                value={genSeed}
                title="The same words and the same seed give much the same picture. It moves on by one after each picture."
                onChange={(event) => setGenSeed(Math.round(Number(event.target.value)))}
              />
            </label>
            {!outlined && (
              <>
                <label>
                  Drawings
                  <select
                    aria-label="Drawings"
                    value={genEach ? "each" : "one"}
                    title="One drawing is made on this pose and the skeleton places it on the rest. One for each pose is drawn pose by pose, so it can tilt."
                    onChange={(event) => setGenEach(event.target.value === "each")}
                  >
                    <option value="one">One, placed by the skeleton</option>
                    <option value="each">One for each pose</option>
                  </select>
                </label>
                <label>
                  Room
                  <select
                    aria-label="Room around the part"
                    value={genRoom}
                    title="How many pixels past the worn part the new one may reach. More room lets the shape change more."
                    onChange={(event) => setGenRoom(Number(event.target.value))}
                  >
                    {Array.from({ length: GEN_ROOM_MAX + 1 }, (_, value) => (
                      <option key={value} value={value}>
                        {value} px
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <button
              type="button"
              disabled={genBusy !== ""}
              onClick={() => void checkPrice()}
              title="Ask Retro Diffusion what this costs. Asking is free."
            >
              {genBusy === "price" ? "Asking…" : "Check the price"}
            </button>
            <button
              type="button"
              disabled={genBusy !== ""}
              onClick={() => void generate()}
              title="Send the picture to Retro Diffusion. It shows the price and asks before it spends anything."
            >
              {genBusy === "paint" ? "Waiting for Retro Diffusion…" : "Generate"}
            </button>
          </div>
          <p className="frame-editor-note">
            {genPlan.plan
              ? quote
                ? `${money(quote.each)} a picture. This is ${pictures(genPlan.plan.sheets.length)}: ${money(quote.each * genPlan.plan.sheets.length)}.`
                : `This is ${pictures(genPlan.plan.sheets.length)}. Checking the price is free, and Generate asks before it spends anything.`
              : genPlan.error}
          </p>
          {genNote !== "" && (
            <p className="frame-editor-note" role="status">
              {genNote}
            </p>
          )}
          {genPlan.plan?.sheets.map((sheet, at) => (
            <SentPicture key={at} sheet={sheet} />
          ))}
          {candidates.length > 0 && (
            <div className="frame-editor-strip frame-editor-shelf" role="group" aria-label="Generated parts">
              {tried.map(({ candidate, pixels }) => (
                <div key={candidate.key} className="frame-editor-candidate">
                  {pixels && <FrameThumb frame={pixels} lut={lut} />}
                  <small>
                    {editorLayerLabel(rigRef.current?.unitId ?? "", candidate.layer)}: {candidate.name} · seed {candidate.seed}
                  </small>
                  <button
                    type="button"
                    onClick={() => keepCandidate(candidate)}
                    title="Add it to the parts under this name and wear it. Ctrl+Z takes it out again."
                  >
                    Keep as a part
                  </button>
                  <button
                    type="button"
                    onClick={() => setCandidates((list) => list.filter((item) => item.key !== candidate.key))}
                    title={`Drop it from this list. The picture stays at ${candidate.path}.`}
                  >
                    Discard
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}

const FRAME_EDITOR_CSS = `
.frame-editor {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  font: 13px/1.4 "Segoe UI", sans-serif;
  letter-spacing: 0;
}
.frame-editor h2, .frame-editor h3 {
  margin: 0;
  font: 600 15px/1.4 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
}
.frame-editor h3 {
  margin-top: 6px;
  font-size: 13px;
  color: #a99c8d;
}
.frame-editor button, .frame-editor select, .frame-editor input[type="text"], .frame-editor input[type="number"] {
  font: 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  padding: 6px 10px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
}
.frame-editor input[type="number"] {
  width: 84px;
}
.frame-editor input.frame-editor-wide {
  width: 380px;
  max-width: 100%;
}
.frame-editor-shelf {
  min-height: 0;
}
.frame-editor-shelf small {
  display: block;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frame-editor-gen {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: #241f1c;
  box-shadow: 0 0 0 1px #4b3d44;
}
.frame-editor-gen h3 {
  margin-top: 0;
  color: #ddcf99;
}
.frame-editor-gen input, .frame-editor-gen select {
  background: #1c1917;
}
.frame-editor-candidate {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 160px;
}
.frame-editor-strip .frame-editor-candidate canvas {
  width: 160px;
  height: auto;
}
.frame-editor-strip .frame-editor-candidate button {
  padding: 6px 10px;
}
.frame-editor input[type="text"]::placeholder {
  color: #a99c8d;
}
.frame-editor button:hover:not(:disabled) {
  border-color: #ddcf99;
}
.frame-editor button:disabled {
  opacity: 0.45;
}
.frame-editor button[aria-pressed="true"], .frame-editor button[aria-selected="true"] {
  border-color: #ddcf99;
  background: #4b3d44;
}
.frame-editor label {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.frame-editor-zoom {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.frame-editor-zoom button {
  min-width: 36px;
  padding: 4px 6px;
}
.frame-editor-zoom button[aria-pressed="true"] {
  background: #ddcf99;
  color: #1c1917;
}
.frame-editor-head, .frame-editor-row, .frame-editor-clips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.frame-editor-parts {
  padding: 8px 10px;
  background: #2a2420;
  box-shadow: 0 0 0 1px #4b3d44;
}
.frame-editor-parts strong {
  font-weight: 600;
  color: #ddcf99;
}
.frame-editor-parts select {
  background: #1c1917;
}
.frame-editor-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  min-height: 104px;
}
.frame-editor-strip button {
  padding: 2px;
  flex: none;
}
.frame-editor-strip canvas {
  display: block;
  width: auto;
  height: 80px;
  image-rendering: pixelated;
  background: #2f2925;
}
.frame-editor-strip small, .frame-editor-clips small {
  color: #ddcf99;
}
.frame-editor-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.frame-editor-stage-wrap {
  flex: 1 1 320px;
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.frame-editor-canvas {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  max-height: min(560px, calc(100vh - 360px));
  overflow: auto;
}
.frame-editor-colours h3 {
  margin-bottom: 4px;
}
.frame-editor-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 220px;
}
.frame-editor-tools [role="group"] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.frame-editor-canvas canvas {
  display: block;
  image-rendering: pixelated;
  cursor: crosshair;
  touch-action: none;
  box-shadow: 0 0 0 1px #4b3d44;
}
.frame-editor-canvas .frame-editor-note {
  margin-top: 6px;
}
.frame-editor-stage {
  position: relative;
}
.frame-editor-canvas canvas.frame-editor-stamp-preview,
.frame-editor-canvas canvas.frame-editor-select {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: none;
  cursor: auto;
}
.frame-editor-drop {
  outline: 2px solid #ddcf99;
}
.frame-editor-bar {
  display: flex;
  gap: 16px;
  margin: 0 0 6px;
  color: #a99c8d;
}
.frame-editor-card {
  margin: 0;
  width: 336px;
}
.frame-editor-card figcaption {
  color: #a99c8d;
  margin-bottom: 6px;
}
.frame-editor-card canvas {
  display: block;
  width: 320px;
  height: 224px;
  image-rendering: pixelated;
  background: linear-gradient(#8e9f7d 0 93%, #7d7b62 93%);
  box-shadow: 0 0 0 1px #4b3d44;
}
.frame-editor-note {
  margin: 0;
  color: #a99c8d;
  max-width: 640px;
}
.frame-editor-check {
  color: #f5f0e6;
}
${EDITOR_SHARED_CSS}`;
