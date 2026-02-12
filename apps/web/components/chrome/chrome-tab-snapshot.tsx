"use client";

import logger from "@workspace/logger";
import { Button } from "@workspace/ui/components/button";
import React from "react";

interface ChromeTabSnapshotProps {
  extension: Web.Extension | undefined;
  workerTab: Web.Tab | undefined;
}

const ERROR_URL_MESSAGE = "Cannot snapshot this page URL (chrome:// / devtools://).";

export default function ChromeTabSnapshot({ extension, workerTab }: ChromeTabSnapshotProps) {
  const [snapshotError, setSnapshotError] = React.useState<string>("");
  const [canReconnectDebugger, setCanReconnectDebugger] = React.useState<boolean>(false);
  const [snapshotStatus, setSnapshotStatus] = React.useState<"loading" | "ready" | "error">("loading");

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const reconnectSnapshotRef = React.useRef<(() => void) | null>(null);

  const handleReconnectSnapshot = React.useCallback(() => {
    reconnectSnapshotRef.current?.();
  }, []);

  React.useEffect(() => {
    if (!extension || workerTab?.id === undefined) return;
    const workerTabId = workerTab.id;
    setSnapshotError("");
    setCanReconnectDebugger(false);
    reconnectSnapshotRef.current = null;

    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const asMessage = (reason: unknown) => {
      if (reason instanceof Error) return reason.message;
      if (typeof reason === "string") return reason;

      return String(reason);
    };
    const drawByBase64 = (base64: string) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      const image = new Image();
      image.onload = () => {
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) return;

        const canvasRatio = canvas.width / canvas.height;
        const imageRatio = sourceWidth / sourceHeight;

        let drawWidth = canvas.width;
        let drawHeight = canvas.height;
        if (imageRatio > canvasRatio) {
          drawHeight = canvas.width / imageRatio;
        } else {
          drawWidth = canvas.height * imageRatio;
        }

        const offsetX = (canvas.width - drawWidth) / 2;
        const offsetY = (canvas.height - drawHeight) / 2;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
      };
      image.src = `data:image/jpeg;base64,${base64}`;
    };
    const drawLoadingMessage = (message: string) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#9ca3af";
      context.font = "28px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(message, canvas.width / 2, canvas.height / 2);
    };
    const drawErrorMessage = (message: string) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111";
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = "#f87171";
      context.font = "bold 36px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("Snapshot Error", canvas.width / 2, canvas.height / 2 - 30);

      context.fillStyle = "#e5e7eb";
      context.font = "24px sans-serif";
      context.fillText(message, canvas.width / 2, canvas.height / 2 + 24);
    };

    const tabTarget: chrome.debugger.DebuggerSession = { tabId: workerTabId };
    let disposed = false;
    let timerId: number | undefined;
    let recoveryTimerId: number | undefined;
    let attachedTarget: chrome.debugger.DebuggerSession | undefined;
    let capturing = false;
    let reconnecting = false;
    let ready = false;
    let captureFailureCount = 0;
    let captureBlockedByUrl = false;
    let manualDetaching = false;
    const setSnapshotLoadingState = () => {
      if (disposed) return;
      setSnapshotError("");
      setCanReconnectDebugger(false);
      setSnapshotStatus("loading");
    };
    const setSnapshotReadyState = () => {
      if (disposed) return;
      setSnapshotError("");
      setCanReconnectDebugger(false);
      setSnapshotStatus("ready");
    };
    const setSnapshotErrorState = (message: string, reconnectable: boolean) => {
      if (disposed) return;
      setSnapshotError(message);
      setCanReconnectDebugger(reconnectable);
      setSnapshotStatus("error");
    };
    setSnapshotLoadingState();
    drawLoadingMessage("Snapshot loading...");

    const MAX_CAPTURE_FAILURES = 5;
    const isBlockedSnapshotUrl = (url?: string) =>
      Boolean(url && (url.startsWith("chrome://") || url.startsWith("devtools://") || url.startsWith("edge://")));
    const isSnapshotUrlAccessError = (message: string) => message.includes("chrome://") || message.includes("Cannot access");

    const stopCaptureLoop = () => {
      if (timerId !== undefined) {
        window.clearInterval(timerId);
        timerId = undefined;
      }
    };

    const stopRecoveryLoop = () => {
      if (recoveryTimerId !== undefined) {
        window.clearInterval(recoveryTimerId);
        recoveryTimerId = undefined;
      }
    };

    const resolveAttachTarget = async (): Promise<chrome.debugger.DebuggerSession> => {
      const targets = await extension.invoke("chrome:debugger:getTargets");
      const pageTarget = targets.find((target) => target.tabId === workerTabId && target.type === "page");
      if (pageTarget?.id) {
        return { targetId: pageTarget.id };
      }

      return tabTarget;
    };

    const ensureAttach = async () => {
      let lastError: unknown;
      for (let index = 0; index < 8; index++) {
        if (disposed) return;
        const target = await resolveAttachTarget();

        try {
          await extension.invoke("chrome:debugger:attach", { target, requiredVersion: "1.3" });
          attachedTarget = target;

          return;
        } catch (reason) {
          const message = asMessage(reason);
          if (message.includes("already attached")) {
            attachedTarget = target;

            return;
          }
          if (message.includes("Cannot attach to this target")) {
            lastError = reason;
            await sleep(250);
            continue;
          }

          throw reason;
        }
      }
      throw lastError ?? new Error("attach worker tab failed");
    };

    const detachDebugger = async () => {
      manualDetaching = true;
      try {
        await extension.invoke("chrome:debugger:detach", attachedTarget || tabTarget);
      } catch (reason) {
        const message = asMessage(reason);
        if (!message.includes("not attached")) {
          logger.null(reason);
        }
      } finally {
        manualDetaching = false;
      }
    };

    const connectDebugger = async () => {
      await ensureAttach();
      if (disposed) return;
      await extension.invoke("chrome:debugger:sendCommand", {
        target: attachedTarget || tabTarget,
        method: "Page.enable",
      });
      ready = true;
    };

    const checkSnapshotUrlAvailability = async () => {
      try {
        const latestTab = await extension.invoke("chrome:tabs:get", { tabId: workerTabId });
        captureBlockedByUrl = isBlockedSnapshotUrl(latestTab.url);
      } catch (reason) {
        logger.null(reason);
      }
    };

    const capture = async () => {
      if (disposed || capturing || reconnecting || !ready) return;
      if (captureBlockedByUrl) {
        startRecoveryLoop();

        return;
      }
      capturing = true;

      try {
        const resp = (await extension.invoke("chrome:debugger:sendCommand", {
          target: attachedTarget || tabTarget,
          method: "Page.captureScreenshot",
          commandParams: { format: "jpeg", quality: 70, fromSurface: true },
        })) as { data?: string };
        if (resp?.data) {
          drawByBase64(resp.data);
        }
        captureFailureCount = 0;
        setSnapshotReadyState();
      } catch (reason) {
        const message = asMessage(reason);
        if (isSnapshotUrlAccessError(message)) {
          captureBlockedByUrl = true;
          stopCaptureLoop();
          drawErrorMessage(ERROR_URL_MESSAGE);
          setSnapshotErrorState(ERROR_URL_MESSAGE, false);
          startRecoveryLoop();

          return;
        }

        captureFailureCount += 1;
        if (captureFailureCount >= MAX_CAPTURE_FAILURES) {
          captureFailureCount = 0;
          void reconnectDebugger();
        }

        logger.null(reason);
      } finally {
        capturing = false;
      }
    };

    const startCaptureLoop = () => {
      if (disposed || document.hidden || timerId !== undefined || captureBlockedByUrl || !ready) return;
      timerId = window.setInterval(() => {
        void capture();
      }, 300);
    };

    const reconnectDebugger = async () => {
      if (disposed || reconnecting || captureBlockedByUrl) return;
      reconnecting = true;
      stopCaptureLoop();
      try {
        await detachDebugger();
        attachedTarget = undefined;
        ready = false;
        await connectDebugger();
        captureFailureCount = 0;
        setSnapshotLoadingState();
        drawLoadingMessage("Snapshot loading...");
        if (!document.hidden) {
          await capture();
          startCaptureLoop();
        }
      } catch (reason) {
        const message = asMessage(reason);
        if (isSnapshotUrlAccessError(message)) {
          captureBlockedByUrl = true;
          stopCaptureLoop();
          drawErrorMessage(ERROR_URL_MESSAGE);
          setSnapshotErrorState(ERROR_URL_MESSAGE, false);
          ready = true;
          startRecoveryLoop();

          return;
        }
        logger.null(reason);
      } finally {
        reconnecting = false;
      }
    };

    const startRecoveryLoop = () => {
      if (disposed || recoveryTimerId !== undefined) return;

      recoveryTimerId = window.setInterval(() => {
        void (async () => {
          if (disposed || document.hidden || reconnecting) return;
          await checkSnapshotUrlAvailability();
          if (captureBlockedByUrl) return;

          stopRecoveryLoop();
          await reconnectDebugger();
        })();
      }, 1200);
    };

    const onDebuggerDetach: Extension.Event.Handler<"chrome:debugger:onDetach"> = (params) => {
      if (disposed || manualDetaching) return;
      const source = params.payload.source;
      const isCurrentTarget =
        source.tabId === workerTabId || (attachedTarget?.targetId !== undefined && source.targetId === attachedTarget.targetId);
      if (!isCurrentTarget) return;

      ready = false;
      stopCaptureLoop();
      stopRecoveryLoop();
      const reason = params.payload.reason;
      const reconnectable = reason !== "target_closed";
      drawErrorMessage(`Debugger detached: ${reason}`);
      setSnapshotErrorState(`Debugger detached: ${reason}`, reconnectable);
    };

    const onWorkerTabRemoved: Extension.Event.Handler<"chrome:tabs:onRemoved"> = (params) => {
      if (disposed || params.payload.tabId !== workerTabId) return;

      ready = false;
      captureBlockedByUrl = true;
      stopCaptureLoop();
      stopRecoveryLoop();
      drawErrorMessage("Worker tab closed, snapshot stopped.");
      setSnapshotErrorState("Worker tab closed, snapshot stopped.", false);
    };

    const onVisibilityChange = () => {
      if (!ready) return;
      if (document.hidden) {
        stopCaptureLoop();

        return;
      }
      if (captureBlockedByUrl) {
        startRecoveryLoop();

        return;
      }
      void capture();
      startCaptureLoop();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    extension.event.on("chrome:debugger:onDetach", onDebuggerDetach);
    extension.event.on("chrome:tabs:onRemoved", onWorkerTabRemoved);
    reconnectSnapshotRef.current = () => {
      setSnapshotLoadingState();
      drawLoadingMessage("Snapshot loading...");
      void reconnectDebugger();
    };

    void (async () => {
      try {
        await checkSnapshotUrlAvailability();
        if (captureBlockedByUrl) {
          drawErrorMessage(ERROR_URL_MESSAGE);
          setSnapshotErrorState(ERROR_URL_MESSAGE, false);
          ready = true;
          startRecoveryLoop();

          return;
        }
        await connectDebugger();
        if (disposed) return;
        await capture();
        startCaptureLoop();
      } catch (reason) {
        const message = asMessage(reason);
        if (isSnapshotUrlAccessError(message)) {
          captureBlockedByUrl = true;
          drawErrorMessage(ERROR_URL_MESSAGE);
          setSnapshotErrorState(ERROR_URL_MESSAGE, false);
          ready = true;
          startRecoveryLoop();

          return;
        }
        logger.error(reason);
      }
    })();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      extension.event.off("chrome:debugger:onDetach", onDebuggerDetach);
      extension.event.off("chrome:tabs:onRemoved", onWorkerTabRemoved);
      reconnectSnapshotRef.current = null;
      stopCaptureLoop();
      stopRecoveryLoop();
      void detachDebugger();
    };
  }, [extension, workerTab?.id]);

  React.useEffect(() => {
    if (workerTab?.id === undefined) {
      setSnapshotStatus("loading");
      setSnapshotError("");
      setCanReconnectDebugger(false);
    }
  }, [workerTab?.id]);

  return (
    <div className="w-full max-w-4xl space-y-2">
      <div className="text-sm text-muted-foreground truncate" title={workerTab?.url || "-"}>
        worker tab url: {workerTab?.url || "-"}
      </div>
      <div className="text-sm text-muted-foreground">worker tab snapshot video</div>
      {snapshotStatus === "loading" ? <div className="text-sm text-muted-foreground">snapshot loading...</div> : null}
      {snapshotError ? (
        <div className="flex items-center gap-2">
          <div className="text-sm text-red-500 truncate flex-1" title={snapshotError}>
            {snapshotError}
          </div>
          {canReconnectDebugger ? <Button onClick={handleReconnectSnapshot}>reconnect</Button> : null}
        </div>
      ) : null}
      <canvas ref={canvasRef} width={1280} height={720} className="w-full aspect-video rounded-lg border bg-black" />
    </div>
  );
}
