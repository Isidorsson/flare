import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";
import { wireAgentEvents } from "@/features/agent-wiring/wire-agent-events";
import { generateCommitMessage } from "@/features/agent/commit-message";
import { startGraphRuntime } from "@/features/graph";
import { configureVcs } from "@/features/vcs";
import "@/styles/index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element in index.html");
}

wireAgentEvents();
startGraphRuntime();
configureVcs({ generateMessage: generateCommitMessage });

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
