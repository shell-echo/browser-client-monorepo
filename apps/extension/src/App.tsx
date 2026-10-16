import { ClientPage } from "@browser-client/ui/components/client-page"

const isPopup =
  typeof chrome !== "undefined" && Boolean(chrome.runtime?.id) && !window.location.pathname.endsWith("options.html")

export default function App() {
  return <ClientPage title="Extension Client" popup={isPopup} />
}
