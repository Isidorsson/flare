import "./live.css";

import { cssTimingVariables } from "./timing";

// The stylesheet reads its animation timings from these, so they are set once for the whole page.
for (const [name, value] of Object.entries(cssTimingVariables())) {
  document.documentElement.style.setProperty(name, value);
}
