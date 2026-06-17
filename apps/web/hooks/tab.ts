import React from "react";

const useTab = (extension?: Web.Extension, tabId?: number) => {
  const [tab, setTab] = React.useState<Web.Tab>();

  React.useEffect(() => {
    if (!extension || !tabId) {
      setTab(undefined);

      return;
    }

    extension
      .invoke("chrome:tabs:get", { tabId })
      .then((resp) => setTab(resp))
      .catch(() => setTab(undefined));
  }, [extension, tabId]);

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

  React.useEffect(() => {
    const onActivated = (params: Extension.Event.Params<"chrome:tabs:onActivated">) => {
      const activeInfo = params.payload.activeInfo;
      if (activeInfo.tabId === tabId) setTab((tab) => (tab ? { ...tab, active: true } : tab));
      else if (activeInfo.windowId === tab?.windowId) setTab((tab) => (tab ? { ...tab, active: false } : tab));
    };

    extension?.event.on("chrome:tabs:onActivated", onActivated);

    return () => extension?.event.off("chrome:tabs:onActivated", onActivated);
  }, [extension?.event, tab?.windowId, tabId]);

  return tab;
};

export default useTab;
