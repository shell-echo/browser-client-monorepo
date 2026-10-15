# browser-client

Next.js Web + Vite Admin + Vite / CRXJS Chrome / Edge Extension 的 pnpm monorepo。三个入口共享 `packages/ui` 中的 shadcn/ui 组件和 Tailwind CSS v4 主题。

## 开始

需要 **Node.js 24 LTS** 和 **pnpm 11.25.0**（`packageManager` 固定版本）。`.tool-versions` 为 mise / asdf 固定项目 Node 版本，`.node-version` 提供 Node 24 版本约定。已有 mise 的环境先运行 `mise install`，即可在此目录执行以下命令；也可使用 `mise exec node@24 -- pnpm install`。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

| 入口               | 命令                     | 地址或产物                               |
| ------------------ | ------------------------ | ---------------------------------------- |
| Web                | `pnpm dev:web`           | http://127.0.0.1:3000                    |
| Admin              | `pnpm dev:admin`         | http://127.0.0.1:3001                    |
| Extension          | `pnpm dev:extension`     | 加载 `apps/extension/dist-dev`，支持 HMR |
| Extension 网页预览 | `pnpm preview:extension` | http://127.0.0.1:3002                    |

`pnpm dev` 同时运行前三项。开发服务默认仅监听本机。Web / Admin 是接入真实业务前的最小示例，没有后端、登录或生产数据。Admin 表单只更新当前页面。

## 目录

```text
apps/
  web/          # Next.js App Router + TypeScript
  admin/        # 官方 Vite React TypeScript 模板
  extension/    # 官方 Vite React TypeScript 模板 + CRXJS + Manifest V3
packages/
  ui/           # 共享 shadcn/ui 组件、工具和主题
  typescript-config/ # 基础 / React / Next.js / Vite 的 TypeScript 预设
  eslint-config/     # ESLint 公共配置，与应用的官方规则组合
  oxlint-config/     # React 应用和共享 UI 的 Oxlint 预设
scripts/
  reinit.mjs    # 从官方最新模板重建
  clean-reinit.mjs # 预览和清理旧的成功备份 / 浏览器副本
  lib/          # 模板接入、公共依赖、命令执行、源码迁移与恢复
  tests/        # 数据保留与失败恢复测试
template-versions.json  # 实际脚手架版本与生成时间
```

保留各官方模板的工具选择；当前 Web 使用 ESLint，Vite 应用使用 Oxlint。Turborepo 调度各 workspace 的构建、lint 与类型检查。`pnpm-lock.yaml` 是唯一依赖锁文件。

## 共享工程配置

公共规则在 `packages/` 维护，通过 `workspace:*` 开发依赖接入。各应用只保留环境和路径相关配置：

| 使用方                 | TypeScript 预设                                    | lint 配置                                                       |
| ---------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Web                    | `@browser-client/typescript-config/nextjs.json`    | `@browser-client/eslint-config/base` + 当前 Next.js 官方规则    |
| Admin / Extension 页面 | `@browser-client/typescript-config/vite.json`      | `@browser-client/oxlint-config/react-app.json`                  |
| Vite 配置文件          | `@browser-client/typescript-config/vite-node.json` | 与所在应用共用 lint                                             |
| UI                     | `@browser-client/typescript-config/react.json`     | `@browser-client/oxlint-config/react.json`，并保留 Unicorn 检查 |

`base.json` 统一严格类型检查、`skipLibCheck` 和 `noEmit`；React、Next.js、Vite 预设逐层继承。`vite-common.json` 复用页面与构建配置共同的检查选项。`paths`、`types`、`include/exclude`、project references、`tsBuildInfoFile` 和 Next.js 插件留在使用方，避免相对路径解析到共享包。应用的本地选项优先于共享默认值。

ESLint 公共包统一生成目录忽略和未使用禁用指令的检查，不绑定 Next.js 版本；Next.js 插件和规则依赖继续由 Web 的官方模板管理。Oxlint 的 React 预设统一 Hooks 规则，应用预设增加 Fast Refresh 导出检查；共享 UI 可同时导出组件与工具函数。当前 Oxlint JSON 的 `extends` 使用文件路径，因此消费方通过 `./node_modules/@browser-client/oxlint-config/...` 引用 workspace 包。

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

修改公共规则后执行 `pnpm check`。三个配置包都纳入 Turbo 的 `globalDependencies`，配置修改会使相关检查及构建缓存失效。根目录脚本和 ESLint 配置由同一个共享包的 `node` 预设检查，`pnpm lint:scripts` 可单独执行。

各应用的 `.env*` 纳入构建缓存输入，修改后会重新构建；环境文件放在相应应用目录，实际值不提交 Git。Turbo 会自动识别 `NEXT_PUBLIC_*` / `VITE_*`；以后新增影响构建的服务端环境变量时，还需将变量名加入 `build.env`。`EXTENSION_DEV_PORT` 会透传给 `pnpm dev` 中的扩展开发服务。

`reinit` 会重新添加配置包依赖并接入公共预设。共享预设已管理的 TypeScript 选项和 Oxlint 规则以项目设置为准，避免你修改公共规则后又被模板默认值覆盖；若模板给出不同值，脚本会打印提示供核对。上游新增且尚未纳入共享预设的选项、额外继承链、环境类型和 lint overrides 会保留。接入逻辑位于 `scripts/lib/tooling.mjs`；公共规则在配置包修改，框架接入差异在脚本修改，均会随下一次 reinit 保留。直接编辑应用配置可以临时覆盖共享默认值，但这些框架配置仍会在 reinit 时重建。

## 格式化与编辑器

根目录的 `.prettierrc.json` 为三个应用、共享包和脚本提供统一格式：两空格、双引号、不加分号、128 列换行。使用项目安装且精确锁定的 Prettier；Tailwind 排序插件通过 `packages/ui/src/styles/globals.css` 读取 v4 主题，同时整理 JSX、`cn`、`clsx` 和 `cva` 中的类名。无需在每个 workspace 重复安装或另建格式配置包。

```sh
pnpm format          # 统一源码、配置与文档的格式
pnpm format:check    # 只检查；pnpm check 和 CI 均包含它
```

两条命令显式读取 `.prettierignore`，避免 Git 的宽泛 `dist/` 忽略规则隐藏 `src/dist/` 等业务源码。格式化只排除指定的工作区生成目录、依赖、锁文件、自动生成的版本记录、静态 `public/` 资源、私有 `.reinit/`、补丁和 `AGENTS.md`；不会改写静态资源或仓库指令。`.editorconfig` 统一 UTF-8、LF、两空格和末尾换行，保留 Markdown 换行及补丁的有意义空白。

用 VS Code 打开仓库根目录后，按 `.vscode/extensions.json` 的推荐安装 Prettier、ESLint、Oxc 和 Tailwind CSS IntelliSense。保存时使用本地 Prettier 格式化，并执行相应 linter 的修复。Web 和工程脚本使用 ESLint；根 `.oxlintrc.json` 为 Oxc 编辑器排除这些文件，Admin、Extension 和 UI 继续使用各自的公共规则。根目录安装的 Oxlint 与应用共用 catalog 版本，供编辑器发现本地语言服务。Oxfmt 格式化已关闭，TypeScript 不使用 Nightly；最终类型检查仍由各工作区锁定的 TypeScript 执行。编辑器插件仅列为推荐，不自动安装或修改个人设置。

`reinit` 在隔离候选目录安装依赖后，仅格式化被重建应用的托管配置，以及更新后的根配置和 workspace 依赖清单，再执行完整检查和浏览器验收。业务源码、共享 shadcn/ui、manifest、静态资源与编辑器配置不会被这一步重写。新增格式依赖自动参与联网兼容性升级；离线模式重放已验证的版本。如果升级后的规则要求业务文件调整，或生成配置不能格式化，检查会中止并保留原项目，需要审核格式调整后再重试。新增格式依赖后，先成功运行一次联网 reinit，才会生成包含这些依赖的离线重放记录。

## 公共依赖版本

`pnpm-workspace.yaml` 的 `catalog` 集中维护 React、React DOM、React 类型、Tailwind、Oxlint、ESLint 和 shadcn。使用方通过 `catalog:` 引用；`catalog:next` 和 `catalog:vite` 分别维护框架工具链。Next.js、Vite、框架插件和 CRXJS 在应用声明版本。联网 reinit 会更新 catalog、根工具依赖和 `packages/*` 的直接依赖，写入经过验证的精确版本；共享组件源码、导出、脚本和 peer 契约保留。

普通安装遵循锁文件，不追随 latest。联网 reinit 优先选择发布者 latest 通道中的稳定版，过滤 beta / rc 等预发布，不自动追随 next 通道。Next.js、Vite 和 CRXJS 必须使用最新稳定版；公共依赖若不满足 Node 引擎、模板工具链要求或 peer 契约，则选择最高兼容稳定版并记录原因。React / React DOM 版本必须一致；Node 类型对齐当前 Node 主版本；TypeScript 保留模板要求，未重建应用的 TypeScript 工具链保留当前兼容范围。

已弃用版本不会被新引入。若当前已经使用的版本因兼容要求暂时必须保留，其 deprecated 状态会明确记录。决策、版本和保留原因保存在 `template-versions.json#dependencies`。求解后还会严格安装 peer dependencies、核对锁文件实际版本，并执行完整检查及联网安全审计；不兼容时停止替换，不自动降级 Next / Vite / CRXJS，也不会用旧缓存冒充联网 latest。

ESLint 使用 10，公共配置通过 peer 契约和 catalog 开发依赖统一版本，Web 保留完整的 Next 官方 Core Web Vitals / TypeScript 规则。模板中的 ESLint 默认版本不作为硬约束，实际兼容性由配置包的 peer、严格安装和规则回归测试共同检查。Next 16.4.1 自带 [ESLint 10 规则上下文兼容层](https://github.com/vercel/next.js/blob/v16.4.1/packages/eslint-config-next/src/rule-context.ts)；React 7.37.5、Import 2.32.0、JSX a11y 6.10.2 三个 ESLint 插件的上游 peer 声明尚未包含 10，因此只对这些固定插件版本设置 `peerDependencyRules.allowedVersions` 例外，其余 peer 检查保持严格。`pnpm test` 会实际执行 React、Hooks、无障碍、Import、Next 和 TypeScript 规则，并确认共享 shadcn/ui 的合法用法正常；后续插件升级仍须通过同样检查，不自动扩大例外。

ESLint 的项目最低版本为 `10.0.0`，当前公共配置的 peer 为 `^10`。联网求解、离线记录重放、无依赖记录的旧锁文件以及安装后的实际依赖图均检查此底线；ESLint 9 即使已缓存、原先已安装或没有 deprecated 标记，也不能被选用。无法找到兼容组合时停止并保留原项目；离线记录低于底线或无法确认版本时，需先联网 reinit 更新记录。安装后的检查发生在替换前，替换后的复验失败仍按备份流程恢复。

应用专属业务依赖保留声明；`packages/ui` 内的 Base UI、图标库、样式工具及 shadcn CLI 等公共依赖会参与升级，但不会重新生成现有 shadcn 组件。Node / pnpm 工具版本、业务源码和 API 不会自动迁移。版本决策位于 `scripts/lib/updates.mjs`，catalog 接入位于 `scripts/lib/catalogs.mjs`。

### 依赖安全检查

```sh
pnpm audit:security
pnpm audit --prod
```

shadcn CLI 放在根和 UI 包的开发依赖中；UI 的 `shadcn/tailwind.css` 仍在构建阶段正常解析。其间接依赖 `braces@3.0.3` 的 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 尚无官方修复版本，本项目使用 `patches/braces@3.0.3.patch` 限制解析和递归 AST 遍历深度，覆盖字符串及直接传入 AST 的入口。补丁由 `pnpm-workspace.yaml#patchedDependencies` 注册并在唯一锁文件中固定，重建时保留。

原始 `pnpm audit` 按版本判断，仍可能报告这条告警。`audit:security` 先核对补丁哈希、锁文件覆盖范围和实际安装依赖的行为，再读取完整审计响应；仅将该 GHSA 的已验证 `3.0.3` 记录为“本地补丁缓解”，不会设置全局忽略列表。其他包、版本、告警及 registry 错误均导致失败。相关回归测试也纳入 `pnpm check`。补丁只处理递归深度问题，不保证任意 glob / 正则表达式的资源消耗安全。

上游发布修复后，升级依赖并同步移除本地补丁及对应验证策略；不能仅删除告警记录或修改版本号来宣称修复。

## shadcn/ui

采用 `base-nova` 风格及 Base UI，已安装 Button、Card、Badge、Input、Label、Separator。三个应用的 `components.json` 均指向共享 UI 包。

```sh
# 从 Web 工作区解析依赖，基础组件自动写入 packages/ui
pnpm ui:add dialog

# 页面 blocks 可从对应应用中添加
pnpm exec shadcn add login-01 --cwd apps/admin
```

```tsx
import { Button } from "@browser-client/ui/components/button"
```

主题在 `packages/ui/src/styles/globals.css`。各应用通过 `@source` 扫描自己的源码，共享样式同时扫描 UI 源码。需要 React hooks 或交互的共享组件须声明 `"use client"`，以兼容 Next.js Server Components。新增组件后运行 `pnpm check`。

## 浏览器扩展

1. 运行 `pnpm dev:extension`，保持开发服务运行。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
3. 选择“加载已解压的扩展程序”，选择 `apps/extension/dist-dev`。
4. 点击扩展图标打开 popup；“打开设置”进入 options。名称保存在 `chrome.storage.local`。

`manifest.config.ts` 是唯一的 manifest 源码，使用 CRXJS 的 `defineManifest`；`src/background.ts`、`index.html`、`options.html` 分别是后台、popup 和设置页入口。CRXJS 根据 manifest 自动收集入口和生成资源路径。不要再往 `public/` 放置 manifest。

popup / options 支持 React Fast Refresh，共享 `packages/ui` 的组件与样式也会热更新，普通组件编辑可保留表单状态。后台或 manifest 的变化可能触发扩展重载，不能承诺保留运行状态。开发产物由 CRXJS 注入本机开发连接及对应权限 / CSP，只用于本地开发。端口默认 3002；需修改时使用 `EXTENSION_DEV_PORT=3202 pnpm dev:extension`，HTTP 与 WebSocket 端口会同步。不要单独使用 `--port` 覆盖。

生产构建运行 `pnpm --filter @browser-client/extension build`，加载或打包 `apps/extension/dist`。生产包独立于开发服务，仍只有 `storage` 权限和严格 CSP，没有内容脚本、网站访问权限或 HMR 客户端。**发布使用 `dist`，不要使用 `dist-dev`。** 重新构建生产包后需在扩展管理页手动重新加载。

`pnpm preview:extension` 在普通网页中预览 UI，不启用 CRXJS，也不具有扩展 API；它与扩展开发默认共用端口，不要同时运行。

## reinit：从官方最新模板重建

参照 HomeFull 重建框架后恢复业务代码的工作方式。这里直接保留当前磁盘文件，包括未提交和未跟踪源码，不依赖 Git 提交或 `git restore`。

```sh
pnpm reinit                  # 只显示计划，不联网、不写文件
pnpm reinit web --dry-run    # 查看指定目标
pnpm reinit --apply          # 重建全部三个应用
pnpm reinit admin --apply    # 更新 Admin 模板及全仓公共依赖，仍检查全部应用
pnpm reinit extension --apply
pnpm reinit --apply --offline # 使用已记录且缓存的官方版本，不查询 latest
```

执行前停止开发/构建进程并暂停编辑项目。脚本的步骤：

1. 获取互斥锁，记录当前源码指纹；逐文件计算内容摘要，再汇总路径、类型及权限，避免文件内容与相邻记录边界混淆。解析官方 `create-next-app` / `create-vite` latest 通道的稳定版本。
2. 在 `.reinit/staging/<id>` 创建独立 workspace，用解析出的精确版本运行官方脚手架，不创建 AGENTS.md。暂存目录建立独立 Git 边界以避免上级 ignore 规则干扰检查；不创建提交或远端，项目原 Git 元数据不变。此步骤需要 Git。
3. 解析最新稳定版框架、CRXJS 和公共依赖，求解模板、Node / peer 兼容约束，记录未采用 latest 的原因。更新 catalog 和依赖清单；恢复业务文件，重新接入 workspace、共享 TypeScript / lint 配置、shadcn/ui、Tailwind 和 CRXJS，保留 `manifest.config.ts`。
4. 严格安装 peer dependencies，核对实际版本并执行 `pnpm check`，包括实际 Vite / CRXJS 兼容性。联网模式追加 `pnpm audit:security` 并用候选项目的 Playwright 准备 Chromium；随后必须通过 `pnpm test:web-admin` 和 `pnpm test:extension`，包括页面交互、共享样式、扩展存储、热更新及独立生产加载。所有目标（包括单独重建一个应用）都执行这两组验收，因为公共依赖可能影响整个仓库。缺少浏览器、验收失败或清理失败时停止，原项目不替换。最后检测原工作区是否在生成期间被编辑；有变化则拒绝替换。
5. 将原 apps、packages、根 `package.json`、`pnpm-workspace.yaml`、node_modules、锁文件和版本记录一起移动到 `.reinit/backups/<id>`，安装经过验证的新目录。
6. 在最终目录按冻结锁文件严格安装并再次检查；联网模式继续联网完成 pnpm 供应链元数据校验，离线模式只使用缓存。失败则恢复原目录，备份与失败候选均保留，便于排查。

| 内容                                                                                                                          | 重建行为                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/`、`public/`、`.env*`、`manifest.config.ts`、HTML 入口、测试及其他业务文件                                               | 从当前磁盘保留，整个目录覆盖模板的示例目录                                                                    |
| `packages/` 的组件 / 配置源码、导出、脚本和 peer 契约；根文档、Git 元数据                                                     | 保留；UI 不会被重新初始化                                                                                     |
| 根 / `packages/*/package.json` 直接依赖及 `pnpm-workspace.yaml` catalog                                                       | 联网时升级到最高兼容稳定版本，保留其他字段和现有 workspace 设置                                               |
| app `package.json`                                                                                                            | 保留业务依赖、非标准 scripts、自定义字段与项目版本；官方模板同名依赖和标准 scripts 优先                       |
| app `tsconfig*.json`、`next/vite/eslint/postcss.config.*`、`.oxlintrc.json`、`next-env.d.ts`、`components.json`               | 用新模板和接入逻辑重建                                                                                        |
| app `README.md`、`.gitignore`                                                                                                 | 使用新模板版本；项目说明请维护在根 README 或 docs                                                             |
| app 内独立的 `pnpm-workspace.yaml` 与锁文件                                                                                   | 移除，统一使用仓库根 workspace 与锁文件                                                                       |
| 仓库根目录及 `apps/*` / `packages/*` 根目录的 `node_modules`、`.next`、`dist`、`dist-dev`、`.turbo`、`*.tsbuildinfo` 等生成物 | 重新生成；只在这些边界排除。`public/dist/`、`src/dist/`、共享组件内的同名业务路径完整保留，并纳入内容指纹检查 |

自定义框架配置应固化到 `scripts/lib/integrate.mjs`，否则它只留在备份中，不会自动迁入新配置。`reinit` 是框架底座更新，不是清空业务源码，也不会自动迁移业务 API。上游模板结构或 API 出现不兼容变化时，脚本会停在暂存目录，由你调整接入逻辑或业务代码后重试。首次版本和以后每次生成的版本均记录在 `template-versions.json`；普通安装遵循锁文件，不追随 latest。

扩展从官方 `create-vite` 最新稳定模板 `--template react-ts` 重建，同时解析 Vite 和 CRXJS 的最新稳定版，再接入共享 UI。每次成功后将精确版本写入应用清单和版本记录；下次联网 reinit 会重新查询。若最新 Vite 与最新 CRXJS 的 peer 范围冲突，会停止并保留原项目，等待上游兼容或调整接入方案。

网络不可用时可显式使用 `--offline`，重放 `template-versions.json` 中已记录的模板及依赖决策，不请求 registry、下载浏览器或执行联网审计。建议先完成一次全部应用的联网 reinit；对应脚手架、全部依赖及当前 Playwright 对应的 Chromium 必须已缓存，缺少记录或缓存会停止。可提前运行 `pnpm exec playwright install chromium`；Linux 若缺系统库，需先按 Playwright 的诊断安装运行依赖。升级前的旧版记录仍按原依赖策略离线重建，并标记为 `legacy-offline`，不会冒充最新版本。离线模式执行相同的严格安装、浏览器验收、备份和恢复流程。默认模式的网络错误会报告，不自动退回旧版本。

reinit 的浏览器报告、日志和截图保存在原项目的 `.reinit/verification/`，不会随候选目录的替换而丢失。单独运行浏览器测试默认也使用此位置；`BROWSER_TEST_OUTPUT_ROOT` 可指定其他报告父目录，reinit 会固定使用原项目的该目录以保留诊断现场。

### 失败与备份

生成或暂存检查失败时原目录未替换；最终目录检查失败时自动恢复。Ctrl-C / SIGTERM 会取消当前命令并停止它的进程树，先等待退出，必要时强制终止，再恢复目录。若无法确认进程已经退出，则保留锁与现场，禁止自动恢复以免与后台写入冲突。命令执行逻辑在 `scripts/lib/commands.mjs`，也用于浏览器验收。

每个 reinit 子命令默认总超时 10 分钟，可用 `REINIT_COMMAND_TIMEOUT_MS` 设置正整数毫秒。版本查询默认 30 秒，安装下载默认 120 秒；两者均最多重试两次，重试间隔为 1–5 秒。安装默认最多 4 个网络请求并发。可通过 pnpm 11 的 `pnpm_config_fetch_timeout` / `pnpm_config_fetch_retries` 等覆盖。`.reinit` 不纳入 Git，其中可能包含环境文件，应按本地私有备份管理。它不是跨磁盘备份或断电原子事务。

pnpm 可能为本次明确选中的新发布版本追加精确的 `minimumReleaseAgeExclude`，包括对应的平台包。这些例外随 workspace 配置一并备份和回滚；不会全局关闭发布年龄限制。脚手架 `dlx` 临时增加的例外不会迁入项目。

若强制结束进程或断电，先查看 `.reinit/lock/owner.json` 和对应备份的 `journal.json`，核对原目录、备份与候选的位置后恢复，**不要直接删除锁或备份**。正常失败会释放锁；备份不会自动回收。

需要手动恢复时，停止相关进程，先将当前 `apps/`、`packages/`、`package.json`、`pnpm-workspace.yaml`、`node_modules/`、`pnpm-lock.yaml`、`template-versions.json` 移到新的保留目录，再按备份 `journal.json#paths` 把同一份成功备份中的对应项目移回根目录，最后运行 `pnpm install --frozen-lockfile` 和 `pnpm check`。旧备份可能不包含根清单和 workspace 配置，按其 journal 恢复，不混用不同时间点的锁文件与源码。

### 清理旧的成功现场

```sh
pnpm reinit:clean                       # 默认预览：每类保留最近 3 份、最近 7 天
pnpm reinit:clean --keep=1 --days=0      # 预览更少的保留数量
pnpm reinit:clean --keep=1 --days=0 --apply
```

只有超出保留数量且早于保留天数的成功备份及关联 staging 可以删除。浏览器验证只回收成功记录中的 workspace 和 profile，保留 `report.json` 与日志。失败、恢复未完成、缺少有效记录的目录和迁移基线均保留。存在维护锁时拒绝清理；执行清理也使用同一把锁。至少保留每类最近 1 份成功记录，符号链接拒绝进入清理计划。Ctrl+C / SIGTERM 会等待当前删除结束，然后停止后续清理并释放锁；已删除的旧现场不会恢复，SIGKILL 或断电仍需手工检查锁。

## 验证

```sh
pnpm check       # CRXJS 兼容性 + 脚本测试 + lint + typecheck + 三应用构建 + 扩展产物检查
pnpm test        # 数据保留、失败恢复、命令取消 / 超时、清理、catalog、配置及产物检查
pnpm lint:scripts
pnpm build

# 首次运行浏览器验收需下载匹配的 Chromium
pnpm exec playwright install chromium
pnpm test:extension
pnpm test:web-admin
pnpm audit:security
```

`test:web-admin` 在 `.reinit/verification/web-admin-*/` 创建独立源码副本和 Git 边界，按锁文件离线安装并重新构建 Web / Admin，使用 Next.js 生产服务和 Vite preview 验证页面及共享组件样式。覆盖 Web 工作区导航、Admin 空白名称禁用 / 保存 / 页面状态重置、桌面和移动布局，以及浏览器异常、控制台和失败资源检查。报告、服务日志和截图保留在该目录；测试结束会关闭自己启动的浏览器和进程，检查原工作区源码未改变。

默认端口为 3150 / 3151；可通过 `WEB_TEST_PORT` / `ADMIN_TEST_PORT` 修改，两者必须不同。测试会检查端口是否空闲；`WEB_ADMIN_TEST_COMMAND_TIMEOUT_MS` 设置子命令超时，默认 5 分钟。运行时暂停编辑项目，避免源码指纹检查失败。

`test:extension` 在 `.reinit/verification/` 创建源码副本和隔离 Chromium profile，使用端口 3102 验证真实扩展加载、后台初始化、popup → options、本地设置保存，以及页面 / 共享组件 / 共享样式的热更新与 React 状态保留。随后停止开发服务，重新构建并加载生产扩展，检查运行错误与外部 HTTP 请求。测试只修改副本，日志和 `report.json` 保留在该目录。先完成根目录依赖安装；副本按锁文件离线安装。运行期间暂停编辑，以便最终源码指纹校验。可设置 `EXTENSION_TEST_PORT` 改测试端口，`EXTENSION_TEST_COMMAND_TIMEOUT_MS` 改子命令超时（默认 3 分钟）；中断会清理测试启动的进程与浏览器。

生产产物检查解析所有输出 JS 的静态导入、重新导出和字符串形式的动态导入，拒绝缺失、远程或越界的资源。运行时计算的动态路径仍须由浏览器验收覆盖。

`pnpm check` 和 reinit 的自动检查不启动浏览器；升级 Vite / CRXJS 后再运行 `pnpm test:extension`。自动浏览器验收使用 Playwright Chromium，Chrome / Edge 的扩展管理界面和商店发布仍需在对应浏览器中验收。

配置测试会实际调用 TypeScript、ESLint 和 Oxlint，检查路径与环境类型解析、React Hooks 错误是否被拒绝、继承的规则参数是否生效，以及 reinit 是否保留上游新增选项。

## CI

`.github/workflows/ci.yml` 配置 GitHub Actions：push / pull request 执行冻结锁文件安装、`pnpm check` 和 `pnpm audit:security`；基础检查通过后，在独立 job 执行 Web / Admin 的生产浏览器冒烟测试。Extension、共享 packages、工程脚本、依赖或 CI 配置变化时，再执行扩展浏览器验收；首次推送及手动触发也执行扩展验收。浏览器 job 保留验证报告、日志及 Web / Admin 截图 7 天，不上传源码副本或浏览器 profile。工作流只检查项目，没有发布步骤。

## 官方参考

- [Next.js create-next-app](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
- [Vite 官方模板](https://vite.dev/guide/)
- [CRXJS 安装与配置](https://crxjs.dev/guide/installation/from-scratch/)
- [Vite WebSocket 配置](https://vite.dev/config/server-options.html#server-ws)
- [shadcn/ui monorepo](https://ui.shadcn.com/docs/monorepo)
- [Chrome Manifest V3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [pnpm 11 配置变更](https://pnpm.io/blog/releases/11.0)
- [pnpm catalogs](https://pnpm.io/catalogs)
- [Playwright Chrome 扩展验收](https://playwright.dev/docs/chrome-extensions)
- [TypeScript 配置继承](https://www.typescriptlang.org/tsconfig/extends.html)
- [ESLint 共享配置](https://eslint.org/docs/latest/extend/shareable-configs)
- [Oxlint 配置继承](https://oxc.rs/docs/guide/usage/linter/config.html#extend-shared-configs)
