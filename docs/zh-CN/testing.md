# 测试与持续集成

[English](../testing.md) · [中文文档](README.md) · [项目首页](../../README.zh-CN.md) · [开发](development.md) · [框架更新](reinit.md) · [依赖安全](security.md)

使用应用专属断言配合共享基础检查，报告与浏览器配置保存在私有 `.reinit/`。维护回归会真实终止维护和恢复主进程，并验证仍存活的分离子进程能阻止恢复；超时配置无效时不得留下锁。组合验收包含每类两个实例，扩展各自只构建和验证自己的生产产物，最后严格汇总覆盖。

## 验证命令

```sh
pnpm check       # 格式、兼容性、测试、lint、类型、全部构建和扩展产物
pnpm test        # 源码保留、恢复、取消、超时、清理、catalogs 与配置
pnpm lint:scripts
pnpm typecheck:scripts
pnpm build

# 首次浏览器测试前安装匹配的 Chromium
pnpm exec playwright install chromium
pnpm test:browser  # 全部注册实例及严格覆盖汇总
pnpm test:extension
pnpm test:web-admin
pnpm test:reinit   # 较慢：隔离副本中的真实在线更新、离线重放和拒绝测试
pnpm audit:security
```

### 低资源本机验证

电脑同时运行其他任务时，可主动选择一次一个验证命令：

```sh
pnpm verify:low check
pnpm verify:low test:browser admin
pnpm verify:low test:apps     # 仍是长验收，资源允许时才执行
pnpm verify:low test:reinit
```

包装器降低自身调度优先级，并由子进程继承；Turbo 任务和 Node 测试文件串行，Next.js 构建 worker、Rayon、libuv 和 Go 池并发设为一。浏览器实例本来就串行，但必要的对端页面和多实例隔离断言仍保留。断言、类型、浏览器门槛和超时全部启用，低优先级与限并发只能降低峰值，不是 CPU 或总内存硬限制。机器无响应时可 Ctrl-C，先停止本轮拥有的进程再清理。

该模式只通过 `verify:low` 启用，普通开发和 CI 维持默认设置。私有 `BROWSER_CLIENT_LOW_RESOURCE=1` 及线程设置传入隔离维护与浏览器工作区，reinit 适配器重接条件 worker 配置，Turbo 为资源设置区分缓存。浏览器报告记录 `resourceMode`，不替换依赖、业务文件或断言。

### 可选资源保护

```sh
pnpm verify:low --guard check
pnpm verify:low --guard test:browser admin
pnpm verify:low --guard --wait-ms=600000 test:accessibility
pnpm verify:low --guard --resume=guard-1793010000000-1234abcd
```

正式 guard 支持 macOS 和 Linux。启动需连续三次、约间隔二十秒观测到 CPU 空闲至少 80%、可用内存至少 40%、正常内存压力。macOS 使用 `top -l 2` 第二个区间、`memory_pressure -Q` 与内核压力；load average 不能替代 CPU 空闲率。Linux 用区间 `/proc/stat`、`MemAvailable` 以及十秒窗口内无 full-stall PSI。不支持的平台或不可读取的探针不算健康。普通串行 `verify:low` 可单独使用；内存压力大时省略 CPU 和进程扫描，只做轻量等待。

运行中约十五秒采样：异常压力、内存低于 40%、CPU 空闲一次低于 35% 或连续两次低于 50%、探针不可用、拥有进程 RSS 总和超过 2GiB 时，只停止本轮拥有的命令树。这是采样保护，不是系统配额，也不保证不受其他系统负载影响。运行资源停止后至少冷却十五分钟再恢复。

每次尝试在新的 `.reinit/verification/guard-*` 保留 `report.json`、`resources.jsonl` 和命令输出。退出 75 表示启动余量不足或资源保护停止；测试失败和不安全清理仍失败。启动默认最多等十分钟。恢复核对源码指纹、Node / 平台、成功清理与冷却，再在新目录重跑所记录任务，不跳过中断任务的任意内部步骤，也不将未执行断言标成通过。源码变化需新尝试，纯启动等待无运行冷却。

每个项目一次一个 guard，协调锁与维护锁独立。主进程意外退出后，必须确认原 owner 和全部已知命令组消失才可重新认领；旧协调、scope 和报告保留，归属不可读或不确定时拒绝启动。受影响隔离工作区仍走正常维护恢复，不直接删锁。

### 无障碍验收

`pnpm test:browser` 先用正常页面及故意缺少名称、对比度不足的页面验证真实 axe-core 引擎。网站与后台扫描主配置路由，后台种子还通过 `accessibilityPaths` 声明 `/login`、`/dashboard`、`/missing-page`；业务新增路由写入实例配置，路径必须留在本地应用来源。

生产扩展的弹出页和设置页在不放宽 CSP 的情况下扫描。覆盖亮暗主题、桌面与移动宽度，以及自动可检测的 WCAG 2 A/AA、2.1 A/AA、2.2 AA 规则。违规和人工复核项都会记录，不禁用失败规则；引擎是根开发依赖，不打入产品。键盘、焦点、恢复和业务断言仍执行，自动扫描不等于完整无障碍认证。

每个实例必须有成功且非空的扫描覆盖，缺失、为空、失败或过期证据使门槛失败。`accessibility.jsonl` 只记录规则、选择器和摘要，不记录页面 HTML 或表单值，CI 与其他诊断一起保留。`pnpm test:accessibility` 单独执行较小的真实引擎回归；`pnpm check` 中的纯配置和报告测试不启动浏览器。[Playwright 官方说明](https://playwright.dev/docs/accessibility-testing)。

网站和后台套件在 `.reinit/verification/web-admin-*/` 建立副本与本地 Git 边界，按锁文件离线安装并重新构建，使用 Next.js 生产服务与 Vite preview。验证英文界面、语言元数据、可访问 GitHub 链接、Inter、共享样式、主题，以及控制台、网络和资源错误。网站另验响应式导航、抽屉、键盘恢复、区块链接、320 / 390 / 768 / 1280px、首帧无效主题和存储不可用。后台另验登录、仪表盘、邮箱原生校验、路由、深链接刷新、未找到页、抽屉菜单；故障上下文拦截真实生产分块，检查 HTTP / 网络失败、返回首页与刷新重试。测试关闭自己的浏览器和进程，并验证原源码不变。

### 自定义业务浏览器断言

默认回归覆盖打开移动导航后跨桌面断点、再返回移动端时旧弹层保持关闭；后台覆盖展开/折叠偏好、路由重挂载、无效与不可读写 cookie；扩展延迟真实存储写响应，同时另一页面写入新名称，验证设置、弹出页与存储最终一致。这些进入普通套件和 reinit 替换前门槛。

每个 `apps/<id>/browser-tests.config.mts` 管理自身页面标题、布局、路由、后台预期和热更新修改。根配置按实例 ID 覆盖。用业务页面替换演示时同步更新实际断言；配置会跨 reinit 保留，并在候选安装后加载。

| 配置                           | 契约                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `web.path`、`admin.path`       | 本地应用来源内路径，例如 `/workspace`，拒绝外部 URL                               |
| `web.verify`、`admin.verify`   | 必需异步业务检查，接收 `{ page, browser, pageFor, url, runDir, errors, passed }`  |
| `admin.verifyRoutes`           | 必需路由检查，接收 `{ pageFor, url, runDir, errors, passed }`，`url` 为后台来源   |
| `extension.verifyPage`         | 必需弹出页与设置断言，接收 `{ page, kind }`                                       |
| `extension.verifyBackground`   | 必需后台初始化断言，接收 `{ page, until }`                                        |
| `extension.verifyInteractions` | 可选开发与生产交互，接收 `{ popup, options, until, runDir, profile }`             |
| `extension.verifyPreview`      | 可选普通网页预览断言，接收 `{ page, until, runDir }`                              |
| `extension.hmr`                | `{ file, update(source), verify({ page, popup }) }`，真实修改源文件并等待界面更新 |

缺必需钩子、无效可选钩子或路径、热更新未产生改动时都会失败，不静默跳过。不要用空函数替代业务断言。配置页面应保留共享主题切换；使用内置扩展设置模板时保留交互和预览钩子。

runner 始终保留主题与持久化、共享组件和样式热更新、不靠存储或整页刷新实现的 React 状态保留、扩展存储往返、生产加载、错误检查和原源码指纹。热更新只修改隔离副本，并在生产构建前恢复；runner 不依赖固定业务标题或固定 `src/App.tsx`。没有绕过 reinit 浏览器门槛的开关。

### 真实框架重建验收

**Reinit acceptance** 是独立于普通 CI 的手动工作流。默认分支包含工作流后，在 GitHub Actions 选择 **Run workflow**，可运行本地同样的 `pnpm test:reinit`，也可选择组合验收；它不提交、推送或发布。

命令复制源码到 `.reinit/verification/reinit-*/workspace`，离线安装当前锁文件，添加未跟踪业务与环境保留探针，再用官方生成器和在线依赖求解执行真实 `reinit --apply`。随后执行离线重放，比较版本和依赖决策；两次都包含候选检查、浏览器门槛、替换和最终检查。快照核对业务、共享组件、编辑器与钩子保留，最后用真实 CLI 拒绝 ESLint 9 离线收据，并要求临时项目原源码、清单和锁文件不变。用户原项目也单独核对指纹。

本机先安装 Chromium。该验收需要注册表网络、生成器与依赖下载、足够磁盘容纳嵌套副本，耗时显著高于普通 CI。`REINIT_TEST_COMMAND_TIMEOUT_MS` 控制每个外层 reinit 命令，默认三十分钟；内部命令仍由 `REINIT_COMMAND_TIMEOUT_MS` 控制。GitHub 仅上传报告、日志和截图，不上传源码、环境文件、浏览器配置或依赖。成功副本可按普通清理保留策略处理。

报告记录复制、安装、构建、启动浏览器和断言的阶段耗时，普通失败及受控取消也包含失败阶段，长阶段每三十秒输出进度。先根据耗时区分本地工作与下载延迟，不只增大超时。强制结束可能来不及写完浏览器报告，因此也保留维护报告和控制台日志。

网站与后台默认测试端口 3150 / 3151，可用不同的 `WEB_TEST_PORT` / `ADMIN_TEST_PORT` 覆盖，启动前检查占用。页面 worker 的子命令上限为五分钟，不是整套上限。测试期间暂停编辑，避免指纹不一致。

扩展测试在 `.reinit/verification/` 使用源码副本与隔离 Chromium 配置，默认端口 3102。覆盖真实加载、后台初始化、弹出页与设置、存储往返、页面与共享组件/样式热更新和 React 状态保留。内置交互还验名称长度与去空格、真实保存、持久化、实时同步、未保存草稿、读写失败重试、真实设置入口失败恢复、长文本和多种移动宽度。停止开发服务后重新构建生产产物，独立加载重验并拒绝外部 HTTP 请求，随后可选检查网页预览和独立存储。

扩展副本按锁文件离线安装，因此先准备根依赖缓存。`EXTENSION_TEST_PORT` 可覆盖端口，`EXTENSION_TEST_COMMAND_TIMEOUT_MS` 控制单个子命令，默认三分钟。取消时关闭所属浏览器和进程。生产产物从全部 JS 解析静态导入、转导出和字符串动态导入，拒绝缺失、远程或越界资源；计算出的运行时路径仍依赖浏览器覆盖。

`pnpm check` 不启动浏览器。Vite / CRXJS 变化后另跑扩展验收，reinit 在替换前要求完整注册组合。自动化使用 Playwright Chromium，Chrome / Edge 扩展管理和商店发布仍需对应浏览器人工验证。

### 工程与失败场景回归

配置测试实际调用 TypeScript、ESLint 和 Oxlint，验证路径、环境、Hooks、继承参数及上游新选项保留；Next.js 配置通过真实框架加载器读取，模块类型回退警告会使回归失败。工程测试原生执行 `.test.mts`，覆盖无依赖环境中的嵌套类型命令、无效进程/依赖/浏览器契约、不可擦除语法，以及未知错误保留恢复标志。

嵌套进程正常启动与归属夹具有十五秒预算，使用生产五秒退出宽限；故意超时与不确定登记场景保留较短期限。写入者兜底退出晚于命令及清理预算，不能用自然退出冒充清理成功。进程退出、停止写入、兄弟隔离和回滚断言均保留。临时 SIGTERM / SIGKILL 权限错误后仍须实际 ESRCH；持续拒绝则耗尽宽限并保留归属记录。

lint 回归要求业务目录中名为 `dist`、`dist-dev`、`.turbo`、`.reinit`、`coverage` 的真实违规仍失败，根和工作区生成物则忽略。侧栏测试覆盖精确 cookie 匹配、回退、属性、不可用存储与非浏览器执行；真实浏览器在 320 / 390 / 767 / 768 / 1280px 反复切换，保留桌面偏好、挂载状态与键盘访问。既有 `AGENTS.md` 在模板冲突时也必须原样保留。

网站和后台用同源 iframe 的原生存储事件验证主题隔离，sessionStorage、无效键、删除、清空、未知区域伪造事件和不可用 localStorage 不应破坏所选主题；正常本地偏好继续同步，其他业务事件仍可用。安全测试检查修复版本与恶意输入执行期限，相关源码与断言也纳入重建保留。

## 持续集成

`.github/workflows/ci.yml` 在 push / pull request 时冻结安装、执行 `pnpm check` 和安全审计，随后稳定的 `browser` job 根据注册表串行执行 `pnpm test:browser`。缺失、重复、跳过或旧源码报告失败。报告、日志和截图保留七天，不上传源码、环境、配置或依赖，没有部署步骤。

应用单元测试跟随实例，移除应用后根测试不会继续导入其源码。根测试用独立夹具覆盖配置、适配器、依赖、恢复与清理，包括真实 SIGKILL 打断替换和回滚、重复恢复及冲突保护。[应用生命周期](applications.md)说明注册表与命名空间。

清理回归使用可丢弃的平铺与多实例报告树，验证保留窗口、过期副本和浏览器配置清理、全部报告/日志/截图保留，以及失败、缺失、畸形、漂移、链接或加锁数据保护。主题同步测试覆盖空组合、仅网站、多 Vite 实例、种子、重复同步和自定义或链接目标拒绝；这些单元夹具不生成官方模板、不启动 Chromium，也不清理真实维护数据。

[安全工作流](../../.github/workflows/security-audit.yml)每周及手动运行，[Dependabot](../../.github/dependabot.yml)维护 GitHub Actions，具体范围见[依赖安全](security.md#定时检查)，npm 升级仍属于 reinit。

## 扩展通信验收

SDK 回归覆盖身份、权限、文档授权、撤销、消息预算和断开清理。真实 Chromium 验证网站 → worker → 内容脚本 → 网站、worker 终止恢复、界面订阅、导航、撤销和来自独立文档的洪泛。单元结果与真实浏览器结果分别记录，资源取消不能算产品通过。[通信指南](extension-communication.md)。
