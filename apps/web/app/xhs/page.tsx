/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import helper from "@workspace/helper";
import logger from "@workspace/logger";
import { Button } from "@workspace/ui/components/button";
import React from "react";

import ChromeTabSnapshot from "~/components/chrome/chrome-tab-snapshot";
import { useExtension } from "~/components/provider/extension";

export default function Page() {
  const { extension, tab } = useExtension();
  const [keyword, setKeyword] = React.useState<string>("");
  const [userData, setUserData] = React.useState<{ [key: string]: any }>({});
  const [loading] = React.useState<boolean>(false);
  const [workerTab, setWorkerTab] = React.useState<Web.Tab>();
  const [allowAutoCreateWorkerTab, setAllowAutoCreateWorkerTab] = React.useState<boolean>(true);
  const [data, setData] = React.useState<any[]>([]);

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
    if (!allowAutoCreateWorkerTab || workerTab) return;
    createworkertab().catch((reason) => logger.null(reason));
  }, [allowAutoCreateWorkerTab, createworkertab, workerTab]);

  // update worker tab
  React.useEffect(() => {
    if (!extension) return;
    const update = (params: Extension.Event.Params<"chrome:tabs:onUpdated">) => {
      if (params.payload.tabId !== workerTab?.id) return;
      setWorkerTab(params.payload.tab);
    };
    const remove = (params: Extension.Event.Params<"chrome:tabs:onRemoved">) => {
      if (params.payload.tabId !== workerTab?.id) return;
      setWorkerTab(undefined);
      setAllowAutoCreateWorkerTab(false);
    };

    extension.event.on("chrome:tabs:onUpdated", update);
    extension.event.on("chrome:tabs:onRemoved", remove);

    return () => {
      extension.event.off("chrome:tabs:onUpdated", update);
      extension.event.off("chrome:tabs:onRemoved", remove);
    };
  }, [extension, workerTab?.id]);

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

  // register proxy
  React.useEffect(() => {
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
  }, [extension, tab, workerTab]);

  // xhs api hook
  React.useEffect(() => {
    const apihook = (event: Event & { detail?: { url: string; method: string; body: any; resp: any } }) => {
      if (!event.detail) return;
      console.log(event.detail);
      if (event.detail.url === "//edith.xiaohongshu.com/api/sns/web/v1/search/notes") {
        setData((data) => [...data, ...(event.detail?.resp.data.items || [])]);
      }
    };

    document.addEventListener("xhs-api", apihook);

    return () => document.removeEventListener("xhs-api", apihook);
  }, []);

  // scroll to .note-item:last-of-type
  React.useEffect(() => {
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
      if (running) return;
      running = true;
      extension
        .invoke("web:runtime:evaluate", { tabId: workerTabId, args: [], code: scroll.toString() })
        .then((resp) => {
          const hasEndContainer = Boolean((resp?.[0] as any)?.result?.data);
          if (hasEndContainer) {
            window.clearInterval(timer);
          }
        })
        .catch((reason) => logger.null(reason))
        .finally(() => {
          running = false;
        });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [data, extension, keyword.length, workerTab?.id]);

  // set search value
  const setsearchvalue = (keyword: string) => {
    const searchInput = document.querySelector("#search-input");
    if (!searchInput) return;
    (searchInput as HTMLInputElement).value = keyword;
    const searchInputEvent = new Event("input", { bubbles: true, cancelable: true });
    searchInput.dispatchEvent(searchInputEvent);
  };
  React.useEffect(() => {
    if (!extension || workerTab?.id === undefined) return;
    const workerTabId = workerTab.id;
    extension
      .invoke("web:runtime:evaluate", { tabId: workerTabId, args: [keyword], code: setsearchvalue.toString() })
      .catch((error) => logger.debug(error));
  }, [extension, keyword, workerTab]);

  const clicksearch = () => (document.querySelector(".search-icon") as HTMLDivElement).click();
  const search = React.useCallback(async () => {
    if (!extension || workerTab?.id === undefined) return;
    const workerTabId = workerTab.id;
    await extension.invoke("web:runtime:evaluate", { tabId: workerTabId, args: [keyword], code: setsearchvalue.toString() });
    setData([]);
    await extension.invoke("web:runtime:evaluate", { tabId: workerTabId, args: [], code: clicksearch.toString() });
  }, [extension, keyword, workerTab]);
  const handleKeywordKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && keyword.length > 0 && !loading) {
        search().catch((error) => logger.error(error));
      }
    },
    [keyword.length, loading, search],
  );

  return (
    <div className="w-screen h-screen flex">
      <div className="w-1/2 h-full border-r flex justify-center items-center p-6">
        <div className="w-full max-w-lg space-y-3">
          <div className="text-sm text-muted-foreground">current tab: {tab?.id}</div>
          <div>{userData.guest ? "未登录" : userData.user_id}</div>
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
        </div>
      </div>

      <div className="w-2/3 h-full flex justify-center items-center p-6 bg-black/5">
        <ChromeTabSnapshot extension={extension} workerTab={workerTab} />
      </div>
    </div>
  );
}
