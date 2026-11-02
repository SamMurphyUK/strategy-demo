import { describe, expect, it } from "vitest";
import { factionChrome } from "../../../src/ui/map/factionChrome";
import { FACTION_PALETTE } from "../../../src/ui/theme/factionPalette";

describe("faction chrome", () => {
  it("paints the frame rules with the colour the map uses for that faction's land", () => {
    const style = factionChrome("ussr") as Record<string, string>;
    expect(style["--brass"]).toBe(FACTION_PALETTE.USSR.primary);
    expect(style["--land"]).toBe(FACTION_PALETTE.USSR.primary);
    expect((factionChrome("ger") as Record<string, string>)["--brass"]).toBe(FACTION_PALETTE.GER.primary);
    expect((factionChrome("uk") as Record<string, string>)["--brass"]).toBe(FACTION_PALETTE.UK.primary);
    expect((factionChrome("jap") as Record<string, string>)["--brass"]).toBe(FACTION_PALETTE.JAP.primary);
    expect((factionChrome("usa") as Record<string, string>)["--brass"]).toBe(FACTION_PALETTE.US.primary);
    expect(style["--filigree-tl"]).toBeUndefined();
  });
});
