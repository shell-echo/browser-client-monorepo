"use client";

import { Button } from "@workspace/ui/components/button";
import { UnplugIcon } from "@workspace/ui/components/icons";
import { Separator } from "@workspace/ui/components/separator";
import Image from "next/image";
import React from "react";

import ChromeTabSnapshot from "~/components/chrome/tab/snapshot";
import { useExtension } from "~/components/provider/extension";

export default function Page() {
  const { extension, tabs } = useExtension();
  const [selectedTabId, setSelectedTabId] = React.useState<number>();

  if (!extension) {
    return (
      <div className="w-screen h-screen flex justify-center items-center gap-2">
        <Button variant="ghost" size="icon-sm">
          <UnplugIcon />
        </Button>
        <blockquote className="italic text-sm text-muted-foreground">Extension not connected.</blockquote>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col p-2 gap-2">
      <div className="w-full flex justify-between">
        <Button variant="ghost">Chrome·Tabs</Button>
        <Button variant="secondary">
          {extension.name} v{extension.version}
        </Button>
      </div>
      <div className="w-full flex-1 flex gap-2 overflow-auto">
        <div className="w-fit h-full flex flex-col overflow-auto">
          <div className="w-fit flex-1 flex flex-col gap-2 p-2 overflow-auto">
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                className="w-24 flex"
                variant={selectedTabId === tab.id ? "default" : "secondary"}
                onClick={() => setSelectedTabId(tab.id)}
              >
                {tab.favIconUrl && <Image width={12} height={12} src={tab.favIconUrl || ""} alt="favicon" />}
                <small className="flex-1 text-xs truncate">{tab.title}</small>
              </Button>
            ))}
          </div>
          <Button onClick={() => setSelectedTabId(undefined)}>clear tab</Button>
        </div>
        <Separator orientation="vertical" />
        <div className="flex-1 h-full overflow-auto flex justify-center items-center">
          {selectedTabId && <ChromeTabSnapshot tabId={selectedTabId} className="w-full max-w-lg p-2 rounded-lg" />}
        </div>
      </div>
    </div>
  );
}
