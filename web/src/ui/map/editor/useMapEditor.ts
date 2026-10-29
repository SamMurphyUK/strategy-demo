import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dict } from "../../../engine/model/types";
import { type MapGeometry, pointInPolygon, type Vec2 } from "../geometry";
import { isLandAt } from "../hitTest";
import { type EditorBinding, SNAP_PX } from "../MapView";
import type { EditorLinkKind, EditorToolName } from "../mapRenderer";
import { clipperFor, type MultiPolygon, multiPolygonArea, type Ring } from "../regionClip";
import type { MasterLand } from "../svgLandLoader";
import { autoNeighborPairs } from "./adjacency";
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
  updateRegion,
  type VertexRef,
  weldRegion,
} from "./editorModel";
import {
  anchorFor,
  carveLoop,
  KNIFE_REACH_PX,
  landComponentAt,
  LOOP_CLOSE_PX,
  LOOP_MIN_PX,
  masterBlocks,
  mergeRegions,
  type PreparedStroke,
  prepareClicks,
  prepareStroke,
  splitPolygonInto,
  strokePreview,
} from "./slicing";

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

type Handle = { kind: "vertex"; regionId: string; group: VertexRef[] } | { kind: "anchor"; regionId: string };

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

const TOOL_KEYS: Record<string, EditorTool> = { s: "select", v: "vertex", k: "knife", m: "merge", d: "draw", l: "link", p: "promote", b: "prune" };

const ringOf = (points: Vec2[]): Ring => points.map((p) => [p.x, p.y]);

export interface MapEditor {
  map: EditorMap;
  geometry: MapGeometry;
  tool: EditorTool;
  layer: EditorLayer;
  drawSea: boolean;
  draft: Vec2[];
  selected: EditorRegion | null;
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
  /** Roughens the border between the selected region and its second pick, or every border it shares. */
  roughenSelected(): void;
  addMasterBlock(): void;
  calculateNeighbors(): void;
  unlink(a: string, b: string): void;
  undo(): void;
  redo(): void;
  exportJson(): void;
  saveToDevServer(): void;
  resetToDemo(): void;
}

export function useMapEditor(demoJson: Dict, land: MasterLand | null, active: boolean): MapEditor {
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
  const dragBase = useRef<EditorMap | null>(null);
  const drawSea = layer === "sea";
  const [strokeTolerance, setStrokeTolerance] = useState<StrokeTolerance>("medium");
  const [strokeSmooth, setStrokeSmooth] = useState(true);
  const stroke = useRef({ active: false, ignore: false, raw: [] as Vec2[], scale: 1 });
  /** World units per screen pixel at the current zoom, so the 25px and 20px knife limits mean pixels. */
  const pxScale = useRef(1);
  const live = useRef({ tool, layer, drawSea, draft, selectedId, secondId, mergeIds, linkFirstId, land, strokeTolerance, strokeSmooth });
  live.current = { tool, layer, drawSea, draft, selectedId, secondId, mergeIds, linkFirstId, land, strokeTolerance, strokeSmooth };

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
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(editorToMapJson(map, { round: false })));
    } catch {
      // Storage full or blocked: the editor still works, it just will not persist.
    }
  }, [map]);

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
      commit(withAutoLinks(applied.map).map);
      cancelDraft();
      setSelectedId(applied.newIds[0]);
      setSecondId("");
      setStatus(
        cut.loop
          ? `Carved ${applied.newIds.join(", ")} out of ${region.id}.`
          : applied.newIds.length === 1
          ? `Cut ${region.id} in two. The new half is ${applied.newIds[0]}; the larger piece kept ${region.id}'s settings.`
          : `Cut ${region.id} into ${applied.newIds.length + 1}. New pieces: ${applied.newIds.join(", ")}.`,
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
    commit(deleteRegion(docRef.current.map, id));
    setSelectedId("");
    setSecondId("");
    setStatus(`Deleted ${id}. "Reset to Master Block" fills the gap.`);
  }, [commit]);

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
    commit(withAutoLinks(added.map).map);
    setSelectedId(added.ids[0]);
    setSecondId("");
    setStatus(
      `Added ${added.ids.length} master ${sea ? "sea" : "land"} block${added.ids.length === 1 ? "" : "s"}: ${added.ids.join(", ")}. Slice ${added.ids.length === 1 ? "it" : "them"} with the knife.`,
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

  const undo = useCallback(() => {
    const cur = docRef.current;
    const previous = cur.past[cur.past.length - 1];
    if (previous) {
      apply({ map: previous, past: cur.past.slice(0, -1), future: [cur.map, ...cur.future] });
    }
  }, [apply]);

  const redo = useCallback(() => {
    const cur = docRef.current;
    const [next, ...rest] = cur.future;
    if (next) {
      apply({ map: next, past: [...cur.past, cur.map], future: rest });
    }
  }, [apply]);

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

  const resetToDemo = useCallback(() => {
    commit(editorFromMapJson(demoJson));
    setSelectedId("");
    setSecondId("");
    cancelDraft();
    setStatus("Reset to the demo map. Undo brings your work back.");
  }, [cancelDraft, commit, demoJson]);

  // Keyboard shortcuts, only while the editor is open.
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
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
        setTool(TOOL_KEYS[e.key.toLowerCase()]);
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
  }, [active, cancelBoxPrune, cancelDraft, finishDraft, makeDecorative, redo, setTool, undo, undoVertex]);

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
      },
      prunePrompt: pruneBox && boxDone ? { box: pruneBox, count: boxIds.length, confirm: confirmBoxPrune, cancel: cancelBoxPrune } : null,
      pickHandle(world, tol) {
        const { tool: t, selectedId: id } = live.current;
        if (id === "" || !(t === "select" || t === "vertex" || t === "merge")) {
          return null;
        }
        const state = docRef.current.map;
        const region = findRegion(state, id);
        if (!region) {
          return null;
        }
        if (dist(world, { x: region.cx, y: region.cy }) <= tol) {
          return { kind: "anchor", regionId: id } satisfies Handle;
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
        const { tool: t, draft: pts, layer: current } = live.current;
        return (t === "knife" && pts.length === 0) || (t === "prune" && current === "land");
      },
      strokeBegin() {
        stroke.current = { active: true, ignore: false, raw: [], scale: 1 };
      },
      onStroke(points, pxToWorld, done) {
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
        const handle = raw as Handle;
        const base = docRef.current.map;
        if (dragBase.current === null) {
          dragBase.current = base;
        }
        if (handle.kind === "anchor") {
          apply({ ...docRef.current, map: updateRegion(base, handle.regionId, { cx: world.x, cy: world.y }) });
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
    }),
    [links, selectedId, secondId, mergeIds, promoteAt, linkFirstId, draft, drawSea, layer, cursor, closing, tool, pruneBox, boxDone, boxIds, confirmBoxPrune, cancelBoxPrune, apply, commit, finishDraft, cancelDraft, runStroke, roughenAt],
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
    second,
    mergeWith,
    selectedUnits,
    linkFirstId,
    status,
    canUndo: doc.past.length > 0,
    canRedo: doc.future.length > 0,
    linkCounts,
    binding,
    setTool,
    setLayer,
    finishDraft,
    cancelDraft,
    undoVertex,
    select,
    patchSelected,
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
    roughenSelected,
    addMasterBlock,
    calculateNeighbors,
    unlink,
    undo,
    redo,
    exportJson,
    saveToDevServer,
    resetToDemo,
  };
}
