# 仓库开发约定

本项目使用 pnpm workspace 和 Turborepo，包含三个 TypeScript 应用及共享工程配置。默认使用中文沟通。操作说明见根目录 `README.md`；工具版本、可用命令及依赖策略以实际配置为准，修改它们时同步相关文档。

## 目录与入口

- `apps/web`：Next.js App Router；路由在 `src/app/`，静态资源在 `public/`。
- `apps/admin`：Vite + React；源码在 `src/`，静态资源在 `public/`。
- `apps/extension`：Vite + React + CRXJS，面向 Chrome / Edge Manifest V3。`manifest.config.ts` 是唯一 manifest 源码；`index.html` / `src/main.tsx` 为 popup，`options.html` 也加载同一 React 入口，后台为 `src/background.ts`。
- `packages/ui`：共享 shadcn/ui（Base UI / base-nova）、工具函数及 Tailwind CSS v4 主题；组件在 `src/components/`，主题在 `src/styles/globals.css`。
- `packages/typescript-config`：基础、React、Next.js、Vite 页面及构建配置、Node 工程脚本的 TypeScript 预设。
- `packages/eslint-config`：共享 ESLint 基础和 Node 脚本预设。
- `packages/oxlint-config`：共享 React / Fast Refresh 规则。
- `scripts/`：模板重建、备份清理、扩展检查和浏览器验收；入口及公共实现使用 `.mts`，公共实现位于 `scripts/lib/`，Node 测试位于 `scripts/tests/*.test.mts`。应用浏览器断言及 HMR 钩子位于根目录 `browser-tests.config.mts`。
- 根工程配置：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`turbo.json`、`eslint.config.mjs`、`template-versions.json`；CI 位于 `.github/workflows/ci.yml`。

## 工具与常用命令

使用 Node.js 24 LTS 和 `package.json#packageManager` 指定的 pnpm（当前 11.25.0）。`.node-version` 约定 Node 24，`.tool-versions` 固定 mise / asdf 的项目版本。所有命令从仓库根目录运行。

```sh
pnpm install --frozen-lockfile
pnpm dev                    # 同时启动三个应用
pnpm dev:web                # http://127.0.0.1:3000
pnpm dev:admin              # http://127.0.0.1:5173
pnpm dev:extension          # 默认端口 5174，加载 apps/extension/dist-dev
pnpm preview:extension      # 普通网页 UI 预览，默认端口 5174
pnpm build
pnpm lint
pnpm lint:scripts
pnpm typecheck
pnpm typecheck:scripts
pnpm test
pnpm check
pnpm ui:add dialog          # 示例：将基础组件添加到共享 UI
```

按工作区执行时使用实际包名，例如 `pnpm --filter @browser-client/web dev`。扩展开发和网页预览默认共用端口，不能同时占用它。修改扩展端口使用 `EXTENSION_DEV_PORT=3202 pnpm dev:extension`，以同步 HTTP / WebSocket 配置。

## 共享配置与代码风格

- 共享组件通过 `@browser-client/ui/components/*` 导入；交互组件声明 `"use client"`，兼容 Next.js Server Components。公共组件和主题在 UI 包维护，应用专属代码放在对应应用。
- 公共配置通过 `workspace:*` 接入。Web 使用共享 ESLint 基础及官方 Next.js 规则；Admin、Extension 和 UI 使用 Oxlint；根脚本使用共享 ESLint Node 预设。
- TypeScript 公共选项在共享预设维护；`paths`、环境 `types`、`include/exclude`、project references 和构建缓存路径保留在使用方，保证相对路径正确解析。
- 公共依赖在 `pnpm-workspace.yaml` 的 `catalog` 维护；Next.js / Vite 的 TypeScript 与 Node 类型分别使用 `catalog:next` / `catalog:vite`，根工程脚本使用独立的 `catalog:tooling`。框架、插件及 CRXJS 在应用声明版本。使用唯一根锁文件，依赖修改后同步锁文件。
- Admin 和共享 UI 的 `lucide-react` 统一使用 catalog；Admin 内置 `react-router` 按 `scripts/lib/updates.mts` 中的 `^8.0.0` 集成范围参与所有联网 reinit 的兼容升级。其他应用专属依赖默认保留锁定版本，新增托管范围须验证真实调用。
- Git 忽略规则仅在仓库 / 工作区边界排除构建目录和缓存，业务路径中的同名目录保持可提交；应用规则通过 `scripts/lib/gitignore.mts` 在 reinit 时重新适配。真实 `.env*` 保持私有，允许提交脱敏的 `.env.example` / `.env.*.example`。
- 使用 `.tsx` 编写 React 组件、`.ts` 编写应用工具；Node 工程脚本、回归测试和浏览器验收配置使用 `.mts`。Node.js 24 原生擦除类型后执行，无需额外编译或 loader；相对导入保留显式扩展名，类型使用 `import type`。不要使用枚举、参数属性或依赖 TypeScript 路径别名的运行时导入。ESLint 配置保留 JavaScript。遵循所在文件及官方模板的现有格式，采用两空格缩进，避免无关的全仓格式改写。
- 工程脚本使用共享 `@browser-client/typescript-config/node.json`；`scripts/tsconfig.json` 对脚本、测试及 `browser-tests.config.mts` 执行严格、无产物的类型检查。直接运行 `.mts` 不会进行类型检查；保留外部输入、依赖记录、路径及恢复状态的运行时校验和有效测试断言。
- 应用 `.env*` 已纳入构建缓存输入。环境文件放在对应应用目录；新增影响构建的服务端变量时，将变量名加入 `turbo.json` 的 `build.env` 并记录用途。实际环境值和 `.reinit/` 私有现场不提交 Git；可提交脱敏的环境示例。

## 验证要求

- 文档修改：核对引用路径、包名、版本和命令与实际配置一致，并执行 `git diff --check`。
- 代码、依赖或公共配置修改：执行 `pnpm check`。它依次检查 CRXJS / Vite 兼容性、Node 测试、lint、类型、三个应用构建及生产扩展产物。
- `pnpm typecheck:scripts` 独立检查工程代码；`pnpm typecheck` 和 `pnpm check` 均包含此检查，CI 及 reinit 的候选、最终位置验收也会执行。
- 扩展、共享 UI 或 Vite / CRXJS 相关修改：额外执行 `pnpm test:extension`。首次需要 `pnpm exec playwright install chromium`；Linux CI 使用 `pnpm exec playwright install --with-deps chromium`。
- 浏览器验收在 `.reinit/verification/` 的副本和隔离 profile 中运行，覆盖后台初始化、popup / options、storage、页面及共享 UI / 样式热更新、React 状态保留和独立生产加载。报告与日志保留；`pnpm check` 本身不启动浏览器。
- 自动浏览器验收使用 Playwright Chromium；Chrome / Edge 扩展管理界面及商店发布仍需在对应浏览器中验收。生产使用 `apps/extension/dist`，开发使用 `dist-dev`。
- 保留测试对数据迁移、失败恢复及进程退出的有效断言；区分实际通过、未执行与受阻，不通过跳过检查或弱化断言隐藏问题。
- CI 对 push / pull request 执行冻结安装和 `pnpm check`；扩展、共享包、脚本、依赖及 CI 配置变化时追加浏览器验收，手动触发也执行。CI 不包含发布步骤。
- 每周安全审计通过 `.github/workflows/security-audit.yml` 在默认分支运行冻结安装及 `pnpm audit:security`；Dependabot 仅维护 GitHub Actions 依赖，npm 版本继续使用本项目的兼容升级策略。

## reinit 与备份

- `pnpm reinit` / `pnpm reinit extension --dry-run` 默认只显示计划。实际重建使用 `--apply`；只在任务明确涉及框架重建时执行，先停止相关开发 / 构建进程并暂停编辑。
- 默认使用官方 `create-next-app@latest` / `create-vite@latest`，在隔离目录生成、接入共享配置并检查，再备份和替换；最终检查失败时恢复。`--offline` 使用 `template-versions.json` 已记录且缓存的版本，不代表获取最新版本。
- 当前业务源码、`public/`、环境文件、manifest、共享包、`browser-tests.config.mts` 和根文档保留。应用的框架配置及标准脚本会重建；需要跨 reinit 保留的框架定制写入 `scripts/lib/integrate.mts` / `scripts/lib/tooling.mts`，不能只改应用生成配置。
- catalog 允许的完整范围必须满足模板要求。联网 reinit 强制使用最新稳定版 Next.js / Vite / CRXJS；共享及内置托管依赖选择最高兼容稳定版。离线仅重放已记录和缓存的版本。ESLint 最低版本为 10；不兼容时停止替换并保留原项目，先调整并验证依赖策略或适配逻辑。
- `pnpm reinit:clean` 默认预览；`--apply` 才清理满足保留策略的旧成功现场。失败 / 未知记录受到保护，浏览器报告和日志保留。
- 出现维护锁或恢复异常时，先检查 `.reinit/lock/owner.json`、相关进程及备份 `journal.json`，保留现场；不要直接删除锁、备份或用户未提交文件。恢复说明见根 README。

## 提交与交付

遵循当前任务的写入、提交和发布授权，保留用户已有工作。提交信息使用简短、小写的祈使句，例如 `update repository guidelines`。PR 或交付说明写明具体变化、影响范围、验证结果和实际限制；界面改动按需附截图。不要擅自暂存无关文件、改写历史或清理现场。
