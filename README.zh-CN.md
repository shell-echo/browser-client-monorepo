# Browser Client

[English](README.md) · **简体中文**

[![CI](https://github.com/shell-echo/browser-client-monorepo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/shell-echo/browser-client-monorepo/actions/workflows/ci.yml)
[![MIT 许可证](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向 **Next.js 网站、React 管理后台和 Chrome / Edge Manifest V3 扩展**的 TypeScript 单仓库起始项目。多个客户端共享 shadcn/ui 组件、带授权控制的扩展通信 SDK，以及可恢复的官方框架模板更新流程。

[快速开始](#快速开始) · [界面预览](#界面预览) · [扩展通信-sdk](#扩展通信-sdk) · [应用组合](#应用组合) · [框架更新](#框架更新) · [文档](#文档)

## 适合哪些需求

- 在同一个 pnpm / Turborepo 工作区开发网站、管理后台和浏览器扩展，统一界面与工程配置。
- 让网站通过 Chrome 原生 Port 连接已安装的扩展，由用户批准当前页面，再由 Service Worker 校验权限和路由请求。
- 保留业务代码，同时更新框架基础；按需保留一种客户端，或从独立种子创建多个同类型应用实例。

选择你需要的客户端即可。身份认证、业务接口、生产托管和扩展商店发布需要在业务项目中接入。

## 已包含的能力

- **三类应用**：响应式网站、管理后台登录页与仪表盘、MV3 扩展弹出页与设置页。
- **共享界面**：shadcn **b0** 预设、Base UI、本地打包的 Inter 字体、Lucide 图标，以及亮色、暗色和跟随系统主题。产品界面文案为英文。
- **共享工具**：pnpm 工作区与 catalogs、Turborepo、TypeScript 预设、ESLint 10、Oxlint、Prettier 和 VS Code 设置。
- **扩展通信**：不依赖外部包的统一 SDK，连接网站、弹出页、设置页和侧边栏，提供按文档授权、网站只读能力、订阅和有限重连。
- **框架更新**：从官方 Next.js / Vite 模板重建基础配置，求解兼容依赖，保留源码并生成可恢复备份。
- **验证与交付**：生产构建、浏览器交互、响应式布局、扩展热更新与 CSP 检查、无障碍扫描、可选资源保护、按实例生成 ZIP 和部署指南。

## 界面预览

### 网站首页

[![暗色网站首页，包含响应式导航和主题切换](docs/images/web-dark.png)](docs/images/web-dark.png)

### 管理后台

| 登录页                                                                            | 仪表盘                                                                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [![管理后台暗色登录页](docs/images/admin-login.png)](docs/images/admin-login.png) | [![管理后台暗色仪表盘](docs/images/admin-dashboard.png)](docs/images/admin-dashboard.png) |

### 扩展

| 工作区弹出页                                                                                    | 设置页                                                                                  |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [![扩展工作区弹出页](docs/images/extension-workspace.png)](docs/images/extension-workspace.png) | [![扩展设置页](docs/images/extension-settings.png)](docs/images/extension-settings.png) |

截图统一使用暗色主题。[完整图库与移动端布局](docs/zh-CN/previews.md)包含截图来源和尺寸说明。

## 快速开始

使用 **Node.js 24 LTS** 和 **pnpm 11.25.0**，版本以[运行时配置](.tool-versions)和[根包配置](package.json)为准。已安装 mise 时，可执行 `mise install` 准备 Node。

```sh
git clone https://github.com/shell-echo/browser-client-monorepo.git
cd browser-client-monorepo
pnpm install --frozen-lockfile
pnpm dev
```

网站位于 **http://127.0.0.1:3000**，管理后台位于 **http://127.0.0.1:5173**。使用扩展时，在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，加载 **`apps/extension/dist-dev`**。

只想在普通网页预览扩展界面时，先停止扩展开发服务，再执行 `pnpm preview:extension`。访问 **http://127.0.0.1:5174** 查看弹出页，访问 **http://127.0.0.1:5174/options.html** 查看设置页。预览偏好与已安装扩展的偏好分开存储。

## 应用

| 应用                   | 单独启动                 | 默认地址或产物                                  | 页面                                              |
| ---------------------- | ------------------------ | ----------------------------------------------- | ------------------------------------------------- |
| [网站](apps/web)       | `pnpm dev:web`           | `http://127.0.0.1:3000`                         | 首页、响应式导航、功能卡片、`/extension` 连接示例 |
| [管理后台](apps/admin) | `pnpm dev:admin`         | `http://127.0.0.1:5173`                         | 概览、`/login`、`/dashboard`、未找到与路由恢复页  |
| [扩展](apps/extension) | `pnpm dev:extension`     | 加载 `apps/extension/dist-dev`；开发端口 `5174` | 工作区弹出页、设置页、侧边栏、后台 Service Worker |
| 扩展网页预览           | `pnpm preview:extension` | `http://127.0.0.1:5174`                         | 普通浏览器中的弹出页与设置页                      |

`pnpm dev` 启动当前注册的全部应用。扩展开发与网页预览共用 `5174`，同一时间只运行一个。开发服务均绑定本机回环地址。

管理后台基于 shadcn 官方 [login-05](https://ui.shadcn.com/blocks/login#login-05) 和 [sidebar-08](https://ui.shadcn.com/blocks/sidebar#sidebar-08) 区块。登录操作是界面示例，尚未接入认证、受保护路由、后端或真实数据。生产托管需为 `/dashboard` 等地址配置单页应用回退。

扩展在本地存储工作区偏好，并同步弹出页与设置页，处理读写失败。生产产物位于 **`apps/extension/dist`**。通信使用 `storage`、`activeTab`、`scripting`、`sidePanel`，保留严格 CSP、明确的网站白名单和隔离内容脚本。

## 扩展通信 SDK

`@browser-client/extension-sdk` 通过 Chrome 原生 Port 连接网站、弹出页、设置页和侧边栏。扩展 Service Worker 校验发送方身份、路由请求，并将授权绑定到精确来源、标签页和文档；隔离内容脚本负责已批准的页面读取。

加载扩展后，打开网站的 `/extension`，输入扩展 ID 并请求访问，再到扩展 **Connections** 界面批准当前页面。网站示例可以读取工作区名称，并主动请求自身选中的文本。导航或撤销授权会终止该授权。

生产站点和自定义端口必须显式加入白名单并重新构建扩展。网站仅获得只读能力；本版不提供任意脚本执行、网络代理、截图或下载。[完整接入、权限、恢复与流量限制](docs/zh-CN/extension-communication.md)。

## 应用组合

可以只保留管理后台、增加多个网站或后台实例，也可以继续使用默认三端。实例名称和模板类型相互独立。[实例注册表、生命周期与恢复](docs/zh-CN/applications.md)。

```sh
pnpm app list
pnpm app add portal --type web --port 3001        # 仅预览
pnpm app add portal --type web --port 3001 --apply
pnpm app dev portal
pnpm app remove extension                        # 仅预览
```

## 框架更新

`reinit` 从官方模板更新指定应用的框架基础，同时保留业务代码和共享设计系统。

```sh
pnpm reinit                      # 仅预览；不联网、不写文件
pnpm reinit web --dry-run         # 预览单个应用
pnpm reinit --apply               # 重建所有应用并更新托管依赖
pnpm reinit admin --apply         # 重建管理后台，验证全部应用
pnpm reinit --apply --offline     # 重放已有记录与缓存版本
```

| 保留                                                         | 重建或更新                               |
| ------------------------------------------------------------ | ---------------------------------------- |
| 业务源码、静态资源、环境文件、HTML 入口、扩展 manifest       | 官方框架基础、应用框架配置和标准脚本     |
| 共享 shadcn/ui、b0 预设、Inter、主题组件、编辑器设置与根文档 | 托管依赖清单、catalogs、锁文件和版本收据 |

在线更新要求所选应用使用最新稳定版 Next.js / Vite / CRXJS，共享依赖则选择最高兼容稳定版本。**ESLint 不得低于 10**，离线重放也遵守此要求。离线模式使用已有记录和缓存，不查询当前最新版本。

执行 `--apply` 前停止开发与构建服务，并暂停编辑。替换前会验证严格 peer 兼容、构建和全部注册实例的浏览器断言。失败时保留或恢复原项目；无法确认进程退出时保留锁与恢复现场，不能直接删除锁。

[流程与依赖策略](docs/zh-CN/reinit.md) · [失败恢复与备份](docs/zh-CN/reinit.md#失败恢复与备份) · [清理与保留](docs/zh-CN/reinit.md#清理旧的成功工作区)

## 工作区结构

```text
apps/
  web/                  Next.js App Router 网站
  admin/                Vite + React + React Router 管理后台
  extension/            Vite + React + CRXJS / Manifest V3 扩展
packages/
  ui/                   共享组件、本地字体与主题
  extension-sdk/        运行时协议校验、客户端和授权路由
  typescript-config/    TypeScript 预设
  eslint-config/        共享 ESLint 规则
  oxlint-config/        共享 Oxlint 规则
scripts/                实例管理、模板更新、依赖策略与验证
docs/                   英文指南、截图和 zh-CN 中文指南
browser-tests.config.mts  按实例覆盖的浏览器断言与热更新钩子
template-versions.json    生成器版本与依赖收据
```

## 开发命令

所有命令从仓库根目录运行。唯一的 `pnpm-lock.yaml` 与工作区 catalogs 统一共享依赖。

| 命令                                | 用途                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| `pnpm ui:add dialog`                | 向共享界面包添加 shadcn 组件                           |
| `pnpm format` / `pnpm format:check` | 格式化或检查源码与文档                                 |
| `pnpm lint` / `pnpm typecheck`      | 检查工作区                                             |
| `pnpm typecheck:scripts`            | 严格检查工程脚本、回归测试与浏览器断言                 |
| `pnpm check`                        | 格式、兼容性、单元测试、lint、类型、构建和扩展产物检查 |
| `pnpm test:browser`                 | 串行验收所有注册实例，并严格核对覆盖范围               |
| `pnpm test:web-admin`               | 网站和管理后台的生产浏览器验收                         |
| `pnpm test:extension`               | 真实扩展加载、设置、主题、热更新、生产构建与网页预览   |
| `pnpm verify:low --guard check`     | 等待 CPU / 内存余量，并监测本轮拥有的验证进程          |
| `pnpm test:accessibility`           | 用正常与故意违规页面验证真实无障碍引擎                 |
| `pnpm extension:package <id>`       | 校验已构建扩展，生成私有生产 ZIP 与收据                |
| `pnpm test:reinit`                  | 在隔离副本中执行较慢的真实在线、离线更新验收           |
| `pnpm audit:security`               | 审计锁定依赖并验证本地安全补丁                         |

首次浏览器验收前执行 `pnpm exec playwright install chromium`，Linux CI 还会安装系统依赖。`pnpm check` 本身不启动浏览器。[测试准备、覆盖和报告](docs/zh-CN/testing.md)。

## 文档

| 指南                                              | 内容                                             |
| ------------------------------------------------- | ------------------------------------------------ |
| [开发](docs/zh-CN/development.md)                 | 模板、共享配置、组件、主题、编辑器与扩展开发     |
| [应用生命周期](docs/zh-CN/applications.md)        | 注册表、身份、添加、移除、恢复与组合             |
| [扩展通信](docs/zh-CN/extension-communication.md) | SDK、精确来源白名单、页面批准、路由、恢复与限额  |
| [框架更新](docs/zh-CN/reinit.md)                  | 保留契约、兼容依赖、离线模式、超时、恢复与清理   |
| [测试与 CI](docs/zh-CN/testing.md)                | 浏览器断言、回归测试、真实更新验收、报告和工作流 |
| [部署与交付](docs/zh-CN/deployment.md)            | 网站托管、后台路由、环境输入和按实例扩展 ZIP     |
| [依赖安全](docs/zh-CN/security.md)                | 审计、安全补丁与定时检查                         |
| [截图库](docs/zh-CN/previews.md)                  | 暗色与移动端预览、截图来源                       |

每份指南都有[英文版本](docs/README.md)。单页正文统一使用一种语言；命令或行为变化时同步更新两种版本。产品界面标签、代码标识符和命令保留原拼写。

## 参与贡献

业务功能放在对应应用，共享组件放在 `packages/ui`。替换起始页面时同步更新实例浏览器断言；需要跨框架重建保留的配置写入 reinit 集成适配器。提交变更前执行 `pnpm check` 与受影响的浏览器验收，行为或界面变化时更新两种语言的指南及必要截图。

## 许可证

[MIT](LICENSE)。
