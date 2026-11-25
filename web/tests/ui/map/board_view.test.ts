import { describe, expect, it } from "vitest";
import { BOARD_VIEW_LABEL, BOARD_VIEWS, boardViewOf, boardViewSearch } from "../../../src/ui/map/boardView";

describe("which board draws the campaign", () => {
  it("opens the 2D map unless the page names another board", () => {
    expect(boardViewOf(null)).toBe("2d");
    expect(boardViewOf("")).toBe("2d");
    expect(boardViewOf("hologram")).toBe("2d");
  });

  it("reads each board's name from ?view=", () => {
    expect(boardViewOf("3d")).toBe("3d");
    expect(boardViewOf("vanilla")).toBe("vanilla");
    expect(boardViewOf("shogun")).toBe("shogun");
    expect(boardViewOf(" Shogun ")).toBe("shogun");
  });

  it("labels every board for the menu", () => {
    for (const view of BOARD_VIEWS) {
      expect(BOARD_VIEW_LABEL[view]).not.toBe("");
    }
    expect(BOARD_VIEW_LABEL.vanilla).toBe("Vanilla");
    expect(BOARD_VIEW_LABEL.shogun).toBe("Shogun");
  });

  it("writes the board into the query and leaves the other keys", () => {
    expect(boardViewSearch("", "shogun")).toBe("?view=shogun");
    expect(boardViewSearch("?tune=1&view=3d", "vanilla")).toBe("?tune=1&view=vanilla");
    expect(boardViewSearch("?view=3d", "2d")).toBe("");
    expect(boardViewSearch("?tune=1&view=shogun", "2d")).toBe("?tune=1");
  });
});
