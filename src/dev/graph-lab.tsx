import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { GraphLab } from "./GraphLab";
import { applyZoomParam, openFixture, sizeFromParams } from "./lab-setup";
import { installTauriStub } from "./tauri-stub";
import "./graph-lab.css";

installTauriStub();
applyZoomParam();
const initialSize = sizeFromParams();
const initialScript = openFixture(initialSize);
const container = document.getElementById("root");
if (container === null) throw new Error("graph lab is missing #root");
createRoot(container).render(
  <StrictMode>
    <GraphLab initialSize={initialSize} initialScript={initialScript} />
  </StrictMode>,
);
