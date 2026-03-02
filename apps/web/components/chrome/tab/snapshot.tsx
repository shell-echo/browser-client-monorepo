"use client";

import { cn } from "@workspace/ui/lib/utils";
import Image from "next/image";
import React from "react";

import { useExtension } from "~/components/provider/extension";

interface ChromeTabSnapshotProps {
  tabId: number;
  className?: string;
}

type ScreencastFrameParams = {
  data?: string;
  sessionId?: number;
};

export default function ChromeTabSnapshot(props: ChromeTabSnapshotProps) {
  const { extension } = useExtension();
  const [snapshot, setSnapshot] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [streaming, setStreaming] = React.useState(false);

  React.useEffect(() => {
    if (!extension) {
      setStreaming(false);
      setError("Extension not connected");

      return;
    }

    let active = true;
    const target: chrome.debugger.Debuggee = { tabId: props.tabId };

    setSnapshot(undefined);
    setError(undefined);
    setStreaming(false);

    const onDebuggerEvent: Extension.Event.Handler<"chrome:debugger:onEvent"> = ({ payload }) => {
      if (payload.source.tabId !== props.tabId || payload.method !== "Page.screencastFrame") {
        return;
      }

      const frame = (payload.params || {}) as ScreencastFrameParams;
      if (active && frame.data) {
        setSnapshot(`data:image/jpeg;base64,${frame.data}`);
        setStreaming(true);
      }

      if (typeof frame.sessionId === "number") {
        extension
          .invoke("chrome:debugger:sendCommand", {
            target: payload.source,
            method: "Page.screencastFrameAck",
            commandParams: { sessionId: frame.sessionId },
          })
          .catch(() => null);
      }
    };

    const onDebuggerDetach: Extension.Event.Handler<"chrome:debugger:onDetach"> = ({ payload }) => {
      if (payload.source.tabId !== props.tabId || !active) {
        return;
      }
      setStreaming(false);
      setError(`Debugger detached: ${payload.reason}`);
    };

    extension.event.on("chrome:debugger:onEvent", onDebuggerEvent);
    extension.event.on("chrome:debugger:onDetach", onDebuggerDetach);

    const start = async () => {
      try {
        await extension.invoke("chrome:debugger:attach", { target, requiredVersion: "1.3" });
        await extension.invoke("chrome:debugger:sendCommand", { target, method: "Page.enable" });
        await extension.invoke("chrome:debugger:sendCommand", {
          target,
          method: "Page.startScreencast",
          commandParams: {
            format: "jpeg",
            quality: 70,
            maxWidth: 1280,
            maxHeight: 720,
            everyNthFrame: 1,
          },
        });
      } catch (reason) {
        if (!active) {
          return;
        }
        setStreaming(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    void start();

    return () => {
      active = false;
      extension.event.off("chrome:debugger:onEvent", onDebuggerEvent);
      extension.event.off("chrome:debugger:onDetach", onDebuggerDetach);

      void extension.invoke("chrome:debugger:sendCommand", { target, method: "Page.stopScreencast" }).catch(() => null);
      void extension.invoke("chrome:debugger:detach", target).catch(() => null);
    };
  }, [extension, props.tabId]);

  return (
    <div className={cn("aspect-video relative overflow-hidden bg-muted/20", props.className)}>
      {snapshot ? (
        <Image
          src={snapshot}
          alt={`tab-${props.tabId}-snapshot`}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 384px"
          className="object-contain"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">waiting frame...</div>
      )}
      <div className="absolute left-2 top-2 rounded bg-background/80 px-2 py-1 text-xs border">
        {error ? `error: ${error}` : streaming ? "live" : "connecting..."}
      </div>
    </div>
  );
}
