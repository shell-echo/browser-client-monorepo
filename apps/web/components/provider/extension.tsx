/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import constant from "@workspace/constant";
import React from "react";

interface ExtensionProviderState {
  tab: Web.Tab | undefined;
  tabs: Web.Tab[];
  extension: Web.Extension | undefined;
}

const initialState: ExtensionProviderState = { tab: undefined, tabs: [], extension: undefined };

const Context = React.createContext<ExtensionProviderState>(initialState);

export const useExtension = () => {
  const context = React.useContext(Context);

  if (context === undefined) throw new Error("useExtension must be used within a ExtensionProvider");

  return context;
};

interface ExtensionProviderProps {
  children: React.ReactNode;
}

const ExtensionProvider: React.FC<ExtensionProviderProps> = ({ children }) => {
  const [tabId, setTabId] = React.useState<number>();
  const [tabs, setTabs] = React.useState<Web.Tab[]>([]);
  const [extension, setExtension] = React.useState<Web.Extension>();
  const [interfacename] = React.useState<string>(constant.extension.name);

  const tab = React.useMemo(() => tabs.find((tab) => tab.id === tabId), [tabId, tabs]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const originobj = (window as any)[interfacename];
    setExtension(originobj);

    Object.defineProperty(window, interfacename, {
      configurable: true,
      set(value) {
        this[`_${interfacename}`] = value;
        setExtension(value);
      },
      get() {
        return this[`_${interfacename}`];
      },
    });
    (window as any)[interfacename] = originobj;
  }, [interfacename]);

  React.useEffect(() => {
    extension?.invoke("chrome:tabs:current").then((tab) => setTabId(tab?.id));
  }, [extension]);

  React.useEffect(() => {
    extension?.invoke("chrome:tabs:query", { queryInfo: {} }).then((value) => setTabs(value));
  }, [extension]);

  React.useEffect(() => {
    const onCreated = (params: Extension.Event.Params<"chrome:tabs:onCreated">) => {
      const payload = params.payload;
      setTabs((tabs) => (tabs.map((tab) => tab.id).includes(payload.tab.id) ? tabs : [...tabs, payload.tab]));
    };

    extension?.event.on("chrome:tabs:onCreated", onCreated);

    return () => extension?.event.off("chrome:tabs:onCreated", onCreated);
  }, [extension?.event]);

  React.useEffect(() => {
    const onRemoved = (params: Extension.Event.Params<"chrome:tabs:onRemoved">) => {
      const payload = params.payload;
      setTabs((tabs) => tabs.filter((tab) => tab.id !== payload.tabId));
    };

    extension?.event.on("chrome:tabs:onRemoved", onRemoved);

    return () => extension?.event.off("chrome:tabs:onRemoved", onRemoved);
  }, [extension?.event]);

  React.useEffect(() => {
    const onUpdated = (params: Extension.Event.Params<"chrome:tabs:onUpdated">) => {
      const payload = params.payload;
      setTabs((tabs) => tabs.map((tab) => (tab.id === payload.tabId ? payload.tab : tab)));
    };

    extension?.event.on("chrome:tabs:onUpdated", onUpdated);

    return () => extension?.event.off("chrome:tabs:onUpdated", onUpdated);
  }, [extension?.event]);

  React.useEffect(() => {
    const onActivated = (params: Extension.Event.Params<"chrome:tabs:onActivated">) => {
      const activeInfo = params.payload.activeInfo;
      setTabs((tabs) =>
        tabs.map((tab) => {
          if (tab.id === activeInfo.tabId) return { ...tab, active: true };
          else if (tab.windowId === activeInfo.windowId) return { ...tab, active: false };

          return tab;
        }),
      );
    };

    extension?.event.on("chrome:tabs:onActivated", onActivated);

    return () => extension?.event.off("chrome:tabs:onActivated", onActivated);
  }, [extension?.event, tab?.windowId, tabId]);

  return (
    <Context.Provider value={{ tab, tabs: tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index), extension }}>
      {children}
    </Context.Provider>
  );
};

export default ExtensionProvider;
