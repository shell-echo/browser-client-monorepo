/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import constant from "@workspace/constant";
import React from "react";

interface ExtensionProviderState {
  tab: Web.Tab | undefined;
  setTab: React.Dispatch<React.SetStateAction<Web.Tab | undefined>>;
  tabs: Web.Tab[];
  setTabs: React.Dispatch<React.SetStateAction<Web.Tab[]>>;
  extension: Web.Extension | undefined;
  setExtension: React.Dispatch<React.SetStateAction<Web.Extension | undefined>>;
}

const initialState: ExtensionProviderState = {
  tab: undefined,
  setTab: () => null,
  tabs: [],
  setTabs: () => null,
  extension: undefined,
  setExtension: () => null,
};

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
  const [tab, setTab] = React.useState<Web.Tab>();
  const [tabs, setTabs] = React.useState<Web.Tab[]>([]);
  const [extension, setExtension] = React.useState<Web.Extension>();
  const [interfacename] = React.useState<string>(constant.extension.name);

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
    extension?.invoke("chrome:tabs:current").then((tab) => setTab(tab));
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
  }, [extension?.event, tab?.id]);

  React.useEffect(() => {
    const onRemoved = (params: Extension.Event.Params<"chrome:tabs:onRemoved">) => {
      const { tabId } = params.payload;
      setTabs((tabs) => tabs.filter((tab) => tab.id !== tabId));
    };

    extension?.event.on("chrome:tabs:onRemoved", onRemoved);
  }, [extension?.event, tab?.id]);

  React.useEffect(() => {
    const onUpdated = (params: Extension.Event.Params<"chrome:tabs:onUpdated">) => {
      const payload = params.payload;
      if (payload.tabId === tab?.id) setTab(payload.tab);
      setTabs((tabs) => tabs.map((tab) => (tab.id === payload.tabId ? payload.tab : tab)));
    };

    extension?.event.on("chrome:tabs:onUpdated", onUpdated);
  }, [extension?.event, tab?.id]);

  return <Context.Provider value={{ tab, setTab, tabs, setTabs, extension, setExtension }}>{children}</Context.Provider>;
};

export default ExtensionProvider;
