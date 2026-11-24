# UI

## Strict warning

A new panel is more buttons on the controls that already exist. It is not a second interface laid over the map.

A combat drag does not move the piece. It writes an order. The arrow and the sword count are drawn from that list. If a new gesture does not write that same order, the piece is marked as attacking and the map draws nothing.

An inspector piece, Select all, and a retarget are the same unit as the piece on the map. They use the map's press, move, and release. They do not grow their own pointer path.

A combat click already hits the defender's piece before the territory. Do not put another meaning on that click.

Do not pile purchase, factories, the inspector, Select all, and retarget into one click handler. An ordinary click must keep the meaning it already has.

Do not splice a CSS rule into `styles.css` without its opening brace. A missing `{` takes the whole sheet down.

The campaign map repaints on a timer. Anything drawn over that canvas has to stay cheap.

- A panel background is a flat color with opacity. That is enough for the map to read through.
- Do not use `backdrop-filter`, `filter`, or a blurred `box-shadow` on a panel that sits over the map. Those resample the canvas on every paint.
- A shadow under a panel is a hard contact darkening: a few solid offset bands, no blur radius. It burns the map darker underneath and does not follow the pixels of the canvas.
- Slides and fades use `transform` and `opacity`. Do not animate `width` or `height`.
- Do not put game rules in a component. Read them from the engine and send commands back.

The map redraws while the camera is still, and that tick stays on the main thread. The blurred shore is drawn when the view, the size, or the coast tune changes, and that picture is kept. The idle tick blits it. It does not run the shore blur again. While the camera pans or zooms, each frame fills ocean, blits land from the bake at the live camera, and slides the last settled hold (land, shore, and cliffs) on top; figures and arrows stamp at the live camera. The 7px shore blur and cliff fills run when the camera settles. At the token zoom the idle tick does not redraw figures. At the tactical zoom it redraws figures only when an idle frame changes, and it does not re-append an SVG node that is already on the stage. A resting hover is drawn on the arrow layer. It does not repaint the coast or the units, and it does not set React state unless the cargo label changes. The title screen drifts in a slow figure-eight, 36 map units across and 18 down. The map is painted once with a margin, the menu color filter is drawn into that picture, and the drift slides it. Do not put the drift back on the camera: every camera step repaints, and the filter would run again on every one. The Z panel's frame clock updates on its own. Do not put that clock in the map paint's dependency list. A color filter on `.map-canvas` (the dusk look) still runs on every paint of that canvas.

A zoom repaints every frame, and each frame draws its shapes at a new scale, so the cost of a zoom is the number of coastline-sized paths in one paint. Keep that number fixed. The cliff face is three fills for each lift group: the lowered silhouette with its rim, one four-sided face under every coast edge (`cliffSweepEdges`), and the silhouette in place. Do not go back to one fill for each pixel of the drop. A ship asks forty times a draw whether its picture overlaps the shore, and it reads the land grid in `landMask.ts`. `isLandAt` walks the whole coastline and is for a click or an editor check. After a zoom settles, the bake tick repaints the map once so the sharper land arrives.

A zoomed figure is a traced SVG file. `figureSheet.ts` draws each file once at the size the map shows it and stamps that picture for every figure of the kind, on the canvas that holds the badges, under them. A figure picks its own frame, so the idle stagger stays. A ship near the coast gets its inland part thinned on a scratch canvas before it is stamped. While a frame's file is on its way the figure keeps the picture it had, and the idle tick redraws when the file lands. Placement is `figureStampBox`, in whole device pixels. The SVG stage draws one node for each figure and is the Sheet switch turned off.

The Z panel's Draw block shows the frame rate, the slowest frame of the last three seconds, and the slowest paint of the last quarter second split into land, shore, figures, arrows, and the idle tick. Land is the base map, the cliffs, and the copy into the held picture. The switches (Anims, Cliffs, Stamp, Shore, Figures, Sheet, Arrows) last for the session. Stamp is the old cliff and it is off. Sheet is on. The page's own timings stop where the browser's drawing begins, so a slow frame with small numbers beside it is the browser filling shapes.

## Bombardment

This is the same combat-move drop. It does not grow a second pointer path. The drop still writes the order. Attack and Bombard are choices on that order.

When a bomber or an artillery unit is dropped on a hostile region that has a target it can bombard, the confirm on that drop offers Attack and, as its child, Bombard. Attack commits the combat move. Bombard does not.

If that unit has one legal target, Bombard commits that target. If it has more than one, Bombard opens the target list under itself and the chosen row commits. The list is not a separate screen.

A unit that commits to bombard cannot attack that round. It does not join the battle in that territory.

In the combat phase, every bombardment is resolved before any battle starts.

The map may not have these covers yet. The choice still names them.

- A city (`URBAN`) and a wood (`FOREST`) can be suppressed. Open ground, mountain, desert, and snow cannot. Ground that is already suppressed is not offered.
- Artillery may bombard a city or a wood. It does not bombard a factory, an airbase, or a harbor.
- A strategic bomber may bombard a factory, an airbase, a harbor, a city, or a wood.
- A tactical bomber may bombard an airbase or a harbor.

A city or a wood is offered only when terrain and preparatory bombardment are on. An airbase or a harbor is offered only when facilities are on. A factory is offered to a strategic bomber on any hostile factory, including the quick game.

Suppressing a city or a wood is the preparatory shot already in the engine: the gun or the bomber gives up its first attack, and the cover stays quiet until the turn passes. A factory raid and an airbase or harbor raid are the facility bombs already in the engine. The confirm only chooses which of those the order is.
