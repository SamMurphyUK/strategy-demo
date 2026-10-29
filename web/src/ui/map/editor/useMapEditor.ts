import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dict } from "../../../engine/model/types";
import { type MapGeometry, type Vec2 } from "../geometry";
import { isLandAt } from "../hitTest";
import type { EditorBinding } from "../MapView";
import type { EditorLinkKind, EditorToolName } from "../mapRenderer";
import { clipperFor, type MultiPolygon, multiPolygonArea, type Ring } from "../regionClip";
import type { MasterLand } from "../svgLandLoader";
import { autoNeighborPairs } from "./adjacency";
import {
  addBlocks,
  addRegionFromPolygon,
  applyAutoLinks,
  applyMerge,
  applySplitMany,
  coincidentVertices,
  deleteRegion,
  dist,
  type EditorMap,
  type EditorRegion,
  editorFromMapJson,
  editorToGeometry,
  editorToMapJson,
  findRegion,
  formatMapJson,
  labelPoint,
  linkKind,
  moveVertices,
  renameRegion,
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
import { anchorFor, masterBlocks, mergePolygons, splitPolygonInto } from "./slicing";

export type EditorTool = EditorToolName;
export type EditorLayer = "land" | "sea";

type Handle = { kind: "vertex"; regionId: string; group: VertexRef[] } | { kind: "anchor"; regionId: string };

const STORAGE_KEY = "strategy-demo.map-editor.v2";
const HISTORY_LIMIT = 100;
/** Where the dev server's save middleware listens (see web/dev/saveMapPlugin.mjs). */
export const SAVE_ENDPOINT = "/__dev/save-map";

interface Doc {
  map: EditorMap;
  past: EditorMap[];
  future: EditorMap[];
}

function loadInitial(demoJson: Dict): EditorMap {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return editorFromMapJson(JSON.parse(saved));
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

const TOOL_KEYS: Record<string, EditorTool> = { s: "select", v: "vertex", k: "knife", m: "merge", d: "draw", l: "link" };

const ringOf = (points: Vec2[]): Ring => points.map((p) => [p.x, p.y]);

export interface MapEditor {
  map: EditorMap;
  geometry: MapGeometry;
  tool: EditorTool;
  layer: EditorLayer;
  drawSea: boolean;
  draft: Vec2[];
  selected: EditorRegion | null;
  /** The second region of a pending merge, or null. */
  second: EditorRegion | null;
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
  mergeSelected(): void;
  clearSecond(): void;
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
  const [secondId, setSecondId] = useState("");
  const [linkFirstId, setLinkFirstId] = useState("");
  const [cursor, setCursor] = useState<{ point: Vec2; kind: "vertex" | "edge" | "free" } | null>(null);
  const [closing, setClosing] = useState(false);
  const [status, setStatus] = useState("");
  const dragBase = useRef<EditorMap | null>(null);
  const drawSea = layer === "sea";
  const live = useRef({ tool, layer, drawSea, draft, selectedId, secondId, linkFirstId, land });
  live.current = { tool, layer, drawSea, draft, selectedId, secondId, linkFirstId, land };

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
  const shapeOf = useCallback((region: { id: string; polygon: Vec2[]; is_sea: boolean }): MultiPolygon => {
    const mask = live.current.land;
    if (!mask) {
      return [[ringOf(region.polygon)]];
    }
    return clipperFor(mask.polygons).clip({ id: region.id, type: region.is_sea ? "sea" : "land", points: region.polygon });
  }, []);

  /** Recomputes neighbor links from the geometry, keeping manual overrides. */
  const withAutoLinks = useCallback((current: EditorMap): { map: EditorMap; pairs: number; masked: boolean } => {
    const mask = live.current.land;
    const pairs = autoNeighborPairs(
      current.regions.map((r) => ({ id: r.id, polygon: r.polygon, is_sea: r.is_sea })),
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
      cancelDraft();
      setLinkFirstId("");
      setSecondId("");
      setStatus("");
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
      setLayerState(next);
      const picked = findRegion(docRef.current.map, live.current.selectedId);
      if (picked && picked.is_sea !== (next === "sea")) {
        setSelectedId("");
      }
    },
    [cancelDraft],
  );

  /**
   * Cuts with a knife line (the draft, or `swipe` when it was dragged out in one go). The target is a region
   * of the active layer that the line actually crosses: the selected one if it does, otherwise the topmost.
   */
  const cutWithKnife = useCallback(
    (swipe?: Vec2[]) => {
      const { draft, selectedId: pickedId, layer: current } = live.current;
      const line = swipe ?? draft;
      const state = docRef.current.map;
      const sea = current === "sea";
      if (line.length < 2) {
        setStatus("Click at least two points, then press Enter or double-click to cut.");
        return;
      }
      const pool = state.regions.filter((r) => r.is_sea === sea);
      const picked = pool.find((r) => r.id === pickedId);
      const order = picked ? [picked, ...[...pool].reverse().filter((r) => r !== picked)] : [...pool].reverse();
      let target: EditorRegion | null = null;
      let pieces: Vec2[][] = [];
      let problem = "";
      for (const candidate of order) {
        const result = splitPolygonInto(candidate.polygon, line);
        if (result.ok) {
          target = candidate;
          pieces = result.pieces;
          break;
        }
        // Only a real problem with a region the line does reach is worth reporting.
        if (!problem && !result.error.startsWith("The knife line has to cross")) {
          problem = result.error;
        }
      }
      if (!target) {
        setStatus(problem || `The line does not cut through any ${sea ? "sea zone" : "land region"}. Draw it across one.`);
        return;
      }
      const region: EditorRegion = target;
      const place = (polygon: Vec2[], prefer?: Vec2) => {
        const shape = shapeOf({ id: region.id, polygon, is_sea: sea });
        return anchorFor(shape, prefer) ?? labelPoint(polygon);
      };
      // The piece with the most visible land or sea keeps the original id and settings.
      const ranked = pieces
        .map((polygon) => ({ polygon, area: multiPolygonArea(shapeOf({ id: region.id, polygon, is_sea: sea })) }))
        .sort((p, q) => q.area - p.area);
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
        applied.newIds.length === 1
          ? `Cut ${region.id} in two. The new half is ${applied.newIds[0]}; the larger piece kept ${region.id}'s settings.`
          : `Cut ${region.id} into ${applied.newIds.length + 1}. New pieces: ${applied.newIds.join(", ")}.`,
      );
    },
    [cancelDraft, commit, shapeOf, withAutoLinks],
  );

  const finishDraft = useCallback(() => {
    const { draft: pts, drawSea: sea, tool: current } = live.current;
    if (current === "knife") {
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
  }, [cancelDraft, commit, cutWithKnife]);

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

  const mergeSelected = useCallback(() => {
    const { selectedId: aId, secondId: bId } = live.current;
    const state = docRef.current.map;
    const a = findRegion(state, aId);
    const b = findRegion(state, bId);
    if (!a || !b) {
      setStatus("Click one region, then Shift-click its neighbor.");
      return;
    }
    if (a.is_sea !== b.is_sea) {
      setStatus("Land and sea regions cannot be merged.");
      return;
    }
    const result = mergePolygons(a.polygon, b.polygon, SAME_VERTEX_EPS);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    const shape = shapeOf({ id: a.id, polygon: result.points, is_sea: a.is_sea });
    const centre =
      anchorFor(shape, { x: a.cx, y: a.cy }) ?? anchorFor(shape, { x: b.cx, y: b.cy }) ?? labelPoint(result.points);
    const merged = applyMerge(state, aId, bId, { polygon: result.points, cx: centre.x, cy: centre.y });
    if (!merged) {
      return;
    }
    commit(withAutoLinks(merged).map);
    setSecondId("");
    setSelectedId(aId);
    setStatus(`Merged ${bId} into ${aId}. It keeps ${aId}'s settings.`);
  }, [commit, shapeOf, withAutoLinks]);

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
      state.regions.filter((r) => r.is_sea === sea).map((r) => r.polygon),
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
      } else if (e.key === "Escape") {
        if (live.current.draft.length > 0 || live.current.linkFirstId !== "") {
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
  }, [active, cancelDraft, finishDraft, redo, setTool, undo, undoVertex]);

  const binding = useMemo<EditorBinding>(
    () => ({
      overlay: {
        links,
        selectedId,
        secondId,
        linkFirstId,
        draft,
        drawSea,
        layer,
        cursor,
        closing,
        tool,
      },
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
        } else if (mods.shift) {
          // Shift-click picks the second region of a merge.
          if (regionId === "") {
            return;
          }
          if (pickedId === "" || pickedId === regionId) {
            setSelectedId(regionId);
            setSecondId("");
          } else {
            setSecondId(regionId);
            setStatus(`Merge ${pickedId} with ${regionId}? Press Merge Regions.`);
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
        return live.current.tool === "knife" && live.current.draft.length === 0;
      },
      onSwipe(from, to, tol, done) {
        const pool = docRef.current.map.regions.filter((r) => r.is_sea === (live.current.layer === "sea"));
        const a = snapPoint(from, pool, tol).point;
        const b = snapPoint(to, pool, tol).point;
        if (!done) {
          setDraft([a, b]);
          setCursor(null);
          return;
        }
        if (dist(a, b) < 1e-6) {
          cancelDraft();
          return;
        }
        cutWithKnife([a, b]);
        cancelDraft();
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
    [links, selectedId, secondId, linkFirstId, draft, drawSea, layer, cursor, closing, tool, apply, commit, finishDraft, cancelDraft, cutWithKnife],
  );

  const selected = selectedId === "" ? null : (findRegion(map, selectedId) ?? null);
  const second = secondId === "" ? null : (findRegion(map, secondId) ?? null);
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
    mergeSelected,
    clearSecond,
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
