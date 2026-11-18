import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MILITARY } from "../ui/theme/militaryPalette";
import {
  FACTION_LUTS,
  FACTION_PRESET_LABEL,
  MASK_RGB,
  PART_CATEGORIES,
  SLOT_LABELS,
  bakeSpritesheet,
  composeFrame,
  extractRig,
  floodMask,
  importQuantizedPart,
  paintPartCell,
  maskFromRgba,
  maskPixelsInRect,
  nudgeSocket,
  paintIndexed,
  paintMaskPixels,
  placeSocket,
  rebuildIdleAndFire,
  rebuildPartsFromMask,
  retintWalkParts,
  layoutWalkGrid,
  type AnimationState,
  type FactionPresetId,
  type IndexedImage,
  type ModularPart,
  type PartCategory,
  type PixelPoint,
  type RigManifest,
} from "./paperDoll";

type Pin = "head" | "weapon" | "torso";
type MaskBrush = PartCategory | "erase";
type EditMode = "paint" | "select" | "pins";

interface ReferenceSheet {
  rgba: Uint8ClampedArray;
  mask: (PartCategory | null)[];
  overrides: number[];
  width: number;
  height: number;
}

interface Marquee {
  a: PixelPoint;
  b: PixelPoint;
}

const RIG_SCALE = 6;
const PREVIEW_SCALE = 4;
const RIG_ZOOMS = [4, 6, 8, 12, 16] as const;
const PIN_LABEL: Record<Pin, string> = {
  head: "Head",
  weapon: "Rifle",
  torso: "Hip",
};
const PIN_COLOR: Record<Pin, string> = {
  head: "#ff4d4d",
  weapon: "#4d7dff",
  torso: "#ffe14a",
};
const MASK_LABEL: Record<PartCategory, string> = {
  head: "Head",
  torso: "Torso",
  weapon: "Weapon",
  legs: "Legs",
};

const EMPTY_SELECTION: Record<PartCategory, string> = {
  legs: "",
  torso: "",
  head: "",
  weapon: "",
};

export function PaperDollPanel({
  onDrawOnSprite,
}: {
  onDrawOnSprite?: (manifest: RigManifest, parts: Record<PartCategory, ModularPart>) => void;
}) {
  const [sheet, setSheet] = useState<ReferenceSheet | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [brush, setBrush] = useState<MaskBrush>("head");
  const [editMode, setEditMode] = useState<EditMode>("paint");
  const [paintSlot, setPaintSlot] = useState(0);
  const [selection, setSelection] = useState<PixelPoint[]>([]);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [solo, setSolo] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [zoom, setZoom] = useState<number | null>(null);
  const [onion, setOnion] = useState(true);
  const [manifest, setManifest] = useState<RigManifest | null>(null);
  const [parts, setParts] = useState<ModularPart[]>([]);
  const [selected, setSelected] = useState<Record<PartCategory, string>>(EMPTY_SELECTION);
  const [faction, setFaction] = useState<FactionPresetId>("GER");
  const [lut, setLut] = useState<string[]>(() => [...FACTION_LUTS.GER]);
  const [animation, setAnimation] = useState<AnimationState>("walk");
  const [fps, setFps] = useState<8 | 12>(8);
  const [playing, setPlaying] = useState(true);
  const [playFrame, setPlayFrame] = useState(0);
  const [pin, setPin] = useState<Pin>("head");
  const [importCategory, setImportCategory] = useState<PartCategory>("head");
  const [editingPart, setEditingPart] = useState<PartCategory | null>(null);
  const [partFrame, setPartFrame] = useState<number | null>(null);
  const [notice, setNotice] = useState("Load an 8-frame walk, then paint or select the pixels in each area.");
  const rigRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLCanvasElement>(null);
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<ReferenceSheet | null>(null);
  const partsRef = useRef<ModularPart[]>([]);
  const selectedRef = useRef(selected);
  const brushRef = useRef<MaskBrush>("head");
  const paintSlotRef = useRef(0);
  const selectionRef = useRef<PixelPoint[]>([]);
  const animationRef = useRef<AnimationState>("walk");
  const stroke = useRef<"paint" | "select" | "pin" | null>(null);
  const history = useRef<Array<{ mask: (PartCategory | null)[]; overrides: number[] }>>([]);
  const historyArmed = useRef(false);
  const paintedStroke = useRef(false);
  const selectOrigin = useRef<PixelPoint>({ x: 0, y: 0 });
  const selectBase = useRef<PixelPoint[]>([]);
  const selectSubtract = useRef(false);
  const undoRef = useRef<() => void>(() => undefined);
  const frameRef = useRef(0);
  const pinRef = useRef<Pin>("head");
  frameRef.current = frameIndex;
  pinRef.current = pin;
  partsRef.current = parts;
  selectedRef.current = selected;
  brushRef.current = brush;
  paintSlotRef.current = paintSlot;
  selectionRef.current = selection;
  animationRef.current = animation;
  sheetRef.current = sheet;

  const frameWidth = sheet ? sheet.width / 8 : 0;
  const frameHeight = sheet?.height ?? 0;
  const rigScale = zoom ?? (frameWidth > 48 ? 4 : RIG_SCALE);
  const rigScaleRef = useRef(rigScale);
  rigScaleRef.current = rigScale;
  const previewScale = frameWidth > 48 ? 3 : PREVIEW_SCALE;
  const socket = manifest?.animations.walk[frameIndex];
  const assembly = assemble(parts, selected);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        if (target instanceof Element && target.closest(".rig-panel")) {
          event.preventDefault();
          undoRef.current();
        }
        return;
      }
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!step) {
        return;
      }
      event.preventDefault();
      const [dx, dy] = step;
      setManifest((current) => (current ? nudgeSocket(current, "walk", frameRef.current, pinRef.current, dx ?? 0, dy ?? 0) : current));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = window.setInterval(() => setPlayFrame((value) => value + 1), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [playing, fps]);

  useEffect(() => {
    const frame = frameBoxRef.current;
    if (!frame) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(stepZoom(rigScaleRef.current, event.deltaY));
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const canvas = rigRef.current;
    if (!canvas || !sheet || frameWidth === 0) {
      return;
    }
    drawRig(canvas, sheet, frameIndex, onion, lut);
    const marks = markRef.current;
    if (marks) {
      drawMarks(marks, sheet, frameIndex, rigScale, {
        areas: solo && brush !== "erase" ? [brush] : [...PART_CATEGORIES],
        selection,
        marquee,
      });
    }
  }, [sheet, frameIndex, onion, frameWidth, selection, marquee, solo, brush, lut, rigScale]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !manifest || !assembly) {
      return;
    }
    const count = manifest.animations[animation].length;
    const index = ((playFrame % count) + count) % count;
    drawPreview(canvas, manifest, assembly, lut, animation, index);
  }, [manifest, assembly, lut, animation, playFrame]);

  const syncParts = (next: ReferenceSheet) => {
    const chosen = assemble(partsRef.current, selectedRef.current);
    const previous = chosen ? PART_CATEGORIES.map((category) => chosen[category]) : partsRef.current;
    const rebuilt = rebuildPartsFromMask(
      next.rgba,
      next.mask,
      next.overrides ?? blankOverrides(next.mask.length),
      next.width,
      next.height,
      previous,
      next.width === 640 && next.height === 80,
    );
    setParts((current) => mergeParts(current, rebuilt));
  };

  const pushHistory = () => {
    const current = sheetRef.current;
    if (!current) {
      return;
    }
    history.current.push({ mask: current.mask.slice(), overrides: (current.overrides ?? blankOverrides(current.mask.length)).slice() });
    if (history.current.length > 40) {
      history.current.shift();
    }
  };

  const writePixels = (pixels: readonly PixelPoint[], category: PartCategory | null, slot: number, record: boolean) => {
    const current = sheetRef.current;
    if (!current || pixels.length === 0) {
      return false;
    }
    const frameWidthNow = current.width / 8;
    const overrides = current.overrides ?? blankOverrides(current.mask.length);
    const painted = paintMaskPixels(current.mask, overrides, current.width, frameRef.current, frameWidthNow, current.height, pixels, category, slot);
    if (painted.mask === current.mask && painted.overrides === current.overrides) {
      return false;
    }
    if (record) {
      pushHistory();
    }
    const next = { ...current, mask: painted.mask, overrides: painted.overrides };
    sheetRef.current = next;
    setSheet(next);
    return true;
  };

  const paintAt = (pixel: PixelPoint) => {
    const category = brushRef.current === "erase" ? null : brushRef.current;
    const changed = writePixels([pixel], category, paintSlotRef.current, historyArmed.current);
    if (changed) {
      historyArmed.current = false;
      paintedStroke.current = true;
    }
  };

  const finishPaint = () => {
    const current = sheetRef.current;
    if (!current || !paintedStroke.current) {
      paintedStroke.current = false;
      return;
    }
    paintedStroke.current = false;
    syncParts(current);
    const area = brushRef.current;
    if (area !== "erase" && area !== "legs" && frameRef.current !== 0) {
      setNotice("Helmet, tunic, and rifle are read from frame 0. This frame keeps its own legs.");
      return;
    }
    if (area === "legs") {
      setNotice(`Frame ${frameRef.current} legs are in the preview.`);
      return;
    }
    if (area === "erase") {
      setNotice("Those pixels were cleared.");
      return;
    }
    setNotice(`The ${MASK_LABEL[area].toLowerCase()} pixels are in the preview.`);
  };

  const undoPaint = () => {
    const snap = history.current.pop();
    const current = sheetRef.current;
    if (!snap || !current) {
      setNotice("Nothing to undo.");
      return;
    }
    const next = { ...current, mask: snap.mask, overrides: snap.overrides };
    sheetRef.current = next;
    setSheet(next);
    setSelection([]);
    syncParts(next);
    setNotice("Brought back the previous pixels.");
  };
  undoRef.current = undoPaint;

  const assignSelection = (category: PartCategory | null) => {
    if (selectionRef.current.length === 0) {
      setNotice("Select some pixels first.");
      return;
    }
    const changed = writePixels(selectionRef.current, category, paintSlotRef.current, true);
    const current = sheetRef.current;
    if (!changed || !current) {
      setNotice("Those pixels were already in that area.");
      return;
    }
    setSelection([]);
    syncParts(current);
    setNotice(category ? `${MASK_LABEL[category]} now owns those pixels.` : "Those pixels were cleared.");
  };

  const holdStill = () => {
    setPlaying(false);
    if (animationRef.current !== "walk") {
      setAnimation("walk");
    }
    setPlayFrame(frameRef.current);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = rigRef.current;
    const current = sheetRef.current;
    if (!canvas || !current) {
      return;
    }
    const pixel = pixelOf(canvas, event.clientX, event.clientY);
    if (!pixel) {
      return;
    }
    canvas.focus();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic event cannot capture the pointer. The stroke still paints.
    }
    if (editMode === "pins") {
      const hit = socket ? pinAt(pixel, socket, pin, Math.max(3, Math.round(18 / rigScaleRef.current))) : null;
      if (!hit) {
        return;
      }
      stroke.current = "pin";
      setPin(hit);
      setManifest((manifestNow) => (manifestNow ? placeSocket(manifestNow, "walk", frameIndex, hit, pixel) : manifestNow));
      return;
    }
    holdStill();
    if (editMode === "select") {
      const modify = event.shiftKey || event.altKey;
      selectBase.current = modify ? selectionRef.current : [];
      selectSubtract.current = event.altKey;
      selectOrigin.current = pixel;
      if (!modify) {
        setSelection([]);
      }
      setMarquee({ a: pixel, b: pixel });
      stroke.current = "select";
      return;
    }
    historyArmed.current = true;
    paintedStroke.current = false;
    stroke.current = "paint";
    paintAt(pixel);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = rigRef.current;
    if (!canvas || stroke.current === null) {
      return;
    }
    const pixel = pixelOf(canvas, event.clientX, event.clientY);
    if (!pixel) {
      return;
    }
    if (stroke.current === "pin") {
      setManifest((current) => (current ? placeSocket(current, "walk", frameRef.current, pinRef.current, pixel) : current));
      return;
    }
    if (stroke.current === "select") {
      setMarquee({ a: selectOrigin.current, b: pixel });
      return;
    }
    paintAt(pixel);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = rigRef.current;
    const kind = stroke.current;
    stroke.current = null;
    if (kind === "paint") {
      finishPaint();
      return;
    }
    if (kind !== "select" || !canvas) {
      return;
    }
    const current = sheetRef.current;
    const pixel = pixelOf(canvas, event.clientX, event.clientY) ?? selectOrigin.current;
    setMarquee(null);
    if (!current) {
      return;
    }
    const frameWidthNow = current.width / 8;
    const origin = selectOrigin.current;
    const picked =
      origin.x === pixel.x && origin.y === pixel.y
        ? floodMask(current.mask, current.rgba, current.width, frameWidthNow, current.height, frameRef.current, origin)
        : maskPixelsInRect(current.mask, current.rgba, current.width, frameWidthNow, current.height, frameRef.current, origin, pixel);
    const next = mergeSelection(selectBase.current, picked, selectSubtract.current);
    setSelection(next);
    const count = next.length;
    setNotice(
      count === 0
        ? "The box had no pixels."
        : count === 1
          ? "1 pixel selected. Assign it to an area, or paint a colour onto it."
          : `${count} pixels selected. Assign them to an area, or paint a colour onto them.`,
    );
  };

  const loadWalk = useCallback(async () => {
    setNotice("Loading the walk sheet.");
    try {
      const response = await fetch("/assets/units/jap_walk.png");
      if (!response.ok) {
        throw new Error("The walk sheet is missing.");
      }
      const blob = await response.blob();
      const image = await readPng(new File([blob], "jap_walk.png", { type: "image/png" }));
      if (!image) {
        throw new Error("The walk sheet could not be read.");
      }
      const laid = layoutWalkGrid(image.data, image.width, image.height);
      const next = withOverrides(laid);
      const result = extractRig(next.rgba, next.mask, next.width, next.height, "jap_walk");
      const tinted = retintWalkParts(result.parts);
      sheetRef.current = next;
      setSheet(next);
      setFrameIndex(0);
      setManifest(result.manifest);
      setParts((current) => mergeParts(current, tinted));
      setSelected({
        head: "head_base",
        torso: "torso_base",
        legs: "legs_base",
        weapon: "weapon_base",
      });
      setSelection([]);
      setNotice("Walk sheet loaded. Paint or select pixels for the helmet, tunic, rifle, and legs.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadWalk();
  }, [loadWalk]);

  const extract = () => {
    if (!sheet) {
      setNotice("Load a reference sheet first.");
      return;
    }
    try {
      const result = extractRig(sheet.rgba, sheet.mask, sheet.width, sheet.height);
      const tinted = rebuildPartsFromMask(
        sheet.rgba,
        sheet.mask,
        sheet.overrides,
        sheet.width,
        sheet.height,
        result.parts,
        sheet.width === 640 && sheet.height === 80,
      );
      setManifest(result.manifest);
      setParts((current) => mergeParts(current, tinted));
      setSelected({
        head: "head_base",
        torso: "torso_base",
        legs: "legs_base",
        weapon: "weapon_base",
      });
      setNotice("Rig extracted. Idle breathes one pixel. Fire kicks the rifle two pixels and flashes on the middle frame.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const applyPreset = (id: FactionPresetId) => {
    setFaction(id);
    setLut([...FACTION_LUTS[id]]);
  };

  const bake = () => {
    if (!manifest || !assembly) {
      setNotice("Extract a rig and choose a head, torso, legs, and weapon before baking.");
      return;
    }
    const baked = bakeSpritesheet(manifest, assembly, lut, FACTION_PRESET_LABEL[faction]);
    const canvas = document.createElement("canvas");
    canvas.width = baked.width;
    canvas.height = baked.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setNotice("The spritesheet could not be drawn.");
      return;
    }
    ctx.imageSmoothingEnabled = false;
    putPixels(ctx, baked.rgba, baked.width, baked.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setNotice("The spritesheet could not be saved.");
        return;
      }
      saveBlob(blob, "spritesheet.png");
      saveBlob(new Blob([JSON.stringify(baked.meta, null, 2)], { type: "application/json" }), "spritesheet.json");
      setNotice(`Baked ${baked.width}×${baked.height}. Walk, idle, and fire are three rows.`);
    });
  };

  return (
    <section className="rig-panel" aria-label="Skeleton rigging">
      <style>{RIG_CSS}</style>
      <header className="rig-head">
        <h3>Skeleton rig</h3>
        <p>{notice}</p>
      </header>
      <div className="rig-tools">
        <button type="button" onClick={() => void loadWalk()}>
          Load the walk
        </button>
        <label className="sprite-open">
          Import reference sheet
          <input
            type="file"
            accept="image/png,.png"
            aria-label="Import reference sheet"
            onChange={(event) => {
              void readSheet(event.target.files?.[0]).then((next) => {
                if (!next) {
                  return;
                }
                if (next.width % 8 !== 0) {
                  setNotice("The reference sheet needs eight equal frames across.");
                  return;
                }
                sheetRef.current = next;
                setSheet(next);
                setFrameIndex(0);
                setSelection([]);
                setNotice("Reference loaded. Paint or select the four areas, then extract.");
              });
              event.target.value = "";
            }}
          />
        </label>
        <label className="sprite-open">
          Import mask
          <input
            type="file"
            accept="image/png,.png"
            aria-label="Import mask"
            onChange={(event) => {
              void readPng(event.target.files?.[0]).then((image) => {
                if (!image || !sheet) {
                  setNotice(sheet ? "Choose a mask picture." : "Load a reference sheet before the mask.");
                  return;
                }
                if (image.width !== sheet.width || image.height !== sheet.height) {
                  setNotice("The mask must be the same size as the reference sheet.");
                  return;
                }
                const next = {
                  ...sheet,
                  mask: maskFromRgba(image.data, image.width, image.height),
                  overrides: blankOverrides(sheet.mask.length),
                };
                pushHistory();
                sheetRef.current = next;
                setSheet(next);
                setNotice("Mask imported. Red is the head, green the torso, blue the weapon, yellow the legs.");
              });
              event.target.value = "";
            }}
          />
        </label>
        <button type="button" onClick={extract} disabled={!sheet}>
          Extract Rig & Base Parts
        </button>
      </div>
      <div className="rig-stage">
        <div>
          <div className="rig-frames" role="toolbar" aria-label="Zoom">
            {RIG_ZOOMS.map((step) => (
              <button key={step} type="button" aria-pressed={rigScale === step} onClick={() => setZoom(step)}>
                {step}×
              </button>
            ))}
          </div>
          <div className="rig-frames" role="toolbar" aria-label="Reference frames">
            {Array.from({ length: 8 }, (_, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={frameIndex === index}
                onClick={() => {
                  setFrameIndex(index);
                  setSelection([]);
                  setMarquee(null);
                }}
              >
                {index}
              </button>
            ))}
          </div>
          <div
            ref={frameBoxRef}
            className="rig-frame"
            style={{ width: (frameWidth || 20) * rigScale, height: (frameHeight || 24) * rigScale }}
          >
            <canvas
              ref={rigRef}
              className="rig-canvas"
              data-edit={editMode}
              tabIndex={0}
              width={frameWidth || 20}
              height={frameHeight || 24}
              aria-label="Reference frame. Paint or select pixels for each area."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            <canvas
              ref={markRef}
              className="rig-marks"
              width={(frameWidth || 20) * rigScale}
              height={(frameHeight || 24) * rigScale}
              aria-hidden="true"
            />
            <div className="rig-grid" style={{ backgroundSize: `${rigScale}px ${rigScale}px` }} />
            {showPins &&
              socket &&
              (Object.keys(PIN_LABEL) as Pin[]).map((kind) => {
                const point = kind === "head" ? socket.headSocket : kind === "weapon" ? socket.weaponSocket : socket.hipSocket;
                return (
                  <button
                    key={kind}
                    type="button"
                    className={pin === kind ? "rig-pin is-active" : "rig-pin"}
                    style={{ left: point.x * rigScale + rigScale / 2, top: point.y * rigScale + rigScale / 2 }}
                    aria-pressed={pin === kind}
                    aria-label={`${PIN_LABEL[kind]} pin`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      pinRef.current = kind;
                      setPin(kind);
                      stroke.current = "pin";
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (stroke.current !== "pin" || pinRef.current !== kind) {
                        return;
                      }
                      const canvas = rigRef.current;
                      if (!canvas) {
                        return;
                      }
                      const pixel = pixelOf(canvas, event.clientX, event.clientY);
                      if (!pixel) {
                        return;
                      }
                      setManifest((current) => (current ? placeSocket(current, "walk", frameRef.current, kind, pixel) : current));
                    }}
                    onPointerUp={() => {
                      stroke.current = null;
                    }}
                  >
                    <span className="rig-pin-dot" style={{ background: PIN_COLOR[kind] }} />
                    <span className="rig-pin-name">{PIN_LABEL[kind]}</span>
                  </button>
                );
              })}
          </div>
          <div className="rig-tools" role="toolbar" aria-label="Pixel edit">
            <button type="button" aria-pressed={editMode === "paint"} onClick={() => setEditMode("paint")}>
              Paint
            </button>
            <button type="button" aria-pressed={editMode === "select"} onClick={() => setEditMode("select")}>
              Select
            </button>
            <button type="button" aria-pressed={editMode === "pins"} onClick={() => setEditMode("pins")}>
              Pins
            </button>
          </div>
          <div className="rig-tools">
            {(Object.keys(MASK_LABEL) as PartCategory[]).map((category) => (
              <button key={category} type="button" aria-pressed={brush === category} onClick={() => setBrush(category)}>
                <i style={{ background: rgbCss(MASK_RGB[category]) }} />
                {MASK_LABEL[category]}
              </button>
            ))}
            <button type="button" aria-pressed={brush === "erase"} onClick={() => setBrush("erase")}>
              Eraser
            </button>
            <label>
              Colour
              <select aria-label="Repaint colour" value={paintSlot} onChange={(event) => setPaintSlot(Number(event.target.value))}>
                <option value={0}>Sheet colour</option>
                {SLOT_LABELS.slice(1).map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={selection.length === 0 || brush === "erase"} onClick={() => assignSelection(brush === "erase" ? null : brush)}>
              {brush === "erase" ? "Assign selection" : `Assign to ${MASK_LABEL[brush]}`}
            </button>
            <button type="button" disabled={selection.length === 0} onClick={() => assignSelection(null)}>
              Erase selected pixels
            </button>
            <button type="button" onClick={() => undoRef.current()}>
              Undo
            </button>
            <label>
              <input type="checkbox" checked={solo} onChange={(event) => setSolo(event.target.checked)} />
              Only highlight this area
            </label>
            <label>
              <input type="checkbox" checked={showPins} onChange={(event) => setShowPins(event.target.checked)} />
              Show pins
            </label>
            <label>
              <input type="checkbox" checked={onion} onChange={(event) => setOnion(event.target.checked)} />
              Onion skin
            </label>
          </div>
          <p className="rig-note">
            {editMode === "pins"
              ? "Drag a pin by its dot. Arrow keys nudge the selected pin by one pixel."
              : editMode === "select"
                ? "Drag a box around pixels, or click a patch to take the connected area. Shift adds. Alt removes. Then assign."
                : "Paint writes the chosen area onto pixels. Helmet, tunic, and rifle come from frame 0. Each frame has its own legs."}
            {socket ? ` Frame ${frameIndex}. Head ${pointText(socket.headSocket)}. Weapon ${pointText(socket.weaponSocket)}. Hip ${pointText(socket.hipSocket)}.` : ""}
            {selection.length > 0 ? ` ${selection.length} pixels selected.` : ""}
          </p>
          <div className="rig-tools" role="toolbar" aria-label="Socket pins">
            {(Object.keys(PIN_LABEL) as Pin[]).map((kind) => (
              <button key={kind} type="button" aria-pressed={pin === kind} onClick={() => setPin(kind)}>
                {PIN_LABEL[kind]}
              </button>
            ))}
            <button
              type="button"
              disabled={!manifest}
              onClick={() => {
                if (!manifest) {
                  return;
                }
                setManifest(rebuildIdleAndFire(manifest));
                setNotice("Idle and fire were rebuilt from walk frame 0.");
              }}
            >
              Rebuild idle and fire
            </button>
          </div>
        </div>
        <div className="rig-preview-wrap">
          <div className="rig-tools" role="toolbar" aria-label="Playback">
            {(["walk", "idle", "fire"] as const).map((state) => (
              <button
                key={state}
                type="button"
                aria-pressed={animation === state}
                onClick={() => {
                  setAnimation(state);
                  setPlayFrame(0);
                }}
              >
                {state === "walk" ? "Walk" : state === "idle" ? "Idle" : "Fire"}
              </button>
            ))}
            <button type="button" onClick={() => setPlaying((value) => !value)}>
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" aria-pressed={fps === 8} onClick={() => setFps(8)}>
              8 FPS
            </button>
            <button type="button" aria-pressed={fps === 12} onClick={() => setFps(12)}>
              12 FPS
            </button>
          </div>
          <div
            className="rig-frame"
            style={{
              width: (manifest?.frameWidth ?? 20) * previewScale,
              height: (manifest?.frameHeight ?? 24) * previewScale,
            }}
          >
            <canvas
              ref={previewRef}
              className="rig-preview"
              width={manifest?.frameWidth ?? 20}
              height={manifest?.frameHeight ?? 24}
              aria-label="Assembled preview"
            />
            <div className="rig-grid" style={{ backgroundSize: `${previewScale}px ${previewScale}px` }} />
          </div>
          <div className="rig-assembly">
            {PART_CATEGORIES.map((category) => {
              const part = assembly?.[category];
              const shown = part ? partImage(part, animation, playFrame, partFrame) : null;
              return (
                <div key={category} className="rig-part">
                  <label>
                    {MASK_LABEL[category]}
                    <select
                      aria-label={MASK_LABEL[category]}
                      value={selected[category]}
                      onChange={(event) => setSelected({ ...selected, [category]: event.target.value })}
                    >
                      <option value="">Choose</option>
                      {parts
                        .filter((item) => item.category === category)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {part && shown && <PartThumb image={shown} lut={lut} />}
                  <button type="button" aria-pressed={editingPart === category} disabled={!part} onClick={() => setEditingPart(category)}>
                    Edit
                  </button>
                  <label className="sprite-open">
                    Upload
                    <input
                      type="file"
                      accept="image/png,.png"
                      aria-label={`Upload ${MASK_LABEL[category]}`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        void readPng(file).then((image) => {
                          if (!image) {
                            return;
                          }
                          try {
                            const imported = importQuantizedPart(
                              part?.id ?? `${category}_${parts.length + 1}`,
                              part?.name ?? MASK_LABEL[category],
                              category,
                              image.data,
                              image.width,
                              image.height,
                            );
                            setParts((current) => mergeParts(current, [imported]));
                            setSelected((current) => ({ ...current, [category]: imported.id }));
                            setEditingPart(category);
                            setNotice(`${MASK_LABEL[category]} replaced from the picture.`);
                          } catch (error) {
                            setNotice(error instanceof Error ? error.message : String(error));
                          }
                        });
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
          {onDrawOnSprite && (
            <button
              type="button"
              disabled={!manifest || !assembly}
              onClick={() => {
                if (manifest && assembly) {
                  onDrawOnSprite(manifest, assembly);
                }
              }}
            >
              Draw on the sprite
            </button>
          )}
          {assembly && editingPart && (
            <PartStudio
              part={assembly[editingPart]}
              lut={lut}
              frameIndex={shownPartFrame(assembly[editingPart], animation, playFrame, partFrame)}
              onFrame={(index) => {
                setPlaying(false);
                setPartFrame(index);
              }}
              onChange={(next) => {
                setPlaying(false);
                setParts((current) => current.map((item) => (item.id === next.id ? next : item)));
              }}
            />
          )}
        </div>
      </div>
      <div className="rig-palette">
        <div className="rig-tools" role="toolbar" aria-label="Faction palette">
          {(Object.keys(FACTION_PRESET_LABEL) as FactionPresetId[]).map((id) => (
            <button key={id} type="button" aria-pressed={faction === id} onClick={() => applyPreset(id)}>
              {FACTION_PRESET_LABEL[id]}
            </button>
          ))}
        </div>
        <div className="rig-slots">
          {SLOT_LABELS.slice(1).map((label, index) => {
            const slot = index + 1;
            return (
              <label key={label}>
                <input
                  type="color"
                  aria-label={label}
                  value={lut[slot] ?? "#000000"}
                  onChange={(event) => {
                    const next = lut.slice();
                    next[slot] = event.target.value;
                    setLut(next);
                  }}
                />
                {label}
              </label>
            );
          })}
        </div>
        <div className="rig-tools">
          <label>
            Part
            <select aria-label="Part to quantize" value={importCategory} onChange={(event) => setImportCategory(event.target.value as PartCategory)}>
              {PART_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {MASK_LABEL[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="sprite-open">
            Quantize to Semantic Indices
            <input
              type="file"
              accept="image/png,.png"
              aria-label="Quantize to Semantic Indices"
              onChange={(event) => {
                void readPng(event.target.files?.[0]).then((image) => {
                  if (!image) {
                    return;
                  }
                  try {
                    const id = `${importCategory}_${parts.length + 1}`;
                    const part = importQuantizedPart(id, `${MASK_LABEL[importCategory]} ${parts.length + 1}`, importCategory, image.data, image.width, image.height);
                    setParts((current) => [...current, part]);
                    setSelected((current) => ({ ...current, [importCategory]: part.id }));
                    setNotice(`${part.name} quantized onto the semantic slots.`);
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : String(error));
                  }
                });
                event.target.value = "";
              }}
            />
          </label>
          <button type="button" onClick={bake} disabled={!manifest || !assembly}>
            Bake Spritesheet
          </button>
        </div>
      </div>
    </section>
  );
}

function PartThumb({ image, lut }: { image: IndexedImage; lut: readonly string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.imageSmoothingEnabled = false;
    putPixels(ctx, paintIndexed(image, lut), image.width, image.height);
  }, [image, lut]);
  return <canvas ref={ref} className="rig-thumb" width={image.width} height={image.height} aria-hidden="true" />;
}

function shownPartFrame(part: ModularPart, animation: AnimationState, playFrame: number, pinned: number | null): number {
  if (part.frameCount <= 1) {
    return 0;
  }
  if (pinned !== null) {
    return Math.max(0, Math.min(part.frames.length - 1, pinned));
  }
  if (animation !== "walk") {
    return 0;
  }
  const count = part.frames.length;
  return ((playFrame % count) + count) % count;
}

function partImage(part: ModularPart, animation: AnimationState, playFrame: number, pinned: number | null): IndexedImage {
  return part.frames[shownPartFrame(part, animation, playFrame, pinned)] ?? part.spriteData;
}

function PartStudio({
  part,
  lut,
  frameIndex,
  onFrame,
  onChange,
}: {
  part: ModularPart;
  lut: readonly string[];
  frameIndex: number;
  onFrame: (index: number) => void;
  onChange: (part: ModularPart) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const partRef = useRef(part);
  const stroking = useRef(false);
  const undo = useRef<ModularPart[]>([]);
  const [slot, setSlot] = useState(2);
  const ink = useRef(slot);
  partRef.current = part;
  const image = part.frames[frameIndex] ?? part.spriteData;
  const scale = 8;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.imageSmoothingEnabled = false;
    putPixels(ctx, paintIndexed(image, lut), image.width, image.height);
  }, [image, lut]);
  const paint = (x: number, y: number) => {
    const current = partRef.current;
    if (!stroking.current) {
      undo.current.push(current);
      if (undo.current.length > 40) {
        undo.current.shift();
      }
      stroking.current = true;
    }
    const next = paintPartCell(current, frameIndex, x, y, ink.current);
    if (next !== current) {
      onChange(next);
    }
  };
  return (
    <div className="rig-part-edit">
      <p className="rig-note">
        {part.frameCount > 1
          ? `${part.name}, frame ${frameIndex + 1} of ${part.frameCount}. Walk shows this step. Idle and fire use the standing legs.`
          : `${part.name} is one picture. It rides every frame.`}
      </p>
      {part.frameCount > 1 && (
        <div className="rig-frames" role="toolbar" aria-label={`${part.name} frames`}>
          {part.frames.map((_, index) => (
            <button key={index} type="button" aria-pressed={index === frameIndex} onClick={() => onFrame(index)}>
              {index}
            </button>
          ))}
        </div>
      )}
      <div className="rig-frame" style={{ width: image.width * scale, height: image.height * scale }}>
        <canvas
          ref={canvasRef}
          className="rig-canvas"
          width={image.width}
          height={image.height}
          aria-label={`Edit ${part.name}`}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            const pixel = pixelOf(event.currentTarget, event.clientX, event.clientY);
            if (!pixel) {
              return;
            }
            ink.current = event.button === 2 || slot === 0 ? 0 : slot;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // A synthetic event can refuse capture.
            }
            paint(pixel.x, pixel.y);
          }}
          onPointerMove={(event) => {
            if (!stroking.current) {
              return;
            }
            const pixel = pixelOf(event.currentTarget, event.clientX, event.clientY);
            if (pixel) {
              paint(pixel.x, pixel.y);
            }
          }}
          onPointerUp={() => {
            stroking.current = false;
          }}
        />
        <div className="rig-grid" style={{ backgroundSize: `${scale}px ${scale}px` }} />
      </div>
      <div className="rig-tools">
        <label>
          Colour
          <select
            aria-label="Segment colour"
            value={slot === 0 ? 2 : slot}
            onChange={(event) => setSlot(Number(event.target.value))}
          >
            {SLOT_LABELS.slice(1).map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" aria-pressed={slot === 0} onClick={() => setSlot(slot === 0 ? 2 : 0)}>
          Eraser
        </button>
        <button
          type="button"
          onClick={() => {
            const previous = undo.current.pop();
            if (previous) {
              onChange(previous);
            }
          }}
        >
          Undo
        </button>
      </div>
    </div>
  );
}

function assemble(parts: readonly ModularPart[], selected: Record<PartCategory, string>): Record<PartCategory, ModularPart> | null {
  const found = {} as Record<PartCategory, ModularPart>;
  for (const category of PART_CATEGORIES) {
    const part = parts.find((item) => item.category === category && item.id === selected[category]);
    if (!part) {
      return null;
    }
    found[category] = part;
  }
  return found;
}

function mergeParts(current: readonly ModularPart[], incoming: readonly ModularPart[]): ModularPart[] {
  const next = [...current];
  for (const part of incoming) {
    const index = next.findIndex((item) => item.id === part.id);
    if (index >= 0) {
      next[index] = part;
    } else {
      next.push(part);
    }
  }
  return next;
}

function pinAt(
  pixel: PixelPoint,
  socket: { headSocket: PixelPoint; weaponSocket: PixelPoint; hipSocket: PixelPoint },
  active: Pin,
  reach: number,
): Pin | null {
  const pins: Record<Pin, PixelPoint> = {
    head: socket.headSocket,
    weapon: socket.weaponSocket,
    torso: socket.hipSocket,
  };
  const order: Pin[] = [active, "head", "weapon", "torso"];
  for (const kind of order) {
    const point = pins[kind];
    if (Math.abs(point.x - pixel.x) <= reach && Math.abs(point.y - pixel.y) <= reach) {
      return kind;
    }
  }
  return null;
}

function drawRig(canvas: HTMLCanvasElement, sheet: ReferenceSheet, frameIndex: number, onion: boolean, lut: readonly string[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const frameWidth = sheet.width / 8;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, frameWidth, sheet.height);
  if (onion) {
    blitFrame(ctx, sheet, (frameIndex + 7) % 8, 0.35);
  }
  blitFrame(ctx, sheet, frameIndex, 1);
  for (let y = 0; y < sheet.height; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const index = y * sheet.width + frameIndex * frameWidth + x;
      const slot = sheet.overrides?.[index] ?? 0;
      if (slot > 0 && lut[slot]) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = lut[slot];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawMarks(
  canvas: HTMLCanvasElement,
  sheet: ReferenceSheet,
  frameIndex: number,
  scale: number,
  edit: { areas: readonly PartCategory[]; selection: readonly PixelPoint[]; marquee: Marquee | null },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const frameWidth = sheet.width / 8;
  const frameHeight = sheet.height;
  canvas.width = frameWidth * scale;
  canvas.height = frameHeight * scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const categoryAt = (x: number, y: number): PartCategory | null => {
    if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) {
      return null;
    }
    return sheet.mask[y * sheet.width + frameIndex * frameWidth + x] ?? null;
  };
  for (const category of edit.areas) {
    const [red, green, blue] = MASK_RGB[category];
    ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        if (categoryAt(x, y) !== category) {
          continue;
        }
        const x0 = x * scale;
        const y0 = y * scale;
        if (categoryAt(x - 1, y) !== category) {
          ctx.fillRect(x0, y0, 1, scale);
        }
        if (categoryAt(x + 1, y) !== category) {
          ctx.fillRect(x0 + scale - 1, y0, 1, scale);
        }
        if (categoryAt(x, y - 1) !== category) {
          ctx.fillRect(x0, y0, scale, 1);
        }
        if (categoryAt(x, y + 1) !== category) {
          ctx.fillRect(x0, y0 + scale - 1, scale, 1);
        }
      }
    }
  }
  const chosen = new Set(edit.selection.map((pixel) => `${pixel.x},${pixel.y}`));
  ctx.fillStyle = "#ffffff";
  for (const pixel of edit.selection) {
    const x0 = pixel.x * scale;
    const y0 = pixel.y * scale;
    const has = (x: number, y: number) => chosen.has(`${x},${y}`);
    if (!has(pixel.x - 1, pixel.y)) {
      ctx.fillRect(x0, y0, 1, scale);
    }
    if (!has(pixel.x + 1, pixel.y)) {
      ctx.fillRect(x0 + scale - 1, y0, 1, scale);
    }
    if (!has(pixel.x, pixel.y - 1)) {
      ctx.fillRect(x0, y0, scale, 1);
    }
    if (!has(pixel.x, pixel.y + 1)) {
      ctx.fillRect(x0, y0 + scale - 1, scale, 1);
    }
  }
  if (!edit.marquee) {
    return;
  }
  const x0 = Math.min(edit.marquee.a.x, edit.marquee.b.x) * scale;
  const y0 = Math.min(edit.marquee.a.y, edit.marquee.b.y) * scale;
  const x1 = (Math.max(edit.marquee.a.x, edit.marquee.b.x) + 1) * scale - 1;
  const y1 = (Math.max(edit.marquee.a.y, edit.marquee.b.y) + 1) * scale - 1;
  ctx.fillRect(x0, y0, x1 - x0, 1);
  ctx.fillRect(x0, y1, x1 - x0, 1);
  ctx.fillRect(x0, y0, 1, y1 - y0);
  ctx.fillRect(x1, y0, 1, y1 - y0);
}

function blitFrame(ctx: CanvasRenderingContext2D, sheet: ReferenceSheet, frameIndex: number, alpha: number): void {
  const frameWidth = sheet.width / 8;
  const scratch = document.createElement("canvas");
  scratch.width = frameWidth;
  scratch.height = sheet.height;
  const source = scratch.getContext("2d");
  if (!source) {
    return;
  }
  const image = source.createImageData(frameWidth, sheet.height);
  const origin = frameIndex * frameWidth;
  for (let y = 0; y < sheet.height; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const from = (y * sheet.width + origin + x) * 4;
      const to = (y * frameWidth + x) * 4;
      image.data[to] = sheet.rgba[from] ?? 0;
      image.data[to + 1] = sheet.rgba[from + 1] ?? 0;
      image.data[to + 2] = sheet.rgba[from + 2] ?? 0;
      image.data[to + 3] = (sheet.rgba[from + 3] ?? 0) === 0 ? 0 : Math.round(255 * alpha);
    }
  }
  source.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0);
}

function drawPreview(
  canvas: HTMLCanvasElement,
  manifest: RigManifest,
  parts: Record<PartCategory, ModularPart>,
  lut: readonly string[],
  animation: AnimationState,
  frameIndex: number,
): void {
  const ctx = canvas.getContext("2d");
  const socket = manifest.animations[animation][frameIndex];
  if (!ctx || !socket) {
    return;
  }
  const composed = composeFrame(manifest, parts, animation, frameIndex);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, manifest.frameWidth, manifest.frameHeight);
  putPixels(ctx, paintIndexed(composed, lut), composed.width, composed.height);
  if (socket.showMuzzleFlash && parts.weapon.muzzleAnchor) {
    const recoil = socket.weaponRecoilOffset ?? { x: 0, y: 0 };
    const x = Math.round(socket.weaponSocket.x + recoil.x - parts.weapon.anchor.x + parts.weapon.muzzleAnchor.x);
    const y = Math.round(socket.weaponSocket.y + recoil.y - parts.weapon.anchor.y + parts.weapon.muzzleAnchor.y);
    stampPreviewFlash(ctx, x, y);
  }
}

function putPixels(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray, width: number, height: number): void {
  const image = ctx.createImageData(width, height);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);
}

function stampPreviewFlash(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const pixels = [
    [0, 0, MILITARY.cream],
    [1, 0, MILITARY.cream],
    [2, 0, MILITARY.brass],
    [0, 1, MILITARY.brass],
    [1, 1, MILITARY.cream],
  ] as const;
  for (const [dx, dy, hex] of pixels) {
    ctx.fillStyle = hex;
    ctx.fillRect(x + dx, y + dy, 1, 1);
  }
}

function pixelOf(canvas: HTMLCanvasElement, clientX: number, clientY: number): PixelPoint | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  const x = Math.round(((clientX - rect.left) / rect.width) * canvas.width - 0.5);
  const y = Math.round(((clientY - rect.top) / rect.height) * canvas.height - 0.5);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    return null;
  }
  return { x, y };
}

function pointText(point: PixelPoint): string {
  return `${point.x},${point.y}`;
}

function rgbCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function readSheet(file: File | undefined): Promise<ReferenceSheet | null> {
  const image = await readPng(file);
  if (!image) {
    return null;
  }
  return withOverrides({
    rgba: image.data,
    mask: new Array<PartCategory | null>(image.width * image.height).fill(null),
    width: image.width,
    height: image.height,
  });
}

function withOverrides(sheet: { rgba: Uint8ClampedArray; mask: (PartCategory | null)[]; width: number; height: number }): ReferenceSheet {
  return { ...sheet, overrides: blankOverrides(sheet.mask.length) };
}

function blankOverrides(length: number): number[] {
  return new Array<number>(length).fill(0);
}

function stepZoom(current: number, deltaY: number): number {
  const index = RIG_ZOOMS.findIndex((step) => step === current);
  const at = index >= 0 ? index : 0;
  const next = at + (deltaY > 0 ? -1 : 1);
  return RIG_ZOOMS[Math.max(0, Math.min(RIG_ZOOMS.length - 1, next))] ?? current;
}

function mergeSelection(base: readonly PixelPoint[], extra: readonly PixelPoint[], subtract: boolean): PixelPoint[] {
  const key = (pixel: PixelPoint) => `${pixel.x},${pixel.y}`;
  if (subtract) {
    const drop = new Set(extra.map(key));
    return base.filter((pixel) => !drop.has(key(pixel)));
  }
  const seen = new Set(base.map(key));
  const next = [...base];
  for (const pixel of extra) {
    const id = key(pixel);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    next.push(pixel);
  }
  return next;
}

async function readPng(file: File | undefined): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  if (!file) {
    return null;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: data.data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const RIG_CSS = `
.rig-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #3a342c;
  background: #221e1a;
}
.rig-panel h3 {
  margin: 0;
  font-size: 16px;
}
.rig-head p, .rig-note {
  margin: 0;
  color: #d9d0c3;
}
.rig-tools, .rig-frames, .rig-slots, .rig-assembly {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.rig-stage {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.rig-frame {
  position: relative;
  flex: none;
  background: #12100e;
  box-shadow: inset 0 0 0 1px #1c1917;
}
.rig-canvas, .rig-preview, .rig-thumb {
  image-rendering: pixelated;
  background: #12100e;
  touch-action: none;
}
.rig-canvas, .rig-preview {
  display: block;
  width: 100%;
  height: 100%;
}
.rig-grid, .rig-marks {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.rig-grid {
  background-image:
    linear-gradient(to right, rgba(221, 207, 153, 0.45) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(221, 207, 153, 0.45) 1px, transparent 1px);
}
.rig-panel button.rig-pin,
.rig-panel button.rig-pin[aria-pressed="true"] {
  position: absolute;
  z-index: 3;
  transform: translate(-8px, -8px);
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  box-shadow: none;
  cursor: grab;
}
.rig-pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #1c1917, 0 0 0 4px #f5f0e6;
  flex: none;
}
.rig-pin.is-active .rig-pin-dot {
  box-shadow: 0 0 0 2px #1c1917, 0 0 0 4px #ffffff;
}
.rig-pin-name {
  font: 600 12px/1 "Segoe UI", sans-serif;
  padding: 3px 5px;
  background: #f5f0e6;
  color: #1c1917;
  border: 1px solid #1c1917;
  pointer-events: none;
}
.rig-pin.is-active .rig-pin-name {
  background: #ffffff;
}
.rig-canvas[data-edit="paint"] { cursor: crosshair; }
.rig-canvas[data-edit="select"] { cursor: cell; }
.rig-canvas[data-edit="pins"] { cursor: grab; }
.rig-canvas:focus { outline: 1px solid #d9d0c3; outline-offset: 2px; }
.rig-panel button[aria-pressed="true"] {
  background: #d9d0c3;
  color: #1c1917;
}
.rig-part {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 72px;
}
.rig-part-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.rig-thumb {
  width: 48px;
  height: auto;
  display: block;
}
.rig-slots label, .rig-assembly label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.rig-panel i {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  vertical-align: -1px;
  box-shadow: inset 0 0 0 1px #1c1917;
}
`;
