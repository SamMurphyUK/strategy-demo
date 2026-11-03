import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupFileFor } from "../../../dev/saveMapPlugin.mjs";

describe("save map backup", () => {
  it("names the backup beside demomap01.json", () => {
    expect(path.basename(backupFileFor("C:/repo/demomap01.json"))).toBe("demomap01.backup.json");
    expect(path.basename(backupFileFor("/repo/board.JSON"))).toBe("board.backup.json");
  });
});
