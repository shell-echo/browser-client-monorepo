import { ConnectionsPage } from "./pages/connections"
import { isExtensionContext } from "./lib/settings"
import { OptionsPage } from "./pages/options"
import { PopupPage } from "./pages/popup"

export default function App() {
  if (window.location.pathname.endsWith("/sidepanel.html")) return <ConnectionsPage />
  if (window.location.pathname.endsWith("/options.html")) return <OptionsPage />
  return (
    <div className={isExtensionContext() ? "" : "grid min-h-svh place-items-center bg-muted/30 p-4 sm:p-8"}>
      <div className={isExtensionContext() ? "" : "w-full max-w-[360px] overflow-hidden rounded-xl border shadow-sm"}>
        <PopupPage />
      </div>
    </div>
  )
}
