# 职教星云 — 开发入口

这是 Astra 仓库内的职业教育工作区。源码、人物场景素材、API、共享包、测试和启动器均在本目录；开发与启动不引用原“揭榜挂帅”文件夹。产品架构、计划、历史和部署统一维护在根目录 [doc](../doc/00-项目总纲.md)，不再维护另一套产品文档。

## 模块分工

| 目录 | 职责 |
| --- | --- |
| `apps/web` | React 页面、路由、接口适配与 Three.js 场景；正式媒体位于 `public/assets` |
| `apps/api` | Fastify 接口、身份/会话、教学任务、作品与存储装配 |
| `packages/contracts` | 跨包 DTO、校验与领域协议 |
| `packages/course-content`、`scenario-catalog` | 课程内容、场景定义与发布配置 |
| `packages/world-core`、`session-control` | 世界规则、允许动作、学习状态与会话控制 |
| `packages/context-engine`、`content-store` | 上下文、资料检索、本地向量接线与 PGlite 内容库 |
| `packages/model-gateway`、`agent-runtime`、`agent-orchestrator` | 模型适配、角色职责与智能体协作 |
| `packages/iflytek-adapter`、`media-processing` | 可选语音/媒体能力与任务处理 |
| `scripts`、`e2e` | 构建、校验、运行、内容导入与浏览器流程回归 |
| `assets`、`演示` | 测试输入与 PDF 解析样本；演示手册是历史测试样本，现行说明以根 `doc/` 为准 |

更详细的调用图、修改路径与边界见 [01 开发者手册](../doc/01-开发者手册.md#25-职教模块与维护路径)。保留内部 `@ronggang/*` 包标识以维持依赖与数据协议；界面品牌为“职教星云”。

## 安装与运行

本目录使用独立 `pnpm-lock.yaml`；Node 与 Corepack 按 [部署指南](../doc/04-部署指南.md#1-运行方式与环境) 准备。以下命令均在 `zhijiao/` 执行：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

开发 Web 默认 5173，API 默认 3001。正式本机预览运行 `powershell -ExecutionPolicy Bypass -File .\启动职教星云.ps1`，Web 为 4173。联合启动与主站数据库的选择见 [04](../doc/04-部署指南.md#8-职教子站运行与数据)。清理后首次运行会重新构建产物。

`.env.local`、真实数据目录、Python/向量模型环境是本机配置；它们不进入 GitHub。未提供模型配置时使用明确的 deterministic 演示服务。真实 DeepSeek、检索材料、向量环境、转写与媒体理解的前提分别见 [可选模型配置](../doc/04-部署指南.md#9-可选-ai-配置与验证边界)，构建通过不代表这些外部能力已启用。

## 按修改范围验证

```powershell
corepack pnpm check:docs
corepack pnpm test:tools
corepack pnpm check:versions
corepack pnpm check:secrets
corepack pnpm typecheck
corepack pnpm --filter @ronggang/web test
corepack pnpm build
```

业务逻辑修改选择对应包的 `test`；`pnpm test` 包含全工作区测试，`pnpm check` 是完整阶段检查，日常小改无需反复全量运行。

端到端测试入口为 [playwright.config.ts](playwright.config.ts) 与 [e2e](e2e/)。先构建并安装测试浏览器，再以 `pnpm test:e2e:built --list` 查看场景。当前默认覆盖显式登录、URL 身份边界、课程目录、教师班级与会话恢复；作品、采访和模型效果另按对应业务测试验证。隔离 API/Web 端口分别使用 `E2E_API_ORIGIN` 和 `E2E_WEB_ORIGIN`，测试使用独立临时数据库。

公开导览使用独立的 `pnpm test:e2e:public`，先构建 `scripts/build-public-demo.mjs`，再把生成的 `.local/public-student-demo/dist` 作为静态根提供服务（默认测试地址 4180）。`E2E_WEB_ORIGIN` 可指定地址，`E2E_PUBLIC_BASE_PATH` 可指定仓库子路径。它不属于动态站的默认测试集。

已构建的动态启动检查可运行：

```powershell
$env:DEMO_API_PORT='3002'
$env:DEMO_WEB_PORT='4174'
$env:DEMO_SKIP_BUILD='1'
corepack pnpm start:smoke
```

冒烟检查覆盖 API 健康、Web 代理、演示身份及登录会话，结束后关闭所创建的进程与临时数据；不等同于真实模型/RAG 和全部浏览器场景验收。

## 文件与交付

保留源码、锁文件、测试、完整媒体和配置模板；依赖、构建结果、`.local`、数据库和密钥遵循根 [.gitignore](../.gitignore)。定向数据备份/核验/恢复仍由 `data:backup`、`data:verify`、`data:restore` 执行。

原独立仓库的 `release:*` 发版脚本已退出本仓库：它们依赖旧版本标签、另一套文档和既有发布收据，不适用于 Astra 的分支交付。旧原文从 Git 历史追溯。当前以根仓库分支保存双站完整源码，学术 Pages 制品仍由 `qianduan/scripts/publish-demo.mjs` 单独发布。
