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
  const [data, setData] = React.useState<XhsSearchNoteItem[]>([]);
  const [searchDone, setSearchDone] = React.useState<boolean>(false);
  const [searchStarted, setSearchStarted] = React.useState<boolean>(false);
  const [detailDone, setDetailDone] = React.useState<boolean>(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [detailProgress, setDetailProgress] = React.useState<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [detailData, setDetailData] = React.useState<Record<string, any>>({});
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
  const [publishContent, setPublishContent] = React.useState<string>("");
  const [publishFilePreviews, setPublishFilePreviews] = React.useState<string[]>([]);
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

  React.useEffect(() => {
    const urls = publishFiles.map((file) => URL.createObjectURL(file));
    setPublishFilePreviews(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [publishFiles]);

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
  }, [extension, tab, workerTab]);
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
  }, [extension, tab, publishTab]);
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
      }
    };

    run().catch((error) => logger.error(error));

    return () => {
      detailAbortRef.current = true;
    };
  }, [data, extension, mode, searchDone]);

  return (
    <div className="w-screen h-screen flex">
      <div className="w-1/2 h-full border-r flex justify-center items-center p-6">
        <div className="w-full max-w-lg space-y-3">
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
                <Button disabled={keyword.length === 0 || loading} onClick={search}>
                  search
                </Button>
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
                  2. fetch detail html:{" "}
                  {detailDone ? "已完成" : detailError ? "失败" : searchDone ? "进行中" : "未开始"} ({detailProgress}/
                  {data.length})
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
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={interrupt} disabled={!searchStarted || detailDone}>
                  interrupt
                </Button>
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
                <div className="text-xs text-muted-foreground">
                  发布页面已在独立 tab 打开，避免与爬虫模式冲突。
                </div>
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <div className="text-sm">本地图片</div>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      className="text-xs"
                      onChange={(e) => setPublishFiles(Array.from(e.target.files || []))}
                    />
                    <div className="text-xs text-muted-foreground">已选: {publishFiles.length} 张</div>
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
                      className="w-full min-h-[96px] rounded-md border bg-transparent p-2 text-xs"
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
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm">长文本</div>
                    <textarea
                      className="w-full min-h-[160px] rounded-md border bg-transparent p-2 text-sm"
                      placeholder="请输入内容"
                      value={publishContent}
                      onChange={(e) => setPublishContent(e.target.value)}
                    />
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
