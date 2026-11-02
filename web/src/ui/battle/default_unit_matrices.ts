// Procedural sprites for units the battle board used to draw as infantry.
// `f` takes the faction colour, `#` is ink, `+` is a light edge, `.` is empty.

export const DEFAULT_UNIT_MATRICES: Record<string, readonly string[]> = {
  aa: [
    "......####..",
    "....##ffff##",
    "...##ff##ff#",
    "..##ff#..#f#",
    "..#ff#....#.",
    "..####......",
    ".########...",
    "....##......",
    "...####.....",
    "..##..##....",
  ],
  transport: [
    "..............",
    "....++++++....",
    "...+######+...",
    "..+##ffff##+..",
    ".+##########+.",
    "+############+",
    ".++++++++++++.",
  ],
  mech_infantry: [
    "....##........",
    "...#ff#.......",
    "..######......",
    ".#ff##ff#.....",
    "....##........",
    "..######......",
    ".##ffff##.....",
    "+##+##+##+....",
    "..+#++#+......",
  ],
};

const SPRITE_KEY: Record<string, string> = {
  infantry: "infantry",
  mech_infantry: "mech_infantry",
  artillery: "artillery",
  tank: "tank",
  armor: "armor",
  fighter: "fighter",
  tactical_bomber: "tactical_bomber",
  strategic_bomber: "strategic_bomber",
  submarine: "submarine",
  destroyer: "destroyer",
  cruiser: "cruiser",
  carrier: "carrier",
  battleship: "battleship",
  transport: "transport",
  aa: "aa",
  aaa: "aa",
};

/** The battle-board sprite for a catalog id. Known units never collapse to infantry. */
export function battleSpriteKey(unitTypeId: string): string {
  const id = unitTypeId.trim().toLowerCase();
  return SPRITE_KEY[id] ?? id;
}

/** Paint one matrix. One cell is two pixels, so the gun and the ships read at token size. */
export function drawAnimatedUnitSprite(
  ctx: CanvasRenderingContext2D,
  spriteKey: string,
  factionColor: string,
  time: number,
): void {
  const rows = DEFAULT_UNIT_MATRICES[spriteKey];
  if (rows == null) return;
  const bob = Math.sin(time * 3) * 0.6;
  ctx.save();
  ctx.translate(0, bob);
  ctx.scale(2, 2);
  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell === "." || cell === " ") continue;
      ctx.fillStyle = cell === "f" ? factionColor : cell === "+" ? "#e6d7c3" : "#241c1e";
      ctx.fillRect(x - width / 2, y - height + 2, 1, 1);
    }
  }
  ctx.restore();
}
