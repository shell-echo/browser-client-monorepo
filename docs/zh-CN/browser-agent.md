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
- `chrome-port`：默认控制传输；
- `document-scoped`：授权绑定精确来源、标签页和文档身份。

能力目录保持保守。本模板不会公开任意脚本执行、调试器、Cookie、网络代理、截图、下载或持久写入任务。新增能力前，必须先定义权限、身份、取消、限额、审计和浏览器覆盖，再加入公开目录并实现。

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

三种适配器共享同一份只读能力目录。`invokeBrowserAgentTool` 会先校验工具名称和空参数，再调用 SDK 请求函数。适配器不会授予权限、重试命令或绕过扩展的批准和限额。

## 最小连接示例

本仓库仍由 Chrome 实现提供具体适配器：

```ts
import { chromeTransport, createClient } from "@browser-client/extension-sdk"

const browser = createClient({
  connect: chromeTransport(extensionId),
  reconnect: true,
})

await browser.request("access.request", {
  capabilities: ["workspace.read", "page.read"],
})
const page = await browser.request("page.read", {})
browser.close()
```

网站示例必须先在已安装扩展的界面中批准，文档才能读取。工具适配器应把 `NOT_AUTHORIZED`、`DISCONNECTED`、`CANCELLED`、`TIMEOUT` 和 `BUSY` 作为结构化工具错误返回，不能对写操作盲目重试。

## 模板贡献规则

- 先在 `packages/browser-agent/src/capabilities.mts` 添加公开能力。
- 模板专属界面和存储放在 `apps/extension` 或 `templates/extension`。
- Chrome 发送方校验、授权、限额和生命周期处理放在 SDK/运行时实现中。
- 先为协议和授权边界补单测，再为真实 MV3 路径补浏览器覆盖。
- 英文和中文指南同步更新。

这样的边界可以同时吸引模板使用者和浏览器运行时贡献者：使用者从页面和接入流程开始，运行时贡献者则围绕小而清晰的能力契约工作。
