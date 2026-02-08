import { ThemeProvider } from "@workspace/components/theme/vite-provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@workspace/ui/globals.css";
import Root from "~/action-popup/root";
import internal from "~/internal";

internal.init({ platform: "action-popup" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider storageKey="extension-ui-theme">
      <Root />
    </ThemeProvider>
  </StrictMode>,
);
