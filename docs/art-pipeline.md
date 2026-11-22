# Art pipeline

The contract the pictures, the tracer, and the battle map already follow. The order of the work stays in [art-production-plan.md](art-production-plan.md). Pixel recipes for one skeleton stay in the sprite-motion rule.

Two stores feed the battle map (`?field=1`). They do not share layer names, and they do not share the shot schedule.

## Two stores

**Frame clips** are the walk the battle map plays. Paint them in the sprite editor (`?bake=1`). Files live in `public/assets/units/frames/<id>/`. A traced copy lives in `public/assets/units/vector/frames/<id>/`.

The file always has four slots, bottom to top: `legs`, `torso`, `head`, `weapon`. A later slot covers an earlier one. The editor shows different words for those slots. Empty slots stay empty.

| Skeleton | Labels, bottom to top | Picture starts on | Muzzle on |
| --- | --- | --- | --- |
| Infantry | Legs, Torso, Head, Weapon | torso | weapon |
| Tank | Tracks, Hull, Turret, Gun | torso | weapon |
| Mechanised infantry | Tracks, Hull, Gun | torso | head |
| Artillery | Wheel, Carriage, Gun | torso | head |
| Aircraft | Chassis, Propeller | legs | legs |
| Ship | Hull, Guns, Top deck | legs | torso |

Clips are `idle`, `walk`, `fire`, and `damaged`. A tank walk is eight frames. The moving part is the only layer whose drawing changes. Everything else is the idle picture, shifted by whole pixels. The frame after the last one is the first.

**Layered plates** are the card strips. Files live in `assets/layered/<FACTION>/<unitTypeId>.json`. Four poses are stored: `idle`, `move_1`, `move_2`, `fire`. Build Animation writes whole-pixel shifts. The card strip plays eight beats from those four poses.

Each skeleton has its own keys, bottom to top. These are not the four clip slots, and a traced SVG does not contain them.

| Skeleton | Keys, bottom to top |
| --- | --- |
| Infantry | `legs`, `torso`, `head`, `hands_weapon` |
| Tank | `tracks`, `hull`, `turret`, `barrel` |
| Mechanised infantry | `wheels_tracks`, `chassis`, `crew_gun` |
| Artillery | `carriage_wheels`, `gun_shield`, `barrel_breech` |
| Aircraft | `fuselage_wings`, `engines_props`, `tail_markings` |
| Ship | `hull_waterline`, `superstructure`, `turrets_masts` |

Infantry parts, vehicle parts, and ship parts do not mix. Finish one faction of one skeleton until its walk loops, then the other factions of that skeleton.

A traced SVG is filled paths in a `viewBox`, with `fill-rule="evenodd"`. The silhouette path has `id="backing"`. There is no `<g>` per layer and no root group.

## Where a pixel lands

The board is 1280 by 720 (`BATTLE_BOARD`). A station is a point on that board. Feet are in the picture's own pixels. The stamp puts the feet on the station:

```
x = station.x - feet.x * scale
y = station.y - feet.y * scale
width = pictureWidth * scale
height = pictureHeight * scale
```

`scale` is the size the picture was given, times the lane. The lane runs from 0.85 on the back lane to 1.05 on the front (`laneScale`, anchored at the feet). A sea scene skips it. The size steps are 1/8, 1/4, 1/2, 1, 2, 3, and 4. At 1, one art pixel covers one board pixel. The map zoom is a different number.

The canvas is device pixels. Each frame:

```
span = dpr * viewScale
ctx.setTransform(span, 0, 0, span, cam.x, cam.y)
```

`cam` is already in device pixels. A board point `(bx, by)` lands at `(bx * span + cam.x, by * span + cam.y)`. The pointer comes back as `(localCss * dpr - cam) / span`. The menu offers view scales 1, 2, 3, and 4. The wheel can sit anywhere from 0.25 to 8.

`resolution` is how many bitmap pixels lie along one logical pixel. A pixel walk is 1. A traced walk is 4.

A pixel picture is an `OffscreenCanvas`, with smoothing off. Its origin is snapped onto a whole device pixel: `round(logical * span) / span`. At unit scale 1/2 or below, or view scale 1/2 or below, the preview draws a half bitmap. That bitmap is a 2×2 reduction that keeps the pixel farthest from the block's mean. Each of its pixels covers `unitScale / 0.5` board pixels, and the feet are halved to match.

A traced picture is an SVG whose width, height, and viewBox are four times the source PNG. The tracer repeats each source pixel 4×, then traces. The manifest records `"scale": 4`. On load, feet are divided by that 4, so the stamp stays in source pixels. The preview loads the SVG as an image and rasterises it. The file has no `<use>` and no `scale(0.25)`.

`crispPictures` changes only that raster:

- On, rasterise at the device size (`blit.width * span` by `blit.height * span`) and draw those pixels 1:1.
- Off, rasterise once at the logical blit size and let the draw stretch it.

Smoothing is on for that vector draw only. The station is not snapped, so a march can sit between pixels. The march is added to the station in picture-pixels and is not drawn into the frame:

```
(POSE_FPS * 14 * 1.2) / 16
```

Fourteen of every sixteen pose ticks are walk frames. The 1.2 is a fifth quicker than one pixel for each walk frame shown.

## Palette

The sixteen colours are `MILITARY` in `web/src/ui/theme/militaryPalette.ts`. The map and the battle share them. White icon ink on the map stays white. That white is not a seventeenth unit colour.

| Name | Hex |
| --- | --- |
| cream | `#DDCF99` |
| tan | `#CCA87B` |
| terracotta | `#B97A60` |
| crimson | `#9C524E` |
| plum | `#774251` |
| charcoal | `#4B3D44` |
| steel | `#4E5463` |
| spruce | `#5B7D73` |
| sage | `#8E9F7D` |
| taupe | `#645355` |
| feldgrau | `#8C7C79` |
| bone | `#A99C8D` |
| olive | `#7D7B62` |
| brass | `#AAA25D` |
| brown | `#846D59` |
| khaki | `#A88A5E` |

Empty in a PNG and in the editor is alpha under 128, slot 0. `#FF00FF` is the key on a clip sheet downloaded to send out. It is outside the sixteen. A unit file does not store it.

The tracer picks the darkest of the sixteen for the backing path. That colour is charcoal `#4B3D44`. It is painted first, under every other colour, so a zoomed-out unit does not show a hairline gap. Each used colour is dilated one pixel and traced after it, lightest first, so an outline stays on top. Every fill is checked back onto the sixteen. Where two tank parts separate by a pixel, the gap in the drawing is this same charcoal.

Faction retint uses slots 0–13 in `paperDoll.ts`. Slot 0 is clear. Slots 12 and 13 stay the gun on every preset. Slot 11 is the helmet. A faction LUT remaps the uniform. The slots are the retint. They do not give every strip colour its own slot.

## Commands

From the repo root. The same scripts run from `web/`.

- `npm run plate:import -- --faction UK --unit tank` crops a baked PNG to its ink and puts the whole picture on the body layer of that skeleton. Cutting it into layers is done in the sprite editor. A layered file already on disk is left alone unless `--force`.
- `npm run animate:batch` writes `public/assets/units/cards/<FACTION>/<unitTypeId>.png`, eight cells of 80×56, 640×56 in all. The cells are idle, move_1, idle_2, move_2, fire_windup, fire_peak, fire_recover, idle_settle. The ground point is (40, 52). `--check` writes nothing. The same file always gives the same strip.
- `npm run vectorize:units -- --clips public/assets/units/frames/<id>/clips.json` traces that clip folder after the frames look right. A quick test copy uses the `_QUICK` suffix and names its faction and unit type in the clip list.
- `npm run polish:units` runs `unify_shading.py`. `npm run stamp:units` composites national emblems. A stamped trace is `npm run vectorize:units -- --stamped`.

`plate:import` and `animate:batch` do not call a network or a model. A shift of one or two pixels is a whole-pixel nudge of the idle drawing, made in the sprite editor. Onion skin matches a frame to the frames beside it. Write a rig file directly only for a whole clip import, or when the editor cannot do the edit. Leave a rig alone while the editor has it open.

## Clocks

`POSE_FPS` is 11 (`motionPreview.ts`). `poseStep(time)` is `floor(time * 11)`. One pose tick is 1000/11 ms.

Frame clips on the field (`walkFrameAt`):

- With a fire clip, the first two pose ticks of every sixteen show fire frame 0.
- Those two ticks are not walk frames. The walk index counts the other fourteen, so an eight-frame loop joins.
- A held idle or a held fire cycles its own frames with `poseStep % count`.

Layered plates (`playbackBeatAt`):

- Every sixteen ticks, the first four are the shot: windup, peak, recover, settle.
- The other twelve cycle the four march beats.
- Windup and recover are half recoil, built from the idle layers when they are drawn. They are not stored poses.

The battle rules step at 60Hz (`stepMs` is `1000/60` in `web/src/ui/battle/constants.ts`) and do not read the pose. The pictures are cosmetic. Speeding the battle speeds them too, so a replay looks the same.

Hull lift, turret delay, and barrel kick are pixels in the clip, one tick at a time. The field preview keeps the camera, the zoom, and the stations in refs and paints from `requestAnimationFrame`. It updates React state for the caption and the zoom label. The procedural drawer in `unitRenderer.ts` still carries `animRecoil`. That drawer is the one the pictures replace. Do not add a second recoil channel beside the frames.

## Leave these alone

- Stay on the sixteen colours. A traced fill outside them fails the tracer.
- A traced SVG is filled paths. No `filter`, no blur, no drop shadow.
- `#FF00FF` stays on the export sheet. It is not painted into a unit.
- Every picture in a loop is the same size and stands on the same feet. The contact shadow is the footprint of the lowest 12% of the opaque rows, drawn before the sprite.
- The other facing is a mirror. Do not bake both directions.
- The walk index skips the two shot ticks. Counting them as walk frames makes the last frame join the third.
- A vector station keeps its fraction. A pixel station snaps to a device pixel.
- `crispPictures` changes the raster size of a vector. It does not change the station, the feet, or which frame is showing. Pixel blits stay nearest-neighbour either way.
- The pose does not feed the battle rules, and the rules do not pick the pose.
- One skeleton at a time. The next skeleton stays as it is until this one's walk loops.

## Field

Add keeps the load for each shelf key. The first click still decodes the frames. A tank or a vector then splits layers. A painted `_QUICK` rig paints on that first click, and the 25D fighter is large enough that this takes about a second and a half. The next Add of the same key reuses that load. The open editor is not cached. A failed open is dropped, so the next click can try again.

The field reads `unitLighting`. On, a canvas sprite is multiplied by the sky, and a crisp vector keeps its SVG and gets the same multiply. Off, the sprite stays as painted. At noon the ambient is nearly white (`255, 252, 244`) and the rim is about a tenth. `?sky=0.68` pins the night, where the change is easy to see.

A rig id and a part id may include capitals. `ger_fighter_seed1_25D` and `legs_farWing`, `torso_fuselage`, `head_propeller`, `weapon_nearWing` pass `fetchRig` and `readPartFile`.
