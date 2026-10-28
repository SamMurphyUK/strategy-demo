import { createRoot } from "react-dom/client";
import App from "./App";
import "./battle.css";

// Outside the Playground host, usePlayground would fetch Google's SDK script. The preview flag
// makes it use the bundled fake SDK instead; the demo only calls sdk.startGame().
(window as unknown as { __PLAYGROUND_PREVIEW__: boolean }).__PLAYGROUND_PREVIEW__ = true;

// No StrictMode: the original root doesn't use it, and the canvas loop isn't written for double-mounted effects.
createRoot(document.getElementById("root")!).render(
  <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
    <App />
  </div>,
);
