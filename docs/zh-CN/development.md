# 开发指南

[English](../development.md) · [中文文档](README.md) · [项目首页](../../README.zh-CN.md) · [框架更新](reinit.md) · [测试](testing.md) · [依赖安全](security.md)

生产托管、环境输入和扩展 ZIP 见[部署与交付](deployment.md)。所有命令从仓库根目录运行，本文路径相对于该目录。

## 网站模板

首页包含导航、概览、功能卡片、文档入口和页脚。低于 768px 时，桌面导航切换为 shadcn Sheet，支持 Escape、关闭按钮和焦点恢复；页面包含键盘跳过链接，适配 320px 屏幕。颜色与排版来自共享 b0 预设。

`apps/web/src/app/page.tsx` 保持 Next.js 服务端组件，交互导航位于 `apps/web/src/components/site-header.tsx`。按业务需要修改这些文件，文档链接指向仓库 README。登录、账号管理和业务功能需要自行接入。

## 扩展模板

| 入口             | 用途                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| `index.html`     | 360px 弹出页，包含当前工作区、主题菜单、GitHub 图标和 **Open settings** |
| `options.html`   | 响应式设置页，包含工作区名称表单和主题菜单                              |
| `sidepanel.html` | 侧边栏中的连接与授权控制                                                |

页面组件位于 `apps/extension/src/pages/`。`src/lib/settings.ts` 读写已有的 `chrome.storage.local.workspaceName`，设置适配器本身无需新增权限。保存会去掉首尾空格，接受 1–80 个字符。弹出页无需刷新即可跟随存储更新；未保存草稿在外部更新和保存失败时保留。加载失败后，需成功重试才能编辑。**Open settings** 调用 `chrome.runtime.openOptionsPage()`，失败时提供重试。

执行 `pnpm preview:extension`，在普通浏览器通过 `/` 查看弹出页、通过 `/options.html` 查看设置。预览工作区使用独立 localStorage 键，不改变已安装扩展设置；主题仍通过共享 provider 和按来源隔离的 localStorage 管理，预览界面也会说明存储区别。

reinit 保留网站与扩展源码、HTML 入口、manifest、共享界面、字体和自定义浏览器钩子。替换前验证响应式布局、真实设置读写与失败恢复、网页预览、主题和热更新。

## 管理后台模板

后台在 `/` 提供概览，并连接两个可定制的官方 shadcn 区块：

| 路由         | 官方区块                                                      | 行为                                               |
| ------------ | ------------------------------------------------------------- | -------------------------------------------------- |
| `/login`     | [login-05](https://ui.shadcn.com/blocks/login#login-05)       | 邮箱表单、Apple / Google 按钮，窄屏为单列堆叠布局  |
| `/dashboard` | [sidebar-08](https://ui.shadcn.com/blocks/sidebar#sidebar-08) | 可折叠导航、项目与用户菜单、面包屑和业务内容占位区 |

两者使用现有 Base UI / base-nova 风格、英文界面和共享主题。低于 768px 时侧栏变为模态抽屉，支持可见关闭按钮、遮罩、Escape 和焦点恢复；摘要区在移动端堆叠。桌面侧栏支持按钮和 Ctrl / Cmd + B。

这些是界面模板。邮箱、社交登录、注册和政策按钮只提示需要接入，不发送凭据或创建会话；导航和菜单动作是业务占位，**Back to login** 只返回登录模板，不表示真实退出。两个路由均未配置访问控制。

页面与区块源码位于 `apps/admin/src/pages/`、`src/components/`，可复用组件、响应式 hook 和侧栏颜色位于 `packages/ui`。React Router 处理导航、历史、深链接和未找到页面。生产主机需将非资源路径回退到 `index.html`，开发和预览服务已提供回退。

懒加载路由失败时显示带 **Refresh page** 和 **Back to home** 的恢复页。刷新创建新文档以重试失败模块，返回首页重置路由边界并保留主题。恢复由用户主动触发，不自动刷新未保存工作。

reinit 保留这些源码、共享界面、后台路由和图标依赖。浏览器套件覆盖表单、主题、直接刷新、移动抽屉、菜单和 320 / 390 / 768 / 1280px 下的水平溢出。

桌面侧栏偏好由带实例命名空间的 `sidebar_state_<namespace>` cookie 恢复；原始实例可按标记迁移旧 `sidebar_state`。只接受 `true` / `false`，缺失、无效或不可读取时默认展开。写入保留七天、根路径和 `SameSite=Lax`，限制 cookie 不影响当前页面切换。后台客户端布局负责初始化；共享 provider 保留 `defaultOpen` 和受控状态契约，SSR 调用方应传入服务端状态，避免水合差异。

## 共享配置

规则位于 `packages/`，通过 `workspace:*` 开发依赖消费，环境与路径相关选项保留在调用方：

| 使用方         | TypeScript 预设                                    | lint 配置                                                   |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| 网站           | `@browser-client/typescript-config/nextjs.json`    | `@browser-client/eslint-config/base` 和官方 Next.js 规则    |
| 后台与扩展页面 | `@browser-client/typescript-config/vite.json`      | `@browser-client/oxlint-config/react-app.json`              |
| Vite 配置      | `@browser-client/typescript-config/vite-node.json` | 与所属应用相同                                              |
| 共享界面       | `@browser-client/typescript-config/react.json`     | `@browser-client/oxlint-config/react.json`，含 Unicorn 规则 |

`base.json` 提供严格检查、`skipLibCheck` 和 `noEmit`；`vite-common.json` 共享页面与构建配置。`paths`、环境 `types`、`include/exclude`、项目引用、`tsBuildInfoFile` 和 Next.js 插件保留在各使用方，确保相对路径正确。本地设置覆盖共享默认值。

共享 ESLint 提供生成物忽略与无用 disable 检查，不绑定某个 Next.js 版本，网站自行管理官方规则依赖。Oxlint React 预设包含 Hooks，应用预设增加 Fast Refresh；共享界面可同时导出组件和工具。Oxlint JSON 继承使用文件路径，例如 `./node_modules/@browser-client/oxlint-config/...`。

构建忽略只作用于配置根和 `apps/*` / `packages/*` 边界；`src/dist`、`src/coverage`、`scripts/.reinit` 等业务目录仍检查，`node_modules` 按标准排除。

```json
{
  "extends": "@browser-client/typescript-config/vite.json",
  "compilerOptions": {
    "types": ["vite/client", "chrome"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

共享规则变化后执行 `pnpm check`。三种共享配置包均参与 Turbo `globalDependencies`，使相关缓存失效；根脚本使用共享 Node 预设，可单独运行 `pnpm lint:scripts`。

应用 `.env*` 参与缓存输入，真实值不提交 Git。Turbo 识别 `NEXT_PUBLIC_*` / `VITE_*`，未来影响构建的服务端变量加入 `build.env`。`EXTENSION_DEV_PORT` 透传给扩展开发服务。

reinit 重新连接共享预设和包依赖。项目托管 TypeScript 选项与 Oxlint 规则优先于模板，差异会报告；新增上游选项、继承、环境类型和 lint 覆盖继续保留。集成位于 `scripts/lib/tooling.mts`。共享规则改配置包，框架适配改工程脚本，应用生成配置中的直接覆盖会被重建。

## 工程脚本

入口、共享实现、回归测试和 `browser-tests.config.mts` 使用 `.mts`。Node.js 24 直接擦除可擦除的 TypeScript 类型运行，无需编译、loader 或生成 JavaScript。相对导入保留扩展名，类型使用 `import type`，不使用枚举、参数属性或仅 TypeScript 能解析的路径别名。

共享 `@browser-client/typescript-config/node.json` 启用严格检查、NodeNext、`noEmit`、`erasableSyntaxOnly` 和 `verbatimModuleSyntax`。`scripts/tsconfig.json` 检查工程代码、测试与浏览器断言，并为 Playwright 回调提供 DOM / Chrome 类型。根编译器与 Node 类型使用独立的 `catalog:tooling`。

共享 ESLint 编译器 peer 范围为 `>=5.8 <6.1`，与当前 TypeScript ESLint 集成对齐。支持新编译器时同步更新并验证该契约，不能只扩范围。

```sh
pnpm typecheck:scripts  # 检查工程与测试类型，不运行、不输出文件
pnpm lint:scripts      # 共享 Node 与 TypeScript 规则
pnpm test              # 运行原生 .test.mts 回归测试
```

`pnpm typecheck` 先检查脚本，`pnpm check`、CI 和 reinit 候选、最终检查均包含该步骤。直接执行脚本只擦除类型，不证明类型正确。外部数据、文件、路径、注册表响应和恢复状态仍需运行时校验。

ESLint 配置保持 JavaScript，Node 预设检查 `.mts` 中的未使用声明、显式 `any` 等；独立 Node 脚本不能使用浏览器全局，浏览器断言模块则保留 Playwright 上下文。测试中的模板、VM 和子进程字符串继续使用对应行为所需的语言。

## 格式与编辑器

根 Prettier 配置为两空格、双引号、无分号和 128 列，本地安装并锁定版本。Tailwind 插件读取共享 v4 主题，对 JSX、`cn`、`clsx` 和 `cva` 排序，不需要每个工作区重复安装。

```sh
pnpm format          # 格式化源码、配置和文档
pnpm format:check    # 只检查；属于完整检查与 CI
```

命令显式使用 `.prettierignore`，不依赖 Git 忽略规则。排除构建产物、依赖、锁文件、生成版本记录、`public/` 静态资源、私有 `.reinit/`、补丁和 `AGENTS.md`。`.editorconfig` 约定 UTF-8、LF、两空格和文件末换行，保留 Markdown 与补丁的有效空白。

在 VS Code 打开仓库根目录，按 `.vscode/extensions.json` 安装推荐的 Prettier、ESLint、Oxc 和 Tailwind 扩展。保存使用本地格式化与适配的 lint 修复；网站和脚本使用 ESLint，根 Oxlint 配置将它们排除。后台、扩展和界面包使用共享 Oxlint，根版本与应用一致。Oxfmt 和 TypeScript Nightly 被禁用，最终检查使用各工作区锁定的 TypeScript。推荐项不会自动安装或修改个人设置。

在线 reinit 在隔离候选安装后执行严格冻结安装，核对完整锁图并准备离线副本所需供应链元数据，随后格式化重建配置与更新后的根清单，再执行完整检查和浏览器验收。不会格式化重写业务源码、共享组件、manifest、静态资源或编辑器设置。元数据缺失、新规则要求业务修改或配置无法格式化时，停止并保留原项目；复核差异后再重试。新格式依赖需要成功在线重建后才具备完整离线收据。

## shadcn/ui

使用官方 [b0 预设](https://ui.shadcn.com/create?preset=b0)：Nova 风格、Neutral 基础与图表色、Inter、Lucide、默认圆角与菜单颜色、轻微菜单强调，保留 Base UI。各应用 `components.json` 指向共享界面包。

预设来自官方 `shadcn apply --preset b0`。Inter 通过共享包的 `@fontsource-variable/inter` 本地打包，所有客户端无需外部字体请求。执行 `pnpm exec shadcn preset resolve --json --cwd apps/admin` 可核对确实解析为 b0。reinit 保留共享源码，并从 `packages/ui/components.json` 重建应用配置。

```sh
# 从网站解析，组件写入共享界面包
pnpm ui:add dialog

# 页面区块在对应应用内添加
pnpm exec shadcn add login-01 --cwd apps/admin
```

```tsx
import { Button } from "@browser-client/ui/components/button"
```

主题位于 `packages/ui/src/styles/globals.css`，应用用 `@source` 扫描自身，公共样式也扫描共享组件。使用 Hook 或交互的共享组件声明 `"use client"`，保持 Next.js 服务端组件兼容；添加组件后运行完整检查。

## 亮色与暗色主题

网站、后台和弹出页右上角提供 **Toggle theme**，扩展设置页放在外观卡片中。菜单提供 **Light**、**Dark**、**System**，默认跟随系统，并支持键盘、Escape 和焦点恢复。客户端使用共享 `ThemeProvider`、上下文与 `ThemeSwitcher`，网站外层用 `NextThemeProvider` 在水合前应用主题，原生控件跟随 `color-scheme`。

偏好保存于 `localStorage["browser-client-theme:<instanceId>"]`，身份由应用外壳提供，同时受来源和实例隔离。同源标签页及同一扩展的弹出页、设置页同步；其他实例键和 sessionStorage 事件被忽略。`legacy: true` 的原始实例在新键缺失时可迁移有效的旧 `browser-client-theme`，新实例不继承；迁移写失败时仍可读取原值，不删除原数据。

跟随系统模式实时响应操作系统变化，手动选择优先。存储被禁用时仍可使用当前页面；网站在水合前处理无效偏好，共享 provider 在应用跨页事件前规范化无效值，不破坏其他数据。写失败时当前手动主题生效，但刷新后无法持久化；清空偏好后回到跟随系统。

网站在水合前设置主题，并在 `html` 使用 `suppressHydrationWarning` 处理主题属性差异。后台和扩展在 React 前加载外部 `theme-init.js`，保持 MV3 严格 CSP，无需内联脚本或额外权限。源文件为 `packages/ui/src/lib/theme-init.js`。修改后运行 `pnpm theme:sync`，同步全部注册 Vite 实例和后台、扩展种子，即使空组合或只有网站也更新种子。命令先检查所有目标，拒绝自定义资源和符号链接。

reinit 保留布局、入口、HTML、主题引导资源和共享组件。浏览器验证切换、持久化、同源同步、系统变化、首帧与不可用存储，扩展另验真实加载、CSP 和热更新。

## 浏览器扩展

1. 执行 `pnpm dev:extension` 并保持服务运行。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
3. 选择 **Load unpacked**，加载 `apps/extension/dist-dev`。
4. 从扩展图标打开 **Workspace**，用 **Open settings** 打开 **Settings**。也可从扩展管理页的选项入口打开。后台初始化默认工作区，但不覆盖已有名称。

`manifest.config.ts` 通过 CRXJS `defineManifest` 定义唯一 manifest。后台、弹出页、设置、侧边栏和隔离内容脚本入口分别是 `src/background.ts`、`index.html`、`options.html`、`sidepanel.html`、`src/content.ts`。CRXJS 根据 manifest 发现入口并生成资源路径，不在 `public/` 再放一份 manifest。

弹出页和设置页支持 React Fast Refresh，包括共享组件和样式，普通组件编辑可保留 React 状态；后台或 manifest 变化可能重载扩展并重置状态。CRXJS 只向开发输出注入本机连接、权限和 CSP。默认端口 5174，可用 `EXTENSION_DEV_PORT=3202 pnpm dev:extension` 同步覆盖 HTTP 与 WebSocket，不要仅修改 `--port`。

执行 `pnpm --filter @browser-client/extension build` 生成生产 `apps/extension/dist`。生产不依赖开发服务，也不带 HMR 客户端；保留 `storage`、`activeTab`、`scripting`、`sidePanel`、严格 CSP 和明确来源白名单，由路由器再校验按文档授权。改策略前阅读[通信指南](extension-communication.md)。发布使用 `dist`，不能使用 `dist-dev`；生产重建后手动重载扩展。

`pnpm preview:extension` 在普通网页预览界面，不加载 CRXJS 或扩展 API，与开发模式共用端口，二者同时只能运行一个。

## 官方参考

- [Next.js 生成器](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
- [Vite 模板](https://vite.dev/guide/)
- [CRXJS 安装与配置](https://crxjs.dev/guide/installation/from-scratch/)
- [Vite WebSocket 配置](https://vite.dev/config/server-options.html#server-ws)
- [shadcn/ui 单仓库](https://ui.shadcn.com/docs/monorepo)
- [Chrome MV3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [pnpm 11 配置变化](https://pnpm.io/blog/releases/11.0)
- [pnpm catalogs](https://pnpm.io/catalogs)
- [Playwright 扩展验证](https://playwright.dev/docs/chrome-extensions)
- [TypeScript 配置继承](https://www.typescriptlang.org/tsconfig/extends.html)
- [ESLint 共享配置](https://eslint.org/docs/latest/extend/shareable-configs)
- [Oxlint 配置继承](https://oxc.rs/docs/guide/usage/linter/config.html#extend-shared-configs)

## 扩展统一通信

网站、弹出页、设置页、侧边栏和隔离内容脚本使用共享 SDK。先体验网站 `/extension`，再显式配置生产来源或自定义端口。[通信指南](extension-communication.md)说明接入、批准和限额。
