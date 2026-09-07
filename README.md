# 星序 Astra · 一站式交互学习平台

星序 Astra 将可交互实验与教学管理结合在同一平台中，Web 实验体验与后端课程、协作和评价同等重要。当前包含：

- **工科试验室**：数学、物理、化学、算法、生物五大学科，共 90 个交互实验。
- **代码空间**：独立子站 [`/codevis/`](codevis/README.md)，提供 6 组课程目录、18 个“预测—运行—追踪—修正”活动以及 JavaScript、Python、C、C++ 浏览器学习运行时。
- **未来星系**：6 个跨学科方向、19 个活动身份，以课程目录、Canvas 观测和按需 Three.js 互动组织地球与宇宙、工程、数据、信息、材料与人文学习。

正式门户位于 `qianduan/`，使用 TypeScript、Vite、原生 DOM 和 Three.js；Python/FastAPI 提供认证、课程、作业、内容、学习分析与治理 API。三个原有实验空间保留，构建时打包为独立公开资源。

[打开 GitHub Pages 演示](https://falling-feather.github.io/Astra/) · [前端开发与发布](qianduan/README.md)

## 当前状态

- `main` 保存完整源码，`qianduan` 保存 Pages 静态制品。线上使用明确标识的内存演示数据，本机完整版本连接真实账号和数据库。本轮采用普通开发提交，未新增产品发布号；提交与验证见 [本阶段记录](doc/03-发布历史.md#8-2026-09-07-正式门户接入与前后端封装)。
- 登录前导览、Cookie Session、教师申请、课程创建与审核、学生选课、多教师共享草稿、不可变发布、三种完成结果和三角色工作台均已进入当前实现。
- 三个学习空间合计 127 项正式活动身份：工科试验室 90、代码空间 18、未来星系 19。课程可引用这些活动；目录身份数量不等于独立实验或完整教学闭环的数量。
- 当前迁移包含个人笔记与发布单元状态修复，准确迁移 head 见 [部署指南](doc/04-部署指南.md)。本轮完成教师课程/版本/学生/批改、学生作业和必要管理审核页面；课程家族、跨分叉同步、候选批审和补做策略仍属于后续计划。公网业务后端、隔离源码执行和真实课堂实证未作为已完成能力。
- 当前作品服务毕业设计、大作业与展示类竞赛；先打磨 Web 交互和后端架构，微信小程序暂不设计。实验端强调课程广度、递进、适配与解释性；业务规则和实施顺序见 [更新规划](doc/02-更新规划.md)，目标图见 [架构设计](doc/01-开发者手册.md#13-目标架构与设计待实现)。

当前实现见 [`doc/01-开发者手册.md`](doc/01-开发者手册.md)，下一阶段任务与版本见 [`doc/02-更新规划.md`](doc/02-更新规划.md)，全部版本、验收证据与历史档案统一见 [`doc/03-发布历史.md`](doc/03-发布历史.md)。

## 快速开始

### 推荐：9001 单入口一键启动

在 Windows PowerShell 中从仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\astra-local.ps1
```

先安装 `.node-version` 指定的 Node.js 和 Python 3.12+。脚本创建仓库内忽略的 `.venv`、按 `backend/requirements.lock` 安装哈希锁依赖、构建正式前端、执行 Alembic 迁移，并把前端与 API 同源启动在 `http://127.0.0.1:9001/`。数据默认保存在 `%LOCALAPPDATA%\Astra\local-preview`；再次执行会识别已经运行的星序站点，停止使用 `Ctrl+C`。

需要保持仓库内不产生 `.venv` 时，可把托管虚拟环境显式放到仓库外；路径允许 Unicode 和空格，但规范化后不得等于仓库根目录或位于其子目录：

```powershell
$ExternalVenv = Join-Path $env:LOCALAPPDATA "Astra\Python 环境\preview venv"
powershell -ExecutionPolicy Bypass -File .\astra-local.ps1 -VirtualEnvironmentPath "$ExternalVenv"
```

该模式拒绝 Windows device namespace；所选目录及其现存祖先、`Scripts/python.exe`、依赖标记和 `Lib/site-packages` 也不得经过 junction、symlink、volume mount 或 cloud reparse point。脚本在所选目录创建/复用 Python 3.12+ 环境，要求该解释器回报的 `sys.prefix` 精确归属所选目录，按同一哈希锁安装依赖，并把锁文件 SHA 标记保存在该环境内，不创建或修改仓库 `.venv`。已有的调用方自管 Python 则使用 `-PythonExecutable "<python.exe>" -SkipDependencyInstall`；两种参数互斥。自管模式不安装依赖、也不写依赖标记，而是在创建数据目录、审计盐、环境配置、迁移、初始化或 Uvicorn 之前，先用解析后的同一可执行文件执行离线哈希锁 dry-run 和 `pip check`，任一步失败即停止。后续 pip、Alembic、bootstrap、演示初始化和前台 Uvicorn 也始终使用选定的精确 Python。

全新数据目录需要首个管理员时，使用交互式入口；密码只在隐藏输入和当前进程内短暂存在，不写入参数、脚本或仓库：

```powershell
powershell -ExecutionPolicy Bypass -File .\astra-local.ps1 -BootstrapAdmin
```

这是当前展示版的正式启动与验收入口；它不配置域名、TLS、Windows 服务或正式 MySQL，也不能被描述成 staging/production。完整边界见 [`doc/04-部署指南.md`](doc/04-部署指南.md)。

### 前端独立开发与演示

在仓库根目录执行：

```bash
npm --prefix qianduan ci --ignore-scripts
npm --prefix qianduan run dev -- --port 5173 --strictPort
```

访问 `http://127.0.0.1:5173/`。真实模式的 `/api` 和 `/labs` 代理到上述本机 9001 服务。只看演示效果时改用 `npm --prefix qianduan run dev:demo`；独立打包、子路径与发布步骤见 [前端说明](qianduan/README.md)。

### 单独运行业务 API

需要 Python 3.12+：

```bash
cd backend
python -m pip install --require-hashes -r requirements.lock
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

默认数据库是本地 SQLite，也是当前展示版要求复验的数据库。以后恢复生产发布时，才需要显式配置 MySQL、关闭自动建表，并按 [`doc/04-部署指南.md`](doc/04-部署指南.md) 执行预检、迁移、烟测和回滚检查。

`backend/requirements.txt` 是直接依赖约束输入，不能用于发布安装。依赖升级必须在独立变更中同时更新哈希锁：先安装 `uv==0.10.6`，再从仓库根目录执行 `python backend/scripts/compile_requirements_lock.py --exclude-newer YYYY-MM-DD`；CI 会重新解析并拒绝漂移。

上述 8000 入口只运行 API；正式门户联调优先使用 9001 一键入口。其他域名或端口需同时配置前端接口地址和后端允许的来源，具体见 [部署指南](doc/04-部署指南.md)。

### 兼容用途：C++ 静态服务

需要 CMake 与完整支持 C++17 filesystem 的编译器（GCC 9.1+、现代 Clang 或 MSVC）：

```bash
cmake -S server -B server/build -DCMAKE_BUILD_TYPE=Release
cmake --build server/build --config Release --target verify_build_manifest
```

C++ 进程只承担静态资源和内部存活探针，业务 `/api/*` 必须由反向代理转发到 FastAPI。FetchContent 固定 cpp-httplib v0.18.3 的完整 commit；构建旁生成并校验包含产物 SHA-256、工具链和依赖来源的 `englab_server.build-manifest.json`，离线缓存用法见 [`server/README.md`](server/README.md)。

## 质量门禁

```powershell
# 后端全量回归；真实 MySQL 专项在未提供隔离数据库时会显式跳过
python -m pytest backend

# 精确 Node/npm + package-lock；覆盖全部跟踪脚本语法与前端契约
npm ci --ignore-scripts
npm test

# 正式门户行为、类型、构建与公开制品
npm --prefix qianduan ci --ignore-scripts
npm --prefix qianduan test
npm --prefix qianduan run build
npm --prefix qianduan run verify:package

# 工作区差异检查
git diff --check
```

GitHub Actions 分别运行 Windows 前端合同、Linux 门户构建、SQLite 全量、MySQL 8.4 发布证据和 C++ Release 构建。当前阶段另实测新门户桌面三角色业务和 Pages 子路径；旧 `role-workflows-proof.cjs` 绑定 V8 页面选择器，仅供兼容与历史追溯，不能代替新门户浏览器验收。验证结果和未覆盖范围见 [本阶段记录](doc/03-发布历史.md#8-2026-09-07-正式门户接入与前后端封装)。

## 项目结构

```text
.
├── qianduan/                  # 正式门户、请求适配、演示适配及制品脚本
├── index.html                 # 原实验站资源入口，构建时纳入 labs
├── package.json/package-lock.json # Node 质量工具入口与 integrity 锁
├── pages/                     # 三个原有学习空间及兼容角色页面
├── shared/                    # 实验求解/渲染、资源路由和兼容模块
├── codevis/                   # 代码空间独立子站
├── backend/                   # FastAPI、SQLAlchemy、Alembic、脚本与 pytest
├── server/                    # Node 开发静态服务与 C++ Release 静态服务
├── tools/quality/             # 跨平台跟踪脚本语法门禁
├── tools/tests/               # 前端/静态公开面契约
├── doc/                       # 开发、规划、历史、部署、UI、审查与索引文档
└── .github/workflows/         # 持续集成质量门禁
```

## 文档入口

| 文档 | 职责 |
| --- | --- |
| [`doc/00-项目总纲.md`](doc/00-项目总纲.md) | 项目定位、系统边界、文档控制面和协作入口 |
| [`doc/01-开发者手册.md`](doc/01-开发者手册.md) | 当前实现、核心业务、启动与边界入口；详细技术分流到 11—19 号子文档 |
| [`doc/02-更新规划.md`](doc/02-更新规划.md) | 当前与后续任务、业务规则、依赖和验收标准 |
| [`doc/03-发布历史.md`](doc/03-发布历史.md) | 当前发布判断与 V4—V8 分卷索引；详细历史位于 31—35 |
| [`doc/04-部署指南.md`](doc/04-部署指南.md) | 环境、迁移、反向代理、服务、回滚与运维 |
| [`doc/05-UI规范模板.md`](doc/05-UI规范模板.md) | UI、Canvas、响应式与可访问性规范 |
| [`doc/06-实验体验与信度审查报告-20260606.md`](doc/06-实验体验与信度审查报告-20260606.md) | 实验体验与教学事实口径审查 |
| [`doc/07-后端优化与设计.md`](doc/07-后端优化与设计.md) | 后端与三端平台的长期设计决策 |
| [`doc/08-前端页面实现索引.md`](doc/08-前端页面实现索引.md) | 页面、路由、模块与实现文件定位 |
| [`doc/09-后端阶段收束小版本开发安排.md`](doc/09-后端阶段收束小版本开发安排.md) | 后端重构阶段顺序、退出门禁、历史锚点与目标环境证据边界 |
| [`doc/99-历史审视报告归档.md`](doc/99-历史审视报告归档.md) | 旧版一次性审视报告归档 |

## 核心边界

- 认证会话使用 HttpOnly cookie；前端不持久化 Bearer token 或学生敏感学习数据。
- `/api` 全状态 `no-store`，Service Worker 不缓存业务 API。
- 教师自定义脚本必须经过 allowlist、审核、SRI/hash、opaque iframe 与 CSP 边界，不能直接执行任意脚本。
- C++/Node 静态服务只公开 `index.html`、`sw.js`、`LICENSE.md`、`pages/`、`shared/`、`UI/`、`codevis/`。
- 外部投递、问题同步和审计锚定默认关闭，不能用本地 dry-run 冒充真实外部证据。

## 许可证

使用条件与第三方资源说明见 [`LICENSE.md`](LICENSE.md)。
