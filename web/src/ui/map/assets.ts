// Resolves Godot `res://` texture paths to URLs Vite serves from the project folder.
// This is the only module that knows the art lives in the Godot tree.
import { resolveUnitArtPath } from "./map/unit_art";

const PROJECT_PREFIX = "../../../";

const TEXTURES = import.meta.glob(
  ["../../../texture/*.{jpg,jpeg,png,webp}", "../../../texture/units/{us,ger,neutral}/*.png"],
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

function globKey(resPath: string): string {
  return PROJECT_PREFIX + resPath.replace(/^res:\/\//, "");
}

export function textureUrl(resPath: string): string {
  return TEXTURES[globKey(resPath)] ?? "";
}

export function textureExists(resPath: string): boolean {
  return globKey(resPath) in TEXTURES;
}

export function unitArtUrl(unitTypeId: string, factionId: string): string {
  const path = resolveUnitArtPath(unitTypeId, factionId, textureExists);
  return path === "" ? "" : textureUrl(path);
}
