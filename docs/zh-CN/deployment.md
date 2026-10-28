# 部署与交付

[English](../deployment.md) · [中文文档](README.md) · [项目首页](../../README.zh-CN.md) · [应用](applications.md) · [框架更新](reinit.md) · [测试](testing.md)

本指南覆盖默认根路径模板。托管服务和凭据由派生业务项目选择；构建或打包本身不会部署服务或上传扩展商店。

## 构建注册实例

```sh
pnpm install --frozen-lockfile
pnpm app doctor
pnpm app build web
pnpm app build admin
pnpm app build extension
```

自定义实例替换为实际 ID，例如 `pnpm app build portal`。`pnpm build` 构建当前注册组合；空组合没有应用产物。构建需要根锁文件、共享包和集成脚本。交付前运行 `pnpm check`、`pnpm audit:security` 及受影响的浏览器验收。

## 网站：Next.js Node 服务

默认构建生成 `apps/<id>/.next`，用于 Next.js 服务部署：

```sh
pnpm app build web
pnpm app start web
```

启动命令绑定本机回环地址及注册端口。Node 主机应在匹配环境中冻结安装工作区、构建指定实例、管理启动进程，并在前面配置 HTTPS 反向代理。使用 Next.js 托管平台时，可将实例目录设为应用根，但仍需从仓库解析工作区依赖和锁文件。[Next.js 官方部署说明](https://nextjs.org/docs/app/getting-started/deploying)。

`.next` 不能直接当作通用静态目录。独立输出、静态导出、容器和平台适配器各有要求，需要在 reinit 适配器中保留相关配置，并验证最终选定的产物。

## 管理后台：静态托管与路由回退

执行 `pnpm app build <id>` 后，发布 `apps/<id>/dist` 的**目录内容**。Vite preview 用于本地验证，不是生产托管服务。[Vite 官方部署说明](https://vite.dev/guide/static-deploy.html)。

默认历史路由要求 `/login`、`/dashboard` 等应用路径回退到 `index.html`；`/assets/` 下缺失文件应返回 404。根路径 Nginx 示例：

```nginx
root /srv/admin/dist;

location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
}
```

在实际主机配置域名和 TLS，部署后检查 `/login`、`/dashboard` 和未知路由的直接访问及刷新。缺失 JavaScript 不能得到 HTML 回退，路由恢复依赖真实的分块加载失败。

### 部署到子目录

模板默认部署在 `/`。改为 `/admin/` 时，应同步配置 Vite `base`、React Router `basename`、链接和公共资源地址，仅改其中一项不够。框架修改写入 `scripts/lib/integrate.mts` / `scripts/lib/tooling.mts`，浏览器断言也要覆盖前缀和真实托管布局。只改生成的 `vite.config.ts` 会在 reinit 时被重建。

## 环境输入

真实 `.env*` 放在 `apps/<id>/` 并保持私有，只提交脱敏的 `.env.example` / `.env.<name>.example`。起始项目目前不要求业务 API 配置。

`NEXT_PUBLIC_*` 和 `VITE_*` 是公开的客户端输入，可能在构建时写入产物；之后修改主机环境不会替换已生成的客户端值。凭据和签名私钥放在服务端或发布系统，扩展包同样是可下载的客户端代码。

应用 `.env*` 已参与构建缓存。新增影响构建的服务端变量时，将变量名加入 `turbo.json` 的 `build.env`、记录用途，并在值变化后重建。运行时服务端配置传给 Next.js 启动进程；引入必填业务变量时补充校验。

## 扩展：经过验证的生产 ZIP

```sh
pnpm app build extension
pnpm extension:package extension --dry-run
pnpm extension:package extension

# 其他扩展实例使用自己的 ID 和 manifest 版本
pnpm app build addon
pnpm extension:package addon
```

打包读取已构建的 **`dist`**，校验生产 Manifest V3、版本与 `manifest.config.ts` 一致，拒绝开发客户端、私有环境文件和符号链接，确保 ZIP 根目录包含 `manifest.json`。打包时暂停编辑和构建；源码变化后先重建，打包器本身不能证明旧构建已使用每一份当前源码。

产物与逐文件 SHA-256 收据写入新的私有 `.reinit/releases/<id>-<timestamp>-<nonce>/`，不覆盖已有交付。文件排序和固定元数据使相同输入可复现。标准 ZIP 使用不压缩的 store 方法，输入最多 128MiB、10,000 个文件以限制本地内存；更大的业务扩展需要另行验证流式打包器。

商店版本来自 `manifest.config.ts` 的 `version`，工作区包的初始 `0.0.0` 不是商店版本。版本由一到四个数字段组成，每段不超过 65535、无前导零，且不能全部为零；后续提交需递增。`dist-dev` 和普通网页预览仅用于开发。

提交前在 Chrome 和 Edge 加载生产 `dist`，检查弹出页、设置和权限。商店简介、隐私说明、截图、发布者认证与上传凭据属于发布环节。参考 [Chrome Web Store](https://developer.chrome.com/docs/webstore/publish) 和 [Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) 官方指南，仓库没有配置自动上传。

## 框架更新与交付记录

reinit 保留业务源码、manifest、浏览器配置、打包工具和本指南。根 axe 工具参与在线兼容依赖规划及离线重放；实例浏览器配置中的额外扫描路径会保留，无障碍等浏览器门槛在替换前执行。

`.reinit/releases/` 独立于框架替换和普通成功工作区清理，收据、验收报告与失败记录按各自保留规则维护。刷新依赖或重新构建不会自行发布产物。
