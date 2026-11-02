# Debugging

Development runs in the browser via Vite. The rules below apply to `web/` first. The Godot process hooks are the same idea for the old client.

## Web

- Do not `console.log` inside the map paint loop, a pointer-move handler, or a `requestAnimationFrame` step.
- Log phase changes, a command result, or a failed save. Those happen once.
- Do not leave a zoom readout, a `window.__` hook, or an on-canvas debug label in the game.
- A debug aid must not change command results, zoom thresholds, or what gets drawn in production.

## Godot client

The previous client follows the same logging rule.

### 1. NO PER-FRAME DEBUG PRINTS
Never print inside:
- _process(delta)
- _physics_process(delta)
- _input(event)
- _unhandled_input(event)
- any function called every frame

Reason:
Per-frame prints flood the console, hide real issues, and destroy performance.

### 2. USE EVENT-BASED DEBUGGING
Allowed debug prints:
- drag started / updated / ended
- mobilization payload creation
- region hover change
- phase transitions
- icon spawn / icon restore
- map drop events

These fire only when something meaningful happens.

### 3. USE TOGGLE-BASED DEBUG OVERLAYS
All visual debugging (HUD, inspector, overlays) must:
- live in a CanvasLayer
- be hidden by default
- be toggled by F1
- never run logic unless visible

### 4. DEBUG OVERLAYS MUST NOT PRINT EVERY FRAME
HUDs and inspectors may update labels every frame,
but they must NOT print to the console every frame.

### 5. DEBUGGING MUST NEVER CHANGE GAMEPLAY LOGIC
Debug code must:
- not modify transforms
- not modify input
- not modify camera
- not modify UI layout
- not modify drag behaviour

### 6. DEBUGGING MUST BE REMOVABLE WITHOUT SIDE EFFECTS
All debug systems must be isolated under:
    res://debug/
    GameScene/DebugRoot/

### 7. CURSOR MUST FOLLOW THESE RULES
Cursor must:
- avoid adding per-frame prints
- prefer event-based logging
- prefer toggle-based overlays
- keep debug code isolated
- never mix debug code with gameplay code
