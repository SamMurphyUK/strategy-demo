import { UI_THEMES, setUiLab, setUiTheme, setUiType, useUiTheme, useUiType } from "./uiTheme";

/** Comparison overlay for the HUD. Open with /ui-lab, ?uiLab=1 or Shift+U. U cycles colours, T flips the type. */
export function UiLab() {
  const theme = useUiTheme();
  const type = useUiType();
  return (
    <aside className="ui-lab" aria-label="UI lab">
      <header>
        <h2>UI Lab</h2>
        <span className="ui-lab-keys">U colour · T type · ⇧U hide</span>
      </header>
      <p className="ui-lab-role">Colour (fading-16)</p>
      <div className="ui-lab-themes" role="group" aria-label="HUD colour">
        {UI_THEMES.map((item) => (
          <button key={item.id} type="button" aria-pressed={theme === item.id} onClick={() => setUiTheme(item.id)}>
            <i style={{ background: item.land || "linear-gradient(135deg, #9C524E 50%, #5B7D73 50%)" }} />
            {item.label}
          </button>
        ))}
      </div>
      <p className="ui-lab-role">Type</p>
      <div className="ui-lab-types" role="group" aria-label="HUD type">
        <button type="button" aria-pressed={type === "pixel"} onClick={() => setUiType("pixel")}>
          Silkscreen
        </button>
        <button type="button" aria-pressed={type === "thin"} onClick={() => setUiType("thin")}>
          Thin pixel
        </button>
        <button type="button" aria-pressed={type === "pack"} onClick={() => setUiType("pack")}>
          Font pack
        </button>
      </div>
      <div className="ui-lab-row">
        <span className="ui-lab-role">Regular</span>
        <span className="ui-lab-pixel">Mechanised Infantry 0123</span>
      </div>
      <div className="ui-lab-row">
        <span className="ui-lab-role">Bold</span>
        <span className="ui-lab-pixel is-bold">Mechanised Infantry 0123</span>
      </div>
      <button type="button" style={{ marginTop: 8, width: "100%" }} onClick={() => setUiLab(false)}>
        Close lab
      </button>
    </aside>
  );
}
