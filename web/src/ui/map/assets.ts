// Resolves `res://texture/...` paths to URLs Vite serves from the loose art folder.
// This is the only module that knows the old Godot textures live in `art/loose/png/texture`.
import { resolveUnitArtPath } from "./unit_art";

const PROJECT_PREFIX = "../../../../art/loose/png/";

const TEXTURES = import.meta.glob(
  [
    "../../../../art/loose/png/texture/*.{jpg,jpeg,png,webp}",
    "../../../../art/loose/png/texture/units/{us,ger,neutral}/*.png",
  ],
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
