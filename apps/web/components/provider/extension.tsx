/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import constant from "@workspace/constant";
import React from "react";

interface ExtensionProviderState {
  tab: Web.Tab | undefined;
  setTab: React.Dispatch<React.SetStateAction<Web.Tab | undefined>>;
  extension: Web.Extension | undefined;
  setExtension: React.Dispatch<React.SetStateAction<Web.Extension | undefined>>;
}

const initialState: ExtensionProviderState = {
  tab: undefined,
  setTab: () => null,
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

  return <Context.Provider value={{ tab, setTab, extension, setExtension }}>{children}</Context.Provider>;
};

export default ExtensionProvider;
