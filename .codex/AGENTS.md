# 星序 Astra 项目指引

## 当前基线

星序 Astra 是多星系全栈学习平台：

- 工科试验室：五大学科、88 个可视化实验。
- 代码空间：`codevis/` 独立子站与多语言运行时。
- 未来星系：六个跨学科探索方向。
- Python/FastAPI 业务后端：认证、学校/班级/课程、作业、内容、学习分析、任务与审计。
- Node/C++ 静态服务：只承担审核后的浏览器资源托管。

V6.6.63 后端阶段已经完成；V7.4 完成项目对接、注册 / 生命周期、认证与角色资源、组织治理、统一三星系总览、单一全局治理和 9001 一键入口；V7.5 完成代码空间、未来星系、课程编排、教师进度、OJ 诚实降级和全仓 review。V7.6 由 `主开发` 作为集成分支，`main@V7.5.11` 保持公开稳定。V7.6.5 / BE-006、V7.8.0 / BE-007、V7.8.2 / BE-011、V7.9.4 / UI-003、V7.9.7 / DATA-001 与 V7.9.12 / DATA-002 均已进入当前集成线；`CONTENT-003 / V7.7.0` 已冻结未来星系六方向 / 18 门课程矩阵，`CONTENT-001 / V7.7.15` 已冻结三星系六门代表课程。`FE-012 / V7.7.22` 已集成精确单元访问处置接线、固定诊断、请求取消 / ABA 隔离与 Zoom 打开态 resize；`TOOLS-002 / V7.7.25` 已在 `de3afdbf` 集成 strict-readonly 外部 Python / venv 启动能力。`QA-014 / V7.7.26` 随后在 clean detached `b56e@de3afdbf` 上完成真实 9001 / SQLite / 外部 Edge 复验并以 P0=0、P1=2、P2=2、P3=0 RETURN FE-012：物理力学缺少学生 `corrected` 路径，已知 locked / hidden 物理深链仍激活模块与 Canvas，实验指南首个 Escape 存在约 100ms 焦点空窗，恢复后重复写入 `started`。Zoom 旧位图早采样已撤销为未证实，不得作为返修依据。V7.7.27 唯一分配给原 FE-012 集中修复，V7.7.28 预留给同一 QA-014 精确复验。FE-013 继续等待 A03a PASS；FE-017 仍等待 26 号视觉规格与完整概念图两次用户确认。当前交付目标仍是课程作业 / 设计大赛的本地展示版：优先课程互动、学生—教师—管理员协同、SQLite 数据对账和 9001 一键启动；真实 MySQL、公网 R6、隔离 runner、压力测试、真实课堂试点与 AI 能力后置。任务、责任、版本与门禁只认 `doc/02-项目规划.md`。

当前增量：V7.7.26 已对 `de3afdbf6934ec4e321bce75fa0595df0c67fed6` 完整执行 216 个跟踪 JavaScript / 43/43 前端合同、76 项定向后端、578 项后端全量、正式启动、三角色 API、外部 Edge 双视口与只读 SQLite 终账。自动化、权限矩阵、响应式、44px、Zoom、普通 missing 固定诊断、console 与资源释放大项通过；A03a 因四项精确前端缺陷 RETURN。QA 的教师 correction 误操作只记程序性数据污染，不计产品缺陷；启动后 `content_pages=1` 是 local-preview 确定性 seed，旧 empty-baseline 失败只记 runbook 阶段错配。外部浏览器与 9001 已关闭，`b56e` clean、无 `.venv`；V7.7.26 TEMP `C:/Users/niu-h/AppData/Local/Temp/astra-qa-v7726-db881ce314d546e9b760aca625544592` 及证据原样保留。原 FE-012 将在新登记的 `f27a` 独立工作树集中修复四项缺口；旧 `d6b6` 只保留审计，`a02c` 永久禁入。所有更新仍以 `doc/02-项目规划.md` 为准。

DATA-001 与 DATA-002 已完成并集成；专业组保留在 `C:/Users/niu-h/.codex/worktrees/992d/工科实验室 / codex/data-v7.9-teacher-demo-sample @ a920642`，工作树 clean、写入关闭。V7.9.12 只为 `control-flow.loop-boundary` 增加 pending 作业样例及专项断言，通用初始化器 blob 保持不变；未新增模型、迁移、endpoint、service、router、直接数据库写入或修改前端 / UI / teacher / Future。

BE-011 已完成并集成；专业组保留在 `C:/Users/niu-h/.codex/worktrees/0dce/工科实验室 / codex/be-v7.8-unit-access @ 35fa219`，工作树 clean、写入关闭。`V7.8.2` 只新增独立 course-unit-access schema / endpoint / service、router 注册和专项测试，未修改模型、迁移、冻结课程 endpoint/schema 或前端。

FE-012 / V7.7.22 已集成；旧专业组树 `d6b6@5db1112e` 保持 clean、写入关闭。QA-014 / V7.7.26 已形成四项真实产品缺陷并 RETURN 原 FE-012；V7.7.27 将从最新主开发控制点建立 `C:/Users/niu-h/.codex/worktrees/f27a/工科实验室` / `codex/fe-v7.7-a03a-four-fixes`，只允许精确返修与受影响 01/08，不得复用旧树或触碰 Future。

QA-014 / V7.7.23 与 V7.7.24 的 BLOCKED / NOT-RUN 现场继续冻结。V7.7.26 在 `b56e@de3afdbf` 完整运行后以 P0=0、P1=2、P2=2、P3=0 RETURN；浏览器、服务与所有仓库均已收束，`b56e` detached、clean、无 `.venv`。本轮唯一 TEMP `C:/Users/niu-h/AppData/Local/Temp/astra-qa-v7726-db881ce314d546e9b760aca625544592` 及 `evidence/final-handoff.json`、targeted ledger、SHA-256 manifest 原样保留。旧 `89e8`、`c91f` 与三个 QA TEMP 不移动复用，`a02c` 永久禁入。

TOOLS-002 / V7.7.25 已在 `C:/Users/niu-h/.codex/worktrees/6f2a/工科实验室` / `codex/tools-v7.7-readonly-local-start` 完成，精确候选 `ba3d02c4e8712e9ba10fd8499f99f5dc0bb43d6b`，父 `0262b322401e644cafc8a31bcfa8b405ebb6df94`，工作树 clean。候选只修改登记的 9 个启动器、合同与入口文档文件；首轮独立复审 RETURN 后由原 owner 返修，最终复审 P0—P3=0 并由本提交集成。工具写入关闭；共享 02/03、requirements、后端、前端、部署脚本和所有 QA TEMP 始终冻结。

## 文档职责

- `README.md`：项目入口、启动、质量门禁和文档导航。
- `doc/00-项目总纲.md`：项目定位、宏观系统边界、文档控制面和协作入口。
- `doc/01-开发者文档.md`：当前实现的规范入口；`doc/01-开发者手册.md` 保留为详细实现卷。
- `doc/02-项目规划.md`：任务原件、责任组、依赖、版本、项目对接、风险和当前状态的唯一权威来源；`doc/02-更新规划.md` 只作兼容入口。
- `doc/03-开发历史.md`：V7.4.12 起的新提交和阶段结果；`doc/03-发布历史.md` 保留 V7.4.11 及以前的历史档案。
- `doc/04-部署指南.md`：环境、迁移、代理、服务、回滚和运维。
- `doc/05-UI规范模板.md`：UI、Canvas、响应式和可访问性。
- `doc/07-后端优化与设计.md`：后端/数据/权限/三端长期设计。
- `doc/08-前端页面实现索引.md`：前端页面、路由和文件定位。

完成项不得长期留在规划文档；临时过程记录不得进入 README 或开发者手册。

## 项目对接与写入

1. 当前“星序 Astra｜主开发｜总控”已经恢复，由主开发独占 `主开发` 根工作区和共享 `02/03`；`main` 只接收已收束的稳定版本，`houduan` 保留下一轮后端开发起点。
2. 项目对接模式已经启用。CONTENT、FE、BE、QA 已按标准标题恢复并登记独立 worktree；CONTENT 与 QA 只读，写入组只在收到主开发的精确任务 / 版本 / 文件包后写各自物理目录。V7.7.26 已真实 RETURN 原 FE-012；当前只恢复 FE-012 / V7.7.27，在新 `f27a` 独立工作树集中修复四项缺口。BE、DATA、UI、TOOLS 与 QA 写入均关闭；不得创建竞争 FE / QA 任务或复用旧 d6b6 / b56e。
3. `doc/02-项目规划.md` 与 `doc/03-开发历史.md` 由主开发集中写入；恢复后的专业组只维护各自专属实现文档差异并在 handoff 中提供任务 / 历史摘要，禁止并行修改共享 02/03 造成冲突。
4. 恢复后的 QA 必须独立验收主开发或专业组交付；主开发自测不能替代 QA 回执。
5. `qianduan` 旧 worktree 无唯一提交，已由 `ARCH-002 / V7.6.9` 删除；`qianduan` 分支与本地标签 `archive/qianduan-wip-before-main-sync-20260727` 继续保留，标签只用于恢复和审计，不是开发入口。
6. 后端 `dafe` 工作树已安全移除；前端 FE-012 的唯一未提交候选保存在 detached `C:/Users/niu-h/.codex/worktrees/a02c/工科实验室`。该目录现在是不可写的保全来源：任何组都不得在其中删除、覆盖、提交、清理或继续开发。FE 只能只读审查，并在主开发发放版本令牌后把获准范围选择性重放到已登记的独立 FE 工作树。`codex/team-be` 与 `codex/team-fe` 仅作历史 / 候选审计锚点。
7. `主开发` 及其任务分支使用 `Vx.y.z GROUP type(scope): 中文说明（TASK-ID）`，责任组、任务编号与标题必须一致；`review` 当前冻结，只有用户重新启动 review 周期后才恢复 `reN：中文说明`。
8. 用户离线期间，全部当前及后续小组不得向用户发起权限或审批申请；既有任务授权与系统安全边界内的动作直接推进。若平台强制审批、权限不足或安全规则阻断某一步，必须立即停止受影响动作，不绕过、不重复申请、不扩大范围；保留精确错误、路径、日志、已完成 / 未完成项和现场状态，向主开发回报并把受影响任务标记为暂缓，不等待用户在线。该规则适用于 PM、CONTENT、FE、BE、DATA、UI、QA 及后续任何工作组，但不扩张原任务授权。

## 工程边界

1. 业务 API 只进入 `backend/`，不要在 C++ 静态服务中恢复业务占位接口。
2. 全局前端组件初始化必须幂等；页面和实验必须有匹配的 init/destroy 清理。
3. 认证使用 HttpOnly cookie-only；敏感学习状态不得进入普通浏览器存储或 Service Worker 缓存。
4. 学校、班级、课程、协作者和作业策略是不同授权轴，优先复用 `app.services.access_control` 与现有策略服务。
5. 教师自定义脚本必须经过审核、allowlist、SRI/hash、sandbox/CSP 和版本绑定。
6. 外部投递/问题同步/审计锚定默认关闭，启用需要独立审批和真实 staging 证据。
7. 数据库结构变化必须带 Alembic、回滚考虑和 SQLite 升级 / 降级 / 再升级；MySQL DDL / 条件门禁不得破坏。真实 MySQL 实证只在用户恢复生产发布任务后成为硬门禁。
8. 学生 AI 助教、教师 AI 教学助手、AI 维护 / 管理助手均为展示后条件任务；当前不得显示为可用。以后接入时，AI 输出只作建议，权威完成、评分、发布、权限和治理写入必须继续由人确认并通过既有领域 API 与审计链执行。
9. 未来星系层级重构以 `doc/02-项目规划.md` 第 1.4 节、`doc/02-子文档/25-V7.7未来星系18课程内容与路由冻结矩阵.md`、`doc/02-子文档/26-V7.7未来星系页面视觉规格.md`、`FE-017`、`QA-015` 为唯一规划入口。18 门课程全部保留，CONTENT-003 已完成；V7.7.26 已真实 RETURN FE-012，必须先以 V7.7.27 关闭学习完成、发布深链、Escape 与重复 started 四项缺口并由 V7.7.28 复验。26 号视觉规格仍待用户确认，之后必须生成并再次确认完整概念图。只有 A03a 通过和两次视觉确认完成、FE 写入分支从最新集成点建立并收到新版本令牌后，FE-017 才能写入产品代码。

## 验证要求

- 后端：`python -m pytest backend`。
- Python 依赖：新环境/CI 使用 `backend/requirements.lock` 和 `--require-hashes`；直接约束变化后以固定 uv 版本重生成，并执行 `python backend/scripts/compile_requirements_lock.py --check`。
- Node 工具链：使用 `.node-version` 的 Node 22.20.0、npm 10.9.3 和 `npm ci --ignore-scripts`；Playwright 只从 `package-lock.json` 安装，不在安装阶段下载浏览器。
- 前端契约与 JavaScript 语法：`npm test`，必须覆盖全部 Git 跟踪的 JS/CJS/MJS。
- 用户界面：桌面与 390×844 浏览器验收，检查页面身份、交互、console、重复 ID、遮罩和溢出。
- C++/CMake：合格 C++17 工具链构建 `verify_build_manifest`；FetchContent 必须复核完整 commit，离线模式必须显式提供已验证 source，公开面 smoke 保持 `/api/info`、`/api/eval` 和私有路径 404。
- 提交前：`git diff --check`，并确认无临时数据库、构建目录、截图或本机工作区。

## Git 提交

- `主开发` 及其任务分支使用 `Vx.y.z GROUP type(scope): 中文说明（TASK-ID）`；版本由 02 唯一分配。`V7.6.6`、`V7.6.7`、`V7.6.11`、`V7.6.12` 均为已取消的空预留，不得复用；`V7.6.15—16` 只属于 `PM-015`，`V7.7.0` 只属于 `CONTENT-003`，`V7.7.1—2`、`V7.7.6`、`V7.7.8`、`V7.7.10`、`V7.7.12`、`V7.7.17`、`V7.7.19`、`V7.7.22` 与 `V7.7.27` 只属于 `FE-012`，`V7.7.3` 只属于 `FE-017` 的视觉规格提案而非产品实现，`V7.7.4` 只属于 `TOOLS-001`，`V7.7.25` 只属于 `TOOLS-002`；`V7.7.5`、`V7.7.7`、`V7.7.9`、`V7.7.11`、`V7.7.16`、`V7.7.18`、`V7.7.20`、`V7.7.21`、`V7.7.23`、`V7.7.24`、`V7.7.26` 与 `V7.7.28` 只属于 `QA-014 A03a`。V7.7.26 记录完整复验 RETURN，V7.7.27 集中返修四项缺口，V7.7.28 只复验精确候选；`V7.8.0` 已由 `BE-007` 使用，`V7.8.2` 已由 `BE-011` 使用，均不得复用。
- 增量版本对账：`V7.7.13—14`、`V7.9.2—3`、`V7.9.5—6`、`V7.9.8—11` 与 `V7.9.13—15` 属于 PM 控制面；`V7.9.9` 只固化用户离线协作阻断规则，`V7.9.10` 只登记 V7.7.22 的 FE 写入包，`V7.9.11` 只冻结 DATA-002 单课程补样，`V7.9.13` 只登记 V7.7.23 的 QA 运行包，`V7.9.14` 只登记 TOOLS-002 写入包与 V7.7.26 QA 续验，`V7.9.15` 只登记 V7.7.26 的精确 QA 工作树与运行包；`V7.7.15` 属于 `CONTENT-001`，`V7.9.4` 唯一分配给 `UI-003`。
- DATA 增量：`V7.9.6` 只属于 PM-009 的数据组实态登记，`V7.9.7` 唯一分配给 DATA-001 本地演示初始化器，`V7.9.12` 唯一分配给 DATA-002 单课程教师演示补样；任何组不得自行猜测或复用。
- `review` 分支当前只保留 V7.5.11 冻结基线；新 review 周期经用户明确启动后使用 `reN：中文说明`。
- 不提交 `WIP`、`temp`、`checkpoint` 或无实际内容的提交。
