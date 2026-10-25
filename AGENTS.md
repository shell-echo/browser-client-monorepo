# 仓库开发约定

本项目使用 pnpm workspace 和 Turborepo，提供 Web、Admin、Extension 三种 TypeScript 模板，可保留任意组合、同类型多个实例或空组合。默认使用中文沟通，界面文案使用英文。操作说明见根目录 `README.md`；工具版本、可用命令及依赖策略以实际配置为准，修改它们时同步相关文档。

## 目录与入口

- `apps.config.json`：实例注册表，声明实例 ID、模板类型和开发端口；`schemas/apps.schema.json` 提供校验。不要用固定目录名判断应用类型。
- `apps/<id>`：每个实例拥有独立目录、`@browser-client/<id>` 包名及 `app-identity.json`；目录和记录必须与注册表、`template-versions.json` 一致。默认实例名为 `web`、`admin`、`extension`。
- Web 实例：Next.js App Router；路由在 `src/app/`，静态资源在 `public/`。
- Admin 实例：Vite + React；源码在 `src/`，静态资源在 `public/`。
- Extension 实例：Vite + React + CRXJS，面向 Chrome / Edge Manifest V3。`manifest.config.ts` 是唯一 manifest 源码；`index.html` / `src/main.tsx` 为 popup，`options.html` 也加载同一 React 入口，后台为 `src/background.ts`。
- `templates/<type>`：独立的新实例种子，包含业务起始页、静态资源及实例测试。新增实例不复制现有业务应用。实例机制详见 `docs/applications.md`。
- `packages/ui`：共享 shadcn/ui（Base UI / base-nova）、工具函数及 Tailwind CSS v4 主题；组件在 `src/components/`，主题在 `src/styles/globals.css`。
- `packages/typescript-config`：基础、React、Next.js、Vite 页面及构建配置、Node 工程脚本的 TypeScript 预设。
- `packages/eslint-config`：共享 ESLint 基础和 Node 脚本预设。
- `packages/oxlint-config`：共享 React / Fast Refresh 规则。
- `scripts/`：实例管理、模板重建、恢复、备份清理和浏览器验收；入口及公共实现使用 `.mts`，公共实现位于 `scripts/lib/`，共享 Node 测试位于 `scripts/tests/*.test.mts`。应用专属测试位于实例的 `tests/*.test.mts`；浏览器断言和 HMR 钩子位于实例的 `browser-tests.config.mts`，根级同名文件按实例 ID 提供覆盖。
- 根工程配置：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`turbo.json`、`eslint.config.mjs`、`template-versions.json`；CI 位于 `.github/workflows/ci.yml`。

## 工具与常用命令

使用 Node.js 24 LTS 和 `package.json#packageManager` 指定的 pnpm（当前 11.25.0）。`.node-version` 约定 Node 24，`.tool-versions` 固定 mise / asdf 的项目版本。所有命令从仓库根目录运行。

```sh
pnpm install --frozen-lockfile
pnpm app list               # 查看当前注册实例
pnpm app doctor             # 校验注册表、目录和身份
pnpm dev                    # 启动当前组合中的应用
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
pnpm test:browser           # 串行验收所有注册实例
pnpm verify:low check       # 本机低优先级、低并发完整检查
pnpm ui:add dialog          # 示例：将基础组件添加到共享 UI
```

默认开发别名依赖对应默认实例名，删除实例后不再适用。自定义实例使用 `pnpm app dev <id>`、`pnpm app build <id>`；Web 生产服务使用 `pnpm app start <web-id>`，Vite 构建产物预览使用 `pnpm app preview <id>`，Extension 独立网页预览使用 `pnpm app preview-ui <id>`。开发端口以注册表为准，临时覆盖使用 `APP_INSTANCE_ID=<id> APP_DEV_PORT=3202 pnpm app dev <id>`；旧 `EXTENSION_DEV_PORT` 仅适用于恰好一个 Extension 的组合。扩展开发和网页预览共用该实例端口，不能同时占用，端口冲突会失败。

新增、移除、恢复使用 `pnpm app add <id> --type <type> --port <port>`、`pnpm app remove <id>`、`pnpm app restore <archive-id>`，默认只读预览，明确应用变更时才加 `--apply`。不要直接删除目录或注册项代替生命周期命令。

## 共享配置与代码风格

- 共享组件通过 `@browser-client/ui/components/*` 导入；交互组件声明 `"use client"`，兼容 Next.js Server Components。公共组件和主题在 UI 包维护，应用专属代码放在对应应用。
- 主题存储和侧栏 cookie 按实例身份隔离；共享 UI 通过应用壳传入的公开命名空间工作，不把仓库配置导入客户端包。新增实例不继承旧实例偏好，迁移逻辑仅适用于已标记的旧实例。
- 公共配置通过 `workspace:*` 接入。Web 使用共享 ESLint 基础及官方 Next.js 规则；Admin、Extension 和 UI 使用 Oxlint；根脚本使用共享 ESLint Node 预设。
- TypeScript 公共选项在共享预设维护；`paths`、环境 `types`、`include/exclude`、project references 和构建缓存路径保留在使用方，保证相对路径正确解析。
- 公共依赖在 `pnpm-workspace.yaml` 的 `catalog` 维护；Next.js / Vite 的 TypeScript 与 Node 类型分别使用 `catalog:next` / `catalog:vite`，根工程脚本使用独立的 `catalog:tooling`。框架、插件及 CRXJS 在应用声明版本。使用唯一根锁文件，依赖修改后同步锁文件。
- Admin 和共享 UI 的 `lucide-react` 统一使用 catalog；Admin 内置 `react-router` 按 `scripts/lib/updates.mts` 中的 `^8.0.0` 集成范围参与所有联网 reinit 的兼容升级。其他应用专属依赖默认保留锁定版本，新增托管范围须验证真实调用。
- Git 忽略规则仅在仓库 / 工作区边界排除构建目录和缓存，业务路径中的同名目录保持可提交；应用规则通过 `scripts/lib/gitignore.mts` 在 reinit 时重新适配。真实 `.env*` 保持私有，允许提交脱敏的 `.env.example` / `.env.*.example`。
- 使用 `.tsx` 编写 React 组件、`.ts` 编写应用工具；Node 工程脚本、回归测试和浏览器验收配置使用 `.mts`。Node.js 24 原生擦除类型后执行，无需额外编译或 loader；相对导入保留显式扩展名，类型使用 `import type`。不要使用枚举、参数属性或依赖 TypeScript 路径别名的运行时导入。ESLint 配置保留 JavaScript。遵循所在文件及官方模板的现有格式，采用两空格缩进，避免无关的全仓格式改写。
- 工程脚本使用共享 `@browser-client/typescript-config/node.json`；`scripts/tsconfig.json` 对脚本、测试及 `browser-tests.config.mts` 执行严格、无产物的类型检查。直接运行 `.mts` 不会进行类型检查；保留外部输入、依赖记录、路径及恢复状态的运行时校验和有效测试断言。
- Next.js 自动生成的实例 `AGENTS.md` 是受版本管理的开发文档，保留官方托管块及已有自定义说明。Next.js 模板生成阶段使用 `--no-agents-md` / `--no-agent-feedback`，既有实例说明在 reinit 时保留；`next dev` 检测到 AI 代理后仍可能生成或更新官方说明，应核对实际差异后提交。Prettier 忽略这些文件，以保护说明内容。
- 应用 `.env*` 已纳入构建缓存输入。环境文件放在对应应用目录；新增影响构建的服务端变量时，将变量名加入 `turbo.json` 的 `build.env` 并记录用途。实际环境值和 `.reinit/` 私有现场不提交 Git；可提交脱敏的环境示例。

## 验证要求

- 文档修改：核对引用路径、包名、版本和命令与实际配置一致，并执行 `git diff --check`。
- 代码、依赖或公共配置修改：执行 `pnpm check`。它依次检查实例一致性、格式、CRXJS / Vite 兼容性、Node 测试、lint、类型、当前组合的应用构建及生产扩展产物。
- `pnpm typecheck:scripts` 独立检查工程代码；`pnpm typecheck` 和 `pnpm check` 均包含此检查，CI 及 reinit 的候选、最终位置验收也会执行。
- 扩展、共享 UI 或 Vite / CRXJS 相关修改：额外执行对应浏览器验收；`pnpm test:browser` 覆盖所有注册实例，`pnpm test:extension` 覆盖所有 Extension，指定实例时追加实例 ID。共享 Hook 修改需覆盖实际使用方。首次需要 `pnpm exec playwright install chromium`；Linux CI 使用 `pnpm exec playwright install --with-deps chromium`。
- 浏览器验收在 `.reinit/verification/` 的副本和隔离 profile 中运行，覆盖后台初始化、popup / options、storage、页面及共享 UI / 样式热更新、React 状态保留和独立生产加载。报告与日志保留；`pnpm check` 本身不启动浏览器。
- 自动浏览器验收使用 Playwright Chromium；Chrome / Edge 扩展管理界面及商店发布仍需在对应浏览器中验收。Extension 的生产产物位于该实例的 `dist`，开发产物位于 `dist-dev`。浏览器覆盖必须与注册实例一致，不允许缺失、重复、跳过或混用旧源码报告；空组合明确报告不适用。
- 保留测试对数据迁移、失败恢复及进程退出的有效断言；区分实际通过、未执行与受阻，不通过跳过检查或弱化断言隐藏问题。
- CI 对 push / pull request 执行冻结安装、`pnpm check`、安全审计和按注册表执行的完整浏览器验收，手动触发也执行。`Reinit acceptance` 手动工作流可选 `reinit` 或 `compositions`，分别对应 `pnpm test:reinit` / `pnpm test:apps`；这些是真实、耗时的隔离验收，按修改影响选择，不因文档或无关局部修改默认重跑。CI 不包含发布步骤。
- 本机负载高时使用 `pnpm verify:low <task>`，保持重型任务串行；按源码、依赖和验证范围复用仍有效的证据，保留报告，不弱化断言或把中断前的局部结果当成整套通过。
- 每周安全审计通过 `.github/workflows/security-audit.yml` 在默认分支运行冻结安装及 `pnpm audit:security`；Dependabot 仅维护 GitHub Actions 依赖，npm 版本继续使用本项目的兼容升级策略。

## reinit 与备份

- `pnpm reinit` / `pnpm reinit extension --dry-run` 默认只显示计划。实际重建使用 `--apply`；只在任务明确涉及框架重建时执行，先停止相关开发 / 构建进程并暂停编辑。
- 按注册实例 ID 选择重建目标，默认重建全部注册实例。使用官方 `create-next-app@latest` / `create-vite@latest`，在隔离目录生成、接入共享配置并检查，再备份和替换；最终检查失败时恢复。`--offline` 使用 `template-versions.json` 已记录且缓存的版本，不代表获取最新版本。
- 当前业务源码、`public/`、环境文件、manifest、共享包、实例测试、浏览器配置、既有 `AGENTS.md` 和根文档保留。应用的框架配置及标准脚本会重建；需要跨 reinit 保留的框架定制写入 `scripts/lib/integrate.mts` / `scripts/lib/tooling.mts`，不能只改应用生成配置。
- add / remove / restore / reinit 共用 `scripts/lib/maintenance.mts` 的锁、候选检查和恢复链路。新模板维护 `templates/<type>`；既有业务源码由保留逻辑迁移。不要依赖默认实例存在，也不要使用现有业务实例作为新增原型。移除归档保留在 `.reinit/archives/`，不参与普通备份清理。
- catalog 允许的完整范围必须满足模板要求。联网 reinit 强制使用最新稳定版 Next.js / Vite / CRXJS；共享及内置托管依赖选择最高兼容稳定版。离线仅重放已记录和缓存的版本。ESLint 最低版本为 10；不兼容时停止替换并保留原项目，先调整并验证依赖策略或适配逻辑。
- `pnpm reinit:clean` 默认预览；`--apply` 才清理满足保留策略的旧成功现场。失败 / 未知记录受到保护，浏览器报告和日志保留。
- 出现维护锁或恢复异常时，先检查 `.reinit/lock/owner.json`、相关进程及备份 `journal.json`，保留现场；不要直接删除锁、备份或用户未提交文件。恢复使用 `pnpm app recover <operation-id> --apply`；若依赖或根包文件处于替换间隙，使用仅依赖 Node 内置模块的 `node scripts/app.mts recover <operation-id> --apply`。进程归属无法确认、子进程仍运行或文件存在冲突时必须保留锁。恢复说明见根 README。

## 提交与交付

遵循当前任务的写入、提交和发布授权，保留用户已有工作。提交信息使用简短、小写的祈使句，例如 `update repository guidelines`。PR 或交付说明写明具体变化、影响范围、验证结果和实际限制；界面改动按需附截图。不要擅自暂存无关文件、改写历史或清理现场。
