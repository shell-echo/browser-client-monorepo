import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@workspace/ui/globals.css";
import ThemeProvider from "~/components/provider/theme";
import internal from "~/internal";
import Root from "~/side-panel/root";

internal.init({ platform: "side-panel" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider storageKey="extension-ui-theme">
      <Root />
    </ThemeProvider>
  </StrictMode>,
);
