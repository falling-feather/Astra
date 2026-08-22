# 星序 Astra · 多学科可视化学习平台

星序 Astra 是一个面向学习者与教师的多星系可视化学习平台。当前包含：

- **工科试验室**：数学、物理、化学、算法、生物五大学科，共 88 个交互实验。
- **代码空间**：独立子站 [`/codevis/`](codevis/README.md)，提供 6 组课程目录、18 个“预测—运行—追踪—修正”活动以及 JavaScript、Python、C、C++ 浏览器学习运行时。
- **未来星系**：6 个跨学科课程群、18 个独立活动，以课程目录、单目标子课、Canvas 观测和按需 Three.js 互动组织地球与宇宙、工程、数据、信息、材料与人文学习。

主站采用 Vanilla JavaScript 单页应用；Python/FastAPI 提供认证、课程、作业、内容、学习分析与治理 API；C++/Node 静态服务只公开经过审核的浏览器资源。

## 当前状态

- `main@V7.5.11` 是公开稳定线；`主开发` 已进入 V7.6 活动集成，`houduan` 保留下轮后端起点，`review` 保持冻结。
- 登录前置、Cookie Session、三角色资源裁剪、星序统一角色工作台、三星系课程、教师编排、组织治理和 9001 本机同源交付已经进入当前实现。
- 代码空间和未来星系均为 6 组/18 活动；默认 `DisabledCodeRunnerAdapter` 只诚实持久化 `runner_unavailable`，不会把未配置判题器伪报为通过。
- Alembic 当前 head 为 `20260809_0052`；0051 提供权威学习证据，0052 把学生源码修订与网络重放分离：同一 `client_submission_id` 的精确重放返回原提交，同键异载荷返回 `409`，新键可形成新的 submission/attempt。V8.0.3 的 SQLite 迁移、幂等、权限与 QA-016 CODE-01 定向门禁已通过；完整后端仍只有 484 秒 `TIMEOUT`，真实 MySQL 与隔离 runner 均为 `NOT-RUN`，不得外推为生产 OJ 已完成。
- 当前作品定位为课程作业 / 设计大赛本地展示版：优先完成代表课程互动和学生—教师—管理员三端协同。真实 MySQL、隔离 runner、staging/production、公网 TLS、压力测试和真实课堂试点保留为后置工程，不阻塞 V8.0 展示候选。

当前实现见 [`doc/01-开发者手册.md`](doc/01-开发者手册.md)，下一阶段任务与版本见 [`doc/02-更新规划.md`](doc/02-更新规划.md)，全部版本、验收证据与历史档案统一见 [`doc/03-发布历史.md`](doc/03-发布历史.md)。

## 快速开始

### 推荐：9001 单入口一键启动

在 Windows PowerShell 中从仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\astra-local.ps1
```

脚本会自动创建仓库内忽略的 `.venv`、按 `backend/requirements.lock` 安装哈希锁依赖、执行 Alembic 迁移，并把前端与 API 同源启动在 `http://127.0.0.1:9001/`。数据默认保存在 `%LOCALAPPDATA%\Astra\local-preview`；再次执行会识别已经运行的星序站点，停止使用 `Ctrl+C`。

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

### 手动拆分 1：启动静态主站

需要 `.node-version` 指定的 Node.js 22.20.0（配套 npm 10.9.3）。先按锁安装测试/浏览器证明工具，不执行依赖安装脚本：

```bash
npm ci --ignore-scripts
node server/dev-static-server.mjs --port 8766
```

访问 `http://127.0.0.1:8766/`。该开发服务器使用显式公开白名单，不会暴露 `backend/`、`doc/`、`.git/` 或仓库根目录中的其他文件。

### 手动拆分 2：启动 Python 业务后端

需要 Python 3.12+：

```bash
cd backend
python -m pip install --require-hashes -r requirements.lock
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

默认数据库是本地 SQLite，也是当前展示版要求复验的数据库。以后恢复生产发布时，才需要显式配置 MySQL、关闭自动建表，并按 [`doc/04-部署指南.md`](doc/04-部署指南.md) 执行预检、迁移、烟测和回滚检查。

`backend/requirements.txt` 是直接依赖约束输入，不能用于发布安装。依赖升级必须在独立变更中同时更新哈希锁：先安装 `uv==0.10.6`，再从仓库根目录执行 `python backend/scripts/compile_requirements_lock.py --exclude-newer YYYY-MM-DD`；CI 会重新解析并拒绝漂移。

联调入口：

```text
http://127.0.0.1:8766/?backendSchema=1&apiBase=http%3A%2F%2F127.0.0.1%3A8000#home
```

### 手动拆分 3：可选 C++ 静态服务

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

# 9001 三角色业务证明：先以全新 -DataDirectory 和 -BootstrapAdmin 启动服务；
# 再只在当前证明进程临时提供同一管理员用户名/密码，--out 指向仓库外空目录。
$env:ASTRA_QA_ADMIN_USERNAME = '<刚才创建的管理员用户名>'
$secret = Read-Host '管理员密码' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$proofOut = Join-Path $env:TEMP ('astra-role-proof-' + [guid]::NewGuid().ToString('N'))
try {
  $env:ASTRA_QA_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
  node tools/browser/role-workflows-proof.cjs --api http://127.0.0.1:9001 --web http://127.0.0.1:9001 --out $proofOut --confirm-isolated-environment
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
  Remove-Item Env:ASTRA_QA_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:ASTRA_QA_ADMIN_USERNAME -ErrorAction SilentlyContinue
}

# 指定 staging 使用 --confirm-target-staging；API/web 必须是同一真实 HTTPS origin，
# Git 必须干净，--out 必须显式指向仓库外不存在或为空的目录，
# bootstrap token 只通过 ASTRA_ADMIN_BOOTSTRAP_TOKEN 环境注入；成功后直接使用
# <out>/target-browser-smoke.json 进入 target-release-v2 seal，完整诊断保留在同目录。

# 工作区差异检查
git diff --check
```

GitHub Actions 仍保留 MySQL 8.4 兼容证据和 C++ Release 构建，防止已有工程能力退化；当前展示版的退出门禁以自动化、本机 9001、浏览器桌面/390×844、三角色数据对账和干净仓库为准。

## 项目结构

```text
.
├── index.html                 # 主站 SPA 外壳
├── package.json/package-lock.json # Node 质量工具入口与 integrity 锁
├── pages/                     # 首页、星系、学科、实验与三端页面
├── shared/                    # 主站路由、组件、API client 与设计系统
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
| [`doc/01-开发者手册.md`](doc/01-开发者手册.md) | 当前实现、架构、模块、运行、验证与扩展方式的完整开发者手册 |
| [`doc/02-更新规划.md`](doc/02-更新规划.md) | 任务原件、认领、版本、项目对接、状态和验收标准 |
| [`doc/03-发布历史.md`](doc/03-发布历史.md) | 全版本提交、阶段结果、验证证据与历史档案 |
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
