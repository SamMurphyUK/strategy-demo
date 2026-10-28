import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../battle/battle.css";
import "./styles.css";

// The battle board's usePlayground would otherwise fetch Google's SDK script; the preview flag
// makes it use the bundled fake.
(window as unknown as { __PLAYGROUND_PREVIEW__: boolean }).__PLAYGROUND_PREVIEW__ = true;

// No StrictMode: the battle board's canvas loop isn't written for double-mounted effects.
createRoot(document.getElementById("root")!).render(<App />);
