# 浏览器 Agent 演示

[English](../demo.md) · [浏览器 Agent 能力层](browser-agent.md) · [扩展通信](extension-communication.md)

[观看真实扩展演示](../browser-agent-demo.mp4) · 81.0 秒 · 1440×900 · MP4

视频由当前 Codex Agent 读取隔离后台 Chrome 中生产 MV3 扩展实际返回的截图，选出 Ready 且零失败的发布候选，输入发布说明、保存本地草稿、滚动到 Activity，再读取新截图确认结果。目标页面的每个动作都通过公共 SDK 执行。视频也展示扩展真实安装、精确文档授权和撤权界面。

业务网页和只读 Agent 控制台是两个独立页面。控制台显示所选工具、可观察的决策说明、实际返回图片和工具回执。开场解释可复用模板、独立能力契约和 Chrome SDK 的关系，并展示最小接入代码。撤销真实文档授权后，访问事件触发控制台清图，下一次观察返回 `NOT_AUTHORIZED`。

网站使用虚构数据，只保存本地草稿。录制采用一次性 profile，仅捕获浏览器视口，不包含个人桌面、已有标签页、收藏夹、账号或浏览历史。剪辑将同时录制的业务页与控制台并排展示，缩短准备阶段停留，去掉 Agent 选择下一步时的等待，保留操作原速。发布片中的 Chrome 安装场景保留隔离录制中真实扩展卡片的英文产品名称和描述，同时裁掉本机语言环境下的中文 Chrome 外壳与控制项，再用英文标签重排，以保持产品展示语言统一。这是后期裁剪和排版，不表示改变了测试机器的 Chrome 语言。首次和最终 SDK 截图会短暂切换到右侧独立的放大视口面板；这是实际返回图片的后期放大，不遮挡左侧业务页或工具结果。控制台非关键页脚和录制 padding 被裁去；右下独立的 **RECORDING NOTE** 区域是画面外的后期说明，不是工具返回。授权片段保留真实扩展界面，不伪造浏览器画面或工具结果。

本次由 Codex 逐张看图，再向私有录制协调器写入下一条决策，没有模拟 OpenAI API 响应，也没有运行托管 MCP 服务。接入方提供自己的模型，使用相同的“截图 → 动作 → 截图”契约。主片展示这条核心链路和撤权，不覆盖全部工具，也不能替代浏览器及安全验收。

## 接入自己的 Agent

```ts
import { createClient, chromeTransport, type PageObservation } from "@browser-client/extension-sdk"
import { invokeBrowserAgentTool, type BrowserAgentRequest } from "@browser-client/browser-agent/tools"

const client = createClient({ connect: chromeTransport(extensionId) })
await client.connect()
await client.request("access.request", {
  capabilities: ["page.observe", "page.click", "page.type", "page.scroll"],
})
// 用户在扩展 Connections 界面批准这个精确文档。
const request: BrowserAgentRequest = (method, params, options) => client.request(method, params, options)
const frame = (await invokeBrowserAgentTool(request, "browser_page_observe", {
  includeScreenshot: true,
})) as PageObservation
// 将 frame.screenshot 交给模型，再执行它选择的有界动作。
// 再次观察确认可见结果，结束后关闭 client。
```

共享工具定义还提供 MCP、OpenAI function calling 和 LangChain 适配器，不会把这些框架打包进扩展运行时。类型接口、截图抑制、确认要求和坐标换算见[接入契约](browser-agent.md)。

## 运行交互演示页

```sh
pnpm install --frozen-lockfile
pnpm dev
```

1. 在 Chrome 打开 `http://127.0.0.1:3000/extension`。
2. 在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/dist-dev`。
3. 从扩展 Connections 页面复制扩展 ID，填入页面并请求授权。
4. 在 Connections 中批准精确页面。Chrome 截图需要 `activeTab` 权限时，在目标标签页激活扩展工具栏按钮。
5. 点击 **Observe real viewport**，在返回的图片上选取坐标，调用点击、输入或滚动，然后再次观察确认结果。
6. 撤销授权或导航离开，结束文档级授权。

截图受抑制时，页面会如实显示原因；动作被接受后，仍须再次观察确认可见结果。这些是有界的页面操作，不提供任意 JavaScript 执行、操作系统输入或无限制的浏览器控制。

## 复现录制

`scripts/record-browser-agent-demo.mts` 提供轻量的虚构网页和真实 SDK 源码，使用生产扩展启动一次性后台浏览器，不启动 Next.js、Vite 开发服务，也不使用已有浏览器资料目录。

录制页面直接读取 `packages/ui/src/styles/globals.css` 中的网页深色主题，并加载同一份内置 Inter 字体。卡片、按钮、输入框和控制台使用共享的中性色变量，不另设演示配色。

默认注册 Extension 实例可以只构建一次，输出到新的私有录制目录：

```sh
record_dir="$PWD/.reinit/verification/agent-demo-$(date +%s)"
mkdir -p "$record_dir"
pnpm exec playwright install chromium --no-shell
pnpm --filter @browser-client/extension exec vite build --outDir "$record_dir/extension"
node scripts/record-browser-agent-demo.mts "$record_dir"
```

注册表不同时，使用所选实例的包名。录制器默认使用 Playwright 已安装的 Chromium；也可通过 `BROWSER_CLIENT_DEMO_BROWSER` 指定支持测试专用 `Extensions.loadUnpacked` 和 `Extensions.triggerAction` DevTools 命令的当前 Chrome 可执行文件。这些命令仅用于准备隔离测试浏览器，不是开放给 Agent 的能力。

录制器保存 `frame-001.jpg`、对应尺寸 JSON 和 `ready.json`。Agent 查看这张真实图片后，逐条原子写入 `decisions/001.json`、`002.json` 等文件：

```json
{
  "sourceFrame": "frame-001",
  "tool": "browser_page_click",
  "input": { "x": 360, "y": 720 },
  "decision": "The release-summary field is visible; focus it before typing."
}
```

示例坐标仅说明格式，实际坐标须来自真实图片，并按记录中的视口与编码图片尺寸换算。等待对应 `receipt-N.json` 后再继续。每次点击、输入或滚动之后，下一条必须调用 `browser_page_observe`，传入 `includeScreenshot: true`；查看新返回的 `frame-NNN.jpg` 后才能选择另一个动作。只有新截图确认 Activity 已保存正确内容后，才可用 `sourceFrame`、简短的可观察 `decision` 和 `finish: true` 结束。过期图片、尺寸不匹配、不支持的工具，以及没有最终新截图的完成声明都会被拒绝。

录制结果包含实际 `trace.json`、观察 JPEG、原始视口视频、剪辑片段和 `report.json` 中的断言。文件协调器仅是录制工具，不是生产 Agent 服务。目标页面的点击、输入和滚动只经公共 SDK 执行；Playwright 负责浏览器准备、通过扩展 UI 批准和撤权、录制及独立结果断言。Agent 决策前，录制器先测量实际截图尺寸；后台 Chrome 的内容区尺寸不一致时，只调整私有原生窗口，并保留原始校准图片。所有页面使用相同的 CSS 视口；900/540px 并排布局属于后期剪辑。为便于录制，一条滚动决策最多拆为 35 次有界 SDK 调用，每次调用都写入 trace，完成后统一刷新一次控制台。

录制、编码和其他重型任务应串行、低优先级运行，并遵守机器资源余量。视频仅证明所展示的演示链路，不能替代完整浏览器与安全验收。
