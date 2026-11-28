# CLAUDE.md — MapViewport3D & PIXIE Visual Pipeline Guardrails

## 1. Branch & Protected Assets
- Active visual development branch: `PIXIE`.
- **NEVER** modify, overwrite, or delete files inside `web/public/assets/units/` unless explicitly instructed.
- Keep `npm run build` and `npx vitest run` passing before every commit.

## 2. Color Space, Tone Mapping & Post-Processing Contract
- **Strict `NoColorSpace` & Flat Canvas:** Every texture, data texture, and render target in `MapViewport3D` MUST stay `THREE.NoColorSpace`, with `<Canvas flat>` (`toneMapped={false}` on unit sprites, waterline rings, and seabirds) so the `fading-16` 16-color palette outputs exact hex values without ACES/AgX shift.
- **NEVER** enable `THREE.ColorManagement.enabled = true` or drop raw `MeshStandardMaterial` GLTFs into the scene without routing them through our display-space vertex-color landmark/prop shader.
- **Selective HDR Bloom:** Only snow highlights, specular water glints, and explicit glow effects may push RGB values above `1.0` into `PostStack`'s float render targets. Keep landmark reveal rims and plinth highlights clamped `<= 0.95`.

## 3. Zoom Tiers & BoardSkin Architecture (`skins/boardSkin.ts`)
- **`zoom < 5.216` (Strategic & Icon Tier):** Lock `softLand = 0.0` (strict world-space texel-center sampling and crisp bathymetric sea steps). Round counter tokens (`4–32px`) already ensure legibility here.
- **`zoom >= 5.216` (Diorama & Micro Tier):** Cross-fade into detailed unit standees on 3D beveled plinths (`groundLift` terrain-aligned), bottom-up landmark reveals (`3.4 -> 4.3`, locked to `1.0×` world scale), and smooth soft-land easing.
- Register all new skin-specific tuning parameters in `mapVisualConfig.ts` and `skins/boardSkin.ts` (`ownedSettings`) so the Board Look panel dims inactive sliders.

## 4. Performance & Three.js r187 Hygiene
- **Zero React Re-Renders in `useFrame`:** Mutate shader uniforms, `InstancedMesh` matrices, and camera/light frustums directly via refs or `mapVisualConfig.ts` getters—never call React `setState` inside animation loops.
- **Shadow Sync:** Any custom shader that clips geometry (`navalSubmergeDepth`, `uLandmarkReveal`) MUST mirror the same `discard` threshold in a `customDepthMaterial` so shadows stay accurate.
- Dispose geometries, materials, and render targets on unmount or skin disposal.
