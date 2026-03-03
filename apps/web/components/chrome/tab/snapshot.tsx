"use client";

import logger from "@workspace/logger";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import Image from "next/image";
import React from "react";

import { useExtension } from "~/components/provider/extension";
import useTab from "~/hooks/tab";

interface ChromeTabSnapshotProps {
  tabId: number;
  className?: string;
  refreshInterval?: number;
}

type PreviewMode = "connecting" | "screencast" | "capture";
type AttachState = { state: boolean; error?: string };
type ScreencastFrameParams = { data?: string; sessionId?: number };
type CaptureScreenshotResult = { data?: string };

export default function ChromeTabSnapshot(props: ChromeTabSnapshotProps) {
  const { extension } = useExtension();
  const tab = useTab(extension, props.tabId);
  const mode = React.useMemo<PreviewMode>(() => (tab ? (tab.active ? "screencast" : "capture") : "connecting"), [tab]);

  const target = React.useMemo<chrome._debugger.Debuggee>(() => ({ tabId: tab?.id }), [tab?.id]);
  const [tabAttachState, setTabAttachState] = React.useState<{ [key: number]: AttachState }>({});
  const attach = React.useMemo<AttachState | undefined>(() => tabAttachState[tab?.id || 0], [tab?.id, tabAttachState]);

  const [snapshot, setSnapshot] = React.useState<string>();

  const connect = React.useCallback(() => {
    const tabId = tab?.id;
    if (!tabId) return;
    const setstate = (state: boolean, error?: string) => setTabAttachState((ta) => ({ ...ta, [tabId]: { state, error } }));

    extension
      ?.invoke("chrome:debugger:attach", { target, requiredVersion: "1.3" })
      .then(() => setstate(true))
      .catch((error) => {
        logger.warn(error);
        if (`${error}`.includes("Another debugger is already attached to the tab")) {
          setstate(true);
        } else setstate(false, `${error}`);
      });
  }, [extension, tab?.id, target]);

  // attach/detach
  React.useEffect(() => {
    const tabId = tab?.id;
    setSnapshot(undefined);
    if (!tabId) return;

    connect();
    const setstate = (state: boolean, error?: string) => setTabAttachState((ta) => ({ ...ta, [tabId]: { state, error } }));

    const onDetach: Extension.Event.Handler<"chrome:debugger:onDetach"> = ({ payload }) => {
      if (payload.source.tabId !== tabId) {
        return;
      }
      setSnapshot(undefined);
      setstate(false, `Debugger detached: ${payload.reason}`);
    };
    extension?.event.on("chrome:debugger:onDetach", onDetach);

    return () => {
      extension?.event.off("chrome:debugger:onDetach", onDetach);
      extension
        ?.invoke("chrome:debugger:detach", target)
        .then(() => setstate(false))
        .catch((error) => setstate(false, `${error}`));
    };
  }, [connect, extension, tab?.id, target]);

  // screencast
  React.useEffect(() => {
    if (mode !== "screencast" || !target.tabId || !attach?.state) return;

    const commandParams = { format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 };
    extension?.invoke("chrome:debugger:sendCommand", { target, method: "Page.startScreencast", commandParams });

    const onEvent = ({ payload }: Extension.Event.Params<"chrome:debugger:onEvent">) => {
      if (payload.method !== "Page.screencastFrame") return;
      const frame = (payload.params || {}) as ScreencastFrameParams;
      if (frame.data) setSnapshot(`data:image/jpeg;base64,${frame.data}`);
      if (typeof frame.sessionId !== "number") return;
      extension
        ?.invoke("chrome:debugger:sendCommand", {
          target: payload.source,
          method: "Page.screencastFrameAck",
          commandParams: { sessionId: frame.sessionId },
        })
        .catch(() => null);
    };
    extension?.event.on("chrome:debugger:onEvent", onEvent);

    return () => {
      extension?.invoke("chrome:debugger:sendCommand", { target, method: "Page.stopScreencast" }).catch(() => null);
      extension?.event.off("chrome:debugger:onEvent", onEvent);
    };
  }, [attach?.state, extension, mode, target]);

  // capture
  const captureTimerRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (mode !== "capture" || !target.tabId || !attach?.state) return;

    const capture = () =>
      extension
        ?.invoke("chrome:debugger:sendCommand", {
          target,
          method: "Page.captureScreenshot",
          commandParams: { format: "jpeg", quality: 70 },
        })
        .then((resp: CaptureScreenshotResult | undefined) =>
          setSnapshot(resp ? `data:image/jpeg;base64,${resp.data}` : undefined),
        )
        .catch(() => null);
    capture();
    captureTimerRef.current = window.setInterval(capture, props.refreshInterval || 500);

    return () => {
      if (captureTimerRef.current === undefined) return;
      window.clearInterval(captureTimerRef.current);
      captureTimerRef.current = undefined;
    };
  }, [attach?.state, extension, mode, props.refreshInterval, target]);

  return (
    <div className={cn("aspect-video relative overflow-hidden bg-muted/20", props.className)}>
      {snapshot && (
        <Image
          src={snapshot}
          alt={`chrome-tab-${props.tabId}-snapshot`}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 384px"
          className="object-contain"
        />
      )}
      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
        {JSON.stringify(attach)}
      </div>

      <Badge variant="secondary" className="absolute right-2 top-2">
        live:{mode}
      </Badge>
      {!attach?.state && (
        <div className="w-full h-full pointer-events-none absolute top-0 left-0 flex justify-center items-end p-2">
          <Button className="text-xs pointer-events-auto" onClick={connect}>
            reconnect
          </Button>
        </div>
      )}
    </div>
  );
}
