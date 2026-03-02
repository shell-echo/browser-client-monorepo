import Notice from "@workspace/components/notice";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import "@workspace/ui/globals.css";
import ThemeProvider from "~/components/provider/theme";
import router from "~/router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider storageKey="admin-ui-theme">
      <RouterProvider router={router} />
      <Notice.Toaster />
    </ThemeProvider>
  </StrictMode>,
);
