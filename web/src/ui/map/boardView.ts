// Which board draws the campaign. Pure.
//
//   2d       the canvas map. The default.
//   3d       the diorama: the canvas map's pieces over a React Three Fiber ground.
//   vanilla  the master copy of the first React Three Fiber board (viewport3d/vanilla).
//   shogun   a copy of vanilla with the Shogun II art pass (viewport3d/shogun).
//   shogun2  the diorama's units and play on the Shogun ground (viewport3d/shogun2).
//
// The page's `?view=` names one, and the main menu switches between them.

export const BOARD_VIEWS = ["2d", "3d", "vanilla", "shogun", "shogun2"] as const;

export type BoardView = (typeof BOARD_VIEWS)[number];

export const BOARD_VIEW_LABEL: Record<BoardView, string> = {
  "2d": "2D",
  "3d": "Diorama",
  vanilla: "Vanilla",
  shogun: "Shogun",
  shogun2: "Shogun V2",
};

/** The board a `?view=` value names. Anything else is the 2D map. */
export function boardViewOf(value: string | null | undefined): BoardView {
  const name = String(value ?? "").trim().toLowerCase();
  return (BOARD_VIEWS as readonly string[]).includes(name) ? (name as BoardView) : "2d";
}

/** The page's query string with `view` set for a board. The 2D map carries no `view`. Other keys stay. */
export function boardViewSearch(search: string, view: BoardView): string {
  const query = new URLSearchParams(search);
  if (view === "2d") {
    query.delete("view");
  } else {
    query.set("view", view);
  }
  const text = query.toString();
  return text === "" ? "" : `?${text}`;
}
