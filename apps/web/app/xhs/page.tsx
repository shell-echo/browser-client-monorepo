/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import helper from "@workspace/helper";
import logger from "@workspace/logger";
import { Button } from "@workspace/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import React from "react";

import ChromeTabSnapshot from "~/components/chrome/chrome-tab-snapshot";
import { useExtension } from "~/components/provider/extension";

interface XhsSearchNoteItem {
  id: string;
  model_type: "note";
  note_card: {
    type: string;
    display_title: string;
    cover: {
      width: number;
      height: number;
      url_pre: string;
      url_default: string;
    };
    interact_info: {
      collected: boolean;
      collected_count: string;
      comment_count: string;
      liked: boolean;
      liked_count: string;
      shared_count: string;
    };
    user: {
      avatar: string;
      nick_name: string;
      nickname: string;
      user_id: string;
      xsec_token: string;
    };
  };
  xsec_token: string;
}

export default function Page() {
  const { extension, tab } = useExtension();
  const [keyword, setKeyword] = React.useState<string>("");
  const [userData, setUserData] = React.useState<{ [key: string]: any }>({});
  const [loading, setLoading] = React.useState<boolean>(false);
  const [mode, setMode] = React.useState<"crawl" | "publish">("crawl");
  const [workerTab, setWorkerTab] = React.useState<Web.Tab>();
  const [allowAutoCreateWorkerTab, setAllowAutoCreateWorkerTab] = React.useState<boolean>(true);
  const [publishTab, setPublishTab] = React.useState<Web.Tab>();
  const [allowAutoCreatePublishTab, setAllowAutoCreatePublishTab] = React.useState<boolean>(true);
  const [tabGroupId, setTabGroupId] = React.useState<number | null>(null);
  const [data, setData] = React.useState<XhsSearchNoteItem[]>([]);
  const [searchDone, setSearchDone] = React.useState<boolean>(false);
  const [searchStarted, setSearchStarted] = React.useState<boolean>(false);
  const [searchRunning, setSearchRunning] = React.useState<boolean>(false);
  const [detailDone, setDetailDone] = React.useState<boolean>(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [detailProgress, setDetailProgress] = React.useState<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [detailData, setDetailData] = React.useState<Record<string, any>>({});
  const [detailRunning, setDetailRunning] = React.useState<boolean>(false);
  const [plan1Logs, setPlan1Logs] = React.useState<Array<{ ts: number; msg: string }>>([]);
  const [plan2Logs, setPlan2Logs] = React.useState<Array<{ ts: number; msg: string }>>([]);
  const [plan3Logs, setPlan3Logs] = React.useState<Array<{ ts: number; msg: string }>>([]);
  const detailRunningRef = React.useRef(false);
  const detailAbortRef = React.useRef(false);
  const searchAbortRef = React.useRef(false);
  const scrollTimerRef = React.useRef<number | null>(null);
  const plan1LogRef = React.useRef<HTMLDivElement | null>(null);
  const plan2LogRef = React.useRef<HTMLDivElement | null>(null);
  const plan3LogRef = React.useRef<HTMLDivElement | null>(null);
  const [plan1AutoScroll, setPlan1AutoScroll] = React.useState<boolean>(true);
  const [plan2AutoScroll, setPlan2AutoScroll] = React.useState<boolean>(true);
  const [plan3AutoScroll, setPlan3AutoScroll] = React.useState<boolean>(true);
  const [publishFiles, setPublishFiles] = React.useState<File[]>([]);
  const [publishImageUrls, setPublishImageUrls] = React.useState<string>("");
  const [publishTitle, setPublishTitle] = React.useState<string>("");
  const [publishContent, setPublishContent] = React.useState<string>("");
  const [publishFilePreviews, setPublishFilePreviews] = React.useState<string[]>([]);
  const [publishInjectLogs, setPublishInjectLogs] = React.useState<Array<{ ts: number; msg: string }>>([]);
  const [publishInjecting, setPublishInjecting] = React.useState<boolean>(false);
  const publishRemoteUrls = React.useMemo(() => {
    return publishImageUrls
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }, [publishImageUrls]);

  const formatTime = React.useCallback((ts: number) => {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
  }, []);

  const isAtBottom = (el: HTMLDivElement | null) => {
    if (!el) return true;

    return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  };

  const ensureTabGroup = React.useCallback(
    async (tabIds: number[]) => {
      if (!extension) return null;
      const options: chrome.tabs.GroupOptions = { tabIds };
      if (tabGroupId !== null) {
        options.groupId = tabGroupId;
      }
      const groupId = await extension.invoke("chrome:tabs:group", { options });
      if (tabGroupId === null || tabGroupId !== groupId) {
        setTabGroupId(groupId);
        await extension.invoke("chrome:tabGroups:update", {
          groupId,
          updateProperties: { title: "XHS Tools", color: "blue", collapsed: true },
        });
      }

      return groupId;
    },
    [extension, tabGroupId],
  );

  React.useEffect(() => {
    const urls = publishFiles.map((file) => URL.createObjectURL(file));
    setPublishFilePreviews(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [publishFiles]);

  const injectPublishImages = React.useCallback(async () => {
    if (!extension || !publishTab?.id || publishInjecting) return;
    if (publishFiles.length === 0 && publishRemoteUrls.length === 0) return;
    setPublishInjecting(true);
    setPublishInjectLogs((logs) => [...logs, { ts: Date.now(), msg: "开始构建图片列表" }]);
    const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    try {
      const payload: Array<{ name: string; type: string; base64: string }> = [];

      for (const file of publishFiles) {
        const buffer = await file.arrayBuffer();
        payload.push({
          name: file.name,
          type: file.type || "image/*",
          base64: helper.utils.arrayBufferToBase64(buffer),
        });
      }

      for (const rawUrl of publishRemoteUrls) {
        const safeUrl = rawUrl.trim();
        if (!safeUrl) continue;
        const url = new URL(safeUrl);
        const resp = await extension.invoke("service-worker:fetch", { url: safeUrl, method: "GET" });
        const mime = resp.headers["content-type"] || "image/*";
        const baseName = url.pathname.split("/").filter(Boolean).pop() || "image";
        payload.push({ name: baseName, type: mime, base64: resp.body });
        setPublishInjectLogs((logs) => [...logs, { ts: Date.now(), msg: `已获取: ${safeUrl}` }]);
        await delay(300);
      }

      const code = async (files: Array<{ name: string; type: string; base64: string }>) => {
        const input = document.querySelector("input[type='file']") as HTMLInputElement | null;
        if (!input) {
          return { success: false, message: "未找到文件输入框" };
        }
        const toArrayBuffer = (base64: string) => {
          const comma = base64.indexOf(",");
          const cleaned = (comma >= 0 ? base64.slice(comma + 1) : base64).trim().replace(/-/g, "+").replace(/_/g, "/");
          const pad = cleaned.length % 4;
          const padded = pad ? cleaned + "=".repeat(4 - pad) : cleaned;
          const binary = atob(padded);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }

          return bytes.buffer;
        };
        const dt = new DataTransfer();
        files.forEach((file) => {
          const buffer = toArrayBuffer(file.base64);
          const blob = new Blob([buffer], { type: file.type || "image/*" });
          const f = new File([blob], file.name, { type: file.type || "image/*" });
          dt.items.add(f);
        });
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        const waitForUpload = () =>
          new Promise<boolean>((resolve) => {
            const startedAt = Date.now();
            const tick = () => {
              const uploading = document.querySelectorAll(".img-preview-area .pr .uploading").length;
              if (uploading === 0) {
                resolve(true);

                return;
              }
              if (Date.now() - startedAt > 60000) {
                resolve(false);

                return;
              }
              window.setTimeout(tick, 500);
            };
            tick();
          });
        // wait a bit to observe upload state changes
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const done = await waitForUpload();

        return done
          ? { success: true, message: `已注入 ${files.length} 张图片，上传完成` }
          : { success: false, message: "等待上传超时" };
      };

      const resp = await extension.invoke("web:runtime:evaluate", {
        tabId: publishTab.id,
        args: [payload],
        code: code.toString(),
      });
      const result = resp?.[0]?.result?.data;
      if (result?.success) {
        setPublishInjectLogs((logs) => [...logs, { ts: Date.now(), msg: result.message }]);
        const setTextCode = async (title: string, content: string) => {
          const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
          const setText = (selector: string, value: string) => {
            const el = document.querySelector(selector) as HTMLElement | null;
            console.log(selector, value, el);
            if (!el) return false;
            el.focus();
            document.execCommand("selectAll", false);
            document.execCommand("insertText", false, value);

            return true;
          };
          await delay(500);
          const titleOk = setText("div.d-input input", title);
          const titleEl = document.querySelector("div.d-input input") as HTMLInputElement | null;
          await delay(500);
          const contentOk = setText('.editor-container [role="textbox"]', content);
          const contentEl = document.querySelector('.editor-container [role="textbox"]') as HTMLElement | null;

          return {
            success: titleOk && contentOk,
            message: titleOk && contentOk ? "标题/内容已填充" : "标题/内容填充失败",
            debug: {
              titleOk,
              contentOk,
              titleValue: titleEl ? titleEl.value : null,
              contentLength: contentEl ? contentEl.textContent?.length || 0 : 0,
            },
          };
        };
        const setResp = await extension.invoke("web:runtime:evaluate", {
          tabId: publishTab.id,
          args: [publishTitle, publishContent],
          code: setTextCode.toString(),
        });
        const setResult = setResp?.[0]?.result?.data;
        setPublishInjectLogs((logs) => [...logs, { ts: Date.now(), msg: setResult?.message || "标题/内容填充失败" }]);
        if (setResult?.debug) {
          setPublishInjectLogs((logs) => [
            ...logs,
            { ts: Date.now(), msg: `debug: titleOk=${setResult.debug.titleOk} contentOk=${setResult.debug.contentOk}` },
            { ts: Date.now(), msg: `debug: titleValue=${setResult.debug.titleValue ?? "null"}` },
            { ts: Date.now(), msg: `debug: contentLength=${setResult.debug.contentLength ?? 0}` },
          ]);
        }
        if (setResult?.success) {
          const clickPublishCode = () => {
            const btn = document.querySelector(".publish-page-publish-btn button.bg-red") as HTMLButtonElement | null;
            if (!btn) return { success: false, message: "未找到发布按钮" };
            btn.click();

            return { success: true, message: "已点击发布按钮" };
          };
          const clickResp = await extension.invoke("web:runtime:evaluate", {
            tabId: publishTab.id,
            args: [],
            code: clickPublishCode.toString(),
          });
          const clickResult = clickResp?.[0]?.result?.data;
          setPublishInjectLogs((logs) => [...logs, { ts: Date.now(), msg: clickResult?.message || "点击发布按钮失败" }]);
        }
      } else {
        setPublishInjectLogs((logs) => [...logs, { ts: Date.now(), msg: result?.message || "注入失败" }]);
      }
    } catch (error) {
      setPublishInjectLogs((logs) => [
        ...logs,
        { ts: Date.now(), msg: `注入失败: ${error instanceof Error ? error.message : String(error)}` },
      ]);
    } finally {
      setPublishInjecting(false);
    }
  }, [extension, publishContent, publishFiles, publishInjecting, publishRemoteUrls, publishTab?.id, publishTitle]);

  // prefetch
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

  // create worker tab
  const createworkertab = React.useCallback(async () => {
    if (!extension || !tab || workerTab) return;

    const createProperties: chrome.tabs.CreateProperties = {
      url: "https://www.xiaohongshu.com/explore",
      openerTabId: tab.id,
      active: false,
    };
    const createdTab = await extension.invoke("chrome:tabs:create", { createProperties });
    setWorkerTab(createdTab);
    const groupTabIds = [createdTab.id, publishTab?.id].filter((value): value is number => value !== undefined);
    await ensureTabGroup(groupTabIds);
  }, [ensureTabGroup, extension, publishTab?.id, tab, workerTab]);
  React.useEffect(() => {
    if (mode !== "crawl") return;
    if (!allowAutoCreateWorkerTab || workerTab) return;
    createworkertab().catch((reason) => logger.null(reason));
  }, [allowAutoCreateWorkerTab, createworkertab, mode, workerTab]);

  const createPublishTab = React.useCallback(async () => {
    if (!extension || !tab || publishTab) return;

    const createProperties: chrome.tabs.CreateProperties = {
      url: "https://creator.xiaohongshu.com/publish/publish?target=image",
      openerTabId: tab.id,
      active: false,
    };
    const createdTab = await extension.invoke("chrome:tabs:create", { createProperties });
    setPublishTab(createdTab);
    const groupTabIds = [createdTab.id, workerTab?.id].filter((value): value is number => value !== undefined);
    await ensureTabGroup(groupTabIds);
  }, [ensureTabGroup, extension, tab, publishTab, workerTab?.id]);
  React.useEffect(() => {
    if (mode !== "publish") return;
    if (!allowAutoCreatePublishTab || publishTab) return;
    createPublishTab().catch((reason) => logger.null(reason));
  }, [allowAutoCreatePublishTab, createPublishTab, mode, publishTab]);

  // update worker tab
  React.useEffect(() => {
    if (!extension) return;
    const update = (params: Extension.Event.Params<"chrome:tabs:onUpdated">) => {
      if (params.payload.tabId === workerTab?.id) {
        setWorkerTab(params.payload.tab);
      }
      if (params.payload.tabId === publishTab?.id) {
        setPublishTab(params.payload.tab);
      }
    };
    const remove = (params: Extension.Event.Params<"chrome:tabs:onRemoved">) => {
      if (params.payload.tabId === workerTab?.id) {
        setWorkerTab(undefined);
        setAllowAutoCreateWorkerTab(false);
      }
      if (params.payload.tabId === publishTab?.id) {
        setPublishTab(undefined);
        setAllowAutoCreatePublishTab(false);
      }
    };

    extension.event.on("chrome:tabs:onUpdated", update);
    extension.event.on("chrome:tabs:onRemoved", remove);

    return () => {
      extension.event.off("chrome:tabs:onUpdated", update);
      extension.event.off("chrome:tabs:onRemoved", remove);
    };
  }, [extension, publishTab?.id, workerTab?.id]);

  // remove worker tab when refresh/leave page
  React.useEffect(() => {
    if (!extension || workerTab?.id === undefined) return;

    const tabId = workerTab.id;

    const deal = () => {
      extension.invoke("chrome:tabs:remove", { tabIds: [tabId] }).catch((error) => logger.null(error));
    };

    window.addEventListener("beforeunload", deal);

    return () => window.removeEventListener("beforeunload", deal);
  }, [extension, workerTab?.id]);

  React.useEffect(() => {
    if (!extension || publishTab?.id === undefined) return;

    const tabId = publishTab.id;

    const deal = () => {
      extension.invoke("chrome:tabs:remove", { tabIds: [tabId] }).catch((error) => logger.null(error));
    };

    window.addEventListener("beforeunload", deal);

    return () => window.removeEventListener("beforeunload", deal);
  }, [extension, publishTab?.id]);

  React.useEffect(() => {
    if (!workerTab && !publishTab) {
      setTabGroupId(null);
    }
  }, [publishTab, workerTab]);

  // register proxy
  React.useEffect(() => {
    if (mode !== "crawl") return;
    if (!extension || tab?.id === undefined || workerTab?.id === undefined) return;
    const workerTabId = workerTab.id;
    const currentTabId = tab.id;
    const proxy = (name: string, tabId: number) => {
      const extension = (window as any)[name] as Web.Extension | undefined;
      if (!extension || extension.network.hook.xhr.send.hook["xhs-api"]) return;

      const allowUrls = [
        "//edith.xiaohongshu.com/api/sns/web/v2/user/me",
        "//edith.xiaohongshu.com/api/sns/web/v1/search/notes",
      ];

      extension.network.hook.xhr.send.on("xhs-api", (meta, xhr) => {
        xhr.addEventListener("load", () => {
          const url = meta.url.toString();

          if (!allowUrls.includes(url)) return;
          const ctype = xhr.getResponseHeader("content-type") || "";
          if (!ctype.includes("application/json")) return;
          const resp = xhr.responseText;

          const event = (url: string, method: string, body: any, resp: any) => {
            const event = new CustomEvent("xhs-api", { detail: { url, method, body, resp } });
            document.dispatchEvent(event);
          };
          extension
            .invoke("web:runtime:evaluate", {
              tabId,
              args: [url, meta.method, JSON.parse(meta.body?.toString() || "{}"), JSON.parse(resp)],
              code: event.toString(),
            })
            .catch((error) => console.error(error));
        });
      });
    };
    extension
      .invoke("web:runtime:evaluate", {
        tabId: workerTabId,
        args: [extension.name, currentTabId],
        code: proxy.toString(),
      })
      .catch((error) => logger.error(error));
  }, [extension, mode, tab, workerTab]);

  // xhs api hook
  React.useEffect(() => {
    if (mode !== "crawl") return;
    const apihook = (event: Event & { detail?: { url: string; method: string; body: any; resp: any } }) => {
      if (!event.detail) return;
      console.log(event.detail);
      if (event.detail.url === "//edith.xiaohongshu.com/api/sns/web/v1/search/notes") {
        const incoming = (event.detail?.resp.data.items || []).filter((item: XhsSearchNoteItem) => item.model_type === "note");
        setPlan1Logs((logs) => [...logs, { ts: Date.now(), msg: `收到 search/notes: ${incoming.length}` }]);
        setData((data) => [...data, ...incoming]);
      }
    };

    document.addEventListener("xhs-api", apihook);

    return () => document.removeEventListener("xhs-api", apihook);
  }, [mode]);

  // scroll to .note-item:last-of-type
  React.useEffect(() => {
    if (mode !== "crawl") return;
    if (!extension || workerTab?.id === undefined || keyword.length === 0 || data.length === 0) return;
    const workerTabId = workerTab.id;

    let running = false;
    const scroll = () => {
      const hasEndContainer = document.querySelectorAll(".end-container").length > 0;
      if (hasEndContainer) {
        document.querySelector(".end-container")?.scrollIntoView({ behavior: "smooth", block: "center" });

        return true;
      }
      document.querySelector(".note-item:last-of-type")?.scrollIntoView({ behavior: "smooth", block: "center" });

      return false;
    };

    const timer = window.setInterval(() => {
      setLoading(running);
      if (searchAbortRef.current) {
        window.clearInterval(timer);
        scrollTimerRef.current = null;

        return;
      }
      if (running) return;
      running = true;
      extension
        .invoke("web:runtime:evaluate", { tabId: workerTabId, args: [], code: scroll.toString() })
        .then((resp) => {
          const hasEndContainer = Boolean((resp?.[0] as any)?.result?.data);
          if (hasEndContainer) {
            window.clearInterval(timer);
            scrollTimerRef.current = null;
            setSearchDone(true);
            setSearchRunning(false);
            setPlan1Logs((logs) => [...logs, { ts: Date.now(), msg: "search/notes 已完成" }]);
          }
        })
        .catch((reason) => logger.null(reason))
        .finally(() => {
          running = false;
        });
    }, 1000);
    scrollTimerRef.current = timer;

    return () => window.clearInterval(timer);
  }, [data, extension, keyword.length, mode, workerTab?.id]);

  // set search value
  const setsearchvalue = (keyword: string) => {
    const searchInput = document.querySelector("#search-input");
    if (!searchInput) return;
    (searchInput as HTMLInputElement).value = keyword;
    const searchInputEvent = new Event("input", { bubbles: true, cancelable: true });
    searchInput.dispatchEvent(searchInputEvent);
  };
  React.useEffect(() => {
    if (mode !== "crawl") return;
    if (!extension || workerTab?.id === undefined) return;
    const workerTabId = workerTab.id;
    extension
      .invoke("web:runtime:evaluate", { tabId: workerTabId, args: [keyword], code: setsearchvalue.toString() })
      .catch((error) => logger.debug(error));
  }, [extension, keyword, mode, workerTab]);

  const clicksearch = () => (document.querySelector(".search-icon") as HTMLDivElement).click();
  const search = React.useCallback(async () => {
    if (mode !== "crawl") return;
    if (!extension || workerTab?.id === undefined) return;
    const workerTabId = workerTab.id;
    await extension.invoke("web:runtime:evaluate", { tabId: workerTabId, args: [keyword], code: setsearchvalue.toString() });
    setData([]);
    setSearchStarted(true);
    setSearchRunning(true);
    setSearchDone(false);
    setDetailDone(false);
    setDetailError(null);
    setDetailProgress(0);
    setDetailData({});
    setPlan1Logs([{ ts: Date.now(), msg: `开始 search/notes: ${keyword}` }]);
    setPlan2Logs([]);
    setPlan3Logs([]);
    detailAbortRef.current = false;
    searchAbortRef.current = false;
    setLoading(true);
    await extension.invoke("web:runtime:evaluate", { tabId: workerTabId, args: [], code: clicksearch.toString() });
  }, [extension, keyword, mode, workerTab]);
  const handleKeywordKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && keyword.length > 0 && !loading) {
        search().catch((error) => logger.error(error));
      }
    },
    [keyword.length, loading, search],
  );

  const interrupt = React.useCallback(() => {
    detailAbortRef.current = true;
    searchAbortRef.current = true;
    setSearchRunning(false);
    if (scrollTimerRef.current !== null) {
      window.clearInterval(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    setDetailError("已中断");
    setDetailDone(false);
    setPlan1Logs((logs) => [...logs, { ts: Date.now(), msg: "已中断" }]);
    setPlan2Logs((logs) => [...logs, { ts: Date.now(), msg: "已中断" }]);
    setPlan3Logs((logs) => [...logs, { ts: Date.now(), msg: "已中断" }]);
  }, []);

  React.useEffect(() => {
    if (plan1AutoScroll && plan1LogRef.current) {
      plan1LogRef.current.scrollTop = plan1LogRef.current.scrollHeight;
    }
  }, [plan1AutoScroll, plan1Logs]);

  React.useEffect(() => {
    if (plan2AutoScroll && plan2LogRef.current) {
      plan2LogRef.current.scrollTop = plan2LogRef.current.scrollHeight;
    }
  }, [plan2AutoScroll, plan2Logs]);

  React.useEffect(() => {
    if (plan3AutoScroll && plan3LogRef.current) {
      plan3LogRef.current.scrollTop = plan3LogRef.current.scrollHeight;
    }
  }, [plan3AutoScroll, plan3Logs]);

  // fetch note detail via service-worker:fetch after search completed
  React.useEffect(() => {
    if (mode !== "crawl") return;
    if (!extension || !searchDone || data.length === 0) return;
    if (detailRunningRef.current) return;

    detailRunningRef.current = true;
    setDetailRunning(true);
    detailAbortRef.current = false;
    setDetailDone(false);
    setDetailError(null);

    const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const extractInitialState = (html: string) => {
      const match = html.match(/window\\.__INITIAL_STATE__\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;/);
      if (!match) return null;
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    };

    const run = async () => {
      try {
        const items = [...data];
        setDetailProgress(0);
        for (let index = 0; index < items.length; index += 1) {
          if (detailAbortRef.current) return;
          const item = items[index];
          const url = `https://www.xiaohongshu.com/explore/${item.id}?xsec_token=${item.xsec_token}&xsec_source=`;
          setPlan2Logs((logs) => [...logs, { ts: Date.now(), msg: `抓取详情: ${item.id}` }]);
          const resp = await extension.invoke("service-worker:fetch", {
            url,
            method: "GET",
            init: { credentials: "omit" },
          });
          const body = helper.utils.base64ToArrayBuffer(resp.body);
          const html = new TextDecoder().decode(body);
          const initialState = extractInitialState(html);
          setDetailData((prev) => ({ ...prev, [item.id]: initialState }));
          setDetailProgress(index + 1);
          await delay(500);
        }
        setDetailDone(true);
        setPlan2Logs((logs) => [...logs, { ts: Date.now(), msg: "详情抓取完成" }]);
        setPlan3Logs((logs) => [...logs, { ts: Date.now(), msg: "任务完成" }]);
      } catch (error) {
        setDetailError(error instanceof Error ? error.message : String(error));
      } finally {
        detailRunningRef.current = false;
        setDetailRunning(false);
      }
    };

    run().catch((error) => logger.error(error));

    return () => {
      detailAbortRef.current = true;
    };
  }, [data, extension, mode, searchDone]);

  return (
    <div className="w-screen h-screen flex">
      <div className="w-1/2 h-full border-r flex justify-center items-start p-6 overflow-y-auto">
        <div className="w-full max-w-lg space-y-3 pb-6">
          <div className="text-sm text-muted-foreground">current tab: {tab?.id}</div>
          <div>{userData.guest ? "未登录" : userData.user_id}</div>
          <Tabs value={mode} onValueChange={(value) => setMode(value as "crawl" | "publish")}>
            <TabsList>
              <TabsTrigger value="crawl">crawl</TabsTrigger>
              <TabsTrigger value="publish">publish</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="min-h-[360px]">
            {mode === "crawl" ? (
              <>
                <div className="flex gap-2 items-center">
                  <input
                    name="keyword"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={handleKeywordKeyDown}
                    className="border rounded-lg p-1"
                    disabled={loading}
                  />
                  <Button disabled={keyword.length === 0 || searchRunning || detailRunning} onClick={search}>
                    search
                  </Button>
                  {(searchRunning || detailRunning) && (
                    <Button size="sm" variant="outline" onClick={interrupt}>
                      interrupt
                    </Button>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  worker tab: {workerTab?.id}
                  {!workerTab && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setAllowAutoCreateWorkerTab(false);
                        createworkertab().catch((reason) => logger.null(reason));
                      }}
                    >
                      create
                    </Button>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">notes: {data.length}</div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>Plan</div>
                  <div>1. search/notes: {searchDone ? "已完成" : searchStarted ? "进行中" : "未开始"}</div>
                  <details className="text-xs text-muted-foreground">
                    <summary>步骤1日志</summary>
                    <div
                      className="mt-2 max-h-16 overflow-y-auto rounded-md border bg-muted/50 px-2 py-1 text-[11px] leading-5 shadow-sm"
                      ref={plan1LogRef}
                      onScroll={(e) => setPlan1AutoScroll(isAtBottom(e.currentTarget))}
                    >
                      {plan1Logs.length === 0 ? (
                        <div className="text-muted-foreground/80">无</div>
                      ) : (
                        plan1Logs.map((log, idx) => (
                          <div key={`p1-${idx}`} className="flex gap-2">
                            <span className="tabular-nums text-muted-foreground/80">{formatTime(log.ts)}</span>
                            <span className="text-foreground/80">{log.msg}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                  <div>
                    2. fetch detail html: {detailDone ? "已完成" : detailError ? "失败" : searchDone ? "进行中" : "未开始"} (
                    {detailProgress}/{data.length})
                  </div>
                  <details className="text-xs text-muted-foreground">
                    <summary>步骤2日志</summary>
                    <div
                      className="mt-2 max-h-16 overflow-y-auto rounded-md border bg-muted/50 px-2 py-1 text-[11px] leading-5 shadow-sm"
                      ref={plan2LogRef}
                      onScroll={(e) => setPlan2AutoScroll(isAtBottom(e.currentTarget))}
                    >
                      {plan2Logs.length === 0 ? (
                        <div className="text-muted-foreground/80">无</div>
                      ) : (
                        plan2Logs.map((log, idx) => (
                          <div key={`p2-${idx}`} className="flex gap-2">
                            <span className="tabular-nums text-muted-foreground/80">{formatTime(log.ts)}</span>
                            <span className="text-foreground/80">{log.msg}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                  <div>3. 任务完成: {detailDone ? "是" : "否"}</div>
                  <details className="text-xs text-muted-foreground">
                    <summary>步骤3日志</summary>
                    <div
                      className="mt-2 max-h-16 overflow-y-auto rounded-md border bg-muted/50 px-2 py-1 text-[11px] leading-5 shadow-sm"
                      ref={plan3LogRef}
                      onScroll={(e) => setPlan3AutoScroll(isAtBottom(e.currentTarget))}
                    >
                      {plan3Logs.length === 0 ? (
                        <div className="text-muted-foreground/80">无</div>
                      ) : (
                        plan3Logs.map((log, idx) => (
                          <div key={`p3-${idx}`} className="flex gap-2">
                            <span className="tabular-nums text-muted-foreground/80">{formatTime(log.ts)}</span>
                            <span className="text-foreground/80">{log.msg}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-muted-foreground">
                  publish tab: {publishTab?.id}
                  {!publishTab && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setAllowAutoCreatePublishTab(false);
                        createPublishTab().catch((reason) => logger.null(reason));
                      }}
                    >
                      create
                    </Button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">发布页面已在独立 tab 打开，避免与爬虫模式冲突。</div>
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <div className="text-sm">本地图片</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center rounded-md border bg-background px-3 py-2 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground">
                        选择图片
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => setPublishFiles(Array.from(e.target.files || []))}
                        />
                      </label>
                      <div className="text-xs text-muted-foreground">已选: {publishFiles.length} 张</div>
                    </div>
                    {publishFilePreviews.length > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        {publishFilePreviews.map((src, idx) => (
                          <div key={`local-${idx}`} className="aspect-square overflow-hidden rounded-md border bg-muted/30">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={`local-${idx}`} className="h-full w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm">在线图片地址</div>
                    <textarea
                      className="w-full min-h-[64px] rounded-md border bg-transparent p-2 text-xs"
                      placeholder="每行一个 URL"
                      value={publishImageUrls}
                      onChange={(e) => setPublishImageUrls(e.target.value)}
                    />
                    {publishRemoteUrls.length > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        {publishRemoteUrls.map((src, idx) => (
                          <div key={`remote-${idx}`} className="aspect-square overflow-hidden rounded-md border bg-muted/30">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={`remote-${idx}`} className="h-full w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    )}
                    {publishInjectLogs.length > 0 && (
                      <div className="mt-2 max-h-24 overflow-y-auto rounded-md border bg-muted/50 px-2 py-1 text-[11px] leading-5 shadow-sm">
                        {publishInjectLogs.map((log, idx) => (
                          <div key={`dl-${idx}`} className="flex gap-2">
                            <span className="tabular-nums text-muted-foreground/80">{formatTime(log.ts)}</span>
                            <span className="text-foreground/80">{log.msg}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm">标题</div>
                    <input
                      className="w-full rounded-md border bg-transparent p-2 text-sm"
                      placeholder="请输入标题"
                      value={publishTitle}
                      onChange={(e) => setPublishTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm">内容</div>
                    <textarea
                      className="w-full min-h-[160px] rounded-md border bg-transparent p-2 text-sm"
                      placeholder="请输入内容"
                      value={publishContent}
                      onChange={(e) => setPublishContent(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      onClick={injectPublishImages}
                      disabled={
                        (publishRemoteUrls.length === 0 && publishFiles.length === 0) || publishInjecting || !publishTab
                      }
                    >
                      发布
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      {publishInjecting ? "处理中..." : "将本地 + 在线图片注入，并填充标题/内容后发布"}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          {detailError && <div className="text-xs text-red-600">error: {detailError}</div>}
        </div>
      </div>

      <div className="w-2/3 h-full flex justify-center items-center p-6 bg-black/5">
        <ChromeTabSnapshot extension={extension} workerTab={mode === "publish" ? publishTab : workerTab} />
      </div>
    </div>
  );
}
