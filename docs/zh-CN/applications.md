# 可组合的应用实例

[English](../applications.md) · [中文文档](README.md) · [项目首页](../../README.zh-CN.md) · [开发](development.md) · [框架更新](reinit.md) · [测试](testing.md)

默认的网站、管理后台和扩展分别是三种内置模板的实例。可以保留一个应用、同类型多个实例、任意组合，或显式使用空注册表，同时保留共享包。

## 注册表与身份

`apps.config.json` 声明实例和开发端口，例如：

```json
{
  "$schema": "./schemas/apps.schema.json",
  "schemaVersion": 1,
  "apps": {
    "website": { "type": "web", "port": 3000 },
    "portal": { "type": "web", "port": 3001 },
    "admin": { "type": "admin", "port": 5173 },
    "operations": { "type": "admin", "port": 5175 },
    "addon": { "type": "extension", "port": 5174 }
  }
}
```

每个实例拥有 `apps/<id>` 和包名 `@browser-client/<id>`。名称使用小写字母、数字和连字符；保留名称、重复键、路径穿越和重复端口均会被拒绝。端口为 1024–65535 的整数，支持的工作区布局是 `apps/*` 和 `packages/*`。

`template-versions.json` 分别记录实例身份和官方生成器版本；每个 `app-identity.json` 必须与记录一致。目录缺失、托管条目遗漏、名称或类型漂移会停止维护。编辑注册表不会隐式删除应用，应使用生命周期命令增删实例。开发端口变更后需要重启服务；重命名和类型转换尚需另行实现显式迁移。

受支持目录中的非托管工作区保持完整，并参与兼容性、安装、构建、lint 和类型检查，但不会自动重建或自动分配浏览器断言。

## 查看与运行

```sh
pnpm app list
pnpm app doctor
pnpm app dev operations
pnpm app build portal
pnpm app start portal
pnpm app preview-ui addon
pnpm dev
pnpm build
```

原有开发别名仅指向默认实例名，移除对应实例后会失败。自定义实例使用 `pnpm app`，未知选择器不会被当成成功的空筛选。

端口来自注册表。可用 `APP_INSTANCE_ID=addon APP_DEV_PORT=3202 pnpm app dev addon` 临时覆盖单个进程；旧的 `EXTENSION_DEV_PORT` 仅适用于恰好一个扩展实例。HTTP 和热更新共用端口，占用时不会静默换端口。浏览器验收使用独立端口，并串行运行实例。

## 添加、移除与恢复

```sh
pnpm app add portal --type web --port 3001
pnpm app add portal --type web --port 3001 --apply
pnpm app add operations --type admin --port 5175 --apply
pnpm app remove extension
pnpm app remove extension --apply --offline
pnpm app restore ARCHIVE_ID
pnpm app restore ARCHIVE_ID --apply --offline
```

预览只读且不访问包注册表。实际添加会在隔离目录生成最新稳定版官方框架模板，并接入 `templates/<type>` 中独立的页面、资源和实例测试，不以既有业务应用作为原型。共享组件、b0、Inter 和工程预设继续位于 `packages/`。

添加操作保留现有兼容的锁定依赖。如果最新框架无法使用该基线，会在替换前停止；先完成并验证完整 reinit 后再重试。新实例需要在线官方模板；已有实例的离线 reinit 则依赖版本记录、包缓存和 Chromium 缓存。

反向 workspace/file/link 引用会阻止移除。移除更新依赖图和收据，不升级无关客户端。含业务和环境源码的私有归档位于 `.reinit/archives/<operation-id>/`，普通 `reinit:clean` 不清理它。

恢复会校验归档身份和源码，拒绝占用中的名称或端口，并将该实例接入当前工作区，不还原旧的全仓锁文件。依赖不兼容或离线缓存缺失会停止操作，恢复后归档仍保留。

## 重建与故障恢复

```sh
pnpm reinit portal
pnpm reinit portal --apply
pnpm reinit all --apply --offline
pnpm app recover OPERATION_ID
pnpm app recover OPERATION_ID --apply
```

若中断使根 `package.json` 或依赖处于替换间隙，直接执行 `node scripts/app.mts recover OPERATION_ID --apply`。该启动入口仅依赖 Node 内置模块，会先恢复原依赖树，再运行检查。

reinit 保留业务源码、资源、环境文件、manifest、实例测试和共享界面。未选择的框架仍构成兼容约束。在线模式使用最新稳定框架和最高兼容托管依赖，ESLint 至少为 10；离线模式仅重放匹配记录和缓存。

所有实际维护操作共用同一把锁，在隔离生成、严格安装、工作区检查和全部注册实例浏览器验收通过后才替换。源码、注册表、依赖策略、锁文件和身份记录一起备份，并在替换前检查并发编辑、在最终位置再次验证。

恢复根据预写计划核对真实文件系统，覆盖重命名与日志更新之间的中断，并支持恢复自身再次中断后续跑。有冲突编辑、进程登记不确定或分离子进程仍运行时，保留锁和两份数据。维护期间应停止相关服务并暂停编辑；维护锁不会锁住编辑器，本地归档也不是异地备份或断电原子事务。

## 测试与偏好隔离

实例拥有自己的 `browser-tests.config.mts` 和 `tests/*.test.mts`；根浏览器配置按实例 ID 提供可选覆盖。自定义页面后更新实际业务断言。`pnpm test:browser` 要求每个注册实例都有报告，拒绝缺失、重复、跳过或过期证据；确实为空的注册表会明确报告浏览器检查不适用，但仍需基础检查。

`pnpm test:apps` 在私有副本中覆盖空组合、仅后台、六实例组合，以及每类两个实例、官方模板添加、离线移除与恢复、同源 cookie 隔离、离线重建和依赖替换时的 SIGKILL 恢复。`pnpm test:reinit` 单独覆盖当前组合的在线与离线更新，以及 ESLint 最低版本拒绝。它们都较耗时；手动 **Reinit acceptance** 工作流可选择其中一种，只上传诊断记录，不上传业务源码或环境文件。

Cookie 和主题键使用实例命名空间。共享界面从应用外壳接收公开身份，不将仓库配置打入客户端包。原始实例可按标记迁移旧偏好，新实例不会读取旧偏好。注册表、身份和运行时集成变更均参与构建缓存。
