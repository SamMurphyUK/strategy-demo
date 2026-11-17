// An empty board the pen can draw on. The rectangle is the camera frame and the tracing sheet.
import type { Dict } from "../../../engine/model/types";
import { isDict } from "../../../engine/model/types";
import type { Rect } from "../geometry";
import type { EditorMap } from "./editorModel";

export function blankEditorMap(width: number, height: number): EditorMap {
  const w = Math.max(64, Math.round(width));
  const h = Math.max(64, Math.round(height));
  const meta: Dict = {
    schema: "blank",
    board: { x: 0, y: 0, w, h },
    turn_order: ["ussr", "ger", "uk", "jap", "usa"],
    starting_units: [],
  };
  return {
    regions: [],
    links: [],
    auto: [],
    overrides: { add: [], remove: [] },
    meta,
  };
}

/** The blank board's frame, when this map was started from one. */
export function boardFrame(map: EditorMap): Rect | null {
  const board = map.meta.board;
  if (!isDict(board)) {
    return null;
  }
  const w = Number(board.w);
  const h = Number(board.h);
  if (!(w > 0) || !(h > 0)) {
    return null;
  }
  return { x: Number(board.x ?? 0), y: Number(board.y ?? 0), w, h };
}
