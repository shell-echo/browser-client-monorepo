import Notice from "@workspace/components/notice";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@workspace/ui/globals.css";
import App from "~/App";
import ThemeProvider from "~/components/provider/theme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider storageKey="admin-ui-theme">
      <App />
      <Notice.Toaster />
    </ThemeProvider>
  </StrictMode>,
);
