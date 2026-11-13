# 浏览器 Agent 演示

[English](../demo.md) · [浏览器 Agent 能力层](browser-agent.md) · [扩展通信](extension-communication.md)

`/extension` 是真实 Chrome 实现的演示页面，不模拟 Agent 返回值：页面通过 `@browser-client/extension-sdk` 连接扩展，由 Service Worker 处理授权，并通过共享 Agent 契约调用 `browser_page_read`。

## 本地运行

```sh
pnpm install --frozen-lockfile
pnpm dev
```

1. 在 Chrome 打开 `http://127.0.0.1:3000/extension`。
2. 在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/dist-dev`。
3. 从扩展 Connections 页面复制扩展 ID，填入演示页。
4. 在扩展中批准这个精确来源的待处理请求。
5. 在演示页选中一段文字，点击 **Run browser_page_read**。
6. 撤销授权或导航离开，观察文档级授权结束。

页面还展示 MCP、OpenAI function calling 和 LangChain 共用的三个只读工具定义。三个适配器共享能力目录，不会把这些框架加入扩展运行时。

## 录制短视频

建议使用一次连续录屏，按下面顺序展示：

1. 展示 `/extension` 页面和 **Ask → Approve → Act** 三步说明。
2. 提交扩展 ID，在 Connections 页面展示待处理请求。
3. 批准 `workspace.read` 和 `page.read`。
4. 在页面选中一句话，执行 `browser_page_read`。
5. 展示真实 SDK 返回的标题、URL 和选中文本。
6. 撤销授权，再次请求并展示 `NOT_AUTHORIZED` 错误。

发布录屏前不要暴露扩展 ID 或个人页面内容。托管演示可以在扩展发布或提供签名的 unpacked 版本后复用此路由；浏览器权限批准仍由用户执行。
