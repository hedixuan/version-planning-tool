# Version Planning Tool

一个可独立迁移、只读的版本计划校验与可视化工具。项目不依赖任何特定业务仓库，不预设阶段名称、版本数量或 ID 格式；消费项目只需提供配置和 JSON 数据。

## 环境与安装

- Node.js `>= 22.17`
- pnpm

```bash
pnpm install
pnpm build
pnpm link --global
```

安装后可使用 `version-plan`。也可以直接运行 `node dist/cli.js`。

## 消费项目配置

在需要查看的项目根目录创建 `version-plan.config.json`：

```json
{
  "dataFile": "planning/roadmap.json",
  "schemaFile": "planning/project-roadmap.schema.json"
}
```

- `dataFile` 必填，指向版本计划 JSON。
- `schemaFile` 可选，用于对通用基础 Schema 施加项目自己的附加约束，例如 ID 格式、项目专用枚举或必填规则。
- 两个路径都必须是消费项目内的相对路径。绝对路径、`..`、Windows ADS、越界符号链接及不存在的路径会被拒绝。
- 服务不会提供通用文件读取、文件写入或命令执行接口。

基础数据结构由 `schema/roadmap.schema.json` 定义，核心字段如下：

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "sample-product",
    "name": "示例产品"
  },
  "releases": [
    {
      "id": "first-release",
      "name": "首个版本",
      "status": "ready",
      "goal": "交付首个可用版本"
    }
  ],
  "requirements": [
    {
      "id": "account-login",
      "title": "账号登录",
      "releaseId": "first-release",
      "status": "ready",
      "dependsOn": [],
      "acceptance": ["用户可以使用有效账号登录"],
      "evidence": []
    }
  ]
}
```

状态固定为 `backlog`、`ready`、`in_progress`、`blocked`、`review`、`done`、`cancelled`。版本状态由其非取消需求聚合：

1. 没有非取消需求：`cancelled`。
2. 全部完成：`done`。
3. 存在 `in_progress` 或 `review`：`in_progress`。
4. 否则存在 `ready`：`ready`。
5. 全部阻塞：`blocked`。
6. 其他情况：`backlog`。

校验同时检查基础 Schema、可选扩展 Schema、重复版本/需求 ID、未知版本、断裂依赖、循环依赖和版本聚合状态。

## CLI

```bash
# 校验；失败时退出码为 1
version-plan validate --project /path/to/consumer

# 构建后启动只读 Web 服务
version-plan serve --project /path/to/consumer
version-plan serve --project /path/to/consumer --port 4300 --host 127.0.0.1
version-plan serve --project /path/to/consumer --open
```

`serve` 只接受 `localhost`、`127.0.0.0/8`、`::1` 等 loopback 地址，明确拒绝 `0.0.0.0` 和局域网地址。服务提供：

- `GET /__health`
- `GET /api/roadmap`
- 构建后的前端静态资源

所有响应带基础安全响应头；路线 API 禁止缓存。服务是只读的，不包含修改数据的路由。
每次 `serve` 会生成随机会话令牌并把完整访问地址输出到终端；`--open` 会直接打开该地址。路线 API 同时校验令牌以及 `Origin`/同源 `Referer`，不要删除地址中的 `token` 参数或分享该会话地址。

## 开发

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm dev` 启动 Vite 前端开发服务器。完整消费数据由构建后的 `version-plan serve` 提供；Vite 已配置将 API 转发到本机 `4173` 端口。

前端是 Linear / Plane 风格的只读工作台，包含：

- 概览、任务列表、状态看板、版本路线四个主视图
- 侧边栏版本进度、阻塞与待验收计数
- 状态、版本、优先级、负责人、标签组合筛选与排序
- 结构化任务详情：依赖导航、验收条件、证据、来源与更新时间
- `Ctrl+K` 聚焦搜索、`Enter`/`Space` 打开任务、`Esc` 重置筛选

项目数据全部来自 `/api/roadmap`，界面不提供写接口或拖拽改状态。仅状态定义属于工具自身契约。
