import { ThemeProvider } from "@workspace/components/theme/vite-provider";
import { Button } from "@workspace/ui/components/button";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="extension-ui-theme">
      <div className="w-screen h-screen flex justify-center items-center">
        <Button>apps/extension/side-panel</Button>
      </div>
    </ThemeProvider>
  );
}

export default App;
