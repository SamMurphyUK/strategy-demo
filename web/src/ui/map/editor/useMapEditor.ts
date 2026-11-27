import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dict } from "../../../engine/model/types";
import { type MapGeometry, pointInPolygon, type Vec2 } from "../geometry";
import { effectiveUnitSlots, generatedSlotsOf } from "../unitSlots";
import { isLandAt } from "../hitTest";
import { type EditorBinding, SNAP_PX } from "../MapView";
import type { EditorLinkKind, EditorToolName } from "../mapRenderer";
import { clipperFor, type MultiPolygon, multiPolygonArea, type Ring, uncoveredLand } from "../regionClip";
import { parseLandSvg, type MasterLand } from "../svgLandLoader";
import { autoNeighborPairs } from "./adjacency";
import { blankEditorMap, boardFrame } from "./blankMap";
import {
  bakeLandmass,
  blobFromStroke,
  circleRing,
  copyShape,
  type DraftShape,
  edgeAt,
  insertVertex,
  landmassToSvg,
  moveVertex,
  replaceShape,
  ringFromStroke,
  rotateShape,
  scaleShape,
  type SculptTool,
  shapeAt,
  shapeBounds,
  shapeCenter,
  shapesFromSvg,
  translateShape,
  vertexAt,
  viewBoxAround,
} from "./landmass";
import { validateEditorMap } from "./validateMap";
import {
  CANONICAL_BOARD_NAME,
  parseVersionLibrary,
  removeVersion,
  freshMapName,
  upsertVersion,
  versionNameError,
  VERSIONS_KEY,
  type MapVersion,
} from "./mapVersions";
import {
  addBlocks,
  addRegionFromPolygon,
  applyAutoLinks,
  applyMergeMany,
  applySplitMany,
  boxFromPoints,
  coincidentVertices,
  deleteRegion,
  detachIslands,
  type WorldBox,
  edgeSharers,
  dist,
  type EditorMap,
  type EditorRegion,
  editorFromMapJson,
  editorToGeometry,
  editorToMapJson,
  anchorHandleAt,
  moveSlot,
  facilityAnchorAfterPlace,
  slotsAfterAdd,
  slotsAfterRemoveLast,
  findRegion,
  formatMapJson,
  labelPoint,
  isUnconfiguredLand,
  linkKind,
  moveVertices,
  nearestSharedEdge,
  pruneSmallIslands,
  renameRegion,
  roughenEdge,
  SAME_VERTEX_EPS,
  type StartingUnit,
  setStartingUnits,
  snapPoint,
  startingUnitsOf,
  subdivideEdge,
  TOPO_LOCK_EPS,
  toggleLink,
  nextRegionId,
  updateRegion,
  type VertexRef,
  weldRegion,
} from "./editorModel";
import {
  anchorFor,
  carveLoop,
  KNIFE_REACH_PX,
  healDeletedRegion,
  landComponentAt,
  LOOP_CLOSE_PX,
  LOOP_MIN_PX,
  masterBlocks,
  mergeRegions,
  separateBlockedPieces,
  type PreparedStroke,
  prepareClicks,
  prepareStroke,
  splitPolygonInto,
  strokePreview,
} from "./slicing";
import {
  dissolveLatticeCellsToRings,
  editLatticeZones,
  hitsAlong,
  latticeAnchor,
  latticeHit,
  partTouches,
  rasterizeRings,
  type LatticeCell,
  type LatticeHit,
  type LatticeRings,
} from "./seaLattice";

export type EditorTool = EditorToolName;
export type EditorLayer = "land" | "sea";
export type StrokeTolerance = "fine" | "medium" | "smooth";

/** RDP tolerance for a freehand stroke, in screen pixels. */
export const STROKE_TOLERANCE_PX: Record<StrokeTolerance, number> = { fine: 1.5, medium: 3, smooth: 5 };
/** The first and last stretch of a stroke that sets the direction its ends are extended in, in pixels. */
const TANGENT_SPAN_PX = 18;
/** The button roughens only borders at least this long (world units); short ones are already detail. */
const MIN_BATCH_ROUGHEN_LENGTH = 16;
/** Prune Small Islands starts here: untouched territories under 25 world square units are specks. */
export const DEFAULT_PRUNE_AREA = 25;

/**
 * `anchor` is the unit anchor and `facility` is the Facility Anchor. A `slot` is unit slot `index` (S1 is 0);
 * `from` is every slot as it was when the drag began, so a generated set becomes hand-placed.
 */
type Handle =
  | { kind: "vertex"; regionId: string; group: VertexRef[] }
  | { kind: "anchor"; regionId: string }
  | { kind: "facility"; regionId: string }
  | { kind: "slot"; regionId: string; index: number; from: Vec2[] };

const STORAGE_KEY = "strategy-demo.map-editor.v3";
const HISTORY_LIMIT = 100;
/** Where the dev server's save middleware listens (see web/dev/saveMapPlugin.mjs). */
export const SAVE_ENDPOINT = "/__dev/save-map";

interface Doc {
  map: EditorMap;
  past: EditorMap[];
  future: EditorMap[];
}

/** A region whose outline is the whole canvas box (the old master block), not a real shape. */
function isCanvasSized(region: EditorRegion): boolean {
  const xs = region.polygon.map((p) => p.x);
  const ys = region.polygon.map((p) => p.y);
  return region.polygon.length <= 5 && Math.max(...xs) - Math.min(...xs) >= 790 && Math.max(...ys) - Math.min(...ys) >= 495;
}

function loadInitial(demoJson: Dict): EditorMap {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const restored = editorFromMapJson(JSON.parse(saved));
      // An autosave that is nothing but canvas-sized master rectangles predates true-geometry blocks and
      // would cut across oceans. There is no work in it, so start from the demo map instead.
      if (restored.regions.length > 0 && restored.regions.every(isCanvasSized)) {
        return editorFromMapJson(demoJson);
      }
      return restored;
    }
  } catch {
    // A corrupt save falls back to the demo map.
  }
  return editorFromMapJson(demoJson);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el !== null && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

const TOOL_KEYS: Record<string, EditorTool> = { s: "select", v: "vertex", k: "knife", m: "merge", d: "draw", l: "link", p: "promote", b: "prune", g: "lattice" };

const ringOf = (points: Vec2[]): Ring => points.map((p) => [p.x, p.y]);

export interface MapEditor {
  map: EditorMap;
  geometry: MapGeometry;
  tool: EditorTool;
  layer: EditorLayer;
  drawSea: boolean;
  draft: Vec2[];
  selected: EditorRegion | null;
  /** How many unit slots the selected region is showing, hand-placed or generated. */
  slotCount: number;
  /** The first other region picked for a merge, or null. */
  second: EditorRegion | null;
  /** Every other region picked for the pending merge (Shift-click), in the order picked. */
  mergeWith: EditorRegion[];
  selectedUnits: StartingUnit[];
  linkFirstId: string;
  status: string;
  canUndo: boolean;
  canRedo: boolean;
  linkCounts: Record<EditorLinkKind, number>;
  binding: EditorBinding;
  setTool(tool: EditorTool): void;
  setLayer(layer: EditorLayer): void;
  finishDraft(): void;
  cancelDraft(): void;
  undoVertex(): void;
  select(id: string): void;
  patchSelected(patch: Partial<EditorRegion>): void;
  /** Writes one more unit slot, keeping the ones already on the map. One undo step. Does nothing at the cap. */
  addUnitSlot(): void;
  /** Drops the last unit slot, keeping the rest. One undo step. */
  removeLastUnitSlot(): void;
  /** Writes the generated slots into the region, so they can be dragged. One undo step. */
  seedUnitSlots(): void;
  /** Writes the one facility anchor (factory, airbase, and harbour) below the unit anchor. One undo step. */
  placeFacilityAnchor(): void;
  setUnits(rows: Omit<StartingUnit, "region_id">[]): void;
  rename(newId: string): string;
  removeSelected(): void;
  /** Takes the selected land region out of play. Its land stays on the map as plain, unselectable terrain. */
  makeDecorative(): void;
  /** Breaks a multi-island territory into one region per island. */
  splitIslands(): void;
  /** Land regions below this visible area (world square units) that Prune Small Islands removes. */
  pruneArea: number;
  setPruneArea(area: number): void;
  /** The Prune Box marquee being drawn or awaiting confirmation, and how many islands it would prune. */
  pruneBox: WorldBox | null;
  boxPruneCount: number;
  /** How many regions Prune Small Islands would remove right now. */
  pruneCount: number;
  pruneSmallIslands(): void;
  mergeSelected(): void;
  clearSecond(): void;
  strokeTolerance: StrokeTolerance;
  setStrokeTolerance(t: StrokeTolerance): void;
  strokeSmooth: boolean;
  setStrokeSmooth(on: boolean): void;
  /** Square paints an 8×8 cell. Triangle paints one diagonal wedge. Shift holds triangle for one stroke. */
  latticeBrush: "square" | "triangle";
  setLatticeBrush(brush: "square" | "triangle"): void;
  latticeShift: boolean;
  /** Adds an empty sea zone and selects it, so the next lattice stroke carves it out of the ocean. */
  newSeaZone(): void;
  /** Roughens the border between the selected region and its second pick, or every border it shares. */
  roughenSelected(): void;
  addMasterBlock(): void;
  calculateNeighbors(): void;
  unlink(a: string, b: string): void;
  undo(): void;
  redo(): void;
  exportJson(): void;
  saveToDevServer(): void;
  /** Writes the saved WorldMap_Populated snapshot to demomap01.json. The open editor document stays put. */
  exportBoardJson(): void;
  /** Magenta and orange outline of land the land-region cutters do not cover. */
  showUncovered: boolean;
  toggleUncovered(): void;
  resetToDemo(): void;
  /** Named snapshots stored in this browser, newest first. */
  versions: MapVersion[];
  /** Saves the open map under `name`. The same name replaces that version. Returns an error, or "". */
  saveVersion(name: string): string;
  /** Opens a saved version. Undo returns to the map that was open. */
  loadVersion(id: string): void;
  /** Removes a saved version. The open map stays. */
  deleteVersion(id: string): void;
  /** Replaces the open board. Undo returns to the map that was open. */
  openMap(next: EditorMap, note?: string): void;
  /** An empty board of `width` by `height` world units. `worldLand` keeps the shared coastline. */
  openBlank(width: number, height: number, worldLand?: boolean): void;
  /** A tracing sheet drawn over the board. Null clears it. */
  referenceUrl: string | null;
  setReference(url: string | null): void;
  /** Closed polygons, names, and sea zones that do not meet. */
  validate(): string[];
  /** Stores `map` under `name` without changing the open board. `error` is empty when it saved. */
  archiveMap(name: string, map: Dict): { id: string; error: string };
  /** Landmass stage. Cut stage is the knife, the lattice, and the rest of the slicer. */
  sculpting: boolean;
  sculptTool: SculptTool;
  sculptShapes: DraftShape[];
  sculptSelectedId: string;
  sculptTolerance: number;
  blobRadius: number;
  sculptBaked: boolean;
  setSculpting(on: boolean): void;
  setSculptTool(tool: SculptTool): void;
  setSculptTolerance(tolerance: number): void;
  setBlobRadius(radius: number): void;
  toggleSculptHole(): void;
  deleteSculptShape(): void;
  importSculptSvg(text: string): void;
  bakeSculpt(): void;
  downloadLandmassSvg(): void;
  /** Leave Landmass. A new or changed coast is baked and becomes the blocks the knife slices. */
  enterCutting(): void;
  /** Read a landmass SVG, install it as the coast, and open Cut. False when the file cannot be sliced. */
  openCoastSvg(text: string): boolean;
}

function anchorForLattice(region: EditorRegion, rings: LatticeRings, land: MasterLand | null): Vec2 {
  const inside = latticeAnchor(rings.polygon, rings.extra);
  if (land && rings.polygon.length >= 3) {
    const shape = clipperFor(land.polygons).clip({
      id: region.id,
      type: "sea",
      points: rings.polygon,
      extra: rings.extra,
    });
    const clipped = anchorFor(shape, inside ?? undefined);
    if (clipped) {
      return clipped;
    }
  }
  return inside ?? { x: region.cx, y: region.cy };
}

/** An empty sea zone for the lattice to paint into. It has no shape until the first square. */
function addEmptySeaZone(map: EditorMap): { map: EditorMap; id: string } {
  const id = nextRegionId(map, true);
  const region: EditorRegion = {
    id,
    name: id,
    ipc_value: 0,
    starting_owner: "Neutral",
    is_sea: true,
    factory: "none",
    capital: false,
    polygon: [],
    cx: 0,
    cy: 0,
  };
  return { map: { ...map, regions: [...map.regions, region] }, id };
}

/** A hand-drawn sea zone joins the lattice once a stroke reaches it, so the stroke can carve it. */
function latticeCellsOf(region: EditorRegion, targetId: string, hits: LatticeHit[]): LatticeCell[] {
  if (region.lattice && region.lattice.length > 0) {
    return region.lattice;
  }
  if (region.polygon.length < 3) {
    return [];
  }
  const rings = [region.polygon, ...(region.extra ?? [])].filter((ring) => ring.length >= 3);
  const reached = region.id === targetId || hits.some((hit) => partTouches(rings, hit.col, hit.row, hit.part));
  return reached ? rasterizeRings(region.polygon, region.extra ?? []) : [];
}

/**
 * Dissolve every sea zone the stroke changed. Other zones lose any wedge this stroke claims.
 * `final` places the unit pin inside the land-clipped water, which is too slow for every drag sample.
 */
function paintSeaLatticeMap(
  base: EditorMap,
  targetId: string,
  hits: LatticeHit[],
  erase: boolean,
  land: MasterLand | null,
  final: boolean,
): EditorMap {
  // The preview paints only the target. Carving the zones around it waits for release.
  const zones = base.regions
    .filter((region) => region.is_sea && (final || region.id === targetId))
    .map((region) => ({ id: region.id, cells: latticeCellsOf(region, targetId, hits) }));
  const edited = editLatticeZones(zones, targetId, hits, erase);
  let next = base;
  for (const zone of edited) {
    const region = findRegion(next, zone.id);
    if (!region) {
      continue;
    }
    const before = zones.find((item) => item.id === zone.id)?.cells ?? [];
    if (JSON.stringify(before) === JSON.stringify(zone.cells)) {
      continue;
    }
    const rings = dissolveLatticeCellsToRings(zone.cells);
    const anchor =
      rings.polygon.length < 3
        ? { x: region.cx, y: region.cy }
        : final
          ? anchorForLattice(region, rings, land)
          : (latticeAnchor(rings.polygon, rings.extra) ?? { x: region.cx, y: region.cy });
    next = updateRegion(next, zone.id, {
      lattice: zone.cells.length > 0 ? zone.cells : undefined,
      polygon: rings.polygon,
      extra: rings.extra.length > 0 ? rings.extra : undefined,
      cx: anchor.x,
      cy: anchor.y,
    });
  }
  return next;
}

export function useMapEditor(
  demoJson: Dict,
  land: MasterLand | null,
  active: boolean,
  onLandmask?: (land: MasterLand | "file" | "none") => void,
): MapEditor {
  const [doc, setDoc] = useState<Doc>(() => ({ map: loadInitial(demoJson), past: [], future: [] }));
  const docRef = useRef(doc);
  const [tool, setToolState] = useState<EditorTool>("select");
  const [layer, setLayerState] = useState<EditorLayer>("land");
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const secondId = mergeIds[0] ?? "";
  const setSecondId = useCallback((id: string) => setMergeIds(id === "" ? [] : [id]), []);
  const [pruneArea, setPruneArea] = useState(DEFAULT_PRUNE_AREA);
  /** The Prune Box marquee. `boxDone` once the pointer is released and the confirmation badge shows. */
  const [pruneBox, setPruneBox] = useState<WorldBox | null>(null);
  const [boxDone, setBoxDone] = useState(false);
  const [linkFirstId, setLinkFirstId] = useState("");
  const [cursor, setCursor] = useState<{ point: Vec2; kind: "vertex" | "edge" | "free" } | null>(null);
  const [closing, setClosing] = useState(false);
  const [status, setStatus] = useState("");
  const [showUncovered, setShowUncovered] = useState(false);
  const [uncovered, setUncovered] = useState<MultiPolygon | null>(null);
  const dragBase = useRef<EditorMap | null>(null);
  const drawSea = layer === "sea";
  const [versions, setVersions] = useState<MapVersion[]>(() => {
    try {
      return parseVersionLibrary(window.localStorage.getItem(VERSIONS_KEY));
    } catch {
      return [];
    }
  });
  const versionsRef = useRef(versions);
  versionsRef.current = versions;
  const [strokeTolerance, setStrokeTolerance] = useState<StrokeTolerance>("medium");
  const [strokeSmooth, setStrokeSmooth] = useState(true);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [latticeBrush, setLatticeBrush] = useState<"square" | "triangle">("square");
  const [latticeShift, setLatticeShift] = useState(false);
  const [latticeHover, setLatticeHover] = useState<LatticeHit | null>(null);
  const [sculpting, setSculptingState] = useState(false);
  const [sculptTool, setSculptToolState] = useState<SculptTool>("pen");
  const [sculptShapes, setSculptShapes] = useState<DraftShape[]>([]);
  const [sculptSelectedId, setSculptSelectedId] = useState("");
  const [sculptDraft, setSculptDraft] = useState<Vec2[]>([]);
  const [sculptTolerance, setSculptToleranceState] = useState(2);
  const [blobRadius, setBlobRadiusState] = useState(12);
  const [sculptSvg, setSculptSvg] = useState("");
  const stroke = useRef({ active: false, ignore: false, raw: [] as Vec2[], scale: 1 });
  /** World units per screen pixel at the current zoom, so the 25px and 20px knife limits mean pixels. */
  const pxScale = useRef(1);
  const onLandmaskRef = useRef(onLandmask);
  onLandmaskRef.current = onLandmask;
  const shapesRef = useRef(sculptShapes);
  shapesRef.current = sculptShapes;
  const sculptPast = useRef<DraftShape[][]>([]);
  const sculptFuture = useRef<DraftShape[][]>([]);
  const sculptBefore = useRef<DraftShape[] | null>(null);
  const sculptDragged = useRef(false);
  const shapeSeq = useRef(1);
  const sculptSvgRef = useRef(sculptSvg);
  sculptSvgRef.current = sculptSvg;
  const live = useRef({
    tool, layer, drawSea, draft, selectedId, secondId, mergeIds, linkFirstId, land, strokeTolerance, strokeSmooth, latticeBrush, latticeShift,
    sculpting, sculptTool, sculptShapes, sculptSelectedId, sculptDraft, sculptTolerance, blobRadius,
  });
  live.current = {
    tool, layer, drawSea, draft, selectedId, secondId, mergeIds, linkFirstId, land, strokeTolerance, strokeSmooth, latticeBrush, latticeShift,
    sculpting, sculptTool, sculptShapes, sculptSelectedId, sculptDraft, sculptTolerance, blobRadius,
  };
  /** `base` is what Undo restores. `start` is what the stroke paints onto: `base` plus a zone it created. */
  const latticeStroke = useRef<{
    base: EditorMap;
    start: EditorMap;
    hits: LatticeHit[];
    erase: boolean;
    last: Vec2;
    targetId: string;
  } | null>(null);
  const latticeFrame = useRef(0);

  const map = doc.map;
  const apply = useCallback((next: Doc) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  /** A change that gets its own undo step. */
  const commit = useCallback(
    (nextMap: EditorMap) => {
      const cur = docRef.current;
      apply({ map: nextMap, past: [...cur.past, cur.map].slice(-HISTORY_LIMIT), future: [] });
    },
    [apply],
  );

  useEffect(() => {
    // A lattice drag previews on every sample. Persist once, when the stroke is released.
    if (latticeStroke.current) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(editorToMapJson(map, { round: false })));
    } catch {
      // Storage full or blocked: the editor still works, it just will not persist.
    }
  }, [map]);

  useEffect(() => {
    const onShift = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setLatticeShift(event.type === "keydown");
      }
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    return () => {
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
    };
  }, []);

  const newSeaZone = useCallback(() => {
    const created = addEmptySeaZone(docRef.current.map);
    commit(created.map);
    setLayerState("sea");
    setToolState("lattice");
    setSelectedId(created.id);
    setStatus(`${created.id} is selected. Paint squares to carve it out of the sea around it.`);
  }, [commit]);

  const geometry = useMemo(() => editorToGeometry(map), [map]);

  const links = useMemo(() => {
    const out: { a: Vec2; b: Vec2; kind: EditorLinkKind }[] = [];
    for (const [ida, idb] of map.links) {
      const a = findRegion(map, ida);
      const b = findRegion(map, idb);
      if (a && b) {
        out.push({ a: { x: a.cx, y: a.cy }, b: { x: b.cx, y: b.cy }, kind: linkKind(map, ida, idb) });
      }
    }
    return out;
  }, [map]);

  const linkCounts = useMemo(() => {
    const counts = { land: 0, sea: 0, coastal: 0 };
    for (const l of links) {
      counts[l.kind]++;
    }
    return counts;
  }, [links]);

  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  /** A region's true shape: its cutter clipped against the land, or the raw cutter without it. */
  const shapeOf = useCallback((region: { id: string; polygon: Vec2[]; extra?: Vec2[][]; is_sea: boolean }): MultiPolygon => {
    const mask = live.current.land;
    if (!mask) {
      return [[ringOf(region.polygon)], ...(region.extra ?? []).map((ring): MultiPolygon[number] => [ringOf(ring)])];
    }
    return clipperFor(mask.polygons).clip({
      id: region.id,
      type: region.is_sea ? "sea" : "land",
      points: region.polygon,
      extra: region.extra,
    });
  }, []);

  // Recompute after edits settle, so dragging a vertex does not clip the land mask on every pointer move.
  useEffect(() => {
    if (!showUncovered) {
      setUncovered(null);
      return;
    }
    if (!land) {
      setUncovered(null);
      setStatus("The land mask has not loaded, so uncovered land cannot be drawn.");
      return;
    }
    const regions = doc.map.regions;
    let cancel = false;
    const handle = window.setTimeout(() => {
      const covers: MultiPolygon[] = [];
      for (const region of regions) {
        if (region.is_sea) continue;
        const mp: MultiPolygon = [];
        if (region.polygon.length >= 3) mp.push([ringOf(region.polygon)]);
        for (const extra of region.extra ?? []) {
          if (extra.length >= 3) mp.push([ringOf(extra)]);
        }
        if (mp.length > 0) covers.push(mp);
      }
      try {
        const free = uncoveredLand(land.polygons, covers);
        if (!cancel) setUncovered(free.length > 0 ? free : null);
      } catch {
        if (!cancel) {
          setUncovered(null);
          setStatus("Uncovered land could not be computed for this map.");
        }
      }
    }, 200);
    return () => {
      cancel = true;
      window.clearTimeout(handle);
    };
  }, [showUncovered, land, doc.map]);

  /** A region's unit slots as the map draws them: hand-placed, or generated from its true shape. */
  const slotsOf = useCallback(
    (id: string): Vec2[] => {
      const shape = geometryRef.current.regions.find((r) => r.id === id);
      const region = findRegion(docRef.current.map, id);
      return shape && region ? effectiveUnitSlots(shape, shapeOf(region)) : [];
    },
    [shapeOf],
  );
  const selectedSlots = useMemo(
    () => (selectedId === "" ? [] : slotsOf(selectedId)),
    // `geometry` and `land` change what the generator sees, though the callback does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, slotsOf, geometry, land],
  );

  /** Recomputes neighbor links from the geometry, keeping manual overrides. */
  const withAutoLinks = useCallback((current: EditorMap): { map: EditorMap; pairs: number; masked: boolean } => {
    const mask = live.current.land;
    const pairs = autoNeighborPairs(
      current.regions.map((r) => ({ id: r.id, polygon: r.polygon, extra: r.extra, is_sea: r.is_sea })),
      mask ? (x, y) => isLandAt(mask, { x, y }) : null,
    );
    return { map: applyAutoLinks(current, pairs), pairs: pairs.length, masked: mask !== null };
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft([]);
    setCursor(null);
    setClosing(false);
  }, []);

  const clearSecond = useCallback(() => setSecondId(""), []);

  const setTool = useCallback(
    (next: EditorTool) => {
      if (next === "prune" && live.current.layer === "sea") {
        setStatus("Prune Box works on land. Switch to Land mode.");
        return;
      }
      cancelDraft();
      setLinkFirstId("");
      setSecondId("");
      setStatus("");
      setPruneBox(null);
      setBoxDone(false);
      setToolState(next);
    },
    [cancelDraft],
  );

  const setLayer = useCallback(
    (next: EditorLayer) => {
      cancelDraft();
      setLinkFirstId("");
      setSecondId("");
      setStatus("");
      setPruneBox(null);
      setBoxDone(false);
      if (next === "sea") {
        setToolState((t) => (t === "prune" ? "select" : t));
      } else {
        setToolState((t) => (t === "lattice" ? "select" : t));
      }
      setLayerState(next);
      const picked = findRegion(docRef.current.map, live.current.selectedId);
      if (picked && picked.is_sea !== (next === "sea")) {
        setSelectedId("");
      }
    },
    [cancelDraft],
  );

  /**
   * Cuts with a prepared knife stroke (a placed line, or one dragged out in one go). A closed loop carves
   * an inland piece out of the region; an open line divides the region it crosses edge to edge. Both work on
   * the region's own outline, which is its visible shape, and nothing reaches past a few pixels. The target
   * is a region of the active layer the stroke works on: the selected one if it does, otherwise the one the
   * stroke runs through, otherwise the topmost.
   */
  const cutWithKnife = useCallback(
    (prepared?: PreparedStroke | null) => {
      const { draft, selectedId: pickedId, layer: current } = live.current;
      const scale = pxScale.current;
      const cut = prepared ?? prepareClicks(draft, LOOP_CLOSE_PX * scale, LOOP_MIN_PX * scale);
      const sea = current === "sea";
      if (!cut || cut.line.length < 2) {
        setStatus("Click at least two points, then press Enter or double-click to cut.");
        return;
      }
      const pool = docRef.current.map.regions.filter((r) => r.is_sea === sea);
      const picked = pool.find((r) => r.id === pickedId);
      // The point the stroke is about: a loop's first corner, otherwise the middle of the line.
      const probe = cut.loop ? cut.loop[0] : cut.line[Math.floor(cut.line.length / 2)];
      const under = pool.filter(
        (r) => r !== picked && (pointInPolygon(probe, r.polygon) || (r.extra ?? []).some((ring) => pointInPolygon(probe, ring))),
      );
      const rest = [...pool].reverse().filter((r) => r !== picked && !under.includes(r));
      const order = [...(picked ? [picked] : []), ...under.reverse(), ...rest];
      let target: EditorRegion | null = null;
      let island = -1;
      let pieces: Vec2[][] = [];
      let ordered = false;
      let problem = "";
      const attempt = (ring: Vec2[]) =>
        cut.loop
          ? carveLoop(ring, cut.loop)
          : splitPolygonInto(ring, cut.line, { reach: KNIFE_REACH_PX * scale, ends: cut.ends });
      search: for (const candidate of order) {
        // A territory's main island first, then its other islands.
        const rings = [candidate.polygon, ...(candidate.extra ?? [])];
        for (let k = 0; k < rings.length; k++) {
          const result = attempt(rings[k]);
          if (result.ok) {
            target = candidate;
            island = k - 1;
            pieces = result.pieces;
            ordered = result.ordered;
            break search;
          }
          // Only a real problem with a region the line does reach is worth reporting.
          if (!problem && !result.error.startsWith("The knife line has to cross") && !result.error.startsWith("That loop is outside")) {
            problem = result.error;
          }
        }
      }
      if (!target) {
        setStatus(
          problem ||
            (cut.loop
              ? `The loop is not inside any ${sea ? "sea zone" : "land region"}. Draw it on one.`
              : `The line does not cut through any ${sea ? "sea zone" : "land region"}. Draw it from one edge to another (it stretches only ${KNIFE_REACH_PX}px).`),
        );
        return;
      }
      let region: EditorRegion = target;
      let state = docRef.current.map;
      if (island >= 0) {
        // The cut is on one of the territory's other islands. Detach that island as its own region, then cut it.
        const ring = region.extra![island];
        const spot = anchorFor(shapeOf({ id: region.id, polygon: ring, is_sea: false })) ?? labelPoint(ring);
        const detached = detachIslands(state, region.id, [island], [spot]);
        const fresh = detached ? findRegion(detached.map, detached.ids[0]) : undefined;
        if (!detached || !fresh) {
          return;
        }
        state = detached.map;
        region = fresh;
      }
      const place = (polygon: Vec2[], prefer?: Vec2) => {
        const shape = shapeOf({ id: region.id, polygon, is_sea: sea });
        return anchorFor(shape, prefer) ?? labelPoint(polygon);
      };
      // A carved loop keeps the surrounding country as the original (it comes first). A cut keeps the piece
      // with the most visible land or sea as the original.
      const ranked = pieces.map((polygon) => ({ polygon, area: multiPolygonArea(shapeOf({ id: region.id, polygon, is_sea: sea })) }));
      if (!ordered) {
        ranked.sort((p, q) => q.area - p.area);
      }
      const placed = ranked.map((piece, i) => {
        const anchor = place(piece.polygon, i === 0 ? { x: region.cx, y: region.cy } : undefined);
        return { polygon: piece.polygon, cx: anchor.x, cy: anchor.y };
      });
      const applied = applySplitMany(state, region.id, placed);
      if (!applied) {
        return;
      }
      const mask = live.current.land;
      const settled = mask ? separateBlockedPieces(applied.map, clipperFor(mask.polygons)) : { map: applied.map, seaIds: [], islandIds: [] };
      commit(withAutoLinks(settled.map).map);
      cancelDraft();
      setSelectedId(applied.newIds[0]);
      setSecondId("");
      const parted = [...settled.seaIds, ...settled.islandIds];
      const extra = parted.length > 0 ? ` Separated ${parted.join(", ")}: the land had already closed that piece off.` : "";
      setStatus(
        (cut.loop
          ? `Carved ${applied.newIds.join(", ")} out of ${region.id}.`
          : applied.newIds.length === 1
          ? `Cut ${region.id} in two. The new half is ${applied.newIds[0]}; the larger piece kept ${region.id}'s settings.`
          : `Cut ${region.id} into ${applied.newIds.length + 1}. New pieces: ${applied.newIds.join(", ")}.`) + extra,
      );
    },
    [cancelDraft, commit, shapeOf, withAutoLinks],
  );

  /** Simplifies the freehand stroke being traced and cuts with it. */
  const runStroke = useCallback(() => {
    const { raw, scale } = stroke.current;
    stroke.current.active = false;
    stroke.current.raw = [];
    const { strokeTolerance: tol, strokeSmooth: smooth } = live.current;
    const prepared = prepareStroke(raw, {
      tolerance: STROKE_TOLERANCE_PX[tol] * scale,
      smooth,
      tangentSpan: TANGENT_SPAN_PX * scale,
      closeDist: LOOP_CLOSE_PX * scale,
      minLoop: LOOP_MIN_PX * scale,
    });
    if (!prepared) {
      cancelDraft();
      setStatus("That stroke was too short to cut with. Drag further across the region.");
      return;
    }
    cutWithKnife(prepared);
    cancelDraft();
  }, [cancelDraft, cutWithKnife]);

  const finishDraft = useCallback(() => {
    const { draft: pts, drawSea: sea, tool: current } = live.current;
    if (current === "knife") {
      if (stroke.current.active) {
        runStroke();
        stroke.current.ignore = true;
        return;
      }
      cutWithKnife();
      return;
    }
    if (pts.length < 3) {
      setStatus("A region needs at least 3 vertices.");
      return;
    }
    const added = addRegionFromPolygon(docRef.current.map, pts, sea);
    commit(added.map);
    cancelDraft();
    setSelectedId(added.id);
    setToolState("select");
    setStatus(`Added ${added.id}. Calculate Neighbors to link it.`);
  }, [cancelDraft, commit, cutWithKnife, runStroke]);

  const undoVertex = useCallback(() => setDraft((d) => d.slice(0, -1)), []);

  const select = useCallback((id: string) => setSelectedId(id), []);

  const patchSelected = useCallback(
    (patch: Partial<EditorRegion>) => {
      const id = live.current.selectedId;
      if (id !== "") {
        commit(updateRegion(docRef.current.map, id, patch));
      }
    },
    [commit],
  );

  const addUnitSlot = useCallback(() => {
    const id = live.current.selectedId;
    const region = findRegion(docRef.current.map, id);
    if (!region) {
      return;
    }
    const next = slotsAfterAdd(region, slotsOf(id));
    if (!next) {
      return;
    }
    commit(updateRegion(docRef.current.map, id, { unit_slots: next }));
  }, [commit, slotsOf]);

  const removeLastUnitSlot = useCallback(() => {
    const id = live.current.selectedId;
    const region = findRegion(docRef.current.map, id);
    if (!region) {
      return;
    }
    const next = slotsAfterRemoveLast(region, slotsOf(id));
    if (next === undefined && !(region.unit_slots && region.unit_slots.length > 0)) {
      return;
    }
    commit(updateRegion(docRef.current.map, id, { unit_slots: next }));
  }, [commit, slotsOf]);

  const seedUnitSlots = useCallback(() => {
    const id = live.current.selectedId;
    const region = findRegion(docRef.current.map, id);
    const shape = geometryRef.current.regions.find((r) => r.id === id);
    if (!region || !shape) {
      return;
    }
    const slots = generatedSlotsOf(shape, shapeOf(region)).slots;
    commit(updateRegion(docRef.current.map, id, { unit_slots: slots.map((p): [number, number] => [p.x, p.y]) }));
  }, [commit, shapeOf]);

  const placeFacilityAnchor = useCallback(() => {
    const id = live.current.selectedId;
    const region = findRegion(docRef.current.map, id);
    if (!region) {
      return;
    }
    const at = facilityAnchorAfterPlace(region);
    if (!at) {
      return;
    }
    commit(updateRegion(docRef.current.map, id, { facility_anchor: at }));
  }, [commit]);

  const setUnits = useCallback(
    (rows: Omit<StartingUnit, "region_id">[]) => {
      const id = live.current.selectedId;
      if (id !== "") {
        commit(setStartingUnits(docRef.current.map, id, rows));
      }
    },
    [commit],
  );

  const rename = useCallback(
    (newId: string): string => {
      const id = live.current.selectedId;
      const result = renameRegion(docRef.current.map, id, newId);
      if ("error" in result) {
        return result.error;
      }
      if (result !== docRef.current.map) {
        commit(result);
        setSelectedId(newId.trim());
      }
      return "";
    },
    [commit],
  );

  const removeSelected = useCallback(() => {
    const id = live.current.selectedId;
    if (id === "") {
      return;
    }
    const state = docRef.current.map;
    // A cut leaves its border on the neighbor. Give the space back so that line is gone and a new cut
    // can cross it. A region that shares no border is removed, and the gap stays unclaimed.
    const healed = healDeletedRegion(state, id);
    if (healed) {
      const host = findRegion(healed.map, healed.into);
      commit(withAutoLinks(healed.map).map);
      setSelectedId(healed.into);
      setSecondId("");
      setMergeIds([]);
      setStatus(`Deleted ${id}. ${host?.name ?? healed.into} took that space, so the old border is gone.`);
      return;
    }
    commit(deleteRegion(state, id));
    setSelectedId("");
    setSecondId("");
    setStatus(`Deleted ${id}. "Reset to Master Block" fills the gap.`);
  }, [commit, withAutoLinks]);

  /** Takes the region out of play: no id, IPC or selection box. The land mask still draws it as plain land. */
  const makeDecorative = useCallback(() => {
    const id = live.current.selectedId;
    const region = findRegion(docRef.current.map, id);
    if (!region) {
      return;
    }
    commit(deleteRegion(docRef.current.map, id));
    setSelectedId("");
    setMergeIds([]);
    setStatus(
      region.is_sea
        ? `Deleted ${id}. "Reset to Master Block" fills the gap.`
        : `${id} is now decorative: the land stays on the map, but it is no longer a territory. The Promote tool (P) brings it back.`,
    );
  }, [commit]);

  /** Breaks the selected multi-island territory back into one region per island. The main island keeps the id. */
  const splitIslands = useCallback(() => {
    const id = live.current.selectedId;
    const region = findRegion(docRef.current.map, id);
    if (!region || !region.extra || region.extra.length === 0) {
      return;
    }
    const spots = region.extra.map((ring) => anchorFor(shapeOf({ id, polygon: ring, is_sea: false })) ?? labelPoint(ring));
    const detached = detachIslands(docRef.current.map, id, null, spots);
    if (!detached) {
      return;
    }
    commit(withAutoLinks(detached.map).map);
    setSecondId("");
    setMergeIds([]);
    setStatus(`Split ${id} into ${detached.ids.length + 1} regions. New islands: ${detached.ids.join(", ")}.`);
  }, [commit, shapeOf, withAutoLinks]);

  const pruneCandidates = useCallback(
    (state: EditorMap) => pruneSmallIslands(state, (region) => multiPolygonArea(shapeOf(region)), pruneArea),
    [pruneArea, shapeOf],
  );

  // How many regions the button would remove; recomputed only when the regions or the threshold change.
  const pruneCount = useMemo(
    () => (land ? map.regions.filter((r) => isUnconfiguredLand(map, r) && multiPolygonArea(shapeOf(r)) < pruneArea).length : 0),
    [map, land, pruneArea, shapeOf],
  );

  // The regions the marquee would prune: untouched, under the threshold, anchor strictly inside the box.
  const boxIds = useMemo(
    () =>
      pruneBox && land
        ? pruneSmallIslands(map, (region) => multiPolygonArea(shapeOf(region)), pruneArea, pruneBox).removed
        : [],
    [map, land, pruneBox, pruneArea, shapeOf],
  );

  const cancelBoxPrune = useCallback(() => {
    setPruneBox(null);
    setBoxDone(false);
  }, []);

  const confirmBoxPrune = useCallback(() => {
    const box = pruneBox;
    if (!box || !live.current.land) {
      return;
    }
    const out = pruneSmallIslands(docRef.current.map, (region) => multiPolygonArea(shapeOf(region)), pruneArea, box);
    setPruneBox(null);
    setBoxDone(false);
    if (out.removed.length === 0) {
      setStatus(`Nothing to prune in that box (untouched Territories under ${pruneArea} square units).`);
      return;
    }
    // One commit, so a single Undo brings every island in the box back.
    commit(withAutoLinks(out.map).map);
    if (out.removed.includes(live.current.selectedId)) {
      setSelectedId("");
    }
    setMergeIds((ids) => ids.filter((id) => !out.removed.includes(id)));
    setStatus(
      `Pruned ${out.removed.length} small island${out.removed.length === 1 ? "" : "s"} in the box. They stay on the map as decorative land. Undo brings them back.`,
    );
  }, [commit, pruneArea, pruneBox, shapeOf, withAutoLinks]);

  const pruneIslands = useCallback(() => {
    if (!live.current.land) {
      setStatus("The land mask has not loaded, so island sizes are unknown.");
      return;
    }
    const out = pruneCandidates(docRef.current.map);
    if (out.removed.length === 0) {
      setStatus(`No untouched Territory is smaller than ${pruneArea} square units.`);
      return;
    }
    commit(withAutoLinks(out.map).map);
    if (out.removed.includes(live.current.selectedId)) {
      setSelectedId("");
    }
    setMergeIds((ids) => ids.filter((id) => !out.removed.includes(id)));
    setStatus(
      `Pruned ${out.removed.length} small island${out.removed.length === 1 ? "" : "s"} (under ${pruneArea} square units). They stay on the map as decorative land. Undo brings them back.`,
    );
  }, [commit, pruneArea, pruneCandidates, withAutoLinks]);

  /** Turns the unclaimed (decorative) landmass under `world` into a playable region. */
  const promoteAt = useCallback(
    (world: Vec2, regionId: string) => {
      const mask = live.current.land;
      if (live.current.layer === "sea") {
        setStatus("Promote works on land. Switch to Land mode.");
        return;
      }
      if (!mask) {
        setStatus("The land mask has not loaded, so there is no island to promote.");
        return;
      }
      const state = docRef.current.map;
      if (regionId !== "") {
        setSelectedId(regionId);
        setStatus(`${regionId} is already a territory. Click bare land to promote it.`);
        return;
      }
      const covered = state.regions.filter((r) => !r.is_sea).map((r) => shapeOf(r));
      const found = landComponentAt(world, mask.polygons, covered);
      if (!found) {
        setStatus("Nothing to promote there. Click land that no territory covers.");
        return;
      }
      const clipper = clipperFor(mask.polygons);
      const anchor = anchorFor(clipper.clip({ id: "promote", type: "land", points: found.outline })) ?? labelPoint(found.outline);
      const added = addBlocks(state, [found.outline], false, [anchor]);
      commit(withAutoLinks(added.map).map);
      setSelectedId(added.ids[0]);
      setMergeIds([]);
      setStatus(`Promoted that island to ${added.ids[0]} (${Math.round(found.area)} square units). Name it in the panel, or merge it into a group.`);
    },
    [commit, shapeOf, withAutoLinks],
  );

  /** Combines the selected region with every Shift-picked one, touching or not (Japan, the Philippines). */
  const mergeSelected = useCallback(() => {
    const { selectedId: aId } = live.current;
    const state = docRef.current.map;
    const a = findRegion(state, aId);
    const others = mergeIds.map((id) => findRegion(state, id)).filter((r): r is EditorRegion => r !== undefined);
    if (!a || others.length === 0) {
      setStatus("Click one region, then Shift-click each region to merge into it.");
      return;
    }
    if (others.some((b) => b.is_sea !== a.is_sea)) {
      setStatus("Land and sea regions cannot be merged.");
      return;
    }
    const result = mergeRegions([a, ...others], SAME_VERTEX_EPS);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    // One anchor, inside the largest island: the old one if it still sits there, otherwise the best interior point.
    const largest = { id: a.id, polygon: result.polygon, is_sea: a.is_sea };
    const shape = shapeOf(largest);
    const centre =
      [a, ...others].map((r) => anchorFor(shape, { x: r.cx, y: r.cy })).find((p) => p !== null) ?? labelPoint(result.polygon);
    const merged = applyMergeMany(state, a.id, mergeIds, { polygon: result.polygon, extra: result.extra, cx: centre.x, cy: centre.y });
    if (!merged) {
      return;
    }
    commit(withAutoLinks(merged).map);
    setMergeIds([]);
    setSelectedId(aId);
    const islands = result.extra.length + 1;
    setStatus(
      `Merged ${others.map((r) => r.id).join(", ")} into ${aId}. It keeps ${aId}'s settings` +
        (islands > 1 ? ` and is one territory of ${islands} separate islands.` : "."),
    );
  }, [commit, mergeIds, shapeOf, withAutoLinks]);

  /** Roughens the shared edge of the selected region nearest the point. True when there was one. */
  const roughenAt = useCallback(
    (world: Vec2, tol: number): boolean => {
      const state = docRef.current.map;
      const id = live.current.selectedId;
      const edge = nearestSharedEdge(state, id, world, tol * 1.5);
      if (edge < 0) {
        return false;
      }
      const sharers = edgeSharers(state, id, edge);
      const out = roughenEdge(state, id, edge, Math.random);
      if (!out) {
        setStatus("That border is too short to roughen.");
        return true;
      }
      commit(out.map);
      setStatus(`Roughened the border between ${id} and ${sharers.join(", ")} with ${out.added} points. Both sides moved together.`);
      return true;
    },
    [commit],
  );

  const roughenSelected = useCallback(() => {
    const id = live.current.selectedId;
    const only = live.current.secondId;
    let state = docRef.current.map;
    const region = findRegion(state, id);
    if (!region) {
      setStatus("Select a region first.");
      return;
    }
    // Walk edges from the last to the first so inserted points do not shift the ones still to do.
    let edges = 0;
    let added = 0;
    for (let i = region.polygon.length - 1; i >= 0; i--) {
      const sharers = edgeSharers(state, id, i);
      if (sharers.length === 0 || (only !== "" && !sharers.includes(only))) {
        continue;
      }
      const out = roughenEdge(state, id, i, Math.random, MIN_BATCH_ROUGHEN_LENGTH);
      if (out) {
        state = out.map;
        edges++;
        added += out.added;
      }
    }
    if (edges === 0) {
      setStatus(only !== "" ? `${id} and ${only} share no straight border long enough to roughen.` : `${id} has no shared border long enough to roughen. Shift-click a short one to roughen it by hand.`);
      return;
    }
    commit(state);
    setStatus(`Roughened ${edges} border${edges === 1 ? "" : "s"} of ${id} (${added} new points). Neighbors moved with it.`);
  }, [commit]);

  const addMasterBlock = useCallback(() => {
    const mask = live.current.land;
    const sea = live.current.layer === "sea";
    if (!mask) {
      setStatus("The land mask has not loaded, so there is nothing to size a master block against.");
      return;
    }
    const state = docRef.current.map;
    const clipper = clipperFor(mask.polygons);
    const found = masterBlocks(
      state.regions.filter((r) => r.is_sea === sea).flatMap((r) => [r.polygon, ...(r.extra ?? [])]),
      mask.viewBox,
      sea ? "sea" : "land",
      clipper,
    );
    if (found.blocks.length === 0) {
      setStatus(`Every ${sea ? "sea" : "land"} area already belongs to a region.`);
      return;
    }
    const anchors = found.blocks.map(
      (polygon) =>
        anchorFor(clipper.clip({ id: "master-block", type: sea ? "sea" : "land", points: polygon })) ?? labelPoint(polygon),
    );
    const added = addBlocks(state, found.blocks, sea, anchors);
    const settled = separateBlockedPieces(added.map, clipper);
    commit(withAutoLinks(settled.map).map);
    setSelectedId(added.ids[0]);
    setSecondId("");
    const parted = [...settled.seaIds, ...settled.islandIds];
    const extra = parted.length > 0 ? ` Separated ${parted.join(", ")}: the land had already closed that piece off.` : "";
    setStatus(
      `Added ${added.ids.length} master ${sea ? "sea" : "land"} block${added.ids.length === 1 ? "" : "s"}: ${added.ids.join(", ")}. Slice ${added.ids.length === 1 ? "it" : "them"} with the knife.${extra}`,
    );
  }, [commit, withAutoLinks]);

  const calculateNeighbors = useCallback(() => {
    const result = withAutoLinks(docRef.current.map);
    commit(result.map);
    const manual = result.map.overrides.add.length + result.map.overrides.remove.length;
    setStatus(
      `${result.map.links.length} links from ${result.pairs} detected` +
        (manual > 0 ? `, with ${manual} manual override${manual === 1 ? "" : "s"} kept.` : ".") +
        (result.masked ? "" : " Land mask not loaded, so coastal links were skipped."),
    );
  }, [commit, withAutoLinks]);

  const unlink = useCallback(
    (a: string, b: string) => commit(toggleLink(docRef.current.map, a, b)),
    [commit],
  );

  const rememberShapes = useCallback((next: DraftShape[]) => {
    sculptPast.current = [...sculptPast.current, shapesRef.current.map(copyShape)].slice(-40);
    sculptFuture.current = [];
    shapesRef.current = next;
    setSculptShapes(next);
    sculptSvgRef.current = "";
    setSculptSvg("");
  }, []);

  const undoSculpt = useCallback(() => {
    const previous = sculptPast.current.pop();
    if (!previous) {
      return false;
    }
    sculptFuture.current.push(shapesRef.current.map(copyShape));
    shapesRef.current = previous;
    setSculptShapes(previous);
    sculptSvgRef.current = "";
    setSculptSvg("");
    return true;
  }, []);

  const redoSculpt = useCallback(() => {
    const next = sculptFuture.current.pop();
    if (!next) {
      return false;
    }
    sculptPast.current.push(shapesRef.current.map(copyShape));
    shapesRef.current = next;
    setSculptShapes(next);
    sculptSvgRef.current = "";
    setSculptSvg("");
    return true;
  }, []);

  function clearSculpt(): void {
    sculptPast.current = [];
    sculptFuture.current = [];
    shapesRef.current = [];
    setSculptShapes([]);
    setSculptDraft([]);
    setSculptSelectedId("");
    sculptSvgRef.current = "";
    setSculptSvg("");
  }

  function restoreCoast(map: EditorMap): void {
    const set = onLandmaskRef.current;
    if (!set) {
      return;
    }
    const svg = map.meta.sculpted_land_svg;
    if (typeof svg === "string" && svg.includes("<path")) {
      try {
        set(parseLandSvg(svg));
        return;
      } catch {
        // A broken bake falls through to the board's coast flag.
      }
    }
    set(map.meta.no_landmass === true ? "none" : "file");
  }

  const undo = useCallback(() => {
    if (live.current.sculpting && undoSculpt()) {
      return;
    }
    const cur = docRef.current;
    const previous = cur.past[cur.past.length - 1];
    if (previous) {
      apply({ map: previous, past: cur.past.slice(0, -1), future: [cur.map, ...cur.future] });
      restoreCoast(previous);
    }
  }, [apply, undoSculpt]);

  const redo = useCallback(() => {
    if (live.current.sculpting && redoSculpt()) {
      return;
    }
    const cur = docRef.current;
    const [next, ...rest] = cur.future;
    if (next) {
      apply({ map: next, past: [...cur.past, cur.map], future: rest });
      restoreCoast(next);
    }
  }, [apply, redoSculpt]);

  /**
   * The map as it will be written: neighbors recalculated first (when the land is loaded, so coastal links can
   * be found), and every region with its clipped shape.
   */
  const prepareExport = useCallback((): { text: string; note: string } => {
    const mask = live.current.land;
    let current = docRef.current.map;
    let note = "";
    if (mask) {
      const result = withAutoLinks(current);
      if (JSON.stringify(result.map.links) !== JSON.stringify(current.links)) {
        commit(result.map);
      }
      current = result.map;
      note = `${current.links.length} links recalculated. `;
    } else {
      note = "Land mask not loaded, so neighbors were not recalculated. ";
    }
    const text = formatMapJson(editorToMapJson(current, { round: true, clipper: mask ? clipperFor(mask.polygons) : undefined }));
    return { text, note: `${note}${current.regions.length} regions.` };
  }, [commit, withAutoLinks]);

  const exportJson = useCallback(() => {
    const { text, note } = prepareExport();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "demomap01.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded demomap01.json. ${note}`);
  }, [prepareExport]);

  const saveToDevServer = useCallback(() => {
    const { text, note } = prepareExport();
    setStatus("Saving to the dev server...");
    fetch(SAVE_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: text })
      .then(async (res) => {
        const body: { ok?: boolean; path?: string; error?: string } = await res.json().catch(() => ({}));
        if (res.ok && body.ok) {
          setStatus(`Saved ${body.path ?? "demomap01.json"}. ${note}`);
        } else {
          setStatus(`Save failed: ${body.error ?? `HTTP ${res.status}`}. Run the app with "npm run dev" to enable saving.`);
        }
      })
      .catch(() => setStatus('Save failed: the dev server did not answer. Run the app with "npm run dev".'));
  }, [prepareExport]);

  const exportBoardJson = useCallback(() => {
    let library: MapVersion[] = [];
    try {
      library = parseVersionLibrary(window.localStorage.getItem(VERSIONS_KEY));
    } catch {
      library = [];
    }
    const board = library.find((version) => version.name === CANONICAL_BOARD_NAME);
    if (!board) {
      setStatus(
        `${CANONICAL_BOARD_NAME} is not in this browser. Named versions live in localStorage under ${VERSIONS_KEY}.`,
      );
      return;
    }
    // The named snapshot can still name the previous land file. The app draws FINAL_02.
    const map = {
      ...board.map,
      coord_space: typeof board.map.coord_space === "string" && board.map.coord_space !== "" ? board.map.coord_space : "svg",
      land_mask: "assets/ne_110m_land_FINAL_02.svg",
    };
    const text = formatMapJson(map);
    const regions = Array.isArray(board.map.regions) ? board.map.regions.length : 0;
    const units = Array.isArray(board.map.starting_units) ? board.map.starting_units.length : 0;
    setStatus(`Exporting ${CANONICAL_BOARD_NAME}…`);
    fetch(SAVE_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: text })
      .then(async (res) => {
        const body: { ok?: boolean; path?: string; backup?: string; error?: string } = await res.json().catch(() => ({}));
        if (res.ok && body.ok) {
          const kept = body.backup || "demomap01.backup.json";
          setStatus(`Exported ${CANONICAL_BOARD_NAME} (${regions} regions, ${units} starting units) to ${body.path ?? "demomap01.json"}. Previous file kept as ${kept}.`);
        } else {
          setStatus(`Export failed: ${body.error ?? `HTTP ${res.status}`}. Run the app with "npm run dev" to enable saving.`);
        }
      })
      .catch(() => setStatus('Export failed: the dev server did not answer. Run the app with "npm run dev".'));
  }, []);

  const toggleUncovered = useCallback(() => {
    setShowUncovered((on) => !on);
  }, []);

  const applyStoredCoast = useCallback((map: EditorMap) => {
    restoreCoast(map);
  }, []);

  const resetToDemo = useCallback(() => {
    const next = editorFromMapJson(demoJson);
    commit(next);
    applyStoredCoast(next);
    clearSculpt();
    setSculptingState(false);
    setSelectedId("");
    setSecondId("");
    cancelDraft();
    setReferenceUrl(null);
    setStatus("Reset to the demo map. Undo brings your work back.");
  }, [applyStoredCoast, cancelDraft, commit, demoJson]);

  const openMap = useCallback(
    (next: EditorMap, note = "Map loaded.") => {
      commit(next);
      applyStoredCoast(next);
      clearSculpt();
      setSelectedId("");
      setSecondId("");
      setMergeIds([]);
      setDraft([]);
      setReferenceUrl(null);
      setStatus(note);
    },
    [applyStoredCoast, commit],
  );

  const openBlank = useCallback(
    (width: number, height: number, worldLand = false) => {
      openMap(
        blankEditorMap(width, height, worldLand),
        worldLand
          ? "Blank map on the world landmass. Draw land with the pen, then cut sea zones in Sea mode."
          : "Landmass. Empty ocean. Draw the coast, then switch to Cut.",
      );
      setSculptingState(!worldLand);
    },
    [openMap],
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    applyStoredCoast(docRef.current.map);
  }, [active, applyStoredCoast]);

  const nextShapeId = () => `land-${shapeSeq.current++}`;

  const finishSculptPen = useCallback(() => {
    const pts = live.current.sculptDraft;
    if (pts.length < 3) {
      setStatus("A land shape needs at least three points.");
      return;
    }
    const id = nextShapeId();
    rememberShapes([...shapesRef.current, { id, ring: pts.map((p) => ({ ...p })), holes: [], hole: false }]);
    setSculptDraft([]);
    setSculptSelectedId(id);
    setStatus("Shape added. Cut this landmass when the coast is ready.");
  }, [rememberShapes]);

  const currentSvg = useCallback((): string => {
    if (sculptSvgRef.current !== "") {
      return sculptSvgRef.current;
    }
    const box = boardFrame(docRef.current.map) ?? live.current.land?.viewBox ?? { x: 0, y: 0, w: 800, h: 504 };
    const result = bakeLandmass(shapesRef.current, live.current.sculptTolerance);
    if (!result.ok) {
      setStatus(result.error);
      sculptSvgRef.current = "";
      setSculptSvg("");
      return "";
    }
    const svg = landmassToSvg(result.polygons, viewBoxAround(box, result.polygons));
    sculptSvgRef.current = svg;
    setSculptSvg(svg);
    const points = result.polygons.reduce((sum, poly) => sum + poly.reduce((n, ring) => n + ring.length, 0), 0);
    setStatus(`Baked ${result.polygons.length} coastline${result.polygons.length === 1 ? "" : "s"}, ${points} points.`);
    return svg;
  }, []);

  const downloadLandmassSvg = useCallback(() => {
    const svg = currentSvg();
    if (svg === "") {
      return;
    }
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "landmass.svg";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Saved landmass.svg. Switch to Cut to slice this coast.");
  }, [currentSvg]);

  const installCoast = useCallback(
    (svg: string): boolean => {
      let master: MasterLand;
      try {
        master = parseLandSvg(svg);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "The baked SVG could not be read.");
        return false;
      }
      if (master.polygons.length === 0) {
        setStatus("That SVG has no coastline.");
        return false;
      }
      onLandmaskRef.current?.(master);
      live.current = { ...live.current, land: master };
      const clipper = clipperFor(master.polygons);
      const landFound = masterBlocks([], master.viewBox, "land", clipper);
      const seaFound = masterBlocks([], master.viewBox, "sea", clipper);
      if (landFound.blocks.length === 0) {
        setStatus("That coast produced no land to slice.");
        return false;
      }
      const base = docRef.current.map;
      const hadRegions = base.regions.length > 0;
      const keptMeta = { ...base.meta };
      delete keptMeta.no_landmass;
      let next: EditorMap = {
        ...base,
        regions: [],
        links: [],
        auto: [],
        overrides: { add: [], remove: [] },
        meta: {
          ...keptMeta,
          sculpted_land_svg: svg,
          board: { x: master.viewBox.x, y: master.viewBox.y, w: master.viewBox.w, h: master.viewBox.h },
        },
      };
      const landAnchors = landFound.blocks.map(
        (polygon) => anchorFor(clipper.clip({ id: "landmass", type: "land", points: polygon })) ?? labelPoint(polygon),
      );
      const addedLand = addBlocks(next, landFound.blocks, false, landAnchors);
      next = addedLand.map;
      const seaAnchors = seaFound.blocks.map(
        (polygon) => anchorFor(clipper.clip({ id: "landmass", type: "sea", points: polygon })) ?? labelPoint(polygon),
      );
      const addedSea = addBlocks(next, seaFound.blocks, true, seaAnchors);
      next = withAutoLinks(addedSea.map).map;
      commit(next);
      sculptSvgRef.current = svg;
      setSculptSvg(svg);
      setSculptingState(false);
      setSculptDraft([]);
      setLayerState("land");
      setToolState("knife");
      setSelectedId(addedLand.ids[0] ?? "");
      const landN = addedLand.ids.length;
      const seaN = addedSea.ids.length;
      const blocks = `${landN} land block${landN === 1 ? "" : "s"} and ${seaN} sea block${seaN === 1 ? "" : "s"}`;
      setStatus(
        hadRegions
          ? `Coast updated. ${blocks} replaced the territories. Undo brings them back.`
          : `Coast ready. ${blocks}. Slice the land with the knife.`,
      );
      return true;
    },
    [commit, withAutoLinks],
  );

  const enterCutting = useCallback(() => {
    const stored = docRef.current.map.meta.sculpted_land_svg;
    if (shapesRef.current.length > 0) {
      const svg = currentSvg();
      if (svg === "") {
        return;
      }
      if (typeof stored !== "string" || stored !== svg || docRef.current.map.regions.length === 0) {
        installCoast(svg);
        return;
      }
    }
    setSculptingState(false);
    setSculptDraft([]);
    if (docRef.current.map.regions.length > 0) {
      setLayerState("land");
      setToolState("knife");
      setStatus("Cut. Slice the land with the knife, and sea zones with the lattice.");
      return;
    }
    setStatus("No coast yet. Draw one under Landmass, or open a landmass SVG.");
  }, [currentSvg, installCoast]);

  const openCoastSvg = useCallback(
    (text: string): boolean => {
      let imported: DraftShape[];
      try {
        parseLandSvg(text);
        imported = shapesFromSvg(text).map((shape) => ({ ...shape, id: nextShapeId() }));
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "That SVG could not be read.");
        return false;
      }
      if (imported.length === 0) {
        setStatus("That SVG has no closed paths.");
        return false;
      }
      sculptPast.current = [...sculptPast.current, shapesRef.current.map(copyShape)].slice(-40);
      sculptFuture.current = [];
      shapesRef.current = imported;
      setSculptShapes(imported);
      setSculptSelectedId(imported[0].id);
      setSculptDraft([]);
      sculptSvgRef.current = text;
      setSculptSvg(text);
      return installCoast(text);
    },
    [installCoast],
  );

  const setReference = useCallback((url: string | null) => {
    setReferenceUrl(url);
  }, []);

  const validate = useCallback((): string[] => {
    return validateEditorMap(docRef.current.map, land ? (x, y) => isLandAt(land, { x, y }) : null);
  }, [land]);

  const writeVersions = useCallback((next: MapVersion[]): boolean => {
    try {
      window.localStorage.setItem(VERSIONS_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    versionsRef.current = next;
    setVersions(next);
    return true;
  }, []);

  const archiveMap = useCallback(
    (name: string, mapJson: Dict): { id: string; error: string } => {
      const problem = versionNameError(name);
      if (problem) {
        setStatus(problem);
        return { id: "", error: problem };
      }
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `v-${Date.now().toString(36)}`;
      const next = upsertVersion(versionsRef.current, name, mapJson, Date.now(), id);
      if (!writeVersions(next.versions)) {
        const full = "This browser could not store that version. Delete an older one and try again.";
        setStatus(full);
        return { id: "", error: full };
      }
      setStatus(`Saved “${name.trim()}”.`);
      return { id: next.version.id, error: "" };
    },
    [writeVersions],
  );

  const saveVersion = useCallback(
    (name: string): string => {
      const problem = versionNameError(name);
      if (problem) {
        setStatus(problem);
        return problem;
      }
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const next = upsertVersion(versionsRef.current, name, editorToMapJson(docRef.current.map, { round: false }), Date.now(), id);
      if (!writeVersions(next.versions)) {
        const full = "This browser could not store that version. Delete an older one and try again.";
        setStatus(full);
        return full;
      }
      setStatus(next.replaced ? `Replaced "${next.version.name}".` : `Saved "${next.version.name}".`);
      return "";
    },
    [writeVersions],
  );

  const loadVersion = useCallback(
    (id: string) => {
      const version = versionsRef.current.find((v) => v.id === id);
      if (!version) {
        setStatus("That version is no longer saved in this browser.");
        return;
      }
      const loaded = editorFromMapJson(version.map);
      const storedCount = Array.isArray(version.map.regions) ? version.map.regions.length : 0;
      if (storedCount > 0 && loaded.regions.length === 0) {
        setStatus(`"${version.name}" could not be read.`);
        return;
      }
      commit(loaded);
      applyStoredCoast(loaded);
      clearSculpt();
      setSculptingState(false);
      setSelectedId("");
      setMergeIds([]);
      cancelDraft();
      setStatus(`Loaded "${version.name}". Undo brings back the map you had open.`);
    },
    [applyStoredCoast, cancelDraft, commit],
  );

  const deleteVersion = useCallback(
    (id: string) => {
      const gone = versionsRef.current.find((v) => v.id === id);
      const next = removeVersion(versionsRef.current, id);
      if (!writeVersions(next)) {
        setStatus("This browser could not update the saved versions.");
        return;
      }
      setStatus(gone ? `Deleted the saved version "${gone.name}".` : "That version was already gone.");
    },
    [writeVersions],
  );

  // Keyboard shortcuts, only while the editor is open.
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!e.repeat) {
          saveVersion(freshMapName(versionsRef.current));
        }
        return;
      }
      if (isTypingTarget(e.target)) {
        return;
      }
      if (live.current.sculpting) {
        if (mod && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            redoSculpt();
          } else {
            undoSculpt();
          }
          return;
        }
        if (mod && e.key.toLowerCase() === "y") {
          e.preventDefault();
          redoSculpt();
          return;
        }
        if (e.key === "Enter") {
          finishSculptPen();
          return;
        }
        if (e.key === "Escape") {
          if (live.current.sculptDraft.length > 0) {
            setSculptDraft([]);
          } else {
            setSculptSelectedId("");
          }
          return;
        }
        if ((e.key === "Backspace" || e.key === "Delete") && live.current.sculptDraft.length > 0) {
          e.preventDefault();
          setSculptDraft((pts) => pts.slice(0, -1));
          return;
        }
        if ((e.key === "Backspace" || e.key === "Delete") && live.current.sculptSelectedId !== "") {
          e.preventDefault();
          const id = live.current.sculptSelectedId;
          rememberShapes(shapesRef.current.filter((shape) => shape.id !== id));
          setSculptSelectedId("");
          return;
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) {
        const nextTool = TOOL_KEYS[e.key.toLowerCase()];
        if (nextTool === "lattice") {
          setLayer("sea");
        }
        setTool(nextTool);
      } else if (e.key === "Enter") {
        finishDraft();
      } else if (e.key === "Backspace" && live.current.draft.length > 0) {
        e.preventDefault();
        undoVertex();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod && live.current.selectedId !== "" && live.current.draft.length === 0) {
        e.preventDefault();
        makeDecorative();
      } else if (e.key === "Escape") {
        if (live.current.tool === "prune") {
          cancelBoxPrune();
        } else if (live.current.draft.length > 0 || live.current.linkFirstId !== "") {
          cancelDraft();
          setLinkFirstId("");
        } else if (live.current.secondId !== "") {
          setSecondId("");
        } else {
          setSelectedId("");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cancelBoxPrune, cancelDraft, finishDraft, finishSculptPen, makeDecorative, redo, redoSculpt, rememberShapes, saveVersion, setTool, undo, undoSculpt, undoVertex]);

  const binding = useMemo<EditorBinding>(
    () => ({
      overlay: {
        links,
        selectedId,
        secondId,
        mergeIds,
        linkFirstId,
        draft,
        drawSea,
        layer,
        cursor,
        closing,
        tool,
        pruneBox,
        pruneIds: boxIds,
        slots: selectedSlots,
        uncovered: showUncovered ? uncovered : null,
        lattice: tool === "lattice" && layer === "sea" ? { brush: latticeBrush, shift: latticeShift, hover: latticeHover } : null,
        sculpt: sculpting
          ? { tool: sculptTool, shapes: sculptShapes, selectedId: sculptSelectedId, draft: sculptDraft }
          : null,
      },
      prunePrompt: pruneBox && boxDone ? { box: pruneBox, count: boxIds.length, confirm: confirmBoxPrune, cancel: cancelBoxPrune } : null,
      pickHandle(world, tol) {
        if (live.current.sculpting) {
          const { sculptTool: mode, sculptShapes: shapes, sculptSelectedId: picked } = live.current;
          const selected = shapes.find((shape) => shape.id === picked) ?? null;
          if (mode === "select" && selected) {
            const center = shapeCenter(selected);
            const bounds = shapeBounds(selected);
            const spin = { x: center.x, y: bounds.minY - tol * 2.4 };
            if (dist(world, spin) <= tol) {
              sculptBefore.current = shapes.map(copyShape);
              sculptDragged.current = false;
              return {
                kind: "sculpt-rotate",
                id: selected.id,
                from: copyShape(selected),
                center,
                start: Math.atan2(world.y - center.y, world.x - center.x),
              };
            }
            const corner = { x: bounds.maxX, y: bounds.maxY };
            if (dist(world, corner) <= tol) {
              sculptBefore.current = shapes.map(copyShape);
              sculptDragged.current = false;
              return {
                kind: "sculpt-scale",
                id: selected.id,
                from: copyShape(selected),
                center,
                start: Math.max(tol, dist(world, center)),
              };
            }
          }
          if (mode === "vertex" && selected) {
            const hit = vertexAt(selected, world, tol);
            if (hit) {
              sculptBefore.current = shapes.map(copyShape);
              sculptDragged.current = false;
              return { kind: "sculpt-vertex", id: selected.id, from: copyShape(selected), hole: hit.hole, index: hit.index };
            }
          }
          if (mode === "select") {
            const under = shapeAt(shapes, world);
            if (under) {
              setSculptSelectedId(under.id);
              sculptBefore.current = shapes.map(copyShape);
              sculptDragged.current = false;
              return { kind: "sculpt-move", id: under.id, from: copyShape(under), origin: { ...world } };
            }
          }
          return null;
        }
        const { tool: t, selectedId: id } = live.current;
        if (id === "" || !(t === "select" || t === "vertex" || t === "merge")) {
          return null;
        }
        const state = docRef.current.map;
        const region = findRegion(state, id);
        if (!region) {
          return null;
        }
        // The three anchors and the unit slots: the nearest one under the pointer wins, the unit anchor on a tie.
        const slots = slotsOf(id);
        const nearest = anchorHandleAt(region, world, tol, slots);
        if (nearest) {
          return (nearest.kind === "slot" ? { ...nearest, from: slots } : nearest) satisfies Handle;
        }
        if (t !== "vertex") {
          return null;
        }
        let best = -1;
        let bestDist = tol;
        region.polygon.forEach((v, i) => {
          const d = dist(world, v);
          if (d <= bestDist) {
            bestDist = d;
            best = i;
          }
        });
        if (best >= 0) {
          return {
            kind: "vertex",
            regionId: id,
            group: coincidentVertices(state, id, best, TOPO_LOCK_EPS),
          } satisfies Handle;
        }
        // An edge midpoint: insert the vertex there (in every region sharing the edge) and drag it.
        const n = region.polygon.length;
        for (let i = 0; i < n && n >= 2; i++) {
          const a = region.polygon[i];
          const b = region.polygon[(i + 1) % n];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (dist(a, b) > tol * 2.2 && dist(world, mid) <= tol) {
            const inserted = subdivideEdge(state, id, i);
            if (!inserted) {
              return null;
            }
            dragBase.current = state;
            apply({ ...docRef.current, map: inserted.map });
            return {
              kind: "vertex",
              regionId: id,
              group: coincidentVertices(inserted.map, id, inserted.at, TOPO_LOCK_EPS),
            } satisfies Handle;
          }
        }
        return null;
      },
      onClick(world, regionId, tol, mods) {
        pxScale.current = tol / SNAP_PX;
        if (live.current.sculpting) {
          const { sculptTool: mode, sculptDraft: pts, sculptShapes: shapes, blobRadius: radius, sculptSelectedId: picked } = live.current;
          if (mode === "pen") {
            if (pts.length >= 3 && dist(world, pts[0]) <= tol) {
              finishSculptPen();
              return;
            }
            setSculptDraft([...pts, { ...world }]);
            return;
          }
          if (mode === "blob") {
            const id = nextShapeId();
            rememberShapes([...shapes, { id, ring: circleRing(world.x, world.y, radius), holes: [], hole: false }]);
            setSculptSelectedId(id);
            return;
          }
          if (mode === "vertex") {
            const selected = shapes.find((shape) => shape.id === picked);
            if (selected) {
              const edge = edgeAt(selected, world, tol);
              if (edge) {
                const ring = edge.hole < 0 ? selected.ring : selected.holes[edge.hole];
                const a = ring[edge.index];
                const b = ring[(edge.index + 1) % ring.length];
                rememberShapes(replaceShape(shapes, insertVertex(selected, edge.hole, edge.index, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })));
                return;
              }
            }
          }
          setSculptSelectedId(shapeAt(shapes, world)?.id ?? "");
          return;
        }
        const { tool: t, draft: pts, layer: current, selectedId: pickedId } = live.current;
        const state = docRef.current.map;
        const sameLayer = state.regions.filter((r) => r.is_sea === (current === "sea"));
        if (t === "draw") {
          const snap = snapPoint(world, state.regions, tol);
          if (pts.length >= 3 && dist(snap.point, pts[0]) <= tol) {
            finishDraft();
            return;
          }
          const last = pts[pts.length - 1];
          if (!last || dist(last, snap.point) > 1e-6) {
            setDraft([...pts, snap.point]);
          }
        } else if (t === "knife") {
          const snap = snapPoint(world, sameLayer, tol);
          const last = pts[pts.length - 1];
          if (!last || dist(last, snap.point) > 1e-6) {
            setDraft([...pts, snap.point]);
          }
        } else if (t === "link") {
          const first = live.current.linkFirstId;
          if (regionId === "") {
            setLinkFirstId("");
          } else if (first === "") {
            setLinkFirstId(regionId);
          } else if (first !== regionId) {
            commit(toggleLink(docRef.current.map, first, regionId));
            const linked = docRef.current.map.links.length;
            setStatus(`Toggled ${first} \u2194 ${regionId} (${linked} links).`);
            setLinkFirstId("");
          }
        } else if (t === "prune") {
          // A plain click (no drag) dismisses the marquee.
          cancelBoxPrune();
        } else if (t === "promote") {
          promoteAt(world, regionId);
        } else if (t === "vertex" && mods.shift && pickedId !== "" && roughenAt(world, tol)) {
          return;
        } else if (mods.shift) {
          // Shift-click adds a region to the merge (again to take it out). Any number, touching or not.
          if (regionId === "") {
            return;
          }
          if (pickedId === "" || pickedId === regionId) {
            setSelectedId(regionId);
            setMergeIds([]);
          } else {
            const ids = live.current.mergeIds;
            const next = ids.includes(regionId) ? ids.filter((id) => id !== regionId) : [...ids, regionId];
            setMergeIds(next);
            setStatus(
              next.length === 0
                ? "Shift-click regions to merge into the selected one."
                : `Merge ${[pickedId, ...next].join(" + ")}? Press Merge Regions. Islands that do not touch become one territory.`,
            );
          }
        } else {
          setSelectedId(regionId);
          setSecondId("");
        }
      },
      onDoubleClick() {
        if (live.current.sculpting && live.current.sculptTool === "pen") {
          finishSculptPen();
          return;
        }
        const t = live.current.tool;
        if (t === "draw" || t === "knife") {
          finishDraft();
        }
      },
      onHover(world, tol) {
        if (tol > 0) {
          pxScale.current = tol / SNAP_PX;
        }
        const t = live.current.tool;
        if (t === "lattice") {
          const triangle = live.current.latticeBrush === "triangle" || live.current.latticeShift;
          const hit = world && live.current.layer === "sea" ? latticeHit(world.x, world.y, triangle) : null;
          setLatticeHover((prev) => {
            if (!hit && !prev) {
              return prev;
            }
            if (hit && prev && hit.col === prev.col && hit.row === prev.row && hit.part === prev.part && hit.originX === prev.originX) {
              return prev;
            }
            return hit;
          });
        } else {
          setLatticeHover((prev) => (prev === null ? prev : null));
        }
        if ((t !== "draw" && t !== "knife") || world === null) {
          setCursor(null);
          setClosing(false);
          return;
        }
        const pts = live.current.draft;
        if (t === "draw" && pts.length >= 3 && dist(world, pts[0]) <= tol) {
          setCursor({ point: pts[0], kind: "vertex" });
          setClosing(true);
          return;
        }
        const state = docRef.current.map;
        const pool = t === "knife" ? state.regions.filter((r) => r.is_sea === (live.current.layer === "sea")) : state.regions;
        const snap = snapPoint(world, pool, tol);
        setCursor({ point: snap.point, kind: snap.kind });
        setClosing(false);
      },
      swipeable() {
        if (live.current.sculpting) {
          const mode = live.current.sculptTool;
          return mode === "blob" || (mode === "pen" && live.current.sculptDraft.length === 0);
        }
        const { tool: t, draft: pts, layer: current } = live.current;
        return (t === "knife" && pts.length === 0) || (t === "prune" && current === "land");
      },
      strokeBegin() {
        stroke.current = { active: true, ignore: false, raw: [], scale: 1 };
      },
      onStroke(points, pxToWorld, done) {
        if (live.current.sculpting) {
          const mode = live.current.sculptTool;
          if (mode !== "pen" && mode !== "blob") {
            return;
          }
          if (!done) {
            setSculptDraft(mode === "pen" ? strokePreview(points) : points);
            return;
          }
          setSculptDraft([]);
          if (mode === "blob") {
            const blob = blobFromStroke(points, live.current.blobRadius);
            if (!blob) {
              setStatus("That blob is too small to keep.");
              return;
            }
            const id = nextShapeId();
            rememberShapes([...shapesRef.current, { ...blob, id }]);
            setSculptSelectedId(id);
            setStatus("Blob added. Cut this landmass when the coast is ready.");
            return;
          }
          const ring = ringFromStroke(points, Math.max(0.4, pxToWorld * 2));
          if (!ring) {
            setStatus("Draw a longer outline.");
            return;
          }
          const id = nextShapeId();
          rememberShapes([...shapesRef.current, { id, ring, holes: [], hole: false }]);
          setSculptSelectedId(id);
          setStatus("Shape added. Cut this landmass when the coast is ready.");
          return;
        }
        if (live.current.tool === "prune") {
          // Not a freehand cut: the first and latest points are the marquee's opposite corners.
          if (points.length >= 2) {
            setPruneBox(boxFromPoints(points[0], points[points.length - 1]));
            setBoxDone(done);
          }
          return;
        }
        if (stroke.current.ignore) {
          if (done) {
            stroke.current.ignore = false;
          }
          return;
        }
        stroke.current.raw = points;
        stroke.current.scale = pxToWorld;
        pxScale.current = pxToWorld;
        if (!done) {
          setDraft(strokePreview(points));
          setCursor(null);
          return;
        }
        runStroke();
      },
      onDrag(raw, world, tol) {
        const sculptKind = (raw as { kind?: string }).kind ?? "";
        if (sculptKind.startsWith("sculpt-")) {
          const handle = raw as {
            kind: string;
            id: string;
            from: DraftShape;
            origin?: Vec2;
            center?: Vec2;
            start?: number;
            hole?: number;
            index?: number;
          };
          const source = shapesRef.current.find((shape) => shape.id === handle.id);
          if (!source) {
            return;
          }
          sculptDragged.current = true;
          let next = handle.from;
          if (handle.kind === "sculpt-move" && handle.origin) {
            next = translateShape(handle.from, world.x - handle.origin.x, world.y - handle.origin.y);
          } else if (handle.kind === "sculpt-vertex" && handle.hole !== undefined && handle.index !== undefined) {
            next = moveVertex(handle.from, handle.hole, handle.index, world);
          } else if (handle.kind === "sculpt-scale" && handle.center && handle.start) {
            const factor = Math.min(8, Math.max(0.15, dist(world, handle.center) / handle.start));
            next = scaleShape(handle.from, handle.center, factor);
          } else if (handle.kind === "sculpt-rotate" && handle.center && handle.start !== undefined) {
            const angle = Math.atan2(world.y - handle.center.y, world.x - handle.center.x) - handle.start;
            next = rotateShape(handle.from, handle.center, angle);
          }
          const updated = replaceShape(shapesRef.current, next);
          shapesRef.current = updated;
          setSculptShapes(updated);
          sculptSvgRef.current = "";
          setSculptSvg("");
          return;
        }
        const handle = raw as Handle;
        const base = docRef.current.map;
        if (dragBase.current === null) {
          dragBase.current = base;
        }
        if (handle.kind === "anchor") {
          apply({ ...docRef.current, map: updateRegion(base, handle.regionId, { cx: world.x, cy: world.y }) });
          return;
        }
        if (handle.kind === "facility") {
          apply({ ...docRef.current, map: updateRegion(base, handle.regionId, { facility_anchor: [world.x, world.y] }) });
          return;
        }
        if (handle.kind === "slot") {
          apply({ ...docRef.current, map: updateRegion(base, handle.regionId, { unit_slots: moveSlot(handle.from, handle.index, world) }) });
          return;
        }
        const inGroup = (id: string, i: number) => handle.group.some((g) => g.regionId === id && g.index === i);
        // Snap only to the layer being dragged, so a coast vertex cannot latch onto a sea border.
        const sea = findRegion(base, handle.regionId)?.is_sea ?? false;
        const snap = snapPoint(
          world,
          base.regions.filter((r) => r.is_sea === sea),
          tol,
          inGroup,
        );
        apply({ ...docRef.current, map: moveVertices(base, handle.group, snap.point) });
      },
      onDragEnd(raw) {
        const sculptKind = (raw as { kind?: string }).kind ?? "";
        if (sculptKind.startsWith("sculpt-")) {
          if (sculptDragged.current && sculptBefore.current) {
            sculptPast.current = [...sculptPast.current, sculptBefore.current].slice(-40);
            sculptFuture.current = [];
          }
          sculptBefore.current = null;
          sculptDragged.current = false;
          return;
        }
        const handle = raw as Handle;
        const before = dragBase.current;
        dragBase.current = null;
        if (!before) {
          return;
        }
        let next = docRef.current.map;
        if (handle.kind === "vertex") {
          for (const id of new Set(handle.group.map((g) => g.regionId))) {
            next = weldRegion(next, id);
          }
        }
        const cur = docRef.current;
        apply({ map: next, past: [...cur.past, before].slice(-HISTORY_LIMIT), future: [] });
      },
      onLattice(world, mods) {
        const { tool: t, layer: current, selectedId, latticeBrush: brush, latticeShift: shiftDown, land: mask } = live.current;
        if (t !== "lattice" || current !== "sea") {
          setStatus("Switch to Sea mode and choose Lattice to paint zones.");
          return false;
        }
        let stroke = latticeStroke.current;
        if (!stroke || stroke.erase !== mods.erase) {
          const base = docRef.current.map;
          const picked = findRegion(base, selectedId);
          const under = findRegion(base, mods.underId ?? "");
          let start = base;
          let targetId = picked?.is_sea ? picked.id : under?.is_sea ? under.id : "";
          if (targetId === "") {
            if (mods.erase) {
              setStatus("Select a sea zone to erase from.");
              return false;
            }
            const created = addEmptySeaZone(base);
            start = created.map;
            targetId = created.id;
          }
          if (selectedId !== targetId) {
            setSelectedId(targetId);
          }
          stroke = { base, start, hits: [], erase: mods.erase, last: world, targetId };
          latticeStroke.current = stroke;
        }
        const triangle = brush === "triangle" || mods.shift || shiftDown;
        const hover = latticeHit(world.x, world.y, triangle);
        setLatticeHover((prev) => {
          if (!hover && !prev) {
            return prev;
          }
          if (hover && prev && hover.col === prev.col && hover.row === prev.row && hover.part === prev.part && hover.originX === prev.originX) {
            return prev;
          }
          return hover;
        });
        const seen = new Set(stroke.hits.map((hit) => `${hit.col},${hit.row},${hit.part}`));
        for (const hit of hitsAlong(stroke.last, world, triangle)) {
          const key = `${hit.col},${hit.row},${hit.part}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          stroke.hits.push(hit);
        }
        stroke.last = world;
        const active = stroke;
        if (!mods.done) {
          if (active.hits.length > 0 && latticeFrame.current === 0) {
            latticeFrame.current = window.requestAnimationFrame(() => {
              latticeFrame.current = 0;
              if (latticeStroke.current !== active) {
                return;
              }
              const preview = paintSeaLatticeMap(active.start, active.targetId, active.hits, active.erase, mask, false);
              apply({ ...docRef.current, map: preview });
            });
          }
          return true;
        }
        if (latticeFrame.current !== 0) {
          window.cancelAnimationFrame(latticeFrame.current);
          latticeFrame.current = 0;
        }
        latticeStroke.current = null;
        const next =
          active.hits.length > 0 ? paintSeaLatticeMap(active.start, active.targetId, active.hits, active.erase, mask, true) : active.start;
        const cur = docRef.current;
        if (next === active.start) {
          apply({ ...cur, map: active.base });
          const owner = active.base.regions.find((region) => region.is_sea && region.id === active.targetId);
          setStatus(
            owner && active.start === active.base
              ? `Those squares already belong to ${active.targetId}. Press New sea zone to carve a separate zone out of it.`
              : "Nothing changed. Paint over water to add squares.",
          );
          return true;
        }
        apply({ map: next, past: [...cur.past, active.base].slice(-HISTORY_LIMIT), future: [] });
        const count = findRegion(next, active.targetId)?.lattice?.length ?? 0;
        setStatus(
          active.erase
            ? `Erased cells from ${active.targetId}. ${count} lattice cells remain.`
            : `Painted ${active.targetId}. ${count} lattice cells. The land mask clips the coast when the map draws.`,
        );
        return true;
      },
    }),
    [links, selectedId, secondId, mergeIds, promoteAt, linkFirstId, draft, drawSea, layer, cursor, closing, tool, pruneBox, boxDone, boxIds, confirmBoxPrune, cancelBoxPrune, apply, commit, finishDraft, cancelDraft, runStroke, roughenAt, selectedSlots, slotsOf, showUncovered, uncovered, latticeBrush, latticeShift, latticeHover, sculpting, sculptTool, sculptShapes, sculptSelectedId, sculptDraft, finishSculptPen, rememberShapes],
  );

  const selected = selectedId === "" ? null : (findRegion(map, selectedId) ?? null);
  const second = secondId === "" ? null : (findRegion(map, secondId) ?? null);
  const mergeWith = mergeIds.map((id) => findRegion(map, id)).filter((r): r is EditorRegion => r !== undefined);
  const selectedUnits = useMemo(() => (selectedId === "" ? [] : startingUnitsOf(map, selectedId)), [map, selectedId]);

  return {
    map,
    geometry,
    tool,
    layer,
    drawSea,
    draft,
    selected,
    slotCount: selectedSlots.length,
    second,
    mergeWith,
    selectedUnits,
    linkFirstId,
    status,
    canUndo: doc.past.length > 0 || sculptPast.current.length > 0,
    canRedo: doc.future.length > 0 || sculptFuture.current.length > 0,
    linkCounts,
    binding,
    setTool,
    setLayer,
    finishDraft,
    cancelDraft,
    undoVertex,
    select,
    patchSelected,
    addUnitSlot,
    removeLastUnitSlot,
    seedUnitSlots,
    placeFacilityAnchor,
    setUnits,
    rename,
    removeSelected,
    makeDecorative,
    splitIslands,
    pruneArea,
    setPruneArea,
    pruneBox,
    boxPruneCount: boxIds.length,
    pruneCount,
    pruneSmallIslands: pruneIslands,
    mergeSelected,
    clearSecond,
    strokeTolerance,
    setStrokeTolerance,
    strokeSmooth,
    setStrokeSmooth,
    latticeBrush,
    setLatticeBrush,
    latticeShift,
    newSeaZone,
    roughenSelected,
    addMasterBlock,
    calculateNeighbors,
    unlink,
    undo,
    redo,
    exportJson,
    saveToDevServer,
    exportBoardJson,
    showUncovered,
    toggleUncovered,
    resetToDemo,
    versions,
    saveVersion,
    loadVersion,
    deleteVersion,
    openMap,
    openBlank,
    referenceUrl,
    setReference,
    validate,
    archiveMap,
    sculpting,
    sculptTool,
    sculptShapes,
    sculptSelectedId,
    sculptTolerance,
    blobRadius,
    sculptBaked: sculptSvg !== "",
    setSculpting(on) {
      setSculptingState(on);
      setSculptDraft([]);
      if (on) {
        setStatus("Landmass. Draw the coast, then Cut this landmass.");
      }
    },
    setSculptTool(next) {
      setSculptToolState(next);
      setSculptDraft([]);
    },
    setSculptTolerance(tolerance) {
      setSculptToleranceState(Math.max(0.25, Math.min(12, tolerance)));
      sculptSvgRef.current = "";
      setSculptSvg("");
    },
    setBlobRadius(radius) {
      setBlobRadiusState(Math.max(2, Math.min(48, radius)));
    },
    toggleSculptHole() {
      const id = sculptSelectedId;
      const shape = sculptShapes.find((item) => item.id === id);
      if (!shape) {
        setStatus("Select a draft shape to mark it as a hole.");
        return;
      }
      rememberShapes(replaceShape(sculptShapes, { ...shape, hole: !shape.hole }));
      setStatus(shape.hole ? `${id} is land again.` : `${id} will be cut out as an inland hole.`);
    },
    deleteSculptShape() {
      if (sculptSelectedId === "") {
        return;
      }
      rememberShapes(sculptShapes.filter((shape) => shape.id !== sculptSelectedId));
      setSculptSelectedId("");
    },
    importSculptSvg(text) {
      try {
        const imported = shapesFromSvg(text).map((shape) => ({ ...shape, id: nextShapeId() }));
        if (imported.length === 0) {
          setStatus("That SVG has no closed paths.");
          return;
        }
        rememberShapes([...shapesRef.current, ...imported]);
        setSculptSelectedId(imported[0].id);
        setSculptingState(true);
        setStatus(`Imported ${imported.length} shape${imported.length === 1 ? "" : "s"}. Cut this landmass when the coast is ready.`);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "That SVG could not be read.");
      }
    },
    bakeSculpt() {
      currentSvg();
    },
    downloadLandmassSvg,
    enterCutting,
    openCoastSvg,
  };
}
