import { useSyncExternalStore } from "react";
import {
  graphicsSettings,
  setGraphicsSettings,
  subscribeGraphics,
  type GraphicsSettings,
} from "../ui/battle/graphicsSettings";

const ROWS: { key: keyof GraphicsSettings; label: string; hint: string }[] = [
  { key: "mist", label: "Mist", hint: "A soft band of the sky's colour along the horizon." },
  {
    key: "liveSky",
    label: "Live sky",
    hint: "Stars twinkle and the clouds drift. Off, the sky holds still until the daylight changes.",
  },
  {
    key: "crispPictures",
    label: "Crisp unit pictures",
    hint: "Redraw a unit at the screen's own size when the zoom changes. Off, one picture is scaled, which is easier on a weak laptop.",
  },
  {
    key: "animatedSea",
    label: "Animated sea",
    hint: "The sea is a tile. On, the tile scrolls. Off, it sits still.",
  },
  {
    key: "unitLighting",
    label: "Unit lighting",
    hint: "Tint units with the sky's light. Off draws them as painted.",
  },
  {
    key: "cinematicCamera",
    label: "Cinematic camera",
    hint: "Pans with the units. The zoom only shifts a little. Wheel zoom cancels it for that round.",
  },
];

/** The four picture switches. The battle map and a real battle read the same saved choices. */
export function GraphicsSettingsPanel() {
  const settings = useSyncExternalStore(subscribeGraphics, graphicsSettings, graphicsSettings);
  return (
    <fieldset className="graphics-settings">
      <legend>Graphical settings</legend>
      {ROWS.map((row) => (
        <label key={row.key} title={row.hint}>
          <input
            type="checkbox"
            checked={settings[row.key]}
            onChange={(event) => setGraphicsSettings({ [row.key]: event.target.checked } as Pick<GraphicsSettings, typeof row.key>)}
          />
          {row.label}
        </label>
      ))}
      <style>{PANEL_CSS}</style>
    </fieldset>
  );
}

const PANEL_CSS = `
.graphics-settings {
  margin: 0;
  border: 1px solid #4b3d44;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  padding: 8px 10px;
}
.graphics-settings legend {
  padding: 0 6px;
  color: #ddcf99;
  font: 600 13px/1.3 "Segoe UI", sans-serif;
}
.graphics-settings label {
  display: flex;
  gap: 6px;
  align-items: center;
  font: 13px/1.3 "Segoe UI", sans-serif;
  color: #f5f0e6;
  cursor: pointer;
}
`;
