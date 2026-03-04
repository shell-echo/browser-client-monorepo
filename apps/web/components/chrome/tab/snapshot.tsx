"use client";

import helper from "@workspace/helper";
import logger from "@workspace/logger";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { LinkIcon, VideoIcon } from "@workspace/ui/components/icons";
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
type PreparedCanvas = { ctx: CanvasRenderingContext2D; width: number; height: number };

const DEFAULT_CAPTURE_INTERVAL = 500;
const SCREENCAST_COMMAND_PARAMS = { format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 } as const;

const decodeBase64ToJpegBytes = (data: string) => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
};

const drawBitmapContain = (bitmap: ImageBitmap, prepared: PreparedCanvas) => {
  const { ctx, width, height } = prepared;
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;

  ctx.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
};

export default function ChromeTabSnapshot(props: ChromeTabSnapshotProps) {
  const { extension } = useExtension();
  const tab = useTab(extension, props.tabId);
  const mode = React.useMemo<PreviewMode>(() => (tab ? (tab.active ? "screencast" : "capture") : "connecting"), [tab]);

  const target = React.useMemo<chrome._debugger.Debuggee>(() => ({ tabId: tab?.id }), [tab?.id]);
  const [tabAttachState, setTabAttachState] = React.useState<Record<number, AttachState>>({});
  const attach = React.useMemo<AttachState | undefined>(() => tabAttachState[tab?.id || 0], [tab?.id, tabAttachState]);

  // set attach state
  const setAttachState = React.useCallback((tabId: number, state: boolean, error?: string) => {
    setTabAttachState((previous) => ({ ...previous, [tabId]: { state, error } }));
  }, []);

  // connect
  const connect = React.useCallback(() => {
    const tabId = tab?.id;
    if (!tabId) return;

    extension
      ?.invoke("chrome:debugger:attach", { target, requiredVersion: "1.3" })
      .then(() => setAttachState(tabId, true))
      .catch((error) => {
        logger.warn(error);
        if (`${error}`.includes("Another debugger is already attached to the tab")) {
          setAttachState(tabId, true);
        } else {
          setAttachState(tabId, false, `${error}`);
        }
      });
  }, [extension, setAttachState, tab?.id, target]);

  const previewCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const previewPendingDataRef = React.useRef<string | null>(null);
  const previewBitmapRef = React.useRef<ImageBitmap | null>(null);
  const previewDecodeInFlightRef = React.useRef(false);
  const previewDrawRafRef = React.useRef<number | null>(null);

  const prepareCanvas = React.useCallback((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { ctx, width, height } as PreparedCanvas;
  }, []);

  const drawPreview = React.useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);

    const bitmap = previewBitmapRef.current;
    if (!bitmap) return;

    drawBitmapContain(bitmap, prepared);
  }, [prepareCanvas]);

  const schedulePreviewDraw = React.useCallback(() => {
    if (previewDrawRafRef.current !== null) return;

    previewDrawRafRef.current = window.requestAnimationFrame(() => {
      previewDrawRafRef.current = null;
      drawPreview();
    });
  }, [drawPreview]);

  const releasePreviewResources = React.useCallback(() => {
    if (previewDrawRafRef.current !== null) {
      window.cancelAnimationFrame(previewDrawRafRef.current);
      previewDrawRafRef.current = null;
    }

    previewPendingDataRef.current = null;
    previewDecodeInFlightRef.current = false;
    const bitmap = previewBitmapRef.current;
    previewBitmapRef.current = null;
    bitmap?.close();
    drawPreview();
  }, [drawPreview]);

  const decodePreviewFrame = React.useCallback(async () => {
    if (previewDecodeInFlightRef.current) return;

    previewDecodeInFlightRef.current = true;
    try {
      while (previewPendingDataRef.current) {
        const data = previewPendingDataRef.current;
        previewPendingDataRef.current = null;

        if (!globalThis.createImageBitmap) {
          break;
        }

        const bytes = decodeBase64ToJpegBytes(data);
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const bitmap = await createImageBitmap(blob);
        const previous = previewBitmapRef.current;
        previewBitmapRef.current = bitmap;
        previous?.close();
        schedulePreviewDraw();
      }
    } catch {
      // noop
    } finally {
      previewDecodeInFlightRef.current = false;
    }
  }, [schedulePreviewDraw]);

  const queuePreviewFrame = React.useCallback(
    (data: string) => {
      previewPendingDataRef.current = data;
      decodePreviewFrame().catch(() => null);
    },
    [decodePreviewFrame],
  );

  // attach/detach
  React.useEffect(() => {
    const tabId = tab?.id;
    if (!tabId) return;

    connect();

    const onDetach: Extension.Event.Handler<"chrome:debugger:onDetach"> = ({ payload }) => {
      if (payload.source.tabId !== tabId) {
        return;
      }

      releasePreviewResources();
      setAttachState(tabId, false, `Debugger detached: ${payload.reason}`);
    };
    extension?.event.on("chrome:debugger:onDetach", onDetach);

    return () => {
      extension?.event.off("chrome:debugger:onDetach", onDetach);
      extension
        ?.invoke("chrome:debugger:detach", target)
        .then(() => setAttachState(tabId, false))
        .catch((error) => setAttachState(tabId, false, `${error}`));
    };
  }, [connect, extension, releasePreviewResources, setAttachState, tab?.id, target]);

  React.useEffect(() => {
    return () => releasePreviewResources();
  }, [releasePreviewResources]);

  React.useEffect(() => {
    if (mode === "connecting" || !attach?.state) {
      releasePreviewResources();

      return;
    }

    schedulePreviewDraw();
    const onResize = () => schedulePreviewDraw();
    window.addEventListener("resize", onResize);

    const observer = new ResizeObserver(onResize);
    const canvas = previewCanvasRef.current;
    if (canvas) {
      observer.observe(canvas);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [attach?.state, mode, releasePreviewResources, schedulePreviewDraw]);

  // screencast
  React.useEffect(() => {
    if (mode !== "screencast" || !target.tabId || !attach?.state) return;

    extension
      ?.invoke("chrome:debugger:sendCommand", {
        target,
        method: "Page.startScreencast",
        commandParams: SCREENCAST_COMMAND_PARAMS,
      })
      .catch(() => null);

    const onEvent = ({ payload }: Extension.Event.Params<"chrome:debugger:onEvent">) => {
      if (payload.method !== "Page.screencastFrame") return;
      const frame = (payload.params || {}) as ScreencastFrameParams;
      if (frame.data) {
        queuePreviewFrame(frame.data);
      }
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
  }, [attach?.state, extension, mode, queuePreviewFrame, target]);

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
        .then((resp: CaptureScreenshotResult | undefined) => (resp?.data ? queuePreviewFrame(resp.data) : null))
        .catch(() => null);
    capture();
    captureTimerRef.current = window.setInterval(capture, props.refreshInterval ?? DEFAULT_CAPTURE_INTERVAL);

    return () => {
      if (captureTimerRef.current === undefined) return;
      window.clearInterval(captureTimerRef.current);
      captureTimerRef.current = undefined;
    };
  }, [attach?.state, extension, mode, props.refreshInterval, queuePreviewFrame, target]);

  return (
    <div className={cn("rounded-lg overflow-hidden bg-muted/50 text-xs", props.className)}>
      <div className="flex justify-between items-center gap-2">
        {tab?.favIconUrl && <Image width={14} height={14} src={tab.favIconUrl || ""} alt="favicon" />}
        <div className="flex-1 truncate">{tab?.title}</div>

        <Badge variant="secondary" className="shrink-0">
          <VideoIcon data-icon="inline-start" />
          {mode.replace(/\b\w/g, (c) => c.toUpperCase())}
        </Badge>
      </div>
      <div className="aspect-video relative">
        <div className="absolute inset-0">
          <canvas ref={previewCanvasRef} className="absolute inset-0 h-full w-full" />
        </div>

        <div className="w-full h-full flex items-center justify-center">
          <Badge variant="destructive">{attach?.error}</Badge>
        </div>

        {!attach?.state && !helper.utils.isRestrictedUrl(tab?.url || "") && mode !== "connecting" && (
          <div className="w-full h-full pointer-events-none absolute top-0 left-0 flex justify-center items-end p-2">
            <Button className="text-xs pointer-events-auto" onClick={connect}>
              reconnect
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="secondary" className="flex-1 justify-start rounded-md">
          <LinkIcon />
          <span className="block truncate">{tab?.url}</span>
        </Badge>
      </div>
    </div>
  );
}
