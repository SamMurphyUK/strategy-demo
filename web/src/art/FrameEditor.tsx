import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import {
  AS_DRAWN_LUT,
  CLIP_KEYS,
  CLIP_LABEL,
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
import { FACTION_LUTS, FACTION_PRESET_LABEL, SLOT_LABELS, type FactionPresetId, type PartCategory } from "./paperDoll";
import { GEN_ROOM_MAX, harvestPart, planGeneration, type GenPicture, type GenPlan, type GenSheet, type GenSpread } from "./partGen";
import {
  assembleRig,
  breathFrame,
  buildGaps,
  clearMoves,
  copyPart,
  describeFrames,
  erasePart,
  fillTorsoUnderWeapon,
  framesOnPose,
  moveLayer,
  outlineFit,
  ownPose,
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
  rigFromClips,
  saveBuild,
  shiftCells,
  shotFrame,
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
const ZOOMS = [4, 6, 8, 10] as const;
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

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function pictures(count: number): string {
  return count === 1 ? "1 picture" : `${count} pictures`;
}

type Tool = "pencil" | "eraser" | "feet" | "muzzle";

const TOOLS: readonly { id: Tool; label: string; help: string }[] = [
  {
    id: "pencil",
    label: "Pencil",
    help: "Paint the picked colour onto the part the picked layer is wearing. Alt-click picks up a colour.",
  },
  { id: "eraser", label: "Eraser", help: "Clear the square on every layer's part." },
  {
    id: "feet",
    label: "Feet",
    help: "Click where the boots stand. The game puts this point on the ground line. It is the same for every frame.",
  },
  {
    id: "muzzle",
    label: "Muzzle",
    help: "Click the end of the barrel on this frame. The flash draws from here. Without a click it sits on the tip of the weapon.",
  },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not open ${src}.`));
    image.src = src;
  });
}

function imageRgba(image: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The browser would not open a canvas.");
  }
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

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
  const clips = { idle: [], walk: [], fire: [] } as Record<ClipKey, SpriteFrame[]>;
  for (const key of CLIP_KEYS) {
    for (const name of file.clips[key]) {
      clips[key].push(fromFrameFile(await fetchJson(`${FRAMES_URL}/${name}.json`)));
    }
  }
  return { unitId: file.unitId, width: file.width, height: file.height, feet: file.feet, clips };
}

async function savedRig(): Promise<PartRig | null> {
  const json = await fetchJson(`${RIG_URL}/rig.json`);
  if (json === null) {
    return null;
  }
  const listed = (json as { parts?: { id?: unknown }[] }).parts ?? [];
  const parts: unknown[] = [];
  for (const part of listed) {
    parts.push(await fetchJson(`${RIG_URL}/part_${String(part.id)}.json`));
  }
  return assembleRig(json, parts);
}

function putRgba(canvas: HTMLCanvasElement | null, rgba: Uint8ClampedArray, width: number, height: number): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) {
    return;
  }
  canvas.width = width;
  canvas.height = height;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
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

async function pngBlob(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  putRgba(canvas, rgba, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("The picture could not be turned into a PNG.");
  }
  return blob;
}

async function pngBase64(rgba: Uint8ClampedArray, width: number, height: number): Promise<string> {
  const bytes = new Uint8Array(await (await pngBlob(rgba, width, height)).arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** A part's strip in the sheet's own colours, so the picture opens again as the same part. */
function partStripRgba(rig: PartRig, part: RigPart): { rgba: Uint8ClampedArray; width: number; height: number } {
  const strip = partStrip(rig, part);
  return { rgba: cellsRgba(strip.cells, AS_DRAWN_LUT), width: strip.width, height: strip.height };
}

function withClip(rig: PartRig, clip: ClipKey, frames: RigFrame[]): PartRig {
  return { ...rig, clips: { ...rig.clips, [clip]: frames } };
}

function movementText(frame: RigFrame): string {
  const moved = LAYER_ORDER.filter((layer) => frame.move[layer].x !== 0 || frame.move[layer].y !== 0);
  if (moved.length === 0) {
    return "No movement on this frame.";
  }
  const signed = (value: number) => (value < 0 ? `−${-value}` : String(value));
  return `Movement on this frame: ${moved.map((layer) => `${LAYER_NAME[layer]} ${signed(frame.move[layer].x)}, ${signed(frame.move[layer].y)}`).join(" · ")}.`;
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

/** The picture with everything outside the mask dimmed, so the open pixels stand out. */
function openPixelsRgba(sheet: GenSheet): Uint8ClampedArray {
  const out = new Uint8ClampedArray(sheet.input);
  for (let offset = 0; offset < out.length; offset += 4) {
    if ((sheet.mask[offset + 3] ?? 0) > 12) {
      continue;
    }
    out[offset] = Math.round((out[offset] ?? 0) * 0.22 + 22);
    out[offset + 1] = Math.round((out[offset + 1] ?? 0) * 0.22 + 20);
    out[offset + 2] = Math.round((out[offset + 2] ?? 0) * 0.22 + 18);
  }
  return out;
}

function SentPicture({ sheet }: { sheet: GenSheet }) {
  const sentRef = useRef<HTMLCanvasElement>(null);
  const openRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    putRgba(sentRef.current, sheet.input, sheet.width, sheet.height);
    putRgba(openRef.current, openPixelsRgba(sheet), sheet.width, sheet.height);
  }, [sheet]);
  const style = { width: sheet.width * 2, height: sheet.height * 2 };
  return (
    <div className="frame-editor-sent">
      <figure>
        <canvas ref={sentRef} style={style} aria-label="The picture that is sent" />
        <figcaption>
          Sent, {sheet.width}×{sheet.height}
        </figcaption>
      </figure>
      <figure>
        <canvas ref={openRef} style={style} aria-label="The pixels open to repainting" />
        <figcaption>Open to repainting</figcaption>
      </figure>
    </div>
  );
}

export function FrameEditor() {
  const [rig, setRigState] = useState<PartRig | null>(null);
  const [clip, setClip] = useState<ClipKey>("idle");
  const [index, setIndex] = useState(0);
  const [layer, setLayer] = useState<PartCategory>("torso");
  const [tool, setTool] = useState<Tool>("pencil");
  const [slot, setSlot] = useState(2);
  const [faction, setFaction] = useState<ColourSet>("SHEET");
  const [zoom, setZoom] = useState<number>(8);
  const [dimOthers, setDimOthers] = useState(false);
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
  const rigRef = useRef<PartRig | null>(null);
  const undoRef = useRef<PartRig[]>([]);
  const strokeRef = useRef(false);
  const strokeSavedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLCanvasElement>(null);
  const layerFileRef = useRef<HTMLInputElement>(null);
  const partFileRef = useRef<HTMLInputElement>(null);
  const lut = faction === "SHEET" ? AS_DRAWN_LUT : FACTION_LUTS[faction];
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

  const setRig = useCallback((next: PartRig) => {
    rigRef.current = next;
    setRigState(next);
  }, []);

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

  const startFresh = useCallback(async () => {
    const fresh = rigFromClips(await walkSheetClips());
    undoRef.current = [];
    setRig(fresh);
    setClip("idle");
    setIndex(0);
    setNote("Split jap_walk.png into eight poses. The fourth sheet frame leads the walk, and Idle is that pose.");
  }, [setRig]);

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

  const cardFrame = playing && shown.length > 0 ? shown[tick % shown.length] : shownFrame;

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
    canvas.width = width * zoom;
    canvas.height = height * zoom;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        ctx.fillStyle = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? "#3a332e" : "#2f2925";
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    }
    if (!frame || !shownFrame) {
      return;
    }
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
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    }
    ctx.globalAlpha = 1;
    if (zoom >= 6) {
      ctx.strokeStyle = "rgba(28, 25, 23, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 1) {
        ctx.moveTo(x * zoom + 0.5, 0);
        ctx.lineTo(x * zoom + 0.5, height * zoom);
      }
      for (let y = 0; y <= height; y += 1) {
        ctx.moveTo(0, y * zoom + 0.5);
        ctx.lineTo(width * zoom, y * zoom + 0.5);
      }
      ctx.stroke();
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
            ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
          } else if (!inside && filled) {
            ctx.strokeStyle = MILITARY.crimson;
            ctx.lineWidth = 2;
            ctx.strokeRect(x * zoom + 1, y * zoom + 1, zoom - 2, zoom - 2);
          }
        }
      }
    }
    const cross = (x: number, y: number, colour: string) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.strokeRect(x * zoom + 1, y * zoom + 1, zoom - 2, zoom - 2);
      ctx.beginPath();
      ctx.moveTo((x - 1) * zoom, (y + 0.5) * zoom);
      ctx.lineTo((x + 2) * zoom, (y + 0.5) * zoom);
      ctx.moveTo((x + 0.5) * zoom, (y - 1) * zoom);
      ctx.lineTo((x + 0.5) * zoom, (y + 2) * zoom);
      ctx.stroke();
    };
    cross(rig.feet.x, rig.feet.y, MILITARY.cream);
    if (shownFrame.muzzle) {
      cross(shownFrame.muzzle.x, shownFrame.muzzle.y, MILITARY.crimson);
    }
  }, [rig, dimOthers, frame, shownFrame, layer, lut, showOutline, zoom]);

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
        const step = event.key === "]" ? 1 : LAYER_ORDER.length - 1;
        setLayer((current) => LAYER_ORDER[(LAYER_ORDER.indexOf(current) + step) % LAYER_ORDER.length] ?? current);
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
  }, [edit, editFrame, layer, undo]);

  const cellAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width / event.currentTarget.width;
    return {
      x: Math.floor((event.clientX - rect.left) / scale / zoom),
      y: Math.floor((event.clientY - rect.top) / scale / zoom),
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
          setNote(`Picked ${SLOT_LABELS[found]} on the ${LAYER_NAME[name]} layer.`);
          return;
        }
      }
      return;
    }
    let next = current;
    if (tool === "pencil") {
      next = paintPart(current, target, layer, x, y, slot);
    } else if (tool === "eraser") {
      next = erasePart(current, target, x, y);
    } else if (tool === "feet" && first) {
      next = current.feet.x === x && current.feet.y === y ? current : { ...current, feet: { x, y } };
    } else if (tool === "muzzle" && first) {
      next = withRigFrame(current, clip, frameIndex, {
        ...target,
        muzzle: { x: x - target.move.weapon.x, y: y - target.move.weapon.y },
      });
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
    const { x, y } = cellAt(event);
    applyTool(x, y, true, event.altKey);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!strokeRef.current || (tool !== "pencil" && tool !== "eraser") || event.altKey) {
      return;
    }
    const { x, y } = cellAt(event);
    applyTool(x, y, false, false);
  };

  const endStroke = () => {
    strokeRef.current = false;
  };

  const allFrames = useMemo(
    () =>
      rig
        ? CLIP_KEYS.flatMap((key) =>
            rig.clips[key].map((_, at) => ({
              value: `${key}:${at}`,
              label: `${CLIP_LABEL[key]} ${at}`,
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
    setNote(`${label} is ${CLIP_LABEL[clip]} ${at}.`);
  };

  const addCopy = () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    const [key, at] = addFrom.split(":") as [ClipKey, string];
    const source = current.clips[key]?.[Number(at)];
    if (source) {
      insertFrame({ ...source, move: { ...source.move } }, `A copy of ${CLIP_LABEL[key]} ${at}`);
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
    setNote(`Deleted ${CLIP_LABEL[clip]} ${frameIndex}. Ctrl+Z brings it back.`);
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
      use(imageRgba(image), image.naturalWidth, image.naturalHeight);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const openOntoLayer = (file: File) =>
    readPicture(file, (rgba, width, height) => {
      edit((current, target) => placePicture(current, target, layer, rgba, width, height));
      setNote(`Put ${file.name} on this pose of the ${LAYER_NAME[layer].toLowerCase()} part. Ctrl+Z takes it off.`);
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
        `Took “${gone.name}” out of the parts. The ${LAYER_NAME[layer].toLowerCase()} now wears “${wornPart(next, layer).name}”. Ctrl+Z brings it back.`,
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
    const gaps = buildGaps(current, build).map((name) => LAYER_NAME[name].toLowerCase());
    setNote(
      gaps.length === 0
        ? `Wearing “${build.name}” in every frame of every clip.`
        : `Wearing “${build.name}”, except the ${gaps.join(" and ")}: that part has been deleted, so the layer keeps what it had.`,
    );
  };

  const saveCurrentBuild = () => {
    const current = rigRef.current;
    if (!current) {
      return;
    }
    try {
      const existed = current.builds.some((build) => build.name.toLowerCase() === buildName.trim().toLowerCase());
      commit(saveBuild(current, buildName, faction));
      setNote(
        `${existed ? "Saved over" : "Saved"} the build “${buildName.trim()}”: these four parts in the ${faction === "SHEET" ? "sheet's own" : FACTION_PRESET_LABEL[faction]} colours. Save writes it to disk.`,
      );
      setBuildName("");
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
    setNote(`Deleted the build “${build.name}”. Its parts stay in the library. Ctrl+Z brings it back.`);
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
        `“${wornPart(next, candidate.layer).name}” is in the parts and the ${LAYER_NAME[candidate.layer].toLowerCase()} is wearing it. Save writes it to disk.`,
      );
    } catch (error) {
      setGenNote(error instanceof Error ? error.message : String(error));
    }
  };

  const save = async () => {
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
      setNote(`Saved ${json.parts} parts and ${json.frames} frame pictures to ${json.path}.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!rig) {
    return (
      <section className="frame-editor" aria-label="Frame editor">
        <style>{FRAME_EDITOR_CSS}</style>
        <p className="frame-editor-note">{note}</p>
      </section>
    );
  }

  const fit = worn && frame ? outlineFit(rig, worn, frame.pose) : null;
  const fitAll = worn ? outlineFit(rig, worn) : null;
  const sharing = frame ? framesOnPose(rig, frame.pose) : [];
  const savedBuild = wornBuild(rig, faction);

  return (
    <section className="frame-editor" aria-label="Frame editor">
      <style>{FRAME_EDITOR_CSS}</style>
      <header className="frame-editor-head">
        <h2>Frame editor</h2>
        <label>
          Colours
          <select value={faction} onChange={(event) => setFaction(event.target.value as ColourSet)}>
            <option value="SHEET">As drawn (jap_walk.png)</option>
            {FACTIONS.map((id) => (
              <option key={id} value={id}>
                {FACTION_PRESET_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zoom
          <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
            {ZOOMS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            title={`Write the rig, every part and a picture of every frame to public${RIG_URL}. Part pictures use the sheet's colours. jap_walk.png is never written.`}
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
      </header>

      <div className="frame-editor-clips" role="tablist" aria-label="Clips">
        {CLIP_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === clip}
            onClick={() => {
              setClip(key);
              setIndex(0);
              setTick(0);
            }}
          >
            {CLIP_LABEL[key]} <small>{rig.clips[key].length}</small>
          </button>
        ))}
      </div>

      <div className="frame-editor-strip" role="group" aria-label={`${CLIP_LABEL[clip]} frames`}>
        {shown.map((item, at) => (
          <button
            key={at}
            type="button"
            aria-pressed={at === frameIndex}
            aria-label={`${CLIP_LABEL[clip]} ${at}`}
            onClick={() => {
              setIndex(at);
              setPlaying(false);
            }}
          >
            <FrameThumb frame={item} lut={lut} />
            <small>
              {at} · pose {frames[at]?.pose}
            </small>
          </button>
        ))}
        {frames.length === 0 && <p className="frame-editor-note">No frames yet. Add one below.</p>}
      </div>

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
        <button
          type="button"
          disabled={!frame}
          onClick={() => frame && insertFrame(breathFrame(frame), "A breath frame")}
          title="Copy this frame with the head and torso moved one pixel up. The movement stays when a part is swapped."
        >
          Add breath frame
        </button>
        <button
          type="button"
          disabled={!frame}
          onClick={() => frame && insertFrame(shotFrame(frame), "A shot frame")}
          title="Copy this frame with the weapon moved two pixels back and the muzzle flash on. The movement stays when a part is swapped."
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
        {LAYER_ORDER.map((name) => (
          <label key={name}>
            {LAYER_NAME[name]}
            <select
              aria-label={`${LAYER_NAME[name]} part`}
              value={rig.wearing[name]}
              title={`Swap the ${LAYER_NAME[name].toLowerCase()} in every frame of every clip.`}
              onChange={(event) => {
                const next = wearPart(rig, name, event.target.value);
                commit(next);
                setLayer(name);
                setNote(`The ${LAYER_NAME[name].toLowerCase()} now wears “${wornPart(next, name).name}” in every frame of every clip.`);
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

      <div className="frame-editor-row frame-editor-parts" role="group" aria-label="Builds">
        <strong>Builds</strong>
        <label>
          Saved
          <select
            aria-label="Saved build"
            value={savedBuild?.id ?? ""}
            title="Put a saved build's four parts and colours on."
            onChange={(event) => putOnBuild(event.target.value)}
          >
            <option value="">{rig.builds.length === 0 ? "None saved yet" : "Not a saved build"}</option>
            {rig.builds.map((build) => (
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
          onClick={saveCurrentBuild}
          title="Save the four parts being worn, and the colour set, under the name. A name already in use is saved over."
        >
          Save build
        </button>
        <button
          type="button"
          disabled={!savedBuild}
          onClick={() => savedBuild && deleteBuild(savedBuild.id)}
          title="Delete the saved build that is on now. Its parts stay in the library."
        >
          Delete build
        </button>
      </div>

      <div className="frame-editor-strip frame-editor-shelf" role="group" aria-label={`${LAYER_NAME[layer]} parts`}>
        {shelf.map(({ part, pixels }) => (
          <button
            key={part.id}
            type="button"
            aria-pressed={part.id === rig.wearing[layer]}
            title={`Wear “${part.name}” in every frame of every clip.`}
            onClick={() => {
              commit(wearPart(rig, layer, part.id));
              setNote(`The ${LAYER_NAME[layer].toLowerCase()} now wears “${part.name}” in every frame of every clip.`);
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
              <button key={item.id} type="button" aria-pressed={tool === item.id} title={item.help} onClick={() => setTool(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <h3>Layer</h3>
          <div role="group" aria-label="Layers">
            {LAYER_ORDER.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={layer === name}
                title="The pencil paints this layer's part. Arrow keys move the layer on this frame. Shift and an arrow key slide the drawing itself. [ and ] switch layers. The order never changes: legs, torso, head, weapon on top."
                onClick={() => setLayer(name)}
              >
                {LAYER_NAME[name]}
              </button>
            ))}
          </div>
          <label className="frame-editor-check">
            <input type="checkbox" checked={dimOthers} onChange={(event) => setDimOthers(event.target.checked)} />
            Fade other layers
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
          <p className="frame-editor-note">{frame ? movementText(frame) : ""}</p>
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
                `${CLIP_LABEL[clip]} ${frameIndex} has its own pose now. Painting it changes no other frame. Every part got a drawing for the new pose.`,
              );
            }}
            title="Give this frame a pose of its own, with its movement drawn in, so it can be repainted without changing the frames it was copied from."
          >
            Give this frame its own pose
          </button>

          <h3>{LAYER_NAME[layer]} part</h3>
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
            title={`Make a ${LAYER_NAME[layer].toLowerCase()} part from a PNG. ${rig.width}×${rig.height} is one drawing, placed on every pose by the skeleton. ${rig.width * rig.poses}×${rig.height} is a strip with one drawing per pose.`}
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
            title={`Open an ${rig.width}×${rig.height} PNG onto this pose of the worn ${LAYER_NAME[layer].toLowerCase()} part.`}
          >
            Open a picture onto this pose
          </button>
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
                      : `The ${LAYER_NAME[layer].toLowerCase()} outline now follows “${wornPart(current, layer).name}” on every pose. New ${LAYER_NAME[layer].toLowerCase()} parts are held to it.`,
                  );
                }}
                title="Take the skeleton's outline again from the worn part, on all poses. Use it after the walk itself has been cleaned up. A torso's outline also covers what the worn weapon hides."
              >
                Use this part as the outline
              </button>
            </>
          )}

          <h3>Colour</h3>
          <div className="frame-editor-swatches" role="group" aria-label="Colours">
            {SLOT_LABELS.map((label, value) =>
              value === 0 ? null : (
                <button
                  key={label}
                  type="button"
                  aria-pressed={slot === value}
                  aria-label={label}
                  title={label}
                  style={{ background: lut[value] }}
                  onClick={() => {
                    setSlot(value);
                    setTool("pencil");
                  }}
                />
              ),
            )}
          </div>
          <p className="frame-editor-note">{SLOT_LABELS[slot]}</p>
        </aside>

        <div className="frame-editor-canvas">
          {frame ? (
            <canvas
              ref={canvasRef}
              aria-label={`${CLIP_LABEL[clip]} ${frameIndex}, ${LAYER_NAME[layer]} layer`}
              style={{ width: rig.width * zoom, height: rig.height * zoom }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={endStroke}
            />
          ) : (
            <p className="frame-editor-note">Pick a frame, or add one to {CLIP_LABEL[clip]}.</p>
          )}
          {frame && worn && (
            <p className="frame-editor-note">
              Painting changes “{worn.name}” on pose {frame.pose}. That pose shows on {describeFrames(sharing)}.
            </p>
          )}
          <p className="frame-editor-note">{note}</p>
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
            The cream cross is the feet. The game stands them on the card's ground point. The red cross is the muzzle.
          </p>
        </figure>
      </div>

      {import.meta.env.DEV && (
        <section className="frame-editor-gen" aria-label="Generate a part">
          <h3>Generate a {LAYER_NAME[layer].toLowerCase()} part</h3>
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
                placeholder={`Describe the ${LAYER_NAME[layer].toLowerCase()}`}
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
                    {LAYER_NAME[candidate.layer]}: {candidate.name} · seed {candidate.seed}
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
.frame-editor-sent {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.frame-editor-sent figure {
  margin: 0;
}
.frame-editor-sent canvas {
  display: block;
  image-rendering: pixelated;
  box-shadow: 0 0 0 1px #4b3d44;
}
.frame-editor-sent figcaption {
  margin-top: 4px;
  color: #a99c8d;
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
  height: 160px;
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
  width: 80px;
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
.frame-editor-swatches button {
  width: 28px;
  height: 28px;
  padding: 0;
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
`;
