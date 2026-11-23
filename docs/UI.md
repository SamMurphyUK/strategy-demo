# UI

The campaign map repaints on a timer. Anything drawn over that canvas has to stay cheap.

- A panel background is a flat color with opacity. That is enough for the map to read through.
- Do not use `backdrop-filter`, `filter`, or a blurred `box-shadow` on a panel that sits over the map. Those resample the canvas on every paint.
- A shadow under a panel is a hard contact darkening: a few solid offset bands, no blur radius. It burns the map darker underneath and does not follow the pixels of the canvas.
- Slides and fades use `transform` and `opacity`. Do not animate `width` or `height`.
- Do not put game rules in a component. Read them from the engine and send commands back.
