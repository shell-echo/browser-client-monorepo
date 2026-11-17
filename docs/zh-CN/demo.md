# 浏览器 Agent 演示

[English](../demo.md) · [浏览器 Agent 能力层](browser-agent.md) · [扩展通信](extension-communication.md)

[下载隐私安全的真实 Chrome 视觉控制演示视频](../browser-agent-demo.mp4) · 12 秒 · 1280×720 · MP4

`/extension` 是真实 Chrome 实现的演示页面，不模拟 Agent 返回值：页面通过 `@browser-client/extension-sdk` 连接扩展，由 Service Worker 处理授权，并通过共享 Agent 契约调用工具。公开契约还包括 `browser_page_observe`、`browser_page_click`、`browser_page_scroll`、`browser_page_type`、`browser_page_keypress` 和 `browser_page_navigate`，接入方可以在此基础上接入自己的多模态 Agent 循环。

## 本地运行

```sh
pnpm install --frozen-lockfile
pnpm dev
```

1. 在 Chrome 打开 `http://127.0.0.1:3000/extension`。
2. 在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/dist-dev`。
3. 从扩展 Connections 页面复制扩展 ID，填入演示页。
4. 在扩展中批准这个精确来源的待处理请求。
5. 在演示页选中一段文字，点击 **Run browser_page_read**。视觉控制循环请按 `docs/browser-agent.md` 使用 SDK：先获取新视口，再执行一个有界动作，然后再次观察。
6. 撤销授权或导航离开，观察文档级授权结束。

页面还展示 MCP、OpenAI function calling 和 LangChain 共用的工具定义。三个适配器共享能力目录，不会把这些框架加入扩展运行时。

## 视频展示内容

这段视频来自一个真实、完全隔离的 Chrome 会话，录制的是 Chrome 实际渲染的本地演示页面视口。它不是桌面录制，因此不会包含其他标签页、收藏夹、账号、扩展 ID、真实网站或个人页面数据；页面使用虚构数据，浏览器 profile 也是一次性的。

视频中的动作是真实的浏览器 DOM 事件：先观察新的视口，移动指针并执行一次有界点击，在聚焦字段中输入文字，以小步滚轮输入进行平滑有界滚动，再次观察并验证结果。左侧面板明确显示通信边界：SDK → Service Worker → Chrome Native Port → 隔离页面代理；标签说明精确来源授权、原生 Port 和不使用 raw `eval`。这是确定性的能力展示；生产接入方通过公开 SDK 契约接入自己的多模态 Agent 循环。

要运行真实扩展，请按上面的本地步骤完成授权并查看 `browser_page_read` 返回，再按 `docs/browser-agent.md` 使用视觉工具实现同样的“观察 → 有界动作 → 再次观察”循环。

## 录制真实接入流程

建议使用一次连续录屏，按下面顺序展示：

1. 展示 `/extension` 页面和 **Ask → Approve → Act** 三步说明。
2. 提交扩展 ID，在 Connections 中批准精确来源的待处理请求。
3. 请求 Agent 获取新的 `browser_page_observe` 画面，并展示返回的视口信息。
4. 根据 Agent 决策执行一次有界的 `browser_page_click`、`browser_page_scroll` 或 `browser_page_type`。
5. 再次观察并展示已验证结果，同时保留动作日志，让通信路径可审计。
6. 撤销授权或导航离开，再次请求并展示 `NOT_AUTHORIZED` 错误。

发布录屏前不要暴露扩展 ID 或个人页面内容。托管演示可以在扩展发布或提供签名的 unpacked 版本后复用此路由；浏览器权限批准仍由用户执行。
