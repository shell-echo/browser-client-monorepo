import React from "react";

const useTab = (extension?: Web.Extension, tabId?: number) => {
  const [tab, setTab] = React.useState<Web.Tab>();
  React.useEffect(() => {
    const onRemoved = (params: Extension.Event.Params<"chrome:tabs:onRemoved">) => {
      const payload = params.payload;
      if (payload.tabId !== tabId) return;
      setTab(undefined);
    };

    extension?.event.on("chrome:tabs:onRemoved", onRemoved);

    return () => extension?.event.off("chrome:tabs:onRemoved", onRemoved);
  }, [extension?.event, tabId]);

  React.useEffect(() => {
    const onUpdated = (params: Extension.Event.Params<"chrome:tabs:onUpdated">) => {
      const payload = params.payload;
      if (payload.tabId !== tabId) return;
      setTab(payload.tab);
    };

    extension?.event.on("chrome:tabs:onUpdated", onUpdated);

    return () => extension?.event.off("chrome:tabs:onUpdated", onUpdated);
  }, [extension?.event, tabId]);

  return tab;
};

export default useTab;
