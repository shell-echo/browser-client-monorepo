# 浏览器 Agent 能力层

[English](../browser-agent.md) · [扩展通信](extension-communication.md)

这个仓库同时承担模板和受控浏览器能力参考实现，但两种职责保持分离：

| 层          | 包或目录                        | 负责内容                                                                 |
| ----------- | ------------------------------- | ------------------------------------------------------------------------ |
| 能力契约    | `@browser-client/browser-agent` | 协议版本、公开能力名称、传输方式和授权模型                               |
| Chrome 实现 | `@browser-client/extension-sdk` | 原生 Port 客户端、MV3 Service Worker 路由器、隔离页面 Agent 和运行时校验 |
| 模板体验    | `apps/*`、`templates/*`         | 网站示例、弹出页、设置页、侧边栏、工作区存储、品牌和 manifest 策略       |

能力包保持很小，不引入 React、Chrome 全局对象、模板存储键或起始页面。Agent 集成可以依赖这个契约，再自行选择工具适配器。扩展 SDK 是本仓库模板提供的具体实现。

## 当前契约

`@browser-client/browser-agent` 当前公开：

- `workspace.read`：读取扩展中有长度限制的工作区名称；
- `page.read`：读取已批准顶层文档的标题、URL 和当前选中文本；
- `page.observe`：读取视口尺寸、滚动位置，并在未检测到敏感字段时返回有界压缩截图；
- `page.click`：在完成文档和来源校验后点击视口坐标；
- `page.scroll`：按有界增量滚动；
- `page.type`：向当前聚焦的非敏感文本控件输入文字；
- `page.keypress`：向当前聚焦控件发送有界按键；
- `page.navigate`：仅在明确确认后导航到允许的标签页；
- `chrome-port`：默认控制传输；
- `document-scoped`：授权绑定精确来源、标签页和文档身份。

能力目录保持保守。本模板不会公开任意脚本执行、调试器、Cookie、网络代理、下载或持久写入任务。截图只覆盖当前视口、经过压缩，并且 SDK 不会持久化；检测到密码/支付类字段或页面包含 iframe 时会抑制截图，因为顶层 Agent 无法检查另一个来源。截图尺寸是设备像素，并通过 `pixelRatio` 说明缩放；动作坐标使用 CSS 视口像素。提交、发送、购买、删除等高影响控件必须传入 `confirm: true`，Web 导航限制在已批准来源内。新增能力前，必须先定义权限、身份、取消、限额、审计和浏览器覆盖，再加入公开目录并实现。

## Agent 接入边界

接入方负责自己的 Agent 工具适配器，扩展运行时作为本地执行边界：

```text
Agent / 工具框架
        ↓ 接入方选择的适配器
@browser-client/extension-sdk 客户端
        ↓ Chrome 原生 Port
扩展 Service Worker 路由器
        ↓ 已授权的隔离页面 Agent
指定文档
```

模板的 `/extension` 页面只是申请权限的参考界面。生产产品可以替换这个页面，但必须保留运行时约束：扩展界面内明确批准、精确文档绑定、导航或权限移除时撤销、消息有界，以及不自动重放结果不明确的写操作。

## 工具适配器

能力包提供三种常见 Agent 接入的无依赖描述：

- `createMcpBrowserAgentTools()` 返回 MCP 风格的 `name`、`description` 和 `inputSchema`；
- `createOpenAiBrowserAgentTools()` 返回 OpenAI 兼容的 function tool 定义；
- `createLangChainBrowserAgentTools(request)` 返回带 JSON Schema 和 `invoke` 方法的工具对象，接入方可以自行包装为 LangChain `StructuredTool`，扩展运行时不需要安装 LangChain。

三种适配器共享同一份能力目录。`invokeBrowserAgentTool` 会在调用 SDK 前校验每个动作的有界参数。适配器不会授予权限、重试命令，也不会绕过扩展批准、文档绑定、敏感字段保护和限额。

## 最小连接示例

本仓库仍由 Chrome 实现提供具体适配器：

```ts
import { chromeTransport, createClient } from "@browser-client/extension-sdk"

const browser = createClient({
  connect: chromeTransport(extensionId),
  reconnect: true,
})

await browser.request("access.request", {
  capabilities: ["page.observe", "page.click", "page.scroll", "page.type", "page.keypress"],
})
const observation = await browser.request("page.observe", { includeScreenshot: true })
// 把 observation.screenshot?.dataUrl 交给多模态模型，然后执行一个有界动作，
// 再次 observe。不要依据过期画面猜坐标。
await browser.request("page.click", { x: 640, y: 420, confirm: false })
browser.close()
```

网站示例必须先在已安装扩展的界面中批准，文档才能观察或操作。工具适配器应把 `NOT_AUTHORIZED`、`CONFIRMATION_REQUIRED`、`SENSITIVE_FIELD`、`DISCONNECTED`、`CANCELLED`、`TIMEOUT` 和 `BUSY` 作为结构化工具错误返回，不能对动作盲目重试。正常的模型循环是 observe → 选择一个动作 → 再次 observe；SDK 不运行自主模型，也不会重放结果不明确的动作。

## 模板贡献规则

- 先在 `packages/browser-agent/src/capabilities.mts` 添加公开能力。
- 模板专属界面和存储放在 `apps/extension` 或 `templates/extension`。
- Chrome 发送方校验、授权、限额和生命周期处理放在 SDK/运行时实现中。
- 先为协议和授权边界补单测，再为真实 MV3 路径补浏览器覆盖。
- 英文和中文指南同步更新。

这样的边界可以同时吸引模板使用者和浏览器运行时贡献者：使用者从页面和接入流程开始，运行时贡献者则围绕小而清晰的能力契约工作。
