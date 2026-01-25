import { ThemeProvider } from "@workspace/components/theme/vite-provider";
import { Button } from "@workspace/ui/components/button";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="extension-ui-theme">
      <div className="w-200 h-112.5 flex flex-col gap-2 justify-center items-center">
        <Button>apps/extension/action-popup</Button>
        <Button
          onClick={() =>
            chrome.windows.getCurrent().then((win) => {
              if (win.id !== undefined) chrome.sidePanel.open({ windowId: win.id });
            })
          }
        >
          apps/extension/side-panel
        </Button>
      </div>
    </ThemeProvider>
  );
}

export default App;
