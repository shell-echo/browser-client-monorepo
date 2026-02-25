import Notice from "@workspace/components/notice";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@workspace/ui/globals.css";
import Root from "~/action-popup/root";
import ThemeProvider from "~/components/provider/theme";
import internal from "~/internal";

internal.init({ platform: "action-popup" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider storageKey="extension-ui-theme">
      <Root />
      <Notice.Toaster />
    </ThemeProvider>
  </StrictMode>,
);
