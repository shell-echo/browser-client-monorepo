# 扩展通信

[English](../extension-communication.md) · [中文文档](README.md) · [项目首页](../../README.zh-CN.md)

网站、弹出页、设置页和侧边栏共用 `@browser-client/extension-sdk`。隔离内容脚本提供有限的页面读取能力，每个已安装扩展由自己的 Service Worker 集中路由，默认传输是 Chrome 原生 Port。无需服务端、WebRTC、全局页面事件总线、全标签页广播或后台心跳。

## 体验完整流程

1. 按扩展开发说明构建并加载实例，在弹出页或设置页的 **Connections** 中复制扩展 ID。
2. 打开网站实例的 `/extension`，输入 ID，选择 **Connect and request access**。
3. 在扩展中核对来源、标签页和能力，选择 **Allow this page**。网站随后可以读取共享工作区名称，并主动请求自身选中文本；文本不会自动持续上传。
4. 修改工作区设置可看到订阅更新。在扩展中撤销、导航该文档或关闭标签页都会结束授权。**Disconnect** 仅关闭 SDK 连接，不等于撤销文档授权。

弹出页的 **Open side panel** 在所选标签页旁打开同样的控制界面。**Read selected page** 需要用户主动触发，并依赖 Chrome `activeTab`；受限制的浏览器页面无法读取。本版只暴露标题、来源与路径、选中文本，不提供页面 HTML、cookie、任意脚本、调试器命令、网络代理、截图或下载。

## 工作区设置

已安装扩展将 `workspaceName` 保存在 `chrome.storage.local`。弹出页、设置页和服务于侧边栏及网站 SDK 的后台共用[同一个读取函数](../../apps/extension/src/lib/settings.ts)，[独立扩展种子](../../templates/extension/src/lib/settings.ts)也遵循相同规则。读取最多返回前 80 个 UTF-16 代码单元，与 JavaScript 字符串长度规则一致。缺失、非字符串或仅含空白的值使用既有默认名称 `Browser Client`；其他已有空白保持原样。

读取不会改写存储值或更换存储键。已有的超长名称仍完整保留在存储中，各端看到相同的截取结果。显式保存沿用原有校验：去掉首尾空白，长度须为 1–80 个 UTF-16 代码单元。普通网页预览使用独立的 `browser-client-workspace-name` localStorage 键，读取规则相同。回归测试覆盖已有数据及读取时的数据保留；浏览器验收核对弹出页、设置页、侧边栏、网站订阅与 SDK 返回值，并检查原始存储值未变。

## 配置可信网站

每个扩展的 `src/bridge-policy.ts` 管理自己的白名单，独立扩展种子也有自己的策略。默认只允许 `http://127.0.0.1:3000` 和 `http://localhost:3000`。自定义网站端口或生产 HTTPS 来源必须主动加入并重建扩展，不能自动信任全部注册实例或使用生产来源通配符。

manifest 从策略生成 `externally_connectable.matches` 和初始 `content_scripts.matches`。Chrome 匹配模式通常比精确来源更宽，尤其是端口；路由器另外校验精确 `MessageSender.origin`、URL、顶层 frame、标签页、当前 document ID 和浏览器配置身份。匹配 manifest 本身不授予能力，浏览器权限和业务批准必须同时满足。内容脚本即使具有相同扩展 ID，也不能调用界面管理方法。

批准发生在打包的扩展界面中，不是在网页对话框中。授权存于 `chrome.storage.session`，绑定扩展安装与浏览器配置、精确来源、标签页和文档 ID，最长一小时。导航使授权失效，移除权限会撤销全部授权。批准请求两分钟过期、断开即移除，不是持久任务。同源网站脚本共享该站点的权限，白名单不能防御网站自身的 XSS。无痕模式使用分离的扩展上下文和授权键，且需先在 Chrome 允许扩展用于无痕。

## SDK 使用

```ts
import { chromeTransport, createClient } from "@browser-client/extension-sdk"

// 网站传入已安装扩展的 ID；扩展界面省略此参数
const sdk = createClient({ connect: chromeTransport(extensionId), reconnect: true })
await sdk.request("access.request", { capabilities: ["workspace.read", "page.read"] })
// 用户在扩展中批准后
const page = await sdk.request("page.read", {})
const stop = sdk.subscribe("workspace", (snapshot) => render(snapshot))
// 组件卸载时释放
stop()
sdk.close()
```

每个挂载的应用上下文使用一个客户端，卸载时释放。`diagnostics()` 只报告有界的请求与等待数量，不暴露文档 ID 或载荷。SDK 可以在 SSR 时导入，连接前不调用 Chrome；Next.js 将其加入 `transpilePackages`。`apps/web/src/app/extension` 提供客户端组件示例。

网站能力只读。`workspace.set` 及除 `access.request` 外的 `access.*` 管理方法要求打包界面身份。网站的 `page.read` 不能指定其他标签页；扩展界面也只能读取当前所选标签页。注入仅使用随包提供的隔离内容脚本，不执行网页传来的任意字符串。

`request` 支持 `AbortSignal`。超时、取消或断开会停止本地等待并取消页面读取，但不能撤销已经发生的浏览器或存储副作用。命令不会自动重放；`workspace.set` 结果不确定时应重新查询当前值。本版没有通用持久写任务接口，也不承诺恰好执行一次。

## 恢复与流量限制

通信消息有版本号和运行时校验，不能只依赖 TypeScript 类型。请求 ID 与截止时间均有界，每次路由器启动产生新的 epoch。订阅提供带修订号的快照，不保证补发断线期间每一个事件；重复响应与事件会忽略，收到的事件不会回传。

Service Worker 同步注册监听器，可正常终止并从会话存储恢复文档授权。有活跃订阅的客户端最多进行五次指数退避并带抖动的重连，不轮询或保活，之后仍可由手动请求重新连接。内容脚本断开后，在显式、已授权的读取时重新引导。浏览器可信的 `pagehide` 暂停 Port，进入往返缓存的文档保留引导钩子，并在可信且 `persisted` 的 `pageshow` 时恢复；网站伪造的生命周期事件不能触发这些操作。关闭弹出页属于正常释放。

| 限制               | 数值                                                    |
| ------------------ | ------------------------------------------------------- |
| JSON 消息          | 32KiB，深度 12，最多 4,096 个节点                       |
| 客户端等待         | 32 个请求，包含等待协商的调用；16 个连接观察者          |
| 路由并发           | 每连接 8 个进行中请求；总共 64 个连接、每身份 4 个      |
| 批准与授权         | 20 个待批准请求、64 条已存授权                          |
| 连接及文档身份预算 | 突发 30 条，每秒补充 5 条；同文档多个 Port 共享文档预算 |
| 全局预算           | 突发 120 条，每秒补充 100 条                            |
| 事件合并           | 100ms；每连接最多一个进行中的快照，待更新主题集合有界   |

洪泛会关闭违规连接，无订阅时不发送快照。导航持久化也会合并处理，身份不明或格式错误的权限声明被拒绝。上述逻辑限制不是进程内存硬上限，也不能保证抵御已被攻陷的浏览器。未来的大数据通道必须保留相同的授权、文档绑定和背压，P2P 网状连接不会改善默认控制链路。

## 种子、维护与验证

`packages/extension-sdk` 无外部依赖。网站和扩展通过 `workspace:*` 引用它，reinit 恢复该依赖及 Next.js 转译设置。源码树、manifest、侧边栏 HTML 和共享包由现有保留流程维护。种子显式同步，新实例不复制现有业务应用；维护命令不会自动扩大来源白名单。

`scripts/tests/extension-sdk.test.mts` 覆盖协议攻击、来源/frame/document 身份、批准与撤销、状态重建、文档路由、重复响应、截止时间、断开清理、突发消息和慢消费者。生产 manifest 检查覆盖外部入口策略、内容脚本资源与侧边栏 HTML。真实 Chromium 另外验证网站到 worker、内容脚本再返回网站的完整链路，界面订阅、撤销、导航和 worker 终止恢复。模拟 Port 或可信生命周期回调不能替代真实浏览器验收，以及 Chrome / Edge 人工检查。

执行验证时留足主机资源，按需使用[资源保护](testing.md)。实现、单元测试和真实浏览器验收分别记录，未执行不能表述为通过。[部署与交付](deployment.md)。

Chrome 官方参考：[消息通信](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)、[worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)、[外部连接](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)、[脚本注入](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[侧边栏](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)。
