/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { error } from "node:console";

import helper from "@workspace/helper";
import logger from "@workspace/logger";
import { Button } from "@workspace/ui/components/button";
import React from "react";

import { useExtension } from "~/components/provider/extension";

const WORKER_TAB_STORAGE_KEY = "xhs-worker-tab-id";

const asMessage = (reason: unknown) => {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
};

export default function Home() {
  const { extension, tab } = useExtension();
  const [keyword, setKeyword] = React.useState<string>("");
  const [userData, setUserData] = React.useState<{ [key: string]: any }>({});
  const [workerTabId, setWorkerTabId] = React.useState<number>();
  const [debugStatus, setDebugStatus] = React.useState<string>("idle");

  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const removeWorkerTab = React.useCallback(
    async (tabId?: number) => {
      if (!tabId) return;
      try {
        await extension?.invoke("chrome:tabs:remove", { tabIds: [tabId] });
      } catch (reason) {
        logger.error(reason);
      }
    },
    [extension],
  );

  React.useEffect(() => {
    extension
      ?.invoke("service-worker:fetch", { url: "https://edith.xiaohongshu.com/api/sns/web/v2/user/me", method: "GET" })
      .then((resp) => {
        const body = helper.utils.base64ToArrayBuffer(resp.body);
        const json = JSON.parse(new TextDecoder().decode(body));
        logger.debug(json);
        setUserData(json.data);
      });
  }, [extension]);

  React.useEffect(() => {
    if (!extension || !tab?.id) return;
    let disposed = false;
    let createdTabId: number | undefined;

    const createWorkerTab = async () => {
      const storedTabId = Number(window.sessionStorage.getItem(WORKER_TAB_STORAGE_KEY) || "0");
      if (storedTabId > 0) {
        await removeWorkerTab(storedTabId);
        window.sessionStorage.removeItem(WORKER_TAB_STORAGE_KEY);
      }
      if (disposed) return;

      const createProperties: chrome.tabs.CreateProperties = {
        url: "https://www.xiaohongshu.com/explore",
        openerTabId: tab.id,
        active: false,
      };
      const newTab = await extension.invoke("chrome:tabs:create", { createProperties });

      if (!newTab?.id) return;
      if (disposed) {
        await removeWorkerTab(newTab.id);

        return;
      }

      createdTabId = newTab.id;
      setWorkerTabId(newTab.id);
      window.sessionStorage.setItem(WORKER_TAB_STORAGE_KEY, String(newTab.id));
    };

    void createWorkerTab();

    return () => {
      disposed = true;
      const tabId = createdTabId ?? Number(window.sessionStorage.getItem(WORKER_TAB_STORAGE_KEY) || "0");
      if (tabId > 0) {
        window.sessionStorage.removeItem(WORKER_TAB_STORAGE_KEY);
        void removeWorkerTab(tabId);
      }
      setWorkerTabId(undefined);
    };
  }, [extension, removeWorkerTab, tab?.id]);

  React.useEffect(() => {
    if (!extension || !workerTabId) return;

    const tabTarget: chrome.debugger.DebuggerSession = { tabId: workerTabId };
    let disposed = false;
    let timerId: number | undefined;
    let drawing = false;
    let attachedTarget: chrome.debugger.DebuggerSession | undefined;

    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const resolveAttachTarget = async (): Promise<chrome.debugger.DebuggerSession> => {
      const targets = await extension.invoke("chrome:debugger:getTargets", undefined);
      const pageTarget = targets.find((item) => item.tabId === workerTabId && item.type === "page");
      if (pageTarget?.id) {
        return { targetId: pageTarget.id };
      }

      return tabTarget;
    };

    const ensureAttachedTarget = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 8; attempt++) {
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
          lastError = reason;
          if (message.includes("Cannot attach to this target")) {
            await sleep(300);
            continue;
          }

          throw reason;
        }
      }
      throw lastError ?? new Error("attach target failed");
    };

    const getCommandTarget = () => attachedTarget ?? tabTarget;

    const drawByBase64 = (base64: string) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      const drawContainSource = (source: HTMLImageElement) => {
        const sourceWidth = source.naturalWidth || source.width;
        const sourceHeight = source.naturalHeight || source.height;
        const canvasRatio = canvas.width / canvas.height;
        const imageRatio = sourceWidth / sourceHeight || 1;

        let drawWidth = canvas.width;
        let drawHeight = canvas.height;

        if (imageRatio > canvasRatio) {
          drawHeight = canvas.width / imageRatio;
        } else {
          drawWidth = canvas.height * imageRatio;
        }

        const offsetX = (canvas.width - drawWidth) / 2;
        const offsetY = (canvas.height - drawHeight) / 2;

        context.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
      };

      const image = new Image();
      image.onload = () => {
        if (disposed) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        drawContainSource(image);
      };
      image.src = `data:image/jpeg;base64,${base64}`;
    };

    const captureFrame = async () => {
      if (disposed || drawing) return;
      drawing = true;
      try {
        const resp = (await extension.invoke("chrome:debugger:sendCommand", {
          target: getCommandTarget(),
          method: "Page.captureScreenshot",
          commandParams: { format: "jpeg", quality: 70, fromSurface: true },
        })) as { data?: string };
        if (resp?.data) {
          drawByBase64(resp.data);
        }
      } catch (reason) {
        logger.null(reason);
      } finally {
        drawing = false;
      }
    };

    const startScreencast = async () => {
      setDebugStatus("connecting");
      await ensureAttachedTarget();
      if (disposed) return;

      await extension.invoke("chrome:debugger:sendCommand", { target: getCommandTarget(), method: "Page.enable" });
      await captureFrame();
      timerId = window.setInterval(() => {
        void captureFrame();
      }, 250);
      if (disposed) return;
      setDebugStatus("recording");
    };

    void startScreencast().catch((reason) => {
      logger.error(reason);
      if (!disposed) setDebugStatus("error");
    });

    return () => {
      disposed = true;
      if (timerId) {
        window.clearInterval(timerId);
      }
      void extension.invoke("chrome:debugger:detach", attachedTarget ?? tabTarget).catch((reason) => logger.null(reason));
      setDebugStatus("idle");
    };
  }, [extension, workerTabId]);

  const proxy = (name: string, tabId: number) => {
    const extension = (window as any)[name] as Web.Extension | undefined;
    if (!extension) return;

    extension.network.hook.xhr.send.on("llm-xhr-worker-proxy", (meta, xhr) => {
      xhr.addEventListener("load", () => {
        const url = meta.url.toString();
        if (!["//edith.xiaohongshu.com/api/sns/web/v2/user/me"].includes(url)) return;
        const ctype = xhr.getResponseHeader("content-type") || "";
        if (!ctype.includes("application/json")) return;
        const resp = xhr.responseText;

        const event = (url: string, resp: string) => {
          const event = new CustomEvent("xhs-api", { detail: { url, resp } });
          document.dispatchEvent(event);
        };
        extension
          .invoke("web:runtime:evaluate", { tabId, args: [url, resp], code: event.toString() })
          .then((resp) => console.log(resp));
      });
    });

    console.log({ extension });
  };
  const xhsApi = (event: Event & { detail?: { url: string; resp: string } }) => {
    console.log();
    if (!event.detail) return;
    const { url, resp } = event.detail;
    if (url === "//edith.xiaohongshu.com/api/sns/web/v2/user/me") {
      setUserData(JSON.parse(resp).data);
    }
  };

  React.useEffect(() => {
    if (workerTabId && extension) {
      extension
        .invoke("web:runtime:evaluate", {
          tabId: workerTabId,
          args: [extension.name, workerTabId],
          code: proxy.toString(),
        })
        .catch((error) => logger.error(error));
    }

    const deal: Extension.Event.Handler<"chrome:tabs:onUpdated"> = ({ payload }) => {
      if (workerTabId !== payload.tabId || !tab) return;
      extension
        ?.invoke("web:runtime:evaluate", {
          tabId: workerTabId,
          args: [extension.name, tab.id],
          code: proxy.toString(),
        })
        .catch((error) => logger.error(error));
    };

    extension?.event.on("chrome:tabs:onUpdated", deal);

    document.removeEventListener("xhs-api", xhsApi);
    document.addEventListener("xhs-api", xhsApi);

    return () => extension?.event.off("chrome:tabs:onUpdated", deal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extension, workerTabId]);

  if (!extension || !tab) return <div>loading...</div>;

  return (
    <div className="w-screen h-screen flex">
      <div className="w-1/2 h-full border-r flex justify-center items-center p-6">
        <div className="w-full max-w-lg space-y-3">
          <div>{userData.guest ? "未登录" : userData.user_id}</div>
          <div className="flex gap-2 items-center">
            <input
              name="keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="border rounded-lg p-1"
            />
            <Button disabled={keyword.length === 0}>search</Button>
          </div>
          <div className="text-sm text-muted-foreground">worker tab: {workerTabId ?? "-"}</div>
          <div className="text-sm text-muted-foreground">debugger: {debugStatus}</div>
          <div>{tab?.id}</div>
        </div>
      </div>

      <div className="w-2/3 h-full flex justify-center items-center p-6 bg-black/5">
        <div className="w-full max-w-4xl space-y-2">
          <div className="text-sm text-muted-foreground">worker tab snapshot video</div>
          <canvas ref={canvasRef} width={1280} height={720} className="w-full aspect-video rounded-lg border bg-black" />
        </div>
      </div>
    </div>
  );
}
