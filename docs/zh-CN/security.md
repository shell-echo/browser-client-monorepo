# 依赖安全

[English](../security.md) · [中文文档](README.md) · [项目首页](../../README.zh-CN.md) · [开发](development.md) · [框架更新](reinit.md) · [测试](testing.md)

项目审计锁定的依赖图，并在接受本地缓解措施前验证实际行为。策略和命令以[工作区配置](../../pnpm-workspace.yaml)、[审计脚本](../../scripts/audit-dependencies.mts)和[安全回归测试](../../scripts/tests/security.test.mts)为准。以下描述当前锁文件与验证策略，不代表未来审计结果。

## 审计命令与现有补丁

```sh
pnpm audit:security
pnpm audit --prod
```

shadcn CLI 是根工程与界面包的开发依赖，但 `shadcn/tailwind.css` 在构建时仍参与解析。锁文件中的传递依赖 `braces@3.0.3` 针对 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 使用本地 `patches/braces@3.0.3.patch`，限制字符串解析和直接 AST 输入的递归遍历深度。补丁注册于 `pnpm-workspace.yaml#patchedDependencies`，由唯一锁文件固定，并在 reinit 中保留。

原始 `pnpm audit` 根据包版本匹配通告，可能仍报告已修补版本。`audit:security` 先验证补丁 SHA、锁文件覆盖和已安装包的行为，再读取完整审计响应。只有经过验证的精确通告与版本组合才归类为本地已缓解，不使用全局忽略列表。其他问题和注册表错误仍使检查失败。回归测试包含在 `pnpm check` 中；braces 补丁限制递归深度，不保证限制任意 glob 或正则表达式的资源消耗。

采用已验证的上游修复后，应同时移除补丁和对应验证策略。删通告记录或只修改版本字符串不等于修复。

## 查询序列化与对象合并保护

Express 工具链在原有 `^6.14.0` 范围内解析到锁定的 `qs@6.16.1`，对应 [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) 的上游修复。测试通过真实 Express 和 body-parser 消费者覆盖恶意 JSON、启用原型的解析、两条逗号序列化路径中的空原型对象，以及正常解析和序列化。

`deepmerge@4.3.1` 针对 [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) 使用 `patches/deepmerge@4.3.1.patch`：在源或目标赋值前丢弃 `__proto__` 键，同时覆盖 CommonJS 和 UMD 入口。实现参考[上游修复提案](https://github.com/TehShrike/deepmerge/pull/274)，保留正常深合并、数组、符号、日期和克隆选项。

审计会检查补丁注册、锁文件 SHA、全部 deepmerge 快照及真实已安装的 shadcn 和 registry 消费者，才认可该精确组合的本地缓解。行为检查覆盖空原型目标、空值或原始值嵌套默认项、目标自身键和数组元素，也检查返回对象的原型，因为该攻击不一定修改全局 `Object.prototype`。新通告、其他版本、收据缺失或注册表错误仍失败。切换到已验证的上游修复时，同时移除此补丁与验证策略。

## IP 解析器上游修复

工具依赖图使用 `ip-address@10.7.4` 修复 [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5)。SOCKS 与 MCP 限流器依赖链在现有范围内更新，没有添加该包的通告例外或本地补丁。

回归测试检查全部锁定版本和实际消费者不低于 `10.7.4`。独立子进程在五秒期限内验证百万字符的畸形 zone 标识符以及正常 IPv4 / IPv6 解析。这些测试进入普通检查和在线、离线 reinit 候选验证；易受攻击的缓存版本会在替换前被拒绝。在线审计继续检查新增通告。

## 工具链上游修复

当前 catalog 使用 shadcn 4.22.1 的上游 Zod 4 集成，并在兼容范围更新 HTTP / URI 传递依赖：Zod 至少 4.6.6、body-parser 至少 2.4.0、undici 7.x 至少 7.30.1、fast-uri 3.x 至少 3.1.9。

相关通告包括 [Zod 集合资源耗尽](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、[body-parser 压缩请求体失败](https://github.com/advisories/GHSA-27r3-jxmh-p828)、[undici 响应流失败](https://github.com/advisories/GHSA-xjj6-f33q-929c)和 [fast-uri scheme 解码](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)，以及实时审计返回的关联通告。升级遵守上游依赖范围，不强制将 Zod 3 消费者跨主版本替换，也不添加审计例外。测试检查全部受影响锁定包，并加载真实 shadcn CLI 和 Zod schema API，普通检查及 reinit 候选、最终检查均执行，包括离线重放。

## 定时检查

`.github/workflows/security-audit.yml` 每周一 UTC 01:23，即北京时间 09:23，冻结安装并运行同一审计，也可手动触发。定时任务在发布到默认分支后生效，实际运行时间由 GitHub 调度决定。它只检查现有锁文件，不升级依赖或改源码；未解决问题使工作流失败并保留日志。

`.github/dependabot.yml` 每周检查 GitHub Actions 版本并合并为分组更新 PR。npm 依赖继续由兼容求解与必要验收流程管理，Dependabot 不负责这些升级，也不自动合并更新。

[安全工作流](../../.github/workflows/security-audit.yml)审计已有版本，[框架更新](reinit.md)负责依赖升级。
