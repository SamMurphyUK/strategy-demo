import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dict } from "../../../engine/model/types";
import type { MapGeometry, Vec2 } from "../geometry";
import { isLandAt } from "../hitTest";
import type { EditorBinding } from "../MapView";
import type { EditorLinkKind } from "../mapRenderer";
import { clipperFor } from "../regionClip";
import type { MasterLand } from "../svgLandLoader";
import { autoNeighborPairs } from "./adjacency";
import {
  addRegionFromPolygon,
  applyAutoLinks,
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
  linkKind,
  moveVertices,
  renameRegion,
  snapPoint,
  toggleLink,
  updateRegion,
  type VertexRef,
  weldRegion,
} from "./editorModel";

export type EditorTool = "select" | "draw" | "link";

type Handle = { kind: "vertex"; regionId: string; group: VertexRef[] } | { kind: "anchor"; regionId: string };

const STORAGE_KEY = "strategy-demo.map-editor.v2";
const HISTORY_LIMIT = 100;

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

export interface MapEditor {
  map: EditorMap;
  geometry: MapGeometry;
  tool: EditorTool;
  drawSea: boolean;
  draft: Vec2[];
  selected: EditorRegion | null;
  linkFirstId: string;
  status: string;
  canUndo: boolean;
  canRedo: boolean;
  linkCounts: Record<EditorLinkKind, number>;
  binding: EditorBinding;
  setTool(tool: EditorTool): void;
  setDrawSea(sea: boolean): void;
  finishDraft(): void;
  cancelDraft(): void;
  undoVertex(): void;
  select(id: string): void;
  patchSelected(patch: Partial<EditorRegion>): void;
  rename(newId: string): string;
  removeSelected(): void;
  calculateNeighbors(): void;
  unlink(a: string, b: string): void;
  undo(): void;
  redo(): void;
  exportJson(): void;
  resetToDemo(): void;
}

export function useMapEditor(demoJson: Dict, land: MasterLand | null, active: boolean): MapEditor {
  const [doc, setDoc] = useState<Doc>(() => ({ map: loadInitial(demoJson), past: [], future: [] }));
  const docRef = useRef(doc);
  const [tool, setToolState] = useState<EditorTool>("select");
  const [drawSea, setDrawSea] = useState(false);
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [linkFirstId, setLinkFirstId] = useState("");
  const [cursor, setCursor] = useState<{ point: Vec2; kind: "vertex" | "edge" | "free" } | null>(null);
  const [closing, setClosing] = useState(false);
  const [status, setStatus] = useState("");
  const dragBase = useRef<EditorMap | null>(null);
  const live = useRef({ tool, drawSea, draft, selectedId, linkFirstId, land });
  live.current = { tool, drawSea, draft, selectedId, linkFirstId, land };

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

  const cancelDraft = useCallback(() => {
    setDraft([]);
    setCursor(null);
    setClosing(false);
  }, []);

  const setTool = useCallback(
    (next: EditorTool) => {
      cancelDraft();
      setLinkFirstId("");
      setToolState(next);
    },
    [cancelDraft],
  );

  const finishDraft = useCallback(() => {
    const { draft: pts, drawSea: sea } = live.current;
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
  }, [cancelDraft, commit]);

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
    setStatus(`Deleted ${id}.`);
  }, [commit]);

  const calculateNeighbors = useCallback(() => {
    const current = docRef.current.map;
    const mask = live.current.land;
    const pairs = autoNeighborPairs(
      current.regions.map((r) => ({ id: r.id, polygon: r.polygon, is_sea: r.is_sea })),
      mask ? (x, y) => isLandAt(mask, { x, y }) : null,
    );
    const next = applyAutoLinks(current, pairs);
    commit(next);
    const manual = next.overrides.add.length + next.overrides.remove.length;
    setStatus(
      `${next.links.length} links from ${pairs.length} detected` +
        (manual > 0 ? `, with ${manual} manual override${manual === 1 ? "" : "s"} kept.` : ".") +
        (mask ? "" : " Land mask not loaded, so coastal links were skipped."),
    );
  }, [commit]);

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

  const exportJson = useCallback(() => {
    // With the land loaded the file also carries each region's true clipped shape (same clipper the canvas uses).
    const land = live.current.land;
    const text = formatMapJson(editorToMapJson(docRef.current.map, { round: true, clipper: land ? clipperFor(land.polygons) : undefined }));
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "demomap01.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const note = `Exported demomap01.json (${docRef.current.map.regions.length} regions).`;
    navigator.clipboard
      ?.writeText(text)
      .then(() => setStatus(`${note} Also copied to the clipboard.`))
      .catch(() => setStatus(note));
    setStatus(note);
  }, []);

  const resetToDemo = useCallback(() => {
    commit(editorFromMapJson(demoJson));
    setSelectedId("");
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
      } else if (e.key === "Enter") {
        finishDraft();
      } else if (e.key === "Backspace" && live.current.draft.length > 0) {
        e.preventDefault();
        undoVertex();
      } else if (e.key === "Escape") {
        if (live.current.draft.length > 0 || live.current.linkFirstId !== "") {
          cancelDraft();
          setLinkFirstId("");
        } else {
          setSelectedId("");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cancelDraft, finishDraft, redo, undo, undoVertex]);

  const binding = useMemo<EditorBinding>(
    () => ({
      overlay: {
        links,
        selectedId,
        linkFirstId,
        draft,
        drawSea,
        cursor,
        closing,
        tool,
      },
      pickHandle(world, tol) {
        const { tool: t, selectedId: id } = live.current;
        if (t === "draw" || id === "") {
          return null;
        }
        const region = findRegion(docRef.current.map, id);
        if (!region) {
          return null;
        }
        if (dist(world, { x: region.cx, y: region.cy }) <= tol) {
          return { kind: "anchor", regionId: id } satisfies Handle;
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
            group: coincidentVertices(docRef.current.map, id, best),
          } satisfies Handle;
        }
        return null;
      },
      onClick(world, regionId, tol) {
        const { tool: t, draft: pts } = live.current;
        if (t === "draw") {
          const snap = snapPoint(world, docRef.current.map.regions, tol);
          if (pts.length >= 3 && dist(snap.point, pts[0]) <= tol) {
            finishDraft();
            return;
          }
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
        } else {
          setSelectedId(regionId);
        }
      },
      onDoubleClick() {
        if (live.current.tool === "draw") {
          finishDraft();
        }
      },
      onHover(world, tol) {
        if (live.current.tool !== "draw" || world === null) {
          setCursor(null);
          setClosing(false);
          return;
        }
        const pts = live.current.draft;
        if (pts.length >= 3 && dist(world, pts[0]) <= tol) {
          setCursor({ point: pts[0], kind: "vertex" });
          setClosing(true);
          return;
        }
        const snap = snapPoint(world, docRef.current.map.regions, tol);
        setCursor({ point: snap.point, kind: snap.kind });
        setClosing(false);
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
        const snap = snapPoint(world, base.regions, tol, inGroup);
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
    [links, selectedId, linkFirstId, draft, drawSea, cursor, closing, tool, apply, commit, finishDraft],
  );

  const selected = selectedId === "" ? null : (findRegion(map, selectedId) ?? null);

  return {
    map,
    geometry,
    tool,
    drawSea,
    draft,
    selected,
    linkFirstId,
    status,
    canUndo: doc.past.length > 0,
    canRedo: doc.future.length > 0,
    linkCounts,
    binding,
    setTool,
    setDrawSea,
    finishDraft,
    cancelDraft,
    undoVertex,
    select,
    patchSelected,
    rename,
    removeSelected,
    calculateNeighbors,
    unlink,
    undo,
    redo,
    exportJson,
    resetToDemo,
  };
}