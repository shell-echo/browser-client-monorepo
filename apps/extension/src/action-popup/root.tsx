import { notice } from "@workspace/components/notice";
import { Button } from "@workspace/ui/components/button";
import React from "react";

import internal from "~/internal";

function App() {
  return (
    <div className="w-200 h-112.5 flex flex-col gap-2 justify-center items-center">
      <Button onClick={() => notice.toast.success("apps/extension/action-popup")}>apps/extension/action-popup</Button>
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
  );
}

function Root() {
  const [state, setState] = React.useState(internal.state);
  const [error, setError] = React.useState(internal.error);

  React.useEffect(() => {
    const onStateChange = (params: Extension.Event.Params<"internal:init:state:change">) => {
      const state = params.payload.state;
      setState(state);
      setError(internal.error);
    };
    internal.event.on("internal:init:state:change", onStateChange);

    return () => internal.event.off("internal:init:state:change", onStateChange);
  }, []);

  if (state === undefined) return <React.Fragment>The app has not been initialized.</React.Fragment>;
  if (state === "error") return <React.Fragment>{`${error}`}</React.Fragment>;
  if (state === "initializing") return <React.Fragment>During the app initialization process</React.Fragment>;

  return <App />;
}

export default Root;
