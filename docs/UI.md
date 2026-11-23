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

The map also redraws itself while the camera is still. `MapView` runs that tick every 84ms: it blits the coast, redraws every upright figure, then syncs the SVG overlay and re-appends every figure. That work is on the main thread, so a heavy tick drops the frame rate of the whole page. Infantry on the campaign map joined this path in the shared Japanese sheet. At the tactical zoom each stack is up to three SVG images, and they are rebuilt on every tick even when they have not moved. Do not add more figures to that overlay without skipping a tick when nothing changed. A color filter on `.map-canvas` (the dusk look) runs again on every one of those paints.
