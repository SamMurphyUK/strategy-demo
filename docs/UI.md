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
