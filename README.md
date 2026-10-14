# browser-client

Next.js Web + Vite Admin + Vite / CRXJS Chrome / Edge Extension 的 pnpm monorepo。三个入口共享 `packages/ui` 中的 shadcn/ui 组件和 Tailwind CSS v4 主题。

## 开始

需要 **Node.js 24 LTS** 和 **pnpm 11.25.0**（`packageManager` 固定版本）。`.tool-versions` 为 mise / asdf 固定项目 Node 版本，`.node-version` 提供 Node 24 版本约定。已有 mise 的环境先运行 `mise install`，即可在此目录执行以下命令；也可使用 `mise exec node@24 -- pnpm install`。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

| 入口 | 命令 | 地址或产物 |
| --- | --- | --- |
| Web | `pnpm dev:web` | http://127.0.0.1:3000 |
| Admin | `pnpm dev:admin` | http://127.0.0.1:3001 |
| Extension | `pnpm dev:extension` | 加载 `apps/extension/dist-dev`，支持 HMR |
| Extension 网页预览 | `pnpm preview:extension` | http://127.0.0.1:3002 |

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

| 使用方 | TypeScript 预设 | lint 配置 |
| --- | --- | --- |
| Web | `@browser-client/typescript-config/nextjs.json` | `@browser-client/eslint-config/base` + 当前 Next.js 官方规则 |
| Admin / Extension 页面 | `@browser-client/typescript-config/vite.json` | `@browser-client/oxlint-config/react-app.json` |
| Vite 配置文件 | `@browser-client/typescript-config/vite-node.json` | 与所在应用共用 lint |
| UI | `@browser-client/typescript-config/react.json` | `@browser-client/oxlint-config/react.json`，并保留 Unicorn 检查 |

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

## 公共依赖版本

`pnpm-workspace.yaml` 的 `catalog` 集中维护 React、React DOM、React 类型、Tailwind、Oxlint、ESLint 和 shadcn 的版本范围。使用方通过 `catalog:` 引用，升级兼容的公共依赖只需修改一处。`catalog:next` 和 `catalog:vite` 分别维护 TypeScript 与 Node 类型，保留两个框架的工具链要求；Next.js、Vite、框架插件和 CRXJS 继续在应用声明版本。

普通安装遵循锁文件。`reinit` 会重新接入 catalog，并要求 catalog 允许的所有版本均满足模板的要求；仅有部分范围相交不足以保证已有锁定版本兼容。不兼容时停止重建，原目录保留，需要先调整公共版本策略。它不会把 `catalog:` 改回分散的版本号，也不会自动升级 catalog。兼容范围内仍需通过完整类型、lint 和构建检查。接入逻辑在 `scripts/lib/catalogs.mjs`。

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
pnpm reinit admin --apply    # 仅更新 Admin 的官方框架底座
pnpm reinit extension --apply
pnpm reinit --apply --offline # 使用已记录且缓存的官方版本，不查询 latest
```

执行前停止开发/构建进程并暂停编辑项目。脚本的步骤：

1. 获取互斥锁，记录当前源码指纹；查询官方 `create-next-app@latest` / `create-vite@latest` 的实际版本。
2. 在 `.reinit/staging/<id>` 创建独立 workspace，用解析出的精确版本运行官方脚手架，不创建 AGENTS.md。暂存目录建立独立 Git 边界以避免上级 ignore 规则干扰检查；不创建提交或远端，项目原 Git 元数据不变。此步骤需要 Git。
3. 恢复业务文件与业务依赖，重新接入 workspace、共享 TypeScript / lint 配置、shadcn/ui、Tailwind 和 CRXJS；保留 `manifest.config.ts`。
4. 安装依赖并执行 `pnpm check`，先检查实际安装的 Vite 是否满足 CRXJS 的 peerDependencies。检测原工作区是否在生成期间被编辑；有变化则拒绝替换。
5. 将原 apps、packages、node_modules、锁文件和版本记录移动到 `.reinit/backups/<id>`，安装经过验证的新目录。
6. 在最终目录重新连接依赖并再次检查；失败则恢复原目录。备份与失败候选均保留，便于排查。

| 内容 | 重建行为 |
| --- | --- |
| `src/`、`public/`、`.env*`、`manifest.config.ts`、HTML 入口、测试及其他业务文件 | 从当前磁盘保留，整个目录覆盖模板的示例目录 |
| `packages/`、根目录配置、文档、Git 元数据 | 保留；UI 不会被重新初始化 |
| app `package.json` | 保留业务依赖、非标准 scripts、自定义字段与项目版本；官方模板同名依赖和标准 scripts 优先 |
| app `tsconfig*.json`、`next/vite/eslint/postcss.config.*`、`.oxlintrc.json`、`next-env.d.ts`、`components.json` | 用新模板和接入逻辑重建 |
| app `README.md`、`.gitignore` | 使用新模板版本；项目说明请维护在根 README 或 docs |
| app 内独立的 `pnpm-workspace.yaml` 与锁文件 | 移除，统一使用仓库根 workspace 与锁文件 |
| `node_modules`、`.next`、`dist`、`dist-dev`、`.turbo`、`*.tsbuildinfo` | 重新生成；源码复制时排除这些名称 |

自定义框架配置应固化到 `scripts/lib/integrate.mjs`，否则它只留在备份中，不会自动迁入新配置。`reinit` 是框架底座更新，不是清空业务源码，也不会自动迁移业务 API。上游模板结构或 API 出现不兼容变化时，脚本会停在暂存目录，由你调整接入逻辑或业务代码后重试。首次版本和以后每次生成的版本均记录在 `template-versions.json`；普通安装遵循锁文件，不追随 latest。

扩展依然从官方 `create-vite@latest --template react-ts` 重建，然后接入 CRXJS。CRXJS 使用项目中明确固定的版本（当前 3.0.0），不会随 reinit 自动追逐 latest；如果未来 Vite 超出其兼容范围，先升级并验证插件，再重试 reinit。

网络不可用时可显式使用 `--offline`，按 `template-versions.json` 中每个应用已记录的官方版本重建。对应脚手架和全部依赖必须已缓存，缺少记录或缓存会停止。离线模式执行相同的接入、检查、备份和恢复流程，不代表重新查询到了最新版本。默认模式的网络错误仍会报告，不自动退回旧版本。

### 失败与备份

生成或暂存检查失败时原目录未替换；最终目录检查失败时自动恢复。Ctrl-C / SIGTERM 会取消当前命令并停止它的进程树，先等待退出，必要时强制终止，再恢复目录。若无法确认进程已经退出，则保留锁与现场，禁止自动恢复以免与后台写入冲突。命令执行逻辑在 `scripts/lib/commands.mjs`，也用于浏览器验收。

每个 reinit 子命令默认总超时 10 分钟，可用 `REINIT_COMMAND_TIMEOUT_MS` 设置正整数毫秒。registry 请求默认 30 秒、不重试，可通过 pnpm 11 的 `pnpm_config_fetch_timeout` / `pnpm_config_fetch_retries` 覆盖。`.reinit` 不纳入 Git，其中可能包含环境文件，应按本地私有备份管理。它不是跨磁盘备份或断电原子事务。

若强制结束进程或断电，先查看 `.reinit/lock/owner.json` 和对应备份的 `journal.json`，核对原目录、备份与候选的位置后恢复，**不要直接删除锁或备份**。正常失败会释放锁；备份不会自动回收。

需要手动恢复时，停止相关进程，先将当前 `apps/`、`packages/`、`node_modules/`、`pnpm-lock.yaml`、`template-versions.json` 移到新的保留目录，再把同一份成功备份中的对应项目移回根目录，最后运行 `pnpm install --frozen-lockfile` 和 `pnpm check`。不要混用不同时间点的锁文件与源码。

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
```

`test:extension` 在 `.reinit/verification/` 创建源码副本和隔离 Chromium profile，使用端口 3102 验证真实扩展加载、后台初始化、popup → options、本地设置保存，以及页面 / 共享组件 / 共享样式的热更新与 React 状态保留。随后停止开发服务，重新构建并加载生产扩展，检查运行错误与外部 HTTP 请求。测试只修改副本，日志和 `report.json` 保留在该目录。先完成根目录依赖安装；副本按锁文件离线安装。运行期间暂停编辑，以便最终源码指纹校验。可设置 `EXTENSION_TEST_PORT` 改测试端口，`EXTENSION_TEST_COMMAND_TIMEOUT_MS` 改子命令超时（默认 3 分钟）；中断会清理测试启动的进程与浏览器。

生产产物检查解析所有输出 JS 的静态导入、重新导出和字符串形式的动态导入，拒绝缺失、远程或越界的资源。运行时计算的动态路径仍须由浏览器验收覆盖。

`pnpm check` 和 reinit 的自动检查不启动浏览器；升级 Vite / CRXJS 后再运行 `pnpm test:extension`。自动浏览器验收使用 Playwright Chromium，Chrome / Edge 的扩展管理界面和商店发布仍需在对应浏览器中验收。

配置测试会实际调用 TypeScript、ESLint 和 Oxlint，检查路径与环境类型解析、React Hooks 错误是否被拒绝、继承的规则参数是否生效，以及 reinit 是否保留上游新增选项。

## CI

`.github/workflows/ci.yml` 配置 GitHub Actions：push / pull request 执行冻结锁文件安装和 `pnpm check`；Extension、共享 packages、工程脚本、依赖或 CI 配置变化时，额外安装 Chromium 并执行 `pnpm test:extension`。首次推送及手动触发也执行浏览器验收。失败时上传验证报告与日志，保留 7 天，不上传源码副本或浏览器 profile。工作流只检查项目，没有发布步骤。

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
