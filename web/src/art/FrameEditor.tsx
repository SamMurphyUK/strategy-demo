import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import {
  AS_DRAWN_LUT,
  CLIP_KEYS,
  CLIP_LABEL,
  LAYER_NAME,
  LAYER_ORDER,
  breathFrom,
  cardRgba,
  clipsFromWalkSheet,
  cloneFrame,
  emptyFrame,
  eraseCell,
  fillTorsoUnderWeapon,
  frameFileName,
  frameRgba,
  fromFrameFile,
  nudgeLayer,
  paintCell,
  placeLayerImage,
  readClipsFile,
  shotFrom,
  toClipsFile,
  toFrameFile,
  type ClipKey,
  type FrameClips,
  type SpriteFrame,
} from "./frameClips";
import { FACTION_LUTS, FACTION_PRESET_LABEL, SLOT_LABELS, type FactionPresetId, type PartCategory } from "./paperDoll";

const UNIT_ID = "jap_infantry";
const WALK_SHEET_URL = "/assets/units/jap_walk.png";
const FRAMES_URL = `/assets/units/frames/${UNIT_ID}`;
const FACTIONS = Object.keys(FACTION_LUTS) as FactionPresetId[];

type ColourSet = FactionPresetId | "SHEET";
const ZOOMS = [4, 6, 8, 10] as const;
const UNDO_LIMIT = 100;

type Tool = "pencil" | "eraser" | "feet" | "muzzle";

const TOOLS: readonly { id: Tool; label: string; help: string }[] = [
  {
    id: "pencil",
    label: "Pencil",
    help: "Paint the picked colour onto the picked layer. Alt-click picks up a colour.",
  },
  { id: "eraser", label: "Eraser", help: "Clear the square on every layer." },
  {
    id: "feet",
    label: "Feet",
    help: "Click where the boots stand. The game puts this point on the ground line. It is the same for every frame.",
  },
  {
    id: "muzzle",
    label: "Muzzle",
    help: "Click the end of the barrel on this frame. The flash draws from here.",
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

async function walkSheetClips(): Promise<FrameClips> {
  const image = await loadImage(WALK_SHEET_URL);
  return clipsFromWalkSheet(imageRgba(image), image.naturalWidth, image.naturalHeight, UNIT_ID);
}

async function savedClips(): Promise<FrameClips | null> {
  const response = await fetch(`${FRAMES_URL}/clips.json`, {
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  const json: unknown = await response.json().catch(() => null);
  if (json === null) {
    return null;
  }
  const file = readClipsFile(json);
  const clips = { idle: [], walk: [], fire: [] } as Record<ClipKey, SpriteFrame[]>;
  for (const key of CLIP_KEYS) {
    for (const name of file.clips[key]) {
      const frame = await fetch(`${FRAMES_URL}/${name}.json`, {
        cache: "no-store",
      }).then((item) => item.json());
      clips[key].push(fromFrameFile(frame));
    }
  }
  return {
    unitId: file.unitId,
    width: file.width,
    height: file.height,
    feet: file.feet,
    clips,
  };
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

async function framePngBase64(frame: SpriteFrame, lut: readonly string[]): Promise<string> {
  const canvas = document.createElement("canvas");
  putRgba(canvas, frameRgba(frame, lut), frame.width, frame.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("The frame could not be turned into a PNG.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function withFrame(clips: FrameClips, clip: ClipKey, index: number, frame: SpriteFrame): FrameClips {
  if (clips.clips[clip][index] === frame) {
    return clips;
  }
  return {
    ...clips,
    clips: {
      ...clips.clips,
      [clip]: clips.clips[clip].map((item, at) => (at === index ? frame : item)),
    },
  };
}

function withClip(clips: FrameClips, clip: ClipKey, frames: SpriteFrame[]): FrameClips {
  return { ...clips, clips: { ...clips.clips, [clip]: frames } };
}

function FrameThumb({ frame, lut }: { frame: SpriteFrame; lut: readonly string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => putRgba(ref.current, frameRgba(frame, lut), frame.width, frame.height), [frame, lut]);
  return <canvas ref={ref} width={frame.width} height={frame.height} />;
}

export function FrameEditor() {
  const [clips, setClipsState] = useState<FrameClips | null>(null);
  const [clip, setClip] = useState<ClipKey>("idle");
  const [index, setIndex] = useState(0);
  const [layer, setLayer] = useState<PartCategory>("torso");
  const [tool, setTool] = useState<Tool>("pencil");
  const [slot, setSlot] = useState(2);
  const [faction, setFaction] = useState<ColourSet>("SHEET");
  const [zoom, setZoom] = useState<number>(8);
  const [dimOthers, setDimOthers] = useState(false);
  const [addFrom, setAddFrom] = useState("walk:0");
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [fps, setFps] = useState(6);
  const [note, setNote] = useState("Opening the frames…");
  const [busy, setBusy] = useState(false);
  const clipsRef = useRef<FrameClips | null>(null);
  const undoRef = useRef<FrameClips[]>([]);
  const strokeRef = useRef(false);
  const strokeSavedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lut = faction === "SHEET" ? AS_DRAWN_LUT : FACTION_LUTS[faction];
  const frames = clips?.clips[clip] ?? [];
  const frame = frames[Math.min(index, frames.length - 1)] ?? null;
  const frameIndex = frame ? Math.min(index, frames.length - 1) : -1;

  const setClips = useCallback((next: FrameClips) => {
    clipsRef.current = next;
    setClipsState(next);
  }, []);

  const remember = useCallback(() => {
    const current = clipsRef.current;
    if (current) {
      undoRef.current = [...undoRef.current.slice(-(UNDO_LIMIT - 1)), current];
    }
  }, []);

  const commit = useCallback(
    (next: FrameClips) => {
      if (next !== clipsRef.current) {
        remember();
        setClips(next);
      }
    },
    [remember, setClips],
  );

  const undo = useCallback(() => {
    const previous = undoRef.current.pop();
    if (previous) {
      setClips(previous);
      setNote("Undone.");
    }
  }, [setClips]);

  const editFrame = useCallback(
    (change: (current: SpriteFrame) => SpriteFrame) => {
      const current = clipsRef.current;
      const target = current?.clips[clip][frameIndex];
      if (!current || !target) {
        return;
      }
      commit(withFrame(current, clip, frameIndex, change(target)));
    },
    [clip, commit, frameIndex],
  );

  const startFresh = useCallback(async () => {
    const fresh = await walkSheetClips();
    undoRef.current = [];
    setClips(fresh);
    setClip("idle");
    setIndex(0);
    setNote("Split jap_walk.png into eight walking frames. Idle starts as a copy of walking frame 0.");
  }, [setClips]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await savedClips();
        if (cancelled) {
          return;
        }
        if (saved) {
          setClips(saved);
          setNote(`Opened the saved frames from public${FRAMES_URL}.`);
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
  }, [setClips, startFresh]);

  useEffect(() => {
    if (!playing || frames.length < 2) {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [playing, fps, frames.length]);

  const cardFrame = playing && frames.length > 0 ? frames[tick % frames.length] : frame;

  useEffect(() => {
    if (!clips || !cardFrame) {
      putRgba(cardRef.current, new Uint8ClampedArray(SPRITE_BAKE.width * SPRITE_BAKE.height * 4), SPRITE_BAKE.width, SPRITE_BAKE.height);
      return;
    }
    putRgba(cardRef.current, cardRgba(cardFrame, lut, clips.feet), SPRITE_BAKE.width, SPRITE_BAKE.height);
  }, [cardFrame, clips, lut]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !clips) {
      return;
    }
    const width = clips.width;
    const height = clips.height;
    canvas.width = width * zoom;
    canvas.height = height * zoom;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        ctx.fillStyle = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? "#3a332e" : "#2f2925";
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    }
    if (!frame) {
      return;
    }
    const shown = dimOthers
      ? {
          ...frame,
          layers: {
            legs: [],
            torso: [],
            head: [],
            weapon: [],
            [layer]: frame.layers[layer],
          },
        }
      : frame;
    const ghost = dimOthers ? frameRgba(frame, lut) : null;
    const rgba = frameRgba(shown as SpriteFrame, lut);
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
    cross(clips.feet.x, clips.feet.y, MILITARY.cream);
    if (frame.muzzle) {
      cross(frame.muzzle.x, frame.muzzle.y, MILITARY.crimson);
    }
  }, [clips, dimOthers, frame, layer, lut, zoom]);

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
      if (move) {
        event.preventDefault();
        editFrame((current) => nudgeLayer(current, layer, move[0], move[1]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editFrame, layer, undo]);

  const cellAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width / event.currentTarget.width;
    return {
      x: Math.floor((event.clientX - rect.left) / scale / zoom),
      y: Math.floor((event.clientY - rect.top) / scale / zoom),
    };
  };

  const applyTool = (x: number, y: number, first: boolean, alt: boolean) => {
    const current = clipsRef.current;
    const target = current?.clips[clip][frameIndex];
    if (!current || !target || x < 0 || y < 0 || x >= target.width || y >= target.height) {
      return;
    }
    const cell = y * target.width + x;
    if (alt) {
      for (const name of [...LAYER_ORDER].reverse()) {
        const found = target.layers[name][cell] ?? 0;
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
      next = withFrame(current, clip, frameIndex, paintCell(target, layer, x, y, slot));
    } else if (tool === "eraser") {
      next = withFrame(current, clip, frameIndex, eraseCell(target, x, y));
    } else if (tool === "feet" && first) {
      next = current.feet.x === x && current.feet.y === y ? current : { ...current, feet: { x, y } };
    } else if (tool === "muzzle" && first) {
      next = withFrame(current, clip, frameIndex, {
        ...target,
        muzzle: { x, y },
      });
    }
    if (next === current) {
      return;
    }
    if (!strokeSavedRef.current) {
      remember();
      strokeSavedRef.current = true;
    }
    setClips(next);
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
      clips
        ? CLIP_KEYS.flatMap((key) =>
            clips.clips[key].map((_, at) => ({
              value: `${key}:${at}`,
              label: `${CLIP_LABEL[key]} ${at}`,
            })),
          )
        : [],
    [clips],
  );

  const insertFrame = (made: SpriteFrame, label: string) => {
    const current = clipsRef.current;
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
    const current = clipsRef.current;
    if (!current) {
      return;
    }
    if (addFrom === "blank") {
      insertFrame(emptyFrame(current.width, current.height), "A blank frame");
      return;
    }
    const [key, at] = addFrom.split(":") as [ClipKey, string];
    const source = current.clips[key]?.[Number(at)];
    if (source) {
      insertFrame(cloneFrame(source), `A copy of ${CLIP_LABEL[key]} ${at}`);
    }
  };

  const deleteFrame = () => {
    const current = clipsRef.current;
    if (!current || frameIndex < 0) {
      return;
    }
    const list = current.clips[clip].filter((_, at) => at !== frameIndex);
    commit(withClip(current, clip, list));
    setIndex(Math.max(0, frameIndex - 1));
    setNote(`Deleted ${CLIP_LABEL[clip]} ${frameIndex}. Ctrl+Z brings it back.`);
  };

  const moveFrame = (step: number) => {
    const current = clipsRef.current;
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

  const openPicture = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      const rgba = imageRgba(image);
      editFrame((current) => placeLayerImage(current, layer, rgba, image.naturalWidth, image.naturalHeight));
      setNote(`Put ${file.name} on the ${LAYER_NAME[layer]} layer. Ctrl+Z takes it off.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const save = async () => {
    const current = clipsRef.current;
    if (!current) {
      return;
    }
    setBusy(true);
    try {
      const items = [];
      for (const key of CLIP_KEYS) {
        for (const [at, item] of current.clips[key].entries()) {
          items.push({
            name: frameFileName(key, at),
            frame: toFrameFile(item),
            pngBase64: await framePngBase64(item, lut),
          });
        }
      }
      const response = await fetch("/__dev/save-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: toClipsFile(current), frames: items }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error || `Saving failed (${response.status}).`);
      }
      setNote(`Saved ${json.frames} frames to ${json.path}. Each frame is a PNG and a JSON file.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!clips) {
    return (
      <section className="frame-editor" aria-label="Frame editor">
        <style>{FRAME_EDITOR_CSS}</style>
        <p className="frame-editor-note">{note}</p>
      </section>
    );
  }

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
            title={`Write every frame to public${FRAMES_URL}. jap_walk.png is never written.`}
          >
            {busy ? "Saving…" : "Save frames"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void startFresh().catch((error) => setNote(String(error)))}
          title="Throw away these frames and split jap_walk.png again. Ctrl+Z does not undo this."
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
            {CLIP_LABEL[key]} <small>{clips.clips[key].length}</small>
          </button>
        ))}
      </div>

      <div className="frame-editor-strip" role="group" aria-label={`${CLIP_LABEL[clip]} frames`}>
        {frames.map((item, at) => (
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
            <small>{at}</small>
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
            <option value="blank">Blank</option>
          </select>
        </label>
        <button type="button" onClick={addCopy} title="Put a copy of that frame after the current one in this clip.">
          Add frame
        </button>
        <button
          type="button"
          disabled={!frame}
          onClick={() => frame && insertFrame(breathFrom(frame), "A breath frame")}
          title="Copy this frame with the head and torso one pixel higher."
        >
          Add breath frame
        </button>
        <button
          type="button"
          disabled={!frame}
          onClick={() => frame && insertFrame(shotFrom(frame), "A shot frame")}
          title="Copy this frame with the weapon two pixels back and the muzzle flash on."
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
                title="The pencil paints this layer. Arrow keys move it. [ and ] switch layers. The order never changes: legs, torso, head, weapon on top."
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
          <button
            type="button"
            disabled={!frame}
            onClick={() => editFrame(fillTorsoUnderWeapon)}
            title="Paint tunic under every weapon pixel that sits over the body, so moving the weapon leaves no hole."
          >
            Fill torso under weapon
          </button>
          <label className="frame-editor-check">
            <input
              type="checkbox"
              checked={frame?.flash ?? false}
              disabled={!frame}
              onChange={(event) =>
                editFrame((current) => ({
                  ...current,
                  flash: event.target.checked,
                }))
              }
            />
            Muzzle flash
          </label>
          <button
            type="button"
            disabled={!frame}
            onClick={() => fileRef.current?.click()}
            title={`Open an ${clips.width}×${clips.height} PNG onto the ${LAYER_NAME[layer]} layer. Use it to swap a weapon or a head.`}
          >
            Open a picture onto this layer
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void openPicture(file);
              }
            }}
          />
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
              style={{ width: clips.width * zoom, height: clips.height * zoom }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={endStroke}
            />
          ) : (
            <p className="frame-editor-note">Pick a frame, or add one to {CLIP_LABEL[clip]}.</p>
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
.frame-editor button, .frame-editor select {
  font: 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  padding: 6px 10px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
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
  width: 200px;
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
