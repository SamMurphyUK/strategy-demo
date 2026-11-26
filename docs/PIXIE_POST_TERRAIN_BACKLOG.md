# PIXIE post-terrain backlog (saved campaign map notes)

Saved from the camera pass. Items 1 is built (see `web/src/ui/viewport3d/boardCamera.ts`); the rest are open.

1. **Zoomed-in (`micro`) camera lock-in.** `microMinDistance = 1.35`, 36 to 40 degree low diorama pitch curve, 35 degree telephoto FOV, ground-locked tilt-shift DoF (`uMicroAlpha`), zoom-scaled pan damping.
2. **Ship shadows and waterline polish.** Fix the directional shadow from naval sprites onto the displaced `waterY` surface: match `customDepthMaterial` to the world-space submerged hull silhouette so no shadow floats or detaches across wave troughs.
3. **3D harbors, naval bases and airfields (parity with factories).** Generate 20mm miniature-style `.glb` assets via `scripts/landmark_common.py`:
   - Harbors / naval bases: stone breakwater, piers, gantry cranes seated at `groundLift`, pilings reaching into the live `waterY` swell.
   - Airfields: graded grass / PSP runway strip, wind-sock, control tower and hangar.
   They replace the flat map triangles.
4. **John Nash scatter terrain expansion.** Place the remaining 20mm props (`hedgerow_segments`, `sandbag_bunker`, `wire_obstacles`, `shell_craters`, `trench_parapet`, `anti_tank_obstacles`, `ruined_masonry`, `field_props`), harmonized to `fading-16`, upright on `groundLift`, along contested fronts and borders.
5. **Biome atmospheric FX.**
   - Desert: rising sine / curl heat-haze UV shimmer (`desertHeatHaze`) and warm amber horizon dust over North Africa and the Middle East.
   - Winter: cool glacial slate-blue shadow grade (`snowColdTint`) and wind-driven snow powder (`THREE.Points` above `groundLift`) over Russia and alpine passes.
6. **Pacific theater polish.**
   - Lower island elevation (`islandElevationScale`) so atolls and islands (Midway, Wake, Solomons, Philippines) sit low, not like pillars.
   - Lusher jungle canopies: denser, broader palm / broadleaf clusters with humid canopy mist (`microMistWeight`).
   - Close-up tropical water: shift shallow coastal water (`seaCoastDist`) in tropical latitudes toward translucent turquoise-teal lagoon bands at Diorama / Micro zoom before dropping to deep navy.
7. **Central Asia visual character.** Break up the empty beige of Kazakhstan, Mongolia and the Silk Road with steppe grass-to-ochre FBM gradients, salt-pan and gravel-basin patches, terraced foothill ridges into the Tian Shan / Altai, and sparse nomadic / rock scatter.
8. **`micro` zoom seabirds and flocks (later pass).** Height-aware boids with Perlin curl-noise flocks (`InstancedMesh`, wing-flap shader) over coastal cliffs, harbors and mountain passes, only when `uMicroAlpha > 0.3`.

9. **Zoom-coupled IPC counter and cartographic stamp (`ipcStampMode`).**
   - Strategic / icon (zoom below 3.8, `uDioramaAlpha = 0`): a crisp dark-ink stencil numeral (`#24201C`) with a 1px parchment halo, so it reads over snow and sand alike without looking like a neon sticker.
   - Diorama / micro (`uDioramaAlpha > 0.3`): cross-fade the floating numeral into a flat, ground-projected embossed stamp at about 35 to 45% opacity, darkened into the grass and sand like a carved tabletop board. It returns to full contrast only on hover or selection of that territory, or while Alt / the tactical overlay toggle is held.
   - Paired with #3: the flat airfield and harbor triangles give way to 3D runway and pier miniatures. (Built in the facilities pass: see `web/src/ui/viewport3d/facilityModels.ts`.)

## Open bugs carried with it

- Attackers should walk from their origin to the battle on End Phase (not teleport). The hold-at-origin plan is in `web/src/ui/map/battleTravel.ts` but did not take effect in play; origins likely need to come from `state.phase_start_snapshot` instead of the captured orders.
- The unmoved / selected ring should fade over the sprite's whole box, not only where pixels are opaque (the campaign figures are SVG vectors drawn above the map canvas).
