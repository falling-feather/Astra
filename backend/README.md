# 星序 Astra · Python 业务后端

> **2026-09-05 适用期说明**：当前已提交基线为 `V8.6.6 / b886829`，Alembic 唯一 head 为 `20260825_0058`。本文件后文的 0053 基线和旧发布门禁保留历史语境；当前业务以 [开发者手册](../doc/01-开发者手册.md) 为准，本轮课程统计与单元替换修正见 [19 号说明](../doc/01-子文档/19-当前功能业务闭环与展示边界.md#1-当前课程学习统计)。

> **文档定位**：后端本地开发、API/服务边界、配置、迁移、运维脚本和验证入口。全部完成事实与历史实机证据统一见 [`../doc/03-发布历史.md`](../doc/03-发布历史.md)，未来任务见 [`../doc/02-更新规划.md`](../doc/02-更新规划.md)。
>
> **当前基线**：FastAPI + SQLAlchemy + Alembic 0053；SQLite 为安全本地默认，MySQL 为后置发布目标。0048 增加稳定课程/活动键和班级发布计划，0049 建立 provider-neutral 题目版本、代码提交与判题尝试/租约，0050 为过期租约的有界恢复增加复合索引，0051 建立权威学习证据、版本化完成规则和投影，0052 再以 `client_submission_id` 把学生多次源码修订与网络重放幂等分开，0053 为学习活动增加精确 runtime identity、逐事件 sidecar 与相互独立的 learner/server 游标。SQLite QA 账本从迁移脚本目录动态解析唯一 head，不写死 revision。默认 runner 仍关闭，API 不执行 shell、动态求值或外呼学生源码；0053 的 SQLite 往返、幂等、权限与 MySQL DDL 离线编译门禁已覆盖，但真实 MySQL、隔离 runner、staging 和公网 R6 仍为 `NOT-RUN`，本机结果不得外推。
>
> **最后更新**：2026-08-10

后端当前承担认证与会话、学校/班级/课程、作业/提交/批改、积分与知识状态、内容草稿/审核/发布/回滚、脚本隔离、管理治理、DB-backed 任务和审计链。`server/` 中的 Node/C++ 进程只承担显式白名单静态资源，不是业务 API。

Webhook、GitHub issue sync、audit anchor、远端脚本扫描等外部副作用继续默认关闭；只有显式配置、管理员确认、计划再校验和真实 staging 证据齐全后才可启用。

## Python 依赖锁

`requirements.txt` 只维护人工审查的直接依赖兼容范围；新环境、CI 和发布安装一律消费 `requirements.lock`。锁文件由 uv 0.10.6 面向 Python 3.12 通用解析生成，包含传递依赖、平台条件和发行包 SHA-256，不接受手工编辑。

```bash
cd backend
python -m pip install --require-hashes -r requirements.lock
```

依赖升级必须是独立提交或独立 PR，并同时审查直接约束与完整锁差异。更新时从仓库根目录运行：

```bash
python -m pip install uv==0.10.6
python backend/scripts/compile_requirements_lock.py --exclude-newer YYYY-MM-DD
python backend/scripts/compile_requirements_lock.py --check
```

`--exclude-newer` 固定本次解析可见的软件发布日期；`--check` 会从已提交锁的生成命令读取该日期，重新解析并在内容漂移时失败。升级 uv 本身也必须在同一独立依赖变更中同步修改脚本、CI、文档与锁文件。

## 9001 同源本机验收

推荐从仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\astra-local.ps1
```

入口自动准备 `.venv`、安装 `requirements.lock`、迁移 SQLite，并以前台 Uvicorn 进程从 `127.0.0.1:9001` 同源提供静态站和现有 FastAPI。`app.local_preview` 只挂载 `pages/`、`shared/`、`UI/`、`codevis/` 及三个根文件，不公开 `backend/`、`doc/`、`server/`、`.git/` 或仓库根目录。需要首管理员时只在全新/尚无管理员的本机数据库上增加 `-BootstrapAdmin`，凭据经交互式 stdin 进入权威 `/api/admin/bootstrap`。

默认无新增参数时仍创建/复用仓库 `.venv`。若仓库必须保持无虚拟环境，可使用仓库外托管目录：

```powershell
$ExternalVenv = Join-Path $env:LOCALAPPDATA "Astra\Python 环境\preview venv"
powershell -ExecutionPolicy Bypass -File .\astra-local.ps1 -VirtualEnvironmentPath "$ExternalVenv"
```

脚本先规范化路径并拒绝仓库根目录及其任何子目录、Windows device namespace，以及所选目录 / 现存祖先 / `Scripts/python.exe` / 依赖标记 / `Lib/site-packages` 上的 junction、symlink、volume mount 或 cloud reparse point。随后才在所选目录创建/复用 Python 3.12+，核对该解释器的 `sys.prefix` 精确等于所选 venv，从 `backend/requirements.lock` 使用 `--require-hashes` 安装，并把 `.astra-requirements.sha256` 留在该外置环境内；仓库 `.venv` 不会被创建或修改。调用方已经管理好解释器和精确依赖时，可改用 `-PythonExecutable "<python.exe>" -SkipDependencyInstall`。它与 `-VirtualEnvironmentPath` 互斥，只接受解析为 PowerShell `Application` 的 Python 3.12+；脚本不安装、不写标记，而是在数据目录、审计盐、环境变量、Alembic、bootstrap、演示初始化和 Uvicorn 之前依次执行离线哈希锁 dry-run 与 `pip check`。验证失败时以上副作用均不发生。路径可含 Unicode 和空格，所有 pip、Alembic、初始化与前台 Uvicorn 子命令都通过最终解析的同一 Python 执行。

三角色本机证明不得再次调用已关闭的运行时 bootstrap。先由 `astra-local.ps1 -BootstrapAdmin` 预置临时管理员，再仅在证明 Node 进程中成对设置 `ASTRA_QA_ADMIN_USERNAME` 与 `ASTRA_QA_ADMIN_PASSWORD`；脚本只消费该账号登录，不把密码写入报告。缺少任一变量时立即失败，目标 staging 仍使用独立的 `ASTRA_ADMIN_BOOTSTRAP_TOKEN` 语义，二者不可混用。

该入口强制 development + SQLite，只供本机功能验收；正式 staging/production 仍使用 `app.main`、MySQL、受保护 secret 与目标服务包，不能引用本机结果替代发布证据。

## API 单独启动

```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/api/health
```

公开健康响应只返回数据库连接状态，不返回数据库 URL、主机、库名或本地文件路径；`database.url_returned=false` 是拓扑门禁的一部分。

### V7.5.6 代码题目与判题契约

- `POST /api/code-problems`、`POST /api/code-problems/{problem_id}/versions`：课程编辑者或管理员为稳定 `CourseUnit.activity_key` 建题并追加不可变版本；学生响应不返回私有测试用例。
- `GET /api/code-problems/by-activity?course_id=...&activity_key=...&class_id=...`：按稳定课程身份发现题目；学生必须显式提供班级并经过 BE-004 发布状态，hidden/撤回发布失败关闭。
- `POST /api/code-problems/{problem_id}/submissions`：仅学生、仅 open 分块；语言规范为 `javascript/python/c/cpp`，源码与输入按 UTF-8 字节限制。学生+题目版本+班级构成幂等范围，相同内容重放返回原记录，不同内容返回 409。
- `GET /api/code-submissions` 及明细/source/attempts：学生只能读取本人且当前非 hidden 的历史；班级教师和管理员在授权范围内按班级、课程、活动数据库分页并可读源码。判题尝试分页使用 `/api/code-submissions/{submission_id}/attempts/page`；旧数组 attempts 仅兼容最多 200 项。
- `DisabledCodeRunnerAdapter` 是唯一默认适配器，只持久化 `runner_unavailable`。`app.services.code_judge` 仅定义问题/资源快照、原子 claim、租约过期重排与终态写回；任何真实执行器必须部署在 API 进程外并另行完成 CPU、墙钟、内存、输出、进程、无网络和无文件系统隔离验收。

### Review 高基数分页兼容

- `/api/classes/{id}/members/page`、`/api/assignments/{id}/submissions/page`、`/api/learning-events/page` 与 `/api/code-submissions/{id}/attempts/page` 是高基数读取的权威入口，统一返回 `items/total/limit/offset/next_offset`，`limit` 上限为 200。
- 对应旧数组端点继续标记 deprecated：先以 201 项探针保持 200 项以内的原数组兼容；结果超过 200 时返回 HTTP 409，`detail.code=legacy_list_limit_exceeded`，并提供保留原过滤条件的 `paged_url`。调用方不得通过重复旧端点恢复无界读取。
- 学生 `/api/learning-events/page` 默认只返回当前有效资源；只有显式 `include_inactive_locked=true` 才恢复组织已归档但课程仍可追溯的旧锁定历史。deprecated 数组端点保持旧兼容口径，避免迁移客户端静默丢失历史。

首个内容协议样例会在 `ASTRA_AUTO_CREATE_TABLES=true` 的开发/测试初始化阶段写入 `content_pages`，并经过 Pydantic schema 校验后返回。内置 seed 已升级到 `2026.07-v6.5-schema.2`，所有 section/source 都带稳定 `sectionId/sourceId`：

```bash
curl http://127.0.0.1:8000/api/render/page/physics/energy-conservation
```

正式环境不会依赖启动时自动 seed。完成迁移、部署预检和首个 admin 初始化后，用显式脚本初始化内置内容页：

```bash
python -m scripts.init_content_pages --dry-run --publisher-user-id <admin_id>
python -m scripts.init_content_pages --publisher-user-id <admin_id> --allow-reviewed-scripts
```

脚本默认先运行部署预检，再创建或修复 `content_pages` 与 `content_page_versions`。若已有同 slug 当前版本与内置 schema 不同，默认报告冲突；确认要追加新版本时再使用 `--upgrade-existing`。存在活跃草稿时升级会被阻断，只有明确接受草稿过期风险时才使用 `--allow-stale-drafts`。`--skip-preflight` 仅用于受控测试或恢复场景。

内容生命周期只读演练报告：

```bash
python -m scripts.content_lifecycle_drill --require-mysql \
  --render-url https://your-domain.example/api/render/page/physics/energy-conservation \
  --static-url https://your-domain.example/physics/energy-conservation
```

该报告检查 published current 指针、schema hash、版本链、active 草稿、脚本镜像、API no-store 和可选静态 fallback；默认不执行初始化、发布、回滚、外网下载或写库，不返回完整 schema、原始 CDN URL、完整 SRI、镜像字节或 `content_bytes`。当前回归已覆盖中文目录和中文 SQLite 文件名下的 Alembic 迁移、正式初始化 CLI、JSON 报告和内容页 current version 写入；内容发布链路也覆盖中文 slug 经百分号编码后的公开读取、后台搜索与版本过滤。

知识快照调度器只读演练报告：

```bash
python -m scripts.knowledge_snapshot_scheduler_drill --require-mysql --expect-scheduler-enabled
```

该报告检查 scheduler 配置、run ledger、lease/heartbeat、due/pending 队列、快照输出计数和真实 MySQL 待留证项；默认不执行 rebuild、不抢租约、不取消、不重排，不返回 `scheduler_lease_token`、`metadata_json`、异常原文或 secret。V6.6.61 已完成真实 MySQL lease/cancel/requeue/stale-token 与窗口精度证据；V6.6.62 已完成独立 worker 服务重启、包装/业务 PID 更替和服务恢复证据。普通用户对 `LocalService` 子进程的强制终止被 Windows 拒绝，未为造证据抬高账号权限；租约过期接管继续由 V6.6.61 的真实 MySQL token guard 证明。

内容脚本远端漂移观察只读演练报告：

```bash
python -m scripts.content_script_remote_drift_drill --require-mysql --expect-scheduler-enabled
```

该报告检查数据库方言、调度配置、host policy 桶、mirror 记录、scan run ledger、queue/alerts/outbox 和真实观察待留证项；默认不联网、不写库、不入队、不修改 host policy，不返回原始 CDN URL、完整 SRI、远端/镜像字节、`content_bytes`、异常原文、`scheduler_lease_token`、payload 或复核备注。V6.6.61 已完成真实 MySQL scan run 租约/取消/重试台账证据；真实安全 CDN 样本、外网扫描和目标 origin 浏览器复跑仍只在被选入 RC 后单独留证。

后端阶段门禁总账：

```bash
python -m scripts.backend_stage_gate --require-mysql \
  --database-url "mysql+pymysql://astra:******@127.0.0.1:3306/astra?charset=utf8mb4" \
  --require-production \
  --require-admin-bootstrap-token \
  --expect-knowledge-scheduler-enabled \
  --expect-content-script-scheduler-enabled \
  --run-topology-live \
  --static-url https://your-domain.example/ \
  --render-url https://your-domain.example/api/render/page/physics/energy-conservation \
  --proxied-api-url https://your-domain.example/api/health \
  --direct-api-url http://127.0.0.1:8000/api/health \
  --public-direct-api-url http://your-public-ip:8000/api/health \
  --external-probe-ref probe/external-change-001 \
  --verify-windows-services \
  --require-public-port-isolation \
  --run-rc-external-scope \
  --confirm-database-restore-evidence \
  --confirm-runtime-rollback-evidence \
  --confirm-backend-tests-passed \
  --confirm-core-manual-paths \
  --confirm-deploy-docs-reviewed \
  --confirm-admin-bootstrap-reviewed \
  --confirm-rollback-reviewed
```

该总账聚合部署预检、smoke、拓扑、认证、内容、调度、脚本和审计演练报告。默认保持 V6.6.44/14 项兼容；增加 RC 范围门禁后输出 V6.6.63/15 项。“确认”参数只表示已有外部证据；未使用真实 MySQL、未跑真实拓扑或缺少人工确认时，报告会保持缺证延期。

零外部通道 RC 的独立只读检查：

```bash
python -m scripts.rc_external_scope_gate \
  --confirm-database-restore-evidence \
  --confirm-runtime-rollback-evidence
```

本地账号与学校班级 API：

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/api/auth/register` | 本地账号注册；用户名会修剪并小写落库，重复校验大小写不敏感；拒绝短密码、纯数字/纯字母、常见弱口令和包含用户名的密码 |
| POST | `/api/auth/login` | 登录响应保留只供显式非浏览器 API 客户端使用的兼容 token，同时写入 HttpOnly cookie；浏览器三端必须采用 cookie-only，不读取、发送或持久化响应中的 Bearer token。Cookie+Bearer、重复同名会话 Cookie、重复 Authorization 和畸形 Authorization 均在会话查询前 fail closed，任何凭据不得静默覆盖另一凭据。生产环境 cookie 预期带 `Secure/HttpOnly/SameSite=Lax`；用户名按规范化值大小写不敏感匹配，连续失败达到阈值返回 `429` 与 `Retry-After`；成功登录会记录 best-effort 设备标识、登录 user-agent、`last_seen_at` 和 IP 哈希；成功、失败和锁定事件写入审计 |
| POST | `/api/auth/logout` | 注销当前用户所有活动会话，并写入审计 |
| POST | `/api/auth/password-reset/request` | 用户自助密码重置请求；响应始终泛化为 `ok`，active 用户会生成哈希存储的一次性 token，并按账号哈希/IP 哈希冷却；生产环境不返回 token，本地调试也必须显式开启 `ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV=true` |
| POST | `/api/auth/password-reset/confirm` | 使用一次性 token 重置密码；行锁消费 token，复用密码强度策略，成功后撤销用户未撤销会话、清理登录失败桶，并写入不含明文密码或 token 的 `auth.password_reset.*` 审计 |
| GET | `/api/auth/sessions` | 当前用户活动会话列表；只返回未撤销、未过期会话，并标记 `is_current`；返回 `device_label`、登录时 `user_agent`、`last_seen_at` 等会话摘要，不返回 token 或 IP 明文 |
| DELETE | `/api/auth/sessions/{id}` | 撤销当前用户自己的单个活动会话；撤销当前会话会清理 cookie，并写入 `auth.session.revoke` 审计 |
| GET | `/api/users/me` | 当前用户；已撤销、过期或非 active 用户会话返回 `401` |
| POST | `/api/admin/bootstrap` | 首个管理员受控初始化；除本地 dev/test 外必须提供 `ASTRA_ADMIN_BOOTSTRAP_TOKEN`，也可用 `ASTRA_ADMIN_BOOTSTRAP_ENABLED=false` 完全关闭；数据库控制锁保证并发单次，响应/审计不回显 token |
| GET/PATCH | `/api/admin/users` / `/api/admin/users/{id}` | 管理端用户列表与角色/状态维护；列表返回 `items/total/limit/offset/next_offset`；把用户置为 `disabled` 时撤销未撤销会话，并在 `admin.user.update` 快照记录 `revoked_sessions` |
| POST | `/api/admin/users/{id}/password-reset` | 管理员重置用户密码；复用密码强度策略，成功后撤销目标用户未撤销会话、清理登录失败桶，并写入不含密码明文或 hash 的 `admin.user.password_reset` 审计 |
| GET | `/api/admin/schools` | 管理端学校基础查看；支持分页与关键字搜索 |
| GET | `/api/admin/schools/{id}/stats` | 学校深度统计；全局管理员或该校 active teacher/admin 读取，聚合班级、成员、课程、作业、提交、事件和积分 |
| GET | `/api/admin/classes` | 管理端班级基础查看，可按学校过滤，支持分页与关键字搜索 |
| GET | `/api/admin/classes/{id}/stats` | 班级深度统计；全局管理员或该班 active teacher 读取，含预期提交、待批改比例、积分和平均得分 |
| GET/PATCH | `/api/admin/class-join-requests` / `/api/admin/class-join-requests/{id}` | 管理端班级加入申请队列与审批；队列支持 school/class/user/role/status/q/时间窗过滤 |
| GET | `/api/admin/content/pages` | 管理端内容页状态查看；数据库侧支持 status 过滤、limit/offset 分页与 slug/title/galaxy/subject/layout 搜索，返回 `schema_hash/current_version_id/published_*` |
| GET | `/api/admin/content/drafts` | 管理端内容草稿队列；支持 status/script_review_status/script_risk_level/author/q 分页过滤，返回 `schema_hash/base_version_id/base_schema_hash/script_risk_level/script_analysis` |
| GET | `/api/admin/content/page-versions` | 管理端内容版本历史；支持 slug/source_draft/restored_from/q 分页过滤，返回 `previous_version_id` |
| GET | `/api/admin/content/page-versions/{id}/diff` | 管理端内容版本 schema diff；默认沿显式 `previous_version_id` 链对比，`base_version_id` 可指定基线，跨 slug 返回 `422`；响应保留兼容 `changes` 并新增 `semantic` 摘要，section/source 变更项显式返回 `section_id_before/after` 与 `source_id_before/after`；raw changes 与 semantic field/prop changes 会对 token/key/secret/script/sandbox/integrity/crossorigin 等敏感字段返回结构化 redaction preview |
| GET | `/api/admin/content/script-assets` | 管理端内容脚本资产供应链清单；支持 slug/source_host/sandbox/page/version/发布人/policy/hash/时间窗/q 分页过滤，响应只返回 host、source URL hash、引用 hash、镜像字节 hash、大小和策略信息，不返回 `content_bytes`、原始 CDN URL 或完整 SRI |
| GET | `/api/admin/content/script-assets/mirror-audit` | 管理端内容脚本镜像一致性审计；只读扫描当前 published schema 与 `content_script_assets` 绑定，复核 `page_version_id + sandbox_id + reference_value_sha256`、source/integrity 元数据、本地字节 SHA-256/大小/SRI 和重复引用，响应与审计只返回 host/hash/问题码，不返回 `content_bytes`、原始 CDN URL 或完整 SRI |
| POST | `/api/admin/content/script-assets/remote-drift-scan` | 管理端内容脚本远端漂移扫描；请求体需显式 `confirm_external_network=true`，按 `limit/offset` 小批量读取当前 published 外部脚本远端字节并比对发布镜像 hash/大小/SRI，响应与审计不返回 `content_bytes`、远端字节、原始 CDN URL、完整 SRI 或异常明细，不自动修复或告警 |
| GET | `/api/admin/content/script-assets/remote-drift-scan-runs` | 管理端内容脚本远端漂移扫描 run 台账；按 status/trigger_source/alert_status/时间窗分页查看 `content_script_asset_scan_runs`，支持 manual/scheduler/script 触发来源和 running/failed/success 状态；响应只返回筛选、聚合 totals、issue counts、alert status、attempt count、租约 owner/过期/心跳和脱敏 issue 摘要数量，不返回 `scheduler_lease_token`、原始 CDN URL、完整 SRI、远端字节或异常明细 |
| GET | `/api/admin/content/script-assets/remote-drift-scan-runs/health` | 管理端内容脚本远端漂移扫描 run 健康摘要；汇总 running/failed/success、stale running、lease expiring、legacy running、issue run 与 problem runs，响应与审计不返回 `scheduler_lease_token`、原始 CDN URL、完整 SRI、远端字节或 issue 明细 |
| GET | `/api/admin/content/script-assets/remote-drift-scan-runs/queue` | 管理端内容脚本远端漂移扫描调度队列摘要；按当前 scheduler bucket、failed/stale manual review 和 active/legacy blocked run 区分 dispatchable now、manual review 与 blocked，调度器关闭且无积压时返回 `disabled`，不触发外网、不投递外部告警、不自动处置 |
| GET | `/api/admin/content/script-assets/remote-drift-alerts` | 管理端内容脚本远端漂移告警候选摘要；从最近 remote drift scan run 的脱敏 issue 摘要、failed run 和 stale running run 派生 severity/action hint，只读返回候选，不发送外部告警、不自动封禁 host、不修复或替换镜像 |
| POST | `/api/admin/content/script-assets/remote-drift-alerts/outbox` | 管理端内容脚本远端漂移告警 outbox 入队；请求体需 `confirm_observe_only=true`，按 `content_script_asset_scan_run_alert` source type 与候选 dedupe key 幂等创建或刷新 `pending_review` 人工复核项，不保存原始 CDN URL、完整 SRI、远端字节、异常明细或 `scheduler_lease_token`，不发送邮件/短信/Webhook、不自动封禁 host 或处置 run |
| GET/PATCH | `/api/admin/content/script-host-policies` / `/api/admin/content/script-host-policies/{source_host}` | 管理端内容脚本 CDN host 信任治理；列表合并已观测 host、配置 allowlist host 和持久化 policy，更新支持 `trusted/watch/blocked` 状态与原因；`blocked` 会阻断草稿创建/编辑、脚本审核、发布和回滚，`trusted/watch` 不绕过 allowlist/SRI/审核/发布前下载校验 |
| GET | `/api/admin/stats` | 管理端全站统计摘要；仅全局管理员读取 |
| GET | `/api/admin/performance/report` | 管理端索引/EXPLAIN/有界基准报告；可关闭 explain/benchmark 或要求 MySQL，响应与审计不返回 SQL、参数、结果值或数据库 URL |
| GET | `/api/admin/knowledge-snapshot-runs` | 管理端知识快照运行记录；支持 status/granularity/trigger_source/时间窗分页过滤，不返回 `scheduler_lease_token` |
| GET | `/api/admin/knowledge-snapshot-runs/health` | 管理端知识快照运行健康摘要；汇总 stale running、lease expiring、claimable、retryable/exhausted failed、problem runs，不返回 lease token 或 metadata |
| GET | `/api/admin/knowledge-snapshot-runs/queue` | 管理端知识快照调度积压摘要；区分 dispatchable now、claimable by lease rule、manual requeue 和 blocked runs，不返回 lease token 或 metadata |
| GET | `/api/admin/knowledge-snapshot-runs/alerts` | 管理端知识快照告警候选摘要；从 health/queue 派生 severity/action hint，响应与审计不返回 lease token、metadata 或重排原因明细，不投递外部告警 |
| POST | `/api/admin/knowledge-snapshot-runs/alerts/outbox` | 将知识快照告警候选显式写入管理端告警 outbox；请求体需 `confirm_observe_only=true`，按候选 dedupe key 幂等创建或刷新 `pending_review` 人工复核项，不发送邮件/短信/Webhook、不自动 requeue/cancel/清理 |
| GET | `/api/admin/alert-outbox` | 管理端告警 outbox 列表；支持 source_type/status/severity/action/event/time 分页过滤，当前仅承载本地人工复核台账；响应使用安全摘要，不返回 `dedupe_key`、完整 `payload_hash`、`payload_json` 或 `review_note` 正文，仅返回 `payload_hash_prefix`、状态字段和 `review_note_present` |
| GET | `/api/admin/alert-outbox/queue` | 管理端告警 outbox 队列摘要；汇总 pending_review/planned/queued/dispatching/failed/delivered/suppressed/cancelled、stale/due 和外部投递安全姿态，不返回 payload、复核备注、外部 URL、凭证或异常正文 |
| POST | `/api/admin/alert-outbox/dispatch-dry-run` | 管理端告警 outbox 执行预检；请求体需 `confirm_dry_run=true`，可选显式 `entry_ids` 或 source/time 筛选，只读分类 queued due、blocked、expired、not due 与终态项，返回脱敏 delivery key、payload hash 前缀和 blocker 原因计数；不写 outbox 状态、不增加 attempt、不接 broker、不投递外部告警 |
| POST | `/api/admin/alert-outbox/dispatch-plans` | 管理端告警 outbox 执行计划台账；请求体需显式 `entry_ids` 与 `confirm_create_plan=true`，最多 100 条，按 dry-run 口径生成并持久化脱敏计划摘要、有限 ready ID 和 blocker 原因计数；不写 outbox 状态、不增加 attempt、不接 broker、不投递外部告警 |
| GET | `/api/admin/alert-outbox/dispatch-plans` | 管理端告警 outbox 执行计划列表；支持 plan/dry-run/source/time 分页过滤，只返回计划摘要、计数和有限 ready ID，不返回 payload、复核备注或敏感明细 |
| GET | `/api/admin/alert-outbox/dispatch-plans/{id}` | 管理端告警 outbox 执行计划详情；按计划 ID 读取脱敏 ledger 摘要，供后续队列执行治理和审计复核使用 |
| POST | `/api/admin/alert-outbox/dispatch-plans/{id}/validate` | 管理端告警 outbox 执行计划再校验；请求体需 `confirm_validate_plan=true`，按计划 ready ID 重新检查 entry 存在、状态、due/expired、delivery 边界和 payload hash 快照，只写脱敏审计，不写 outbox 状态、不增加 attempt、不接 broker、不投递外部告警 |
| POST | `/api/admin/alert-outbox/dispatch-plans/{id}/dispatch` | V6.6.54 显式外部投递；请求体需 `confirm_external_dispatch=true`，默认关闭，配置完整后才把校验通过的 queued 项逐项投递到 HTTPS Webhook。状态写为 dispatching/delivered/failed，逐项增加 attempt、写脱敏审计；失败项可人工重新排队且不会回滚或阻塞告警来源业务事务 |
| POST | `/api/admin/background-tasks/alert-dispatch-plans/{id}` | 把 created 告警 dispatch plan 幂等写入统一任务控制面；需 `confirm_enqueue=true`，不直接外发 |
| POST | `/api/admin/background-tasks/knowledge-snapshots` | 按 day/week + reference date 幂等入队知识快照任务；需显式确认 |
| POST | `/api/admin/background-tasks/content-script-scans` | 按 request key 与脱敏筛选入队内容脚本扫描；入队不等于允许外网，worker 还需独立网络 opt-in |
| GET | `/api/admin/background-tasks` | 统一任务分页列表，可按 type/status/source 过滤；只返回幂等键前缀和结果摘要，不返回 payload/lease token |
| GET | `/api/admin/background-tasks/queue` | pending/leased/retry_wait/succeeded/dead_letter/cancelled、stale lease 与下一可用时间的只读摘要 |
| GET | `/api/admin/background-tasks/{id}`、`/{id}/attempts` | 单任务和逐次 attempt 历史；token/payload 保持隐藏 |
| POST | `/api/admin/background-tasks/{id}/retry`、`/{id}/cancel` | admin 显式确认的人工恢复；retry 仅作用于 dead-letter/cancelled，cancel 为协作式状态收口 |
| PATCH | `/api/admin/alert-outbox/reviews` | 管理端告警 outbox 批量人工复核；请求体需显式列出 `entry_ids`、目标状态和 `confirm_manual_review=true`，最多 100 条，all-or-nothing 更新状态/复核人/复核时间/备注；响应和审计只返回瘦身条目与聚合计数，不返回 payload 或备注正文 |
| PATCH | `/api/admin/alert-outbox/{id}` | 管理端告警 outbox 人工复核状态流转；请求体需 `confirm_manual_review=true`，可将条目标记为 `pending_review/planned/queued/suppressed/cancelled` 并记录 `reviewed_by_user_id/reviewed_at/review_note`；响应只返回 `review_note_present`，不回显备注正文、payload、dedupe key 或完整 payload hash，审计只记录脱敏状态摘要 |
| POST | `/api/admin/knowledge-snapshot-runs/{id}/cancel` | 管理端协作式取消 pending 或带 scheduler lease 的 running 知识快照 run；标记 `cancelled`、清空租约并写入 `admin.knowledge_snapshot_run.cancel` 审计 |
| POST | `/api/admin/knowledge-snapshot-runs/{id}/requeue` | 管理端手动重排 failed、cancelled 或过期带租约 running 知识快照 run；重置为 pending 并清空错误与租约，pending 幂等，active/legacy running 与 success 返回 `409` |
| GET | `/api/admin/audit-logs` | 管理端审计日志查询，分页返回，可按 actor/action/resource/request_id/event_result/failure_reason/时间窗过滤；响应包含 `prev_hash/current_hash` 应用层链式哈希 |
| GET | `/api/admin/audit-logs/export` | 管理端审计日志 JSON 导出；复用审计筛选与倒序排序，不使用 offset，默认 `limit=1000`、最大 `5000`，默认不返回 `snapshot_json`，但保留 `prev_hash/current_hash`；成功导出后写入 `admin.audit.export`，只记录筛选条件和导出摘要 |
| GET | `/api/admin/audit-logs/export.csv` | 管理端审计日志 CSV 导出；复用 JSON 导出的筛选、排序、`limit/truncated` 和 `include_snapshot` 边界，响应为下载附件并返回 `X-Audit-Export-*` 元数据头；默认快照列为空，显式包含快照时写入紧凑 JSON 字符串，CSV 表头包含 `prev_hash/current_hash`，文本单元格会中和表格公式前缀；成功导出后同样写入 `admin.audit.export` 摘要 |
| GET | `/api/admin/audit-logs/report` | 管理端审计日志 JSON 报表摘要；复用审计筛选，按 action/resource_type/actor_role/event_result/failure_reason 聚合，`bucket_limit` 默认 20、最大 100；成功生成后写入 `admin.audit.report` 摘要 |
| GET | `/api/admin/audit-logs/report.csv` | 管理端审计日志 CSV 报表摘要；与 JSON 报表同源，响应为下载附件并返回 `X-Audit-Report-*` 元数据头，只导出聚合行，不导出原始审计条目 |
| GET | `/api/admin/audit-logs/retention-plan` | 管理端审计留存预检；复用审计筛选，按 `ASTRA_AUDIT_LOG_RETENTION_DAYS`、`retention_days` 或 `before` 计算归档候选、临期数量、聚合桶和哈希链边界；成功生成后写入 `admin.audit.retention_plan` 摘要，响应显式标记不导出归档、不删除、不提供 WORM 或外部锚定 |
| GET | `/api/admin/audit-logs/chain-integrity` | 管理端审计链完整性校验；按 `from/to`、`limit` 和 `issue_limit` 顺序扫描审计日志，重算 `current_hash`、检查相邻 `prev_hash`、把历史空 hash 标记为 partial，并返回 `valid/partial/invalid`、计数和受限 issue 样本；成功生成后写入 `admin.audit.chain_integrity` 摘要，不修复、不删除、不提供 WORM 或外部锚定 |
| GET | `/api/admin/audit-logs/high-frequency` | 管理端审计高频候选摘要；复用审计筛选，默认查看最近 24 小时，按 action、actor/action、ip/action、resource/action 和 failure_reason 聚合候选；成功生成后写入 `admin.audit.high_frequency` 摘要，不记录候选明细 |
| GET | `/api/admin/submissions/pending` | 待批改队列；全局管理员可跨范围过滤，教师仅可读取本人任教班级内 `submitted/returned` 提交，`status=graded` 仍为管理员治理视图 |
| GET/POST/PATCH | `/api/admin/bugs` | 缺陷/风险清单基础维护；可记录外部 issue provider/id/url，列表支持分页、状态过滤和关键字搜索 |
| GET | `/api/admin/bugs/external-sync/posture` | 外部 issue 同步安全姿态；只报告 enabled/configured/provider/transport/本地权威和重试边界，不返回 owner/repo host、路径或 token |
| GET | `/api/admin/bugs/{id}/external-sync-operations` | 外部 issue 操作账本分页列表；返回 create/status/comment 的脱敏状态、attempt 和 receipt 摘要，不返回评论正文或完整操作键 |
| POST | `/api/admin/bugs/{id}/external-sync/create` | 管理员显式确认后创建 GitHub issue；稳定 create 操作键防重复，未知结果标记 ambiguous 并禁止盲重试 |
| POST | `/api/admin/bugs/{id}/external-sync/status` | 以本地 `BugRecord.status` 映射外部 open/closed；本地修订号进入操作键，外部响应不会反向覆盖本地状态 |
| POST | `/api/admin/bugs/{id}/external-sync/comments` | 管理员显式提交安全评论；按规范化评论 hash 幂等，敏感标记 fail closed，响应/审计/账本不保存评论正文 |
| GET/POST | `/api/schools` | 当前用户可见学校 / 创建学校 |
| GET | `/api/schools/{id}/classes` | 学校内班级 |
| GET/POST | `/api/classes` | 当前用户可见班级 / 创建班级；`GET ?mine=true` 只返回当前用户 active membership 对应班级 |
| POST | `/api/classes/{id}/join` | legacy/direct join 兼容入口：学生可直接生成学校/班级成员关系；teacher 角色 direct join 仅保留给全局 admin 或受控导入/邀请码路径，非 admin 教师必须走 join request 审批；若同角色已有 pending 申请，会同步转为 approved |
| GET | `/api/classes/{id}/members` | 班级教师或管理员查看成员列表；默认 `status=active`，可按 `role=student/teacher` 和 `status=active/inactive` 过滤 |
| PATCH | `/api/classes/{id}/members/{membership_id}` | 维护成员状态；班级教师仅可维护 student membership，管理员可维护 student/teacher membership，均只支持 `active/inactive` 并写入审计 |
| PATCH | `/api/classes/{id}/members/batch-status` | 批量维护成员状态；班级教师仅可批量维护 student membership，全局 admin 可批量维护 student/teacher membership；整批 all-or-nothing，最终不能让 active teacher 归零 |
| POST | `/api/classes/{id}/teachers/transfer` | 班级 teacher membership 转让；仅全局 admin 可把源 active teacher 转给同校 active teacher/admin，目标 membership 不存在则创建、inactive 则恢复，可选择停用源 teacher |
| POST | `/api/classes/{id}/students/{membership_id}/transfer` | 学生同校转班；要求操作者同时具备源班和目标班 active teacher scope，源 membership 软停用、目标创建或恢复，目标状态已存在时幂等返回 `applied=false` |
| POST | `/api/classes/{id}/students/batch-import` | 按校内用户名批量导入学生；只接纳 active 同校 student membership，逐项返回 `created/restored/unchanged/failed`，允许部分失败并按成员权威状态幂等 |
| POST | `/api/classes/{id}/join-requests` | 审批流入口：创建班级加入申请；不立即生成成员关系。active 正式教师即使尚无该校成员关系，也可凭已知 `class_id` 申请 teacher 角色；普通学生不能冒用 teacher 角色 |
| GET | `/api/classes/{id}/join-requests` | 班级教师或管理员查看加入申请，可按 `status` 过滤 |
| PATCH | `/api/classes/{id}/join-requests/{request_id}` | 班级教师或管理员审批加入申请，支持 `approved` / `rejected` |
| GET/POST | `/api/courses` | 当前用户可见课程 / 教师创建课程；学生仅返回本人 active 班级内 published 课程 |
| POST | `/api/courses/{id}/classes` | 将课程挂接到班级 |
| PATCH | `/api/courses/{id}/owner` | 课程 owner 转让；课程创建者或全局 admin 可转给同校 active teacher/admin，目标原 active collaborator 会置为 inactive |
| GET/POST | `/api/courses/{id}/collaborators` | 课程协作者列表与创建；课程 owner/admin 管理 `editor/content_editor/assessment_editor/viewer`，任一 active collaborator 可读取列表但不能管理协作者 |
| POST | `/api/courses/{id}/collaborators/batch` | owner/admin 批量 upsert 协作者；逐项返回 created/updated/unchanged/failed，active 写入要求同校 active teacher/admin，inactive 可回收已失校级范围的旧协作者 |
| PATCH | `/api/courses/{id}/collaborators/{collaborator_id}` | owner/admin 维护协作者角色与状态；重新激活时再次校验 active 同校 teacher/admin membership |
| GET/POST | `/api/courses/{id}/units` | 课程单元列表 / owner、active editor/content_editor 或全局 admin 创建单元；学生仅可读取 published 课程下的 published 单元 |
| GET | `/api/courses/{id}/assignments` | 课程作业列表；可传 `class_id` 读取 effective class policy，学生必须落到唯一 active 班级且只返回本班有效 active 作业 |
| POST | `/api/courses/{id}/units/{unit_id}/assignments` | owner、active editor/content_editor/assessment_editor 或全局 admin 创建作业，可声明 `audience_mode=all_attached_classes/selected_classes` |
| PATCH | `/api/assignments/{id}/audience` | 课程 owner/admin 切换作业受众模式；selected 模式只向持久化且 `assigned=true` 的班级开放 |
| GET/PUT/DELETE | `/api/assignments/{id}/classes/{class_id}/policy` | 读取、全量写入或删除班级作业策略；支持 assigned、状态/截止时间和积分规则覆盖；写入要求课程 editor/assessment_editor（owner/admin 等价）且同时具备本班 teacher scope |
| GET/POST | `/api/learning-events` | 学习事件查询 / 记录访问、提交、完成等事件；学生读写仅计入 published 课程、published 单元和 active 作业；教师查询按本班 teacher scope 收束 |
| GET | `/api/assignments/me` | 学生作业中心；按 active 班级 membership 展开班级、课程、单元、作业、本人提交与复盘状态，支持 `class_id/course_id`、`filter=all/active/feedback/history` 和 `limit/offset` 分页，响应返回 `items/total/limit/offset/next_offset` |
| POST | `/api/assignments/{id}/submissions` | 学生按 `class_id` 提交作业；同一 `assignment/student/class` 只能提交一次，同一作业挂到多个班级时可分别提交；数据库唯一约束冲突统一返回 `409`；提交目标必须位于 published 课程和 published 单元下且作业 active |
| GET | `/api/assignments/{id}/review` | 学生侧作业复盘入口；多班级可见时必须显式传 `class_id`，否则返回 `422`；active 未提交返回可提交，已提交、closed 或 archived 返回只读和 `submit_block_reason` |
| GET | `/api/assignments/{id}/submissions` | 学生查看本人提交 / 教师查看作业提交 |
| PATCH | `/api/submissions/{id}/grade` | 教师批改作业，并按作业积分规则目标值与当前 submission 已入账 `assignment_grade` 积分差额生成流水 |
| GET | `/api/points/ledger` | 查询个人或班级范围积分流水；教师查询按本班 teacher scope 收束 |
| GET/PATCH | `/api/points/assignments/{id}/rule` | 读取/维护 assignment 全局积分规则；学校 teacher/admin 可读，课程 owner、active editor/assessment_editor 或全局 admin 可写；班级 override 由 assignment class policy 承载 |
| GET | `/api/progress/me` | 当前用户个人进度摘要；学生个人口径仅计入当前可见资源 |
| GET | `/api/progress/users/{id}` | 教师查看班级内学生进度摘要；要求本班 teacher scope |
| GET | `/api/knowledge/me` | 当前用户知识状态 v2 统计，可按班级/课程/时间窗过滤；返回 overall/course/unit/knowledge_point/assignment 维度、规则版本和可解释 evidence，只计入 effective active assignment-class pairs |
| POST | `/api/knowledge/me/snapshots` | 当前用户按时间窗重算并写入个人知识快照，重复窗口幂等更新；学生快照使用同一可见性口径 |
| GET | `/api/knowledge/me/snapshots` | 当前用户分页查看自己的知识快照，可按班级、课程、粒度和时间窗过滤；学生列表不暴露 hidden course 旧快照 |
| GET | `/api/classes/{id}/knowledge` | 教师查看班级知识状态与课程/单元/知识点/作业/提交/事件/积分聚合；隐藏、draft、archived、closed 或本班未分配资源不进入当前 v2 分母 |
| POST | `/api/classes/{id}/knowledge/snapshots` | 教师或管理员按时间窗重算并写入班级知识快照，重复窗口幂等更新 |
| GET | `/api/classes/{id}/knowledge/snapshots` | 教师或管理员分页查看班级知识快照，可按课程、粒度和时间窗过滤 |
| GET | `/api/content/pages` | 当前已发布内容页摘要 |
| GET | `/api/content/pages/{slug}` | 已发布内容协议详情；公开响应会移除原始脚本引用，仅保留不可执行 `scriptManifest`，manifest 内含沙箱 enforcement/capabilities |
| POST | `/api/content/drafts` | 教师或管理员创建内容草稿；不会写入公开 `content_pages`，会记录草稿 schema hash、当前 published base 版本和脚本静态分析结果；新写入 schema 必须为每个 section/source 提供稳定 `sectionId/sourceId`；同一作者同一目标页只允许一个 active 草稿，数据库唯一约束并发兜底 |
| GET | `/api/content/drafts/{id}` | 草稿作者或管理员读取单条草稿 |
| PATCH | `/api/content/drafts/{id}` | 草稿作者或管理员编辑 `draft` / `changes_requested` 草稿；`schema.slug` 必须保持目标 slug，更新会复核稳定 `sectionId/sourceId`，重算 schema hash、脚本分析与脚本审核状态，且不会自动 rebase |
| POST | `/api/content/drafts/{id}/submit` | 草稿作者或管理员提交审核；允许 `draft` / `changes_requested` 进入 `submitted` |
| POST | `/api/content/drafts/{id}/withdraw` | 草稿作者或管理员撤回活跃草稿；撤回会清空 active key，之后可重新创建同目标草稿 |
| POST | `/api/content/drafts/{id}/request-changes` | 管理员退回已提交草稿，记录退回人、时间和必填备注 |
| POST | `/api/content/drafts/{id}/publish` | 管理员发布已提交草稿到公开内容页，发布前会以 `409` 复核稳定 `sectionId/sourceId` 契约，并写入不可变版本记录、current 指针和 previous 链；外部脚本会在同一发布事务内写入发布版本绑定的镜像资产；版本唯一冲突或同一草稿重复产出版本会返回 `409` |
| PATCH | `/api/content/drafts/{id}/script-review` | 管理员审核允许脚本的草稿；作者不能自审，阻断级脚本策略结果不可审核通过 |
| POST | `/api/content/page-versions/{id}/rollback` | 管理员按历史版本追加式回滚，生成新的当前版本；版本唯一冲突会返回 `409` |
| GET | `/api/render/page/{slug}` | 前端可渲染页面结构；公开响应会移除原始脚本引用，仅保留带稳定 `sandboxId` 的 `scriptManifest`，并在可执行且唯一的 manifest 中提供脱敏 `embed` 描述符（iframe src/sandbox/referrerPolicy/messageProtocol/capabilities），同时返回 `X-Astra-Content-Script-*` 沙箱契约头 |
| GET | `/api/render/script-sandboxes/{sandbox_id}/page/{slug}` | 按已发布私有 schema 和后端模板生成 sandbox HTML；nonce 只启动受信 bootstrap，资产脚本按服务端字节 SHA-256 CSP/SRI 授权且不继承 nonce；`frame-ancestors` 只允许 `'self'` 和精确 CORS origin，blocked/歧义/缺镜像/未知模板 fail closed |
| GET | `/api/render/script-sandboxes/{sandbox_id}/bootstrap/page/{slug}` | 返回 sandbox 内后端受控 bootstrap JS；按 published slug + sandboxId 生成受控资产 URL 列表，顺序加载资产并调用 allowlist initializer，只有 initializer 显式返回 `{ready:true}` 才发送 ready；postMessage 同时绑定 `bootstrap-v1`、templateId 和 document contract。响应 `application/javascript`、`no-store`、`nosniff`、`no-referrer` 和 `Cross-Origin-Resource-Policy: cross-origin` |
| GET | `/api/render/script-sandboxes/{sandbox_id}/assets/{asset_sha256}/page/{slug}` | 按 published slug + sandboxId + 脚本引用 SHA-256 读取受控 JS 资产；本地资产仅允许 `pages/`、`shared/js/`、`codevis/shared/js/` 和 `drafts/` 根内 `.js` 文件，外部脚本只返回当前发布版本绑定的镜像字节；响应 `application/javascript`、引用 hash、镜像字节 hash、`no-store`、`nosniff`、`no-referrer`、`Cross-Origin-Resource-Policy: cross-origin` 和资源级 `Access-Control-Allow-Origin: *`。该 wildcard 只为 opaque iframe 的匿名 SRI 请求服务，不接受凭据且不改变全局 API CORS |

## V6.6.52 浏览器 API 与离线契约

- `shared/js/api-client.js` 是管理、教师、学生三端和后端 schema adapter 的统一请求入口。它只接受同源、显式配置的精确 HTTP(S) origin 或本地开发 origin，拒绝路径、query、fragment、userinfo 与 HTTPS 降级；无效非空配置不会静默回退同源。
- 浏览器鉴权只使用 HttpOnly Cookie。统一 client 强制删除调用方 `Authorization`，并在模块加载、主应用启动和三端进入时幂等清理已知历史 token key；token、提交正文、成绩、反馈、学习事件、知识状态和快照不得进入 localStorage/sessionStorage。
- 后端同时保留显式非浏览器 Bearer 兼容，但单个请求只能选择一种认证通道。混合 Cookie+Bearer、重复目标 Cookie、重复 Authorization 或格式畸形的 Authorization 均使用不含凭据的稳定错误响应拒绝；自动化 Bearer 测试必须显式清空测试客户端 Cookie jar。
- GET 只做一次权威读取，不使用持久化 API 缓存；写请求不自动重试。发送后发生超时、取消或网络错误时标记结果未知，UI 必须锁定相关写入口并通过权威 GET 对账；收到 HTTP 状态或成功响应后 body/protocol 失败不应伪装为“可以安全重试”。
- 未登录、无权限、服务端错误、超时、离线和网络故障使用稳定产品文案；失去认证或实时连接时立即清空内存数据和 dashboard DOM，不能把旧数据伪装为实时状态。恢复在线后只允许重新读取，不自动重放写入。
- Service Worker 在导航和扩展名判断之前旁路精确 `/api` 与 `/api/*`，不调用 `respondWith`、CacheStorage 或离线 fallback；FastAPI 外层中间件为 API 的 2xx/4xx/5xx/OPTIONS 统一补 `Cache-Control: no-store`、`Pragma: no-cache` 和 `X-Request-ID`。

## V6.6.51 学生端消费契约

- `#student` 是 englab 壳内的非课程页，先通过 `/api/users/me` 完成 student 角色门禁；教师、管理员、未登录或 API 不可用时不得展示学生工作台数据。
- 班级范围只认 active membership。页面通过 `GET /api/classes?mine=true` 读取本人班级；无班级时不提供学校/班级公共目录，只接受教师提供的 `class_id` 并调用 `POST /api/classes/{id}/join` 直接加入。这里的“教师提供”只是 UI/运营约定，当前接口不会验证 ID 来源，也不构成邀请码安全边界。
- `GET /api/assignments/me` 是学生作业中心的唯一聚合入口，使用 `filter=all/active/feedback/history`、可选 `class_id/course_id` 与 `limit/offset`；每项返回班级、课程、单元、作业、本人提交、`can_submit/read_only/submit_block_reason`，前端必须保留项目中的 `class.id`。
- 同一作业对学生存在多个 eligible class 时，`GET /api/assignments/{id}/review` 必须携带 `class_id`；遗漏返回 `422`。`due_at` 当前只用于显示，提交权限以 review 的可提交状态和服务端写入校验为准。
- 同一 `assignment/student/class` 重复提交统一返回 `409`。提交请求出现超时或其他未知网络结果时，客户端必须先重新读取 review / 作业中心核对服务端状态，不得自动重发。
- 个人 progress、points、knowledge 和 snapshots 可用于规则式补强建议；首轮不伪装 AI 推断，也不自动触发 snapshot rebuild。认证 token、提交正文、成绩、反馈、事件、知识状态和快照不得写入 localStorage/sessionStorage。
- 统一错误态、离线与缓存硬化已由 V6.6.52 完成；V6.6.53 进一步补齐复杂成员操作、多角色协作者、班级作业策略与 `rule_version=v2` 多维学习分析。正式邀请模型、监护人/联系方式档案和生成式学习建议仍不在当前承诺范围。

## 前端 schema smoke

默认前端不会请求后端 schema。启动 API 后，再从项目根目录启动静态服务：

```bash
node server/dev-static-server.mjs --port 8766
```

访问本地试点：

```text
http://localhost:8766/?backendSchema=1&apiBase=http%3A%2F%2F127.0.0.1%3A8000#physics/energy-conservation
```

`backendSchema=1` 打开试点 adapter，`apiBase=` 指向本地 FastAPI。也可用 `CONFIG.backend.apiBaseUrl` 或 localStorage `astra-api-base` 设置 API origin；V6.6.52 起只接受受信精确 origin，不接受路径/query/fragment/userinfo 或 HTTPS 降级。默认静态页面保持回退，不依赖后端可用。

V6.6.52 起，试点 adapter 只接受严格 `scriptManifest.embed` 描述符和精确 sandbox URL，父页校验 iframe source、opaque `origin=null`、sandboxId、`bootstrap-v1`、templateId 与 `astra-sandbox-dom-v1`。内置能量守恒实验由后端模板注册表生成独立 controls/canvas/info DOM，脚本只查询传入 root；终态 error/timeout 会卸载 iframe、忽略迟到 ready 并恢复静态实验。未知模板、非法 config 或缺失 document contract 不生成可执行 embed。

V6.6.48 起，可从仓库根目录运行本地浏览器隔离证明：

```bash
node tools/browser/script-sandbox-isolation-proof.cjs --api http://127.0.0.1:8000 --web http://127.0.0.1:8766 --channel msedge --out test-screenshots/browser-isolation
```

该脚本需要当前 Node 环境能 `require('playwright')`，会打开本地试点页面，检查 iframe sandbox 属性、sandbox CSP/SRI/no-store/nosniff/no-referrer、unknown sandbox/asset fail closed、父页面隔离、交互/重挂载、异常导航后静态恢复、CacheStorage API 空集、console/network，以及真实 390×844 无横向溢出与截图证据。V6.6.60 外部 Edge 最终 27/27；报告和截图默认写入 `test-screenshots/browser-isolation/`，正式验收建议用 `--out` 指向受控临时/证据目录。

## 配置

配置使用 `ASTRA_` 前缀环境变量：

| 变量 | 默认值 | 说明 |
| ---- | ------ | ---- |
| `ASTRA_ENVIRONMENT` | `development` | 运行环境 |
| `ASTRA_ADMIN_BOOTSTRAP_ENABLED` | `true` | 首个管理员初始化开关；生产初始化完成后建议设为 `false` 并重启 |
| `ASTRA_ADMIN_BOOTSTRAP_TOKEN` | 空 | 除 `dev/development/test/testing` 外，只要 bootstrap 开启就必须配置 |
| `ASTRA_API_PREFIX` | `/api` | API 前缀 |
| `ASTRA_API_CACHE_CONTROL` | `no-store` | API 响应固定缓存策略；配置模型只接受 `no-store`，业务 JSON 不进入浏览器或中间层缓存 |
| `ASTRA_AUTO_CREATE_TABLES` | `false` | 是否启动时自动建表，开发临时可用，正式迁移应使用 Alembic |
| `ASTRA_SESSION_COOKIE_NAME` | `astra_session` | 登录会话 cookie 名称 |
| `ASTRA_SESSION_DAYS` | `7` | 登录会话有效天数 |
| `ASTRA_SESSION_LAST_SEEN_UPDATE_SECONDS` | `300` | 当前会话 last_seen 刷新节流窗口；同一 IP 哈希在窗口内不重复写库，设为 `0` 可关闭节流 |
| `ASTRA_PASSWORD_RESET_TOKEN_TTL_SECONDS` | `1800` | 用户自助密码重置 token 有效期，最低 60 秒 |
| `ASTRA_PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS` | `300` | 密码重置请求冷却窗口；按账号哈希和客户端 IP 哈希检查最近请求，设为 `0` 可关闭冷却 |
| `ASTRA_PASSWORD_RESET_TOKEN_RETENTION_DAYS` | `30` | 过期或已用密码重置 token 默认留存天数；清理脚本未传 `--before` 或 `--retention-days` 时据此计算 cutoff |
| `ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV` | `false` | 仅用于本地/测试调试的 token 回传开关；生产环境即便误设为 `true` 也不会回传 token |
| `ASTRA_LOGIN_MAX_ATTEMPTS` | `5` | 登录失败锁定阈值 |
| `ASTRA_LOGIN_LOCKOUT_SECONDS` | `900` | 达到失败阈值后的锁定秒数 |
| `ASTRA_LOGIN_ATTEMPT_WINDOW_SECONDS` | `900` | 统计连续失败的时间窗口 |
| `ASTRA_AUDIT_LOG_RETENTION_DAYS` | `365` | 审计留存预检与 `scripts.archive_audit_logs` 默认保留天数；未传 `retention_days`、`--retention-days` 或 `before/--before` 时据此计算候选 cutoff |
| `ASTRA_AUDIT_ANCHOR_ENABLED` | `false` | 外部审计 hash 回执总开关；默认关闭 |
| `ASTRA_AUDIT_ANCHOR_PROVIDER` | `webhook` | 当前锚定 provider；仅支持 HTTPS Webhook 回执合同 |
| `ASTRA_AUDIT_ANCHOR_WEBHOOK_URL` | 空 | 外部回执服务 HTTPS URL；报告与管理响应不回显 |
| `ASTRA_AUDIT_ANCHOR_WEBHOOK_TOKEN` | 空 | 外部回执服务 SecretStr token；仅从环境或安全配置注入 |
| `ASTRA_AUDIT_ANCHOR_TIMEOUT_SECONDS` | `5` | 单次锚定请求超时，范围 1-30 秒 |
| `ASTRA_AUDIT_ANCHOR_MAX_ATTEMPTS` | `5` | 锚定任务进入 dead-letter 前的最大 attempt 数 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_ENABLED` | `false` | 外部 issue 同步总开关；默认关闭，手工保存引用元数据不受影响 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_PROVIDER` | `github` | 当前可执行 provider；协议预留 Gitee/Jira，当前仅支持 GitHub |
| `ASTRA_EXTERNAL_ISSUE_SYNC_GITHUB_API_URL` | `https://api.github.com` | GitHub REST HTTPS 基址；重定向仅允许同源 307/308 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_GITHUB_WEB_URL` | `https://github.com` | 用于校验 issue 回执与手工绑定 URL 的 HTTPS 基址 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_GITHUB_OWNER` / `REPO` | 空 | 目标仓库 owner/repo；启用时必填，姿态报告不回显 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_GITHUB_TOKEN` | 空 | GitHub SecretStr token；需目标仓库 Issues 写权限，仅从环境或 secret store 注入 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_GITHUB_API_VERSION` | `2026-03-10` | GitHub REST API 版本请求头 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_TIMEOUT_SECONDS` | `10` | 单次 GitHub 请求超时，范围 1-30 秒 |
| `ASTRA_AUDIT_IP_HASH_SALT` | `astra-dev-audit-salt` | 审计中客户端 IP 哈希盐；生产环境应替换 |
| `ASTRA_AUDIT_TRUST_FORWARDED_FOR` | `false` | 是否允许审计 IP 哈希读取 `X-Forwarded-For`；默认关闭，防止客户端伪造转发链 |
| `ASTRA_AUDIT_TRUSTED_PROXY_HOSTS` | 空 | 可信反向代理连接来源，逗号分隔；只有开启 `ASTRA_AUDIT_TRUST_FORWARDED_FOR=true` 且 `request.client.host` 命中该列表时，才使用 `X-Forwarded-For` 首个 IP |
| `ASTRA_CONTENT_SCRIPT_ALLOWED_HOSTS` | 空 | 外部内容脚本 host allowlist，逗号分隔；默认阻断 `scriptUrl/scriptSrc` 外链，配置后仍要求显式 `https://`、无 query/fragment、合法 SRI、`crossorigin=anonymous` 和管理员脚本审核 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ENABLED` | `false` | 是否随 FastAPI lifespan 启动内容脚本远端漂移扫描进程内调度器；默认关闭，启用前应完成 Alembic 和外部网络访问评审 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_RUN_ON_START` | `false` | 内容脚本远端漂移调度器启动后是否立即运行一次；部署 smoke 会临时关闭该开关 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_INTERVAL_SECONDS` | `3600` | 内容脚本远端漂移调度轮询间隔，最低 60 秒 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_LEASE_SECONDS` | `3600` | 内容脚本远端漂移扫描 run 租约有效期，过期 running run 可被新 worker 接管，最低 60 秒 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ACTOR_USER_ID` | 空 | 外网扫描调度必须配置的活动 admin 用户 id；为空、禁用或非 admin 时跳过 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_SCAN_LIMIT` | `25` | 单轮调度最多扫描的 published 外部脚本引用数量，范围 1~200 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_SOURCE_HOST` | 空 | 可选调度筛选：仅扫描指定 source host |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_SLUG` | 空 | 可选调度筛选：仅扫描指定内容页 slug |
| `ASTRA_CORS_ORIGINS` | `http://127.0.0.1:8766,http://localhost:8766` | 凭据型 API 与 sandbox frame ancestor 的精确 origin；允许方法固定为 `GET/POST/PUT/PATCH/DELETE/OPTIONS`，`*`、`null`、userinfo、路径、query、fragment 会使应用启动失败 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_ENABLED` | `false` | 是否随 FastAPI lifespan 启动知识快照进程内调度器 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_RUN_ON_START` | `false` | 调度器启动后是否立即检查一次到期窗口 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_INTERVAL_SECONDS` | `300` | 调度器轮询间隔，最低 30 秒 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_LEASE_SECONDS` | `3600` | 知识快照调度数据库租约有效期，过期 running 窗口可被其他 worker 接管，最低 60 秒 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_HEARTBEAT_SECONDS` | `120` | 知识快照重算长循环中的自动租约心跳间隔；调度器与 CLI 会按该间隔用 owner/token guard 续租，最低 30 秒 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_DAILY_ENABLED` | `true` | 是否启用每日窗口调度 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_DAILY_HOUR` | `3` | 每日重算在 UTC 当日达到该小时后重算前一日窗口 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_WEEKLY_ENABLED` | `true` | 是否启用每周窗口调度 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_WEEKLY_WEEKDAY` | `0` | 每周重算星期，0 表示周一 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_WEEKLY_HOUR` | `4` | 每周重算在配置星期达到该小时后重算上一自然周 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_RETRY_ATTEMPTS` | `3` | 失败窗口在调度器中允许的最大尝试次数 |
| `ASTRA_BACKGROUND_TASK_WORKER_ENABLED` | `false` | 是否随 FastAPI lifespan 启动统一 worker；独立 worker 服务模式下 API 进程保持关闭 |
| `ASTRA_BACKGROUND_TASK_WORKER_INTERVAL_SECONDS` | `5` | worker 空闲轮询秒数 |
| `ASTRA_BACKGROUND_TASK_WORKER_LEASE_SECONDS` | `300` | 统一任务租约秒数，最低 30 |
| `ASTRA_BACKGROUND_TASK_WORKER_BATCH_SIZE` | `10` | 单轮最大任务数，范围 1-100 |
| `ASTRA_BACKGROUND_TASK_WORKER_BASE_BACKOFF_SECONDS` | `30` | 首次可重试失败的退避秒数 |
| `ASTRA_BACKGROUND_TASK_WORKER_MAX_BACKOFF_SECONDS` | `3600` | 指数退避上限秒数 |
| `ASTRA_BACKGROUND_TASK_WORKER_CONTENT_SCAN_ENABLED` | `false` | 是否允许统一 worker 执行外网内容脚本扫描；独立默认关闭 |
| `ASTRA_BACKGROUND_TASK_WORKER_AUDIT_ANCHOR_ENABLED` | `false` | 是否允许统一 worker 执行外部审计锚定；独立默认关闭 |
| `ASTRA_DATABASE_POOL_SIZE` / `MAX_OVERFLOW` | `10` / `10` | MySQL 单进程常驻连接和临时溢出上限；API/独立 worker 分进程分别计算 |
| `ASTRA_DATABASE_POOL_TIMEOUT_SECONDS` / `POOL_RECYCLE_SECONDS` | `30` / `1800` | 获取连接等待和连接回收秒数；继续启用 `pool_pre_ping` 与 LIFO |
| `ASTRA_DATABASE_CONNECT_TIMEOUT_SECONDS` | `10` | PyMySQL 建连超时秒数 |
| `ASTRA_DATABASE_READ_TIMEOUT_SECONDS` / `WRITE_TIMEOUT_SECONDS` | `30` / `30` | PyMySQL 单次读写超时；应用不自动重试业务写事务 |
| `ASTRA_PERFORMANCE_SLOW_QUERY_LOGGING_ENABLED` / `THRESHOLD_MS` | `true` / `500` | 慢 SQL 指纹日志；只记录 hash/操作/方言/耗时，不记录 SQL 或参数 |
| `ASTRA_PERFORMANCE_SLOW_REQUEST_LOGGING_ENABLED` / `THRESHOLD_MS` | `true` / `1000` | 慢 API 日志；只记录 request id、方法、路由模板、状态和耗时 |
| `ASTRA_PERFORMANCE_CORE_API_BUDGET_MS` | `500` | 核心读取 API 预算基线 |
| `ASTRA_PERFORMANCE_ADMIN_API_BUDGET_MS` | `1000` | 管理列表/query profile 单次预算基线 |
| `ASTRA_PERFORMANCE_EXPORT_BUDGET_MS` | `5000` | 有界导出/性能报告总预算基线 |
| `ASTRA_PERFORMANCE_PROBE_ITERATIONS` | `3` | 性能报告每个 query profile 的有界基准轮数，范围 1-20 |
| `ASTRA_DATABASE_URL` | `sqlite+pysqlite:///./astra-dev.db` | 安全的本地默认；生产必须通过环境/secret store 注入 MySQL URL，仓库不提供示例密码 |

可从 `.env.example` 复制本地配置；真实密码不要提交到仓库。

测试会覆盖为 SQLite 内存数据库，避免依赖本机 MySQL 实例。

## 服务层边界

### V6.6.53 课程与班级权限矩阵

| 身份 | 课程结构 | 作业/积分 | 协作者治理 | 班级数据/评分 | 班级策略 |
| --- | --- | --- | --- | --- | --- |
| 全局 admin | 读写 | 读写 | 读写 | 跨范围治理 | 读写 |
| course owner | 读写 | 全局规则与受众读写 | 角色/批量/状态/owner 转让 | 不自动获得，仍需 class teacher scope | 同时具备 class teacher scope 时读写 |
| active `editor` | 单元/作业读写 | 全局规则读写 | 只读列表 | 不自动获得 | 同时具备 class teacher scope 时读写 |
| active `content_editor` | 单元/作业读写 | 不可维护积分规则 | 只读列表 | 不自动获得 | 不可写 |
| active `assessment_editor` | 不可创建单元，可创建作业 | 全局规则读写 | 只读列表 | 不自动获得 | 同时具备 class teacher scope 时读写 |
| active `viewer` | 只读 | 只读 | 只读列表 | 不自动获得 | 仅本班 teacher 可读 effective policy |
| class active teacher | 可为本班挂接同校课程 | 可批改本班提交，不可改共享规则 | 无课程治理权 | 本班成员/提交/事件/积分/学情 | 还需 owner/editor/assessment_editor 才可写 |
| student | published + effective assigned 只读 | 本班 active 作业提交/复盘 | 无 | 仅本人 | 无 |

课程角色和班级角色是两条独立授权轴：课程协作者不会因为能编辑课程而获得任意班级成员、提交、评分或学情权限；class teacher 也不会因为能批改本班提交而获得共享课程结构、全局积分规则或协作者治理权限。

- `app.services.access_control` 负责学校、班级和课程范围判断，`app.services.assignment_policies` 负责同一作业在指定班级的 assigned/status/due_at/point rule effective 解析与 SQL 可见性表达式；提交、事件、积分、进度、知识统计与作业中心必须复用该口径，禁止只在前端隐藏。
- 学生移除采用 class membership `active -> inactive` 软移除，保留提交、积分和审计历史；同校转班要求源/目标双 class teacher scope。批量导入不会仅凭用户名创建跨校关系，只接纳 active 同校 student membership；逐项失败不回显目标账号的学校归属。
- `app.services.points` 负责 assignment 级积分规则规范化与批改积分计算；默认规则为 `enabled=true`、`points_per_score=1`、`max_points=null`，批改时写入“规则目标积分 - 当前 submission 已入账 assignment_grade 积分”的差额流水，避免重复批改累计膨胀，并支持封顶或禁用规则后的反向校正。
- 知识统计 `rule_version=v2` 把分母定义为 effective active assignment-class pair；课程/单元必须 published，班级策略必须 assigned，effective status 必须 active。提交数按 `submitted_at`、评分与分数按 `graded_at`、事件按 `occurred_at`、积分按 ledger `created_at` 进入时间窗；`LearningEvent.knowledge_code` 经 trim/lower 后作为知识点稳定编码。`knowledge_stats_json` 继续承载扩展维度，因此 v1 历史快照无需回填即可兼容读取，新重算写入 v2 并按 course/unit/knowledge_point/assignment 稳定排序输出 evidence。
- `app.services.class_join_requests` 负责加入申请审批状态流转和成员关系补齐。
- `POST /api/classes/{id}/join` 与 `POST /api/classes/{id}/join-requests` 长期并存：前者是保留给学生自助加入、admin 治理、受控导入/邀请码或旧 UI 的 direct join；active 正式教师可在尚无学校成员关系时凭已知 `class_id` 通过后者申请 teacher 角色，审批前不获得任何学校或班级权限，由该班教师/admin 批准时原子建立学校 teacher 与班级 teacher membership。前端不得把审批流表现为唯一加入路径，也不得让普通教师绕过审批自助成为班级 teacher。
- 学生端不得依赖公共学校/班级发现：`GET /api/classes?mine=true` 只返回当前用户 active membership 对应班级；无班级学生只能使用教师提供的 `class_id` 走 direct join。学生作业中心必须按 `/api/assignments/me` 返回的 class-expanded 条目保留班级上下文。
- `app.services.audit` 负责写入审计日志及请求元数据；新记录以 `prev_hash/current_hash` 保存应用层 SHA-256 链，并通过单例 `audit_chain_heads` 串行化并发链尾。MySQL 使用数据库行锁，SQLite 本地回归使用事务级进程锁；这仍不能替代备份、binlog 或独立保留的外部回执。管理端 JSON/CSV 明细导出默认剥离 `snapshot_json`，审计摘要不记录候选明细或秘密值。
- `app.services.audit_archive_anchors` 与 `app.services.audit_anchor_delivery` 负责校验 Manifest/归档文件、创建幂等锚定账本并发送 `astra.audit-archive-anchor.v1` hash-only 信封。稳定 Idempotency-Key、HMAC-SHA256、no-redirect、严格回执 hash 匹配和统一任务重试用于 staging/生产接入；失败只更新独立账本，不改写 `audit_logs`、Manifest 或归档字节。
- `app.services.audit_archive_drill` 与 `scripts.audit_archive_drill` 提供审计归档/留存生产演练前后的只读姿态报告；检查数据库方言、留存 cutoff、候选/保留/临期数量、归档预览、候选链完整性、敏感字段扫描、操作边界和真实 MySQL/WORM/外部锚定待留证项，不写文件、不写审计、不删除或移动 `audit_logs`，不返回密码、token、密钥、原始快照正文或复核备注。
- `app.services.audit_chain` 负责复用型审计链校验：按传入顺序重算 `current_hash`、检查相邻记录 `prev_hash` 是否衔接上一条 `current_hash`，并把历史空 hash 作为 partial 状态暴露给 API 与归档 Manifest；它只报告 `current_hash_mismatch`、`prev_hash_mismatch` 和 `null_current_hash`，不执行修复、删除、回填或外部锚定。
- `/api/admin/bugs` 仍以本地 `BugRecord` 为唯一权威；V6.6.57 支持手工绑定和显式 GitHub 创建/状态/评论出站同步，但不做自动入站或双向覆盖。`app.services.external_issue_providers` 负责 HTTPS provider 合同、回执校验和敏感文本门禁，`app.services.bug_external_sync` 负责稳定操作键、失败/歧义账本与本地成功提交；Gitee/Jira 尚未实现。
- `app.services.backend_performance` 固化高频查询、必要索引、分页上限、响应预算、worker/连接池姿态和延期风险；性能报告只读执行 EXPLAIN/有界 SELECT，不执行写入、不回传 SQL/参数/结果值。SQLite 报告只能证明本地合同，真实 MySQL `EXPLAIN ANALYZE`、buffer pool、filesort、锁等待、深分页和 worker/API 并发必须在 RC 环境留证。
- `app.services.request_metadata` 统一解析请求元数据；审计与会话治理共享 request_id、user-agent 和 IP 哈希口径。`AuthSession.device_label` 优先来自 `X-Device-Label` / `X-Device-Name`，缺省回退到登录 user-agent，因此只是 best-effort 设备摘要，不等同强设备绑定。
- `app.api.deps.auth.get_current_auth_context()` 会在有效鉴权后按 `ASTRA_SESSION_LAST_SEEN_UPDATE_SECONDS` 刷新当前 `AuthSession.last_seen_at` 和 `last_seen_ip_hash`；默认 300 秒内同一 IP 哈希不重复写库，窗口过期、IP 哈希变化或配置为 `0` 时刷新。该机制只降低 last_seen 写放大，不等同强设备绑定或长期会话风控。
- `/api/auth/password-reset/request` 与 `/api/auth/password-reset/confirm` 只提供本地账号自助重置 token 能力；邮件/短信/MFA 投递暂列 `P4 / 最低优先级 / 暂缓`。请求审计使用账号哈希作为 `resource_id`，不记录明文用户名或 token；确认阶段会对 token 行加锁并一次性消费。`app.services.password_reset_tokens` 与 `scripts.cleanup_password_reset_tokens` 提供过期/已用 token 的离线清理入口，默认 dry-run，显式 `--apply` 才删除，摘要不返回用户名、IP 哈希、user-agent 或 token hash。
- `app.services.auth_sessions` 与 `scripts.cleanup_auth_sessions` 提供过期认证会话离线撤销入口；默认 dry-run，显式 `--apply` 才为 expired+unrevoked 会话写入 `revoked_at`，不删除会话行，摘要不返回 token hash、IP hash、user-agent 或明文 token。`scripts.auth_security_drill` 用于输出认证生产姿态报告，覆盖 admin bootstrap token、cookie、password reset、localStorage、审计盐和清理命令入口，报告不回显 secret。
- `app.services.content_catalog` 负责内容页 seed、正式内容初始化、已发布 schema 读取和内容页摘要；`/api/content/pages*` 与 `/api/render/page/*` 查询只读 published 当前记录，不在 GET 路径隐式写库，公开响应会剥离原始脚本引用、SRI/crossorigin 元数据和 sandbox 原始字段，只保留带稳定 `sandboxId` 的 `scriptManifest`；manifest 会返回沙箱 enforcement/capabilities，`/api/render/page/{slug}` 会额外返回 `X-Astra-Content-Script-Sandbox`、`X-Astra-Content-Script-Manifest-Count`、`X-Astra-Content-Script-Iframe-Sandbox` 和 `X-Astra-Content-Script-CSP` 稳定契约头，并只为 document contract 通过后端模板注册表校验、可执行且全页唯一的 sandbox manifest 注入 `embed` 描述符。`embed` 只包含前端 iframe 编排所需的同源 sandbox document `src`、`sandbox=allow-scripts`、`referrerPolicy=no-referrer`、消息协议、template/document contract、能力摘要和资产数量，不包含原始脚本 URL/路径值、SRI、crossorigin、nonce、bootstrap/asset URL、镜像表 metadata 或数据库 id；blocked/ambiguous/unknown-template manifest 不生成可执行 embed。sandbox document 从注册模板生成独立 DOM/CSS，bootstrap 顺序加载受控资产并调用 allowlist initializer，只有显式 readiness 才发送 ready；运行时 CSP nonce 只存在于单次 HTML 响应，opaque sandbox、CORP、no-store 和受控资产绑定保持不变。
- `app.services.content_script_sandbox_templates` 是可执行 sandbox DOM/initializer 的后端 allowlist 注册表。当前只登记 `physics-energy-conservation-v1`，document contract 固定为 `astra-sandbox-dom-v1`，只接收受控 config；raw HTML、任意 initializer、未知模板和非法配置全部拒绝。
- `app.services.content_lifecycle_drill` 与 `scripts.content_lifecycle_drill` 提供内容发布/初始化/回滚生产演练前后的只读姿态报告；检查 current 指针、schema hash、版本链、active 草稿、脚本镜像、API no-store、可选 render URL 和静态 fallback，不执行发布/回滚、不联网下载脚本、不写库，也不返回完整 schema、原始 CDN URL、完整 SRI、镜像字节或 `content_bytes`。`--require-mysql` 用于防止把 SQLite 回归误判为真实 MySQL 演练。
- `app.services.content_identity` 负责内容协议稳定身份契约：历史 schema 读取仍允许缺失 `sectionId/sourceId`，但新建/编辑/发布草稿和内置内容初始化要求每个 section/source 带稳定 ID，并拒绝重复 ID 或与 `props.sectionId/props.id` 冲突的章节身份。
- `app.services.content_script_policy` 负责内容草稿脚本静态分析、脚本资产 allowlist/SRI 静态门禁、后端下载校验、public manifest 与 sandbox 契约；当前识别脚本引用、外链脚本、事件处理器、阻断协议、路径穿越、内联 `<script>` 和不安全 sandbox 能力。外部 `scriptUrl/scriptSrc` 默认阻断，只有 host 出现在 `ASTRA_CONTENT_SCRIPT_ALLOWED_HOSTS` 且 URL 为显式 `https://`、无 query/fragment、声明合法 SRI 与 `crossorigin=anonymous` 时才可进入 high-risk 管理员审核；管理员批准外部脚本和发布已审核草稿时会下载资产并按声明 SRI 比对字节，下载失败、SRI mismatch、host policy blocked 或发布前 CDN 字节漂移会阻断流程，默认下载器不跟随重定向。下载校验 finding 会通过 metadata 保留资产 SHA-256、字节大小、SRI token 数量和匹配算法；公开 `scriptManifest.sandbox` 会按 `network=none/same-origin` 派生稳定 CSP、显式返回 enforcement/capabilities，并对 unsafe sandbox 防御性降级为 blocked；sandbox HTML 响应会按单次请求生成 nonce，把响应级 `script-src` 收紧为 nonce source，并强制 `Content-Security-Policy`、`X-Content-Type-Options: nosniff` 和 `Referrer-Policy: no-referrer`，本地 JS 资产必须位于受控根且通过 bootstrap + `asset_sha256` 端点加载；外部脚本发布成功后由 `app.services.content_script_assets` 写入 `content_script_assets`，render 阶段只读取当前 published version 绑定的镜像字节，不联网、不代理任意 CDN、不暴露原始 URL。管理端 `GET /api/admin/content/script-assets` 可分页审计这些镜像资产，`GET /api/admin/content/script-assets/mirror-audit` 可离线复核当前 published schema 与镜像表绑定、本地字节 hash/大小/SRI 和重复引用，`POST /api/admin/content/script-assets/remote-drift-scan` 可在 admin 显式确认后小批量触发远端漂移扫描并写入 run 台账，`GET /api/admin/content/script-assets/remote-drift-alerts` 可从 run 台账、failed run 与 stale running run 派生只读告警候选，`GET/PATCH /api/admin/content/script-host-policies` 可维护 host 评审状态并用 `blocked` 作为发布链路 fail-closed 门禁；响应与审计都不返回原始 CDN URL、完整 SRI、远端字节或 `content_bytes`。分析结果带 `policy_context_hash`，allowlist 配置变化会触发发布/审核前重分析。当前仍不承担实时监控、外部告警投递或自动信任/封禁策略；前端 iframe 生命周期首轮和浏览器自动化隔离证明已由 opt-in adapter 与 V6.6.48 drill 覆盖。
- `app.services.content_script_asset_scan_runs` 与 `app.services.content_script_asset_scan_scheduler` 负责内容脚本远端漂移扫描 run 台账、数据库租约、健康摘要、调度队列摘要和进程内调度。`content_script_asset_scan_runs` 允许 `running/success/failed` 生命周期、可空触发人、`attempt_count`、scheduler lease owner/token/expires/heartbeat 元数据和唯一 `run_key`；管理端列表、health、queue 与 alerts 只暴露租约 owner/过期/心跳、计数、状态和脱敏候选，不返回 `scheduler_lease_token`。调度器默认关闭，启用后按配置筛选 slug/source host 并以 observe-only 模式调用远端漂移扫描；它不会修改 host policy、替换镜像、下线/重发布内容或投递外部告警。
- `app.services.content_script_remote_drift_drill` 与 `scripts.content_script_remote_drift_drill` 提供内容脚本远端漂移生产观察前后的只读姿态报告；聚合数据库方言、调度配置、host policy 桶、mirror 记录、scan run ledger、queue/alerts/outbox 和真实观察待留证项，不触发外网、不写 outbox、不修改 host policy、不返回原始 CDN URL、完整 SRI、远端/镜像字节、`content_bytes`、异常原文、`scheduler_lease_token`、payload 或复核备注。公开 render 对 `blocked` host 运行时 fail closed，不注入可执行 `embed`，sandbox document/bootstrap/asset 返回 `content_script_host_blocked`。
- `/api/admin/content/page-versions/{id}/diff` 负责版本对比：旧 `changes` 继续返回 JSON path 级差异，新 `semantic` 汇总 metadata、courseUnit、sections 与 sources 的增删改移；sections/sources 优先按 `sectionId/sourceId` 识别，保留旧标题、label、url 和 index fallback，并在每条 section/source 变更中显式返回 before/after 稳定 ID，便于后续管理端 UI 展示。diff 响应会对路径或字段名命中 token/key/secret/script/sandbox/integrity/crossorigin 等敏感语义的值返回 `{redacted, reason, value_type, length}` 预览对象；非敏感字段保持原值，避免破坏既有标题、summary、source URL 和普通 props 展示。
- `PATCH /api/content/drafts/{id}` 负责草稿编辑闭环：仅允许作者或管理员编辑 `draft` / `changes_requested` 草稿，禁止 retarget 到其他 slug，保存时重算 `schema_hash/script_analysis/script_risk_level`，并清空旧脚本审核元数据；`base_version_id/base_schema_hash` 保持创建时基线，发布前仍由 stale guard 拦截过期草稿。
- `/api/content/drafts/{id}/submit`、`/request-changes`、`/withdraw` 与 `/publish` 负责草稿状态流转；创建草稿时绑定当前 published base 版本和 hash，写入 `active_key='active'`，并由 `(author_user_id, target_slug, active_key)` 唯一约束防止同一作者同一目标页并发创建多个 active 草稿；撤回或发布会清空 active key。发布前校验 base 未过期并复核当前配置下的脚本 policy，脚本引用必须带 `scriptSandbox.mode=isolated-iframe` 且不能声明危险能力；外部脚本还必须满足 allowlist/SRI/crossorigin 契约、完成管理员审核，并在审核批准和发布时通过后端下载/SRI 字节校验；发布时会把外部脚本镜像字节与 `page_version_id + sandbox_id + reference_value_sha256` 同事务绑定。发布阶段由 `(slug, version)`、`source_draft_id` 和脚本资产唯一约束兜底，冲突统一返回 `409`，发布后回填 page/version/publisher 元数据，审计只记录状态和版本元数据，不记录完整 schema。
- `/api/content/page-versions/{id}/rollback` 负责内容版本追加式回滚：更新 `content_pages.current_version_id/schema_hash/published_*` 当前态、追加带 `previous_version_id` 的 `content_page_versions`，并在审计中只记录版本元数据与 schema hash，不记录完整 schema。
- `app.services.knowledge_snapshot_runs` 与 `app.services.knowledge_snapshot_scheduler` 负责知识快照窗口重算、运行记录、进程内调度、数据库租约防重入、长重算自动心跳、健康摘要、调度积压摘要、告警候选摘要、协作式取消和手动 requeue；同一 `run_key` 通过 scheduler lease owner/token/expires/heartbeat 元数据抢占，调度器与 CLI 会把 token-guard heartbeat callback 注入重算循环，开始重算前用 `id/status/owner/token` 再确认租约仍有效，完成或失败释放使用 token guard，失去租约或被 admin 取消的旧 worker 会中止而不覆盖新状态；requeue 会把 failed、cancelled 或过期带租约 running run 重置为 pending，调度器会扫描 pending run 并重新抢占执行；积压摘要会显式区分 scheduler 实际会处理的 dispatchable now 和仅符合租约抢占规则的 claimable by lease rule，告警候选摘要会从 health/queue 派生 severity/action hint，管理端响应不返回 `scheduler_lease_token` 或 `metadata_json`。
- `app.services.knowledge_snapshot_scheduler_drill` 与 `scripts.knowledge_snapshot_scheduler_drill` 提供知识快照调度器生产演练前后的只读姿态报告；检查 scheduler 配置、run ledger、lease/heartbeat、due/pending 队列、快照输出计数和真实 MySQL 待留证项，不执行 rebuild、不抢租约、不取消、不重排，也不返回 `scheduler_lease_token`、`metadata_json`、异常原文或 secret。`--require-mysql` 用于防止把 SQLite 回归误判为真实 MySQL 演练，`--expect-scheduler-enabled` 用于生产调度器启用门禁。
- `app.services.admin_alert_outbox` 负责把管理端告警候选写入本地 outbox 人工复核台账；当前承接知识快照告警候选和内容脚本远端漂移告警候选，分别以 `knowledge_snapshot_run_alert`、`content_script_asset_scan_run_alert` 写入 `admin_alert_outbox_entries`，按 source/run/code/action 与 host/hash/asset hash 定位信息生成 dedupe key，重复入队只刷新 `last_seen_at/seen_count/payload_hash`，且不会覆盖已经人工复核为 `planned/queued/suppressed/cancelled` 的状态。outbox payload 只保存脱敏运行摘要，不保存 scheduler lease token、metadata、原始 CDN URL、完整 SRI、远端字节、异常原文、`content_bytes` 或重排原因；普通列表、入队响应和单条复核响应统一使用安全摘要，不返回 dedupe key、完整 payload hash、payload JSON 或复核备注正文，只返回 `payload_hash_prefix`、状态字段和 `review_note_present`；`GET /api/admin/alert-outbox/queue` 只读派生队列摘要、状态 bucket、stale pending review 和 due planned/queued，用 `admin.alert_outbox.queue_report` 记录聚合审计且不返回 payload 或备注正文；`POST /api/admin/alert-outbox/dispatch-dry-run` 只读生成 queued due 执行预检，按 blocker/expired/not due 分类并写入 `admin.alert_outbox.dispatch_dry_run` 聚合审计，不修改 `status/attempt_count/last_error_code/reviewed_*`；`POST/GET /api/admin/alert-outbox/dispatch-plans` 会把显式 ID 的执行预检结果持久化为 `admin_alert_outbox_dispatch_plans` 脱敏 ledger，只保存筛选、policy、计数、有限 ready ID、ready entry payload hash 快照和 blocker 原因计数；`POST /api/admin/alert-outbox/dispatch-plans/{id}/validate` 会基于计划快照重新校验 entry 存在、状态、due/expired、delivery 边界和 payload hash 漂移，并以 `admin.alert_outbox.dispatch_plan.validate` 写入脱敏审计，不返回完整 hash、payload 或备注正文；单条与批量复核分别通过 `PATCH /api/admin/alert-outbox/{id}` 和 `PATCH /api/admin/alert-outbox/reviews` 记录 `reviewed_by_user_id/reviewed_at/review_note`，批量路径必须显式列出 ID 且 all-or-nothing，响应使用不含 payload/备注正文的瘦身条目；`external_delivery=false`、`dispatch_mode=manual_review`，当前不发送邮件/短信/Webhook、不接入 broker、不自动处置 run。
- `app.services.alert_delivery` 负责 V6.6.54 外部告警通道抽象与 Webhook 第一适配器。配置默认关闭，只接受 HTTPS 目标和 SecretStr token；显式或 worker plan dispatch 使用 Bearer、HMAC-SHA256 与稳定 Idempotency-Key，外发信封不含原始 payload。
- `app.services.background_tasks` 是 V6.6.55 DB-backed 控制面，负责入队、原子 claim、租约/heartbeat、attempt、退避、dead-letter、retry/cancel；`app.services.background_task_worker` 负责调度生产和三类领域 handler。告警歧义 plan fail closed，知识快照/脚本扫描以领域 run success 恢复控制面，均不盲目重复副作用。
- `POST /api/assignments/{id}/submissions` 的提交唯一性按 `assignment_id + student_id + class_id` 收口；同一共享作业可在不同班级各提交一次，同班重复提交返回 `409`。提交、学习事件、作业中心、复盘、批改、积分、进度和知识统计都按班级 effective policy 复核：课程/单元须 published，班级须被分配，effective status 须 active；closed/archived 只保留受权历史复盘与教师治理视角。班级成员采用软停用保留历史，学生转班要求源/目标双 teacher scope，批量导入只接纳 active 同校 student membership。课程协作者支持 `editor/content_editor/assessment_editor/viewer` 与 owner/admin 批量 upsert；课程角色不会自动授予班级成员、提交、评分或学情权限。全局积分规则由 owner、editor、assessment_editor 或 admin 维护；班级覆盖规则还要求操作者同时具备目标班级 teacher scope。教师查询学习事件、积分、进度、提交和班级知识统计始终按本班 scope 收束。
- `GET /api/assignments/me` 是学生侧分页作业聚合入口，按 active membership 与 published 课程/单元展开 `all/active/feedback/history`；响应中的 `can_submit/read_only/submit_block_reason` 用于前端展示与入口状态，实际提交仍由服务端复核。`GET /api/assignments/{id}/review` 是单项复盘入口：只允许 student 访问自己的提交历史，多班级可见时必须显式提供 `class_id`；published 课程/单元内 closed / archived 作业不允许再次提交但仍返回题目、成绩和反馈，`due_at` 当前只作展示；教师和管理员继续使用 submissions 列表与批改接口。

## 验证

```bash
python -m pytest backend
```

V6.6.58 基线为 322 项全量 pytest；权限/班级策略/统计、外部投递、统一任务、审计锚定、外部 issue 和性能专项可运行：

V6.6.61 基线收集 365 项：默认套件 360 项通过、5 项真实 MySQL 专项按显式环境门禁跳过；真实 MySQL 专项另行 5/5 通过。Alembic head 为 `20260710_0046`，新增知识快照窗口 DATETIME(6) 精度迁移、MySQL 发布证据、运行负载 drill 和 Windows legacy console 安全 JSON 输出回归。

V6.6.62 基线收集 373 项：默认套件 368 项通过、5 项真实 MySQL 专项按显式环境门禁跳过；定向 23 项、PowerShell 语法、静态公开面合同、真实四服务 topology、MSVC Release 构建/回滚和生产 stage gate 14/14 通过。

V6.6.63 基线收集 380 项：默认套件 375 项通过、5 项真实 MySQL 专项按显式环境门禁跳过；RC 范围门禁定向、中文路径 ASCII-safe 初始化 CLI、真实 MySQL 0046 preflight/smoke、拓扑 render 和最终生产 stage gate 15/15 通过。

V7.4.24 基线收集 435 项：默认套件 429 项通过、6 项真实 MySQL 发布证据按显式环境门禁跳过；新增组织治理、0047 SQLite 往返、条件式 MySQL schema、26 个活动组织写门禁、责任人并发保护以及归档后当前学情/进度与历史读取边界回归。真实 MySQL 未提供隔离库时只能声明门禁已落地，不得声明目标数据库已通过。

V7.4.25 针对管理组织 UI 的后端定向门禁为 40 项通过：`test_admin_organization_governance.py` 覆盖受约束治理，`test_health.py` 覆盖凭据型 `PUT` CORS 预检。本次没有重跑完整后端套件，也没有提供新的真实 MySQL 或目标环境证据；完整 V7.4.24 数据库基线和 0047 MySQL 待补边界保持不变。

```bash
python -m pytest backend/tests/test_school_classes.py backend/tests/test_access_control.py backend/tests/test_course_learning_loop.py -q
python -m pytest backend/tests/test_alert_delivery.py -q
python -m pytest backend/tests/test_background_tasks.py backend/tests/test_background_task_api_worker.py -q
python -m pytest backend/tests/test_audit_archive.py backend/tests/test_audit_archive_anchor.py backend/tests/test_audit_chain_concurrency.py -q
python -m pytest backend/tests/test_bug_external_sync.py backend/tests/test_deploy_preflight.py -q
python -m pytest backend/tests/test_backend_performance.py backend/tests/test_api_cache_policy.py -q
node tools/tests/v6653-permission-analytics-contract.cjs
```

迁移最低门禁需验证 `upgrade 20260710_0043 -> upgrade head -> downgrade 20260710_0043 -> upgrade head`，最终 `alembic current` 必须为动态解析出的唯一 head；0044 绑定最后编辑者/审核 schema hash，0045 串行化 admin 安全控制面，0046 将知识快照窗口字段提升为 MySQL DATETIME(6)，0047 增加学校/班级说明与乐观并发版本，0048 增加稳定课程/活动键和班级发布计划，0049 增加代码题目、版本、提交与判题尝试，0050 增加判题尝试过期租约恢复复合索引，0051 增加权威学习证据七表与隔离历史访问权益，0052 增加客户端提交键并替换旧单修订唯一约束，0053 增加双游标活动 runtime 与逐事件 exact sidecar。V6.6.61 的真实 MySQL 证据只覆盖至 0046；0047—0053 必须在新的隔离 MySQL 或目标环境补证。

权限范围回归可单独运行：

```bash
python -m pytest backend/tests/test_access_control.py
```

迁移烟测：

```bash
cd backend
$env:ASTRA_DATABASE_URL='sqlite+pysqlite:///:memory:'
python -m alembic upgrade head
```

当前 Alembic head：`20260810_0053`。`0043` 为高频治理读取增加复合索引；`0044/0045` 分别增加内容审核绑定和安全控制锁；`0046` 统一知识窗口的 MySQL DATETIME(6)；`0047` 增加学校/班级说明与乐观并发版本；`0048` 增加课程/活动稳定键和班级发布计划；`0049` 建立代码题目、不可变版本、submission 与 judge attempt；`0050` 增加过期租约恢复索引；`0051` 建立权威学习证据、完成规则、活动/续学投影及隔离历史访问权益；`0052` 为 `code_submissions` 增加 `client_submission_id` 并替换旧单修订唯一约束；`0053` 新建不可变 runtime identity，事件按 `server_sequence` 连续排列，并为 learner fact 独立保存 `learner_sequence` 与完整 canonical sidecar。0053 已覆盖 SQLite 空/历史库升级、0053→0052→0053 往返与 MySQL DDL 离线编译；真实 MySQL 仍待隔离环境补证。

内容脚本远端漂移 CLI：

```bash
cd backend
python -m scripts.scan_content_script_asset_remote_drift --confirm-external-network --actor-user-id <admin_id> --limit 25
python -m scripts.scan_content_script_asset_remote_drift --confirm-external-network --source-host cdn.example.com --actor-user-id <admin_id>
python -m scripts.content_script_remote_drift_drill --require-mysql --expect-scheduler-enabled
```

扫描 CLI 必须显式传入 `--confirm-external-network` 才会访问远端脚本字节；运行结果写入 `content_script_asset_scan_runs`，`trigger_source=script`。观察演练 CLI 默认只读，不访问外网也不写库，用于生产观察前后检查调度/host policy/mirror/run/outbox 姿态。两者输出均不返回原始 CDN URL、完整 SRI、远端字节、异常原文或 `scheduler_lease_token`。

知识快照周期重算：

```bash
cd backend
python -m scripts.rebuild_knowledge_snapshots --granularity day
python -m scripts.rebuild_knowledge_snapshots --granularity week --date 2026-07-03
```

脚本按日或自然周对齐窗口，先抢占 `knowledge_snapshot_runs` 数据库租约，再重算活跃班级已挂接课程的个人/班级快照；学生 user snapshot 跳过 unpublished 课程并按学生可见性过滤单元/作业，class snapshot 保持教师/管理聚合口径；重算长循环会按 `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_HEARTBEAT_SECONDS` 自动续租，租约不可用时输出 `status=skipped`，失去租约或失败时输出 JSON 并返回非零退出码。

知识快照和内容脚本 scheduler 默认关闭。V6.6.55 后，统一 worker 关闭时保留旧 lifespan 调度器兼容行为；统一 worker 启用时，相同 scheduler 开关改为生成持久化任务，不再并行启动旧调度器。知识快照和内容脚本领域 run 的 owner/token/expiry/heartbeat guard 继续生效，控制面 lease 负责跨进程 claim、attempt/退避/dead-letter 与重启接管。V6.6.61 已完成真实 MySQL 竞争、锁等待、cancel/retry/stale-token 与 API/worker 并发证据；长任务进程强杀和注册服务重启恢复归 V6.6.62。

统一 worker 本地入口：

```bash
cd backend
python -m scripts.run_background_tasks --once
python -m scripts.run_background_tasks
python -m scripts.run_background_tasks --enable-content-scan  # 仅在外网访问评审后
python -m scripts.run_background_tasks --enable-audit-anchor  # 仅在外部回执服务评审后
```

生产只选择“FastAPI lifespan 内 worker”或“独立 worker 服务”之一。独立服务可使用进程专属环境开启知识/脚本 scheduler 生产者，API 服务保持对应旧 scheduler 关闭。worker 中断后等待 lease 到期再接管；告警 plan 若停在 `dispatching`，先核对接收端幂等账本，已接收项人工 suppressed/cancelled，确认未接收项才重新 queued 并创建新 plan，禁止直接 retry 盲发。

审计归档候选导出：

```bash
cd backend
python -m scripts.audit_archive_drill --require-mysql --retention-days 365
python -m scripts.archive_audit_logs --require-mysql --retention-days 365 --output-dir audit-archives
python -m scripts.archive_audit_logs --require-mysql --before 2026-07-01T00:00:00Z --format jsonl --include-snapshot --exported-by <operator> --output-dir audit-archives
python -m scripts.archive_audit_logs --verify audit-archives/audit-logs-archive-<stamp>.manifest.json
python -m scripts.anchor_audit_archive --manifest audit-archives/audit-logs-archive-<stamp>.manifest.json --confirm-external-anchor --actor-user-id <admin_id>
python -m scripts.run_background_tasks --once --enable-audit-anchor
python -m scripts.anchor_audit_archive --status <anchor_id>
```

`audit_archive_drill` 默认只读。`archive_audit_logs` 输出的 Manifest v2 记录策略、筛选、导出器/导出时间、范围、链边界、hash-chain 状态、归档 SHA-256 和生命周期审批边界；`--verify` 复验文件 hash、记录数和内部相邻链，JSONL + `--include-snapshot` 可重算 `current_hash`，其余场景显式标记 partial。锚定必须在复验通过后显式 `--confirm-external-anchor` 入队，并且 provider 总开关、HTTPS URL/token 与 worker 锚定开关全部有效才会外发。源数据删除仍未实现且被禁止；脱敏必须生成新派生归档、新 Manifest 和新锚点；恢复必须先复验归档/Manifest/外部回执，再走双人变更单与已验证备份审批。

密码重置 token 留存清理：

```bash
cd backend
python -m scripts.cleanup_password_reset_tokens --retention-days 30
python -m scripts.cleanup_password_reset_tokens --retention-days 30 --apply
```

该脚本按 `used_at <= cutoff` 或 `used_at IS NULL AND expires_at <= cutoff` 选择已使用或已过期的终态 token。默认只做 dry-run，显式传入 `--apply` 才删除；`--retention-days` 与 `--before` 互斥，`--before` 不允许指向未来时间，`--limit` 控制单批候选数量。输出只包含数量、状态、id 范围、终态时间和候选口径，不返回用户名、IP 哈希、user-agent、token hash 或明文 token。

过期认证会话清理：

```bash
cd backend
python -m scripts.cleanup_auth_sessions --before 2026-07-08T00:00:00Z
python -m scripts.cleanup_auth_sessions --before 2026-07-08T00:00:00Z --apply
```

该脚本按 `revoked_at IS NULL AND expires_at <= cutoff_at` 选择过期且未撤销的登录会话。默认只做 dry-run，显式 `--apply` 才写入 `revoked_at`；不会删除 `auth_sessions` 行，不返回 token hash、IP hash、user-agent 或明文 token。

认证生产姿态报告：

```bash
cd backend
python -m scripts.auth_security_drill --require-production --require-admin-bootstrap-token
```

报告检查 production-like 环境、admin bootstrap token 配置强度、session cookie 策略、password reset dev token 回传、登录锁定、审计脱敏和清理命令入口；只返回布尔状态和策略判断，不回显 secret。该报告是上线前清单，不替代真实 MySQL 注册/登录/登出/撤销/密码重置演练。

部署预检：

```bash
cd backend
python -m scripts.deploy_preflight --require-mysql
```

预检会检查 `ASTRA_DATABASE_URL` 可连通，并确认数据库 Alembic 当前 revision 已到 head；失败时返回非零退出码和 JSON 报告。正式部署应先执行 `python -m alembic upgrade head`，再执行预检。生产环境建议追加 `--require-mysql`，此时预检会要求当前连接为 MySQL、`ASTRA_AUTO_CREATE_TABLES=false`，并报告 `configuration.auto_create_tables`、`dialect`、`driver`、数据库/连接字符集、排序规则、`time_zone`、`system_time_zone`、`server_version`、`sql_mode`、`max_connections`、当前库和当前用户；若仍开启自动建表、数据库或连接字符集不是 `utf8mb4`，或排序规则不是 `utf8mb4_` 前缀，会返回非零退出码。时区、`sql_mode` 与连接数当前只报告不强制，真实 MySQL 试运行报告需记录异常值和处置状态。

部署 smoke：

```bash
cd backend
python -m scripts.deploy_smoke --require-mysql
```

smoke 会复用部署预检，再检查当前模型期望表是否全部存在、关键模型列是否缺失，并用同一配置启动 FastAPI TestClient 访问 `/api/health`。0047 起还固定检查 `schools/class_groups.description` 的 Text/nullable、`version` 的 Integer/non-null/server default 1，以及所有现存行 `version >= 1`；结果位于 `organization_governance_mismatches` 与 `organization_version_invalid_rows`。脚本运行时会临时关闭自动建表、知识快照调度器和内容脚本远端漂移调度器，只验证迁移后的现有状态。`--require-mysql` 用作生产门禁：会把 MySQL 方言、`utf8mb4` 字符集/排序规则检查传递给预检层，并继续在 schema 层阻断非 MySQL 方言；本地或 CI 需要覆盖临时库时可追加 `--database-url` 且不传 `--require-mysql`。

反向代理/服务注册拓扑演练报告：

```bash
cd backend
python -m scripts.deploy_topology_drill \
  --static-url https://your-domain.example/ \
  --proxied-api-url https://your-domain.example/api/health \
  --direct-api-url http://127.0.0.1:9011/api/health \
  --public-direct-api-url http://your-public-ip:9011/api/health \
  --external-probe-ref probe/external-change-001 \
  --origin https://your-domain.example \
  --api-bind-host 127.0.0.1 \
  --api-bind-port 9011 \
  --verify-windows-services \
  --require-public-port-isolation
```

该脚本输出 JSON 报告，检查静态主站 HTML、经反向代理的 FastAPI `/api/health`、`Cache-Control: no-store`、`X-Request-ID`、CORS Origin、公开 health 不回传数据库 URL、直连 FastAPI 主机是否为本机/内网、公网直连端口是否不可达，以及四个服务的日志和重启计划。目标发布必须同时使用 `--require-public-port-isolation`、`--external-probe-ref` 与 `--verify-windows-services`：公网探测 host 必须由 manifest 冻结并成功解析到公网地址，缺 URL/外部执行引用或解析失败均阻断；SCM 回读还要逐服务确认存在、自动启动、正在运行、最小权限内置账号和有效 PID。本地非发布演练可不启用严格参数。

Windows 演练包应使用已单独下载并复核 hash 的 WinSW/Caddy 与合格 Release 构建产物生成；脚本不会联网下载、不会打开防火墙、不会安装或启动服务，也不会把 MySQL DSN 写进报告：

```powershell
.\deploy.ps1 `
  -WinSwPath C:\staging\verified\WinSW-x64.exe `
  -StaticExecutable C:\staging\build\englab_server.exe `
  -CaddyExecutable C:\staging\verified\caddy.exe `
  -OutputDir C:\englab\service-bundle `
  -SecretStorePath C:\englab\secrets\astra-staging.dpapi `
  -Environment staging `
  -PublicOrigin $PublicOrigin
```

`-Environment` 只接受 `staging` 或 `production`，并同时写入 API/worker XML 与生成报告；默认值为 production 以兼容旧调用。目标 staging 必须显式传入 staging，development 不属于目标服务包。

密钥文件先从 `backend/` 运行 `python -m scripts.windows_dpapi_secret_store seal --output <dedicated-secrets-dir>\<store> --service-account "NT AUTHORITY\LocalService"`，并只从 stdin 输入进程内 `ASTRA_*` JSON。专用父目录和文件都使用 DPAPI LocalMachine 配套的受保护 DACL，只授权当前操作者、SYSTEM、Administrators 和所选 LocalService/NetworkService；已存在但 ACL 不匹配的目录直接拒绝，加密载荷与服务包必须绑定同一账号。生成后先复核 JSON 中的 `artifact_hashes`、`secret_store_provider`、`secret_store_required_keys`、四份 XML 和 `config/Caddyfile`，再按 `commands.install/start/stop/uninstall` 操作。生产数据库连接只允许由该 store 注入；bootstrap key 只注入 API、不进入 worker；根脚本不下载未校验工具、不开放端口，也不直接包装控制台程序。

指定 staging 三角色证明运行 `node tools/browser/role-workflows-proof.cjs --api <same-https-origin> --web <same-https-origin> --out <empty-directory-outside-repo> --confirm-target-staging ...`。目标模式要求公开 DNS、标准 443 的同源 HTTPS，拒绝 IP、单标签、保留/示例域和非标准端口；health `environment` 必须明确为 `staging` 或 `production`，Git 必须干净冻结，`--out` 必须显式指向仓库外不存在或为空的目录，bootstrap token 只从 `ASTRA_ADMIN_BOOTSTRAP_TOKEN` 环境注入并拒绝 CLI 值。推荐使用 DPAPI runner 的 `--executable <node.exe>` 启动；成功后完整诊断写入 `role-workflows-report.json`，可封装的固定 raw 直接写入 `target-browser-smoke.json`，其 12 项语义、真实 Edge 版本和 `release_revision` 均由运行断言生成。浏览器成功后仍须对同一 MySQL 做独立只读总账，再把该 raw 进入精确七类 `target-release-v2` evidence 封装。

目标发布证据使用 `target-release-v2`。先基于 `backend/release-artifact-manifest.example.json` 建立同包 `release-artifact-manifest-v1`，固定 version/revision 以及 static/API/worker/proxy/migrations 五类不可变制品引用、SHA 和大小；再完成 `backend/target-release-manifest.example.json` 中的目标实例、HTTPS origin、版本、冻结 revision、制品清单路径/SHA 和 bundle ID。四份自动报告必须保留执行时生成的 `generated_at` raw JSON；恢复/回滚从 fail-closed 模板开始，目标浏览器模板只作 schema 参考，真实 ready raw 必须由 target proof 直接生成。所有 raw 报告必须由统一封装器校验并绑定唯一 run ID：

```bash
cd backend
python -m scripts.target_release_evidence template --evidence-id database_restore --output ../evidence/raw/database-restore.json
python -m scripts.target_release_evidence seal --manifest ../evidence/target-release.json --evidence-id deploy_preflight --run-id preflight-change-001 --input ../evidence/raw/deploy-preflight.json --output ../evidence/evidence/deploy-preflight.json
python -m scripts.target_release_gate --manifest ../evidence/target-release.json
```

总闸固定为 51/51：拒绝示例 origin、制品清单缺失/篡改/版本不一致、manifest 自选 `status_path/expected`、匿名或自定义第八 evidence、空壳 `ok=true`、跨目标/跨 revision/跨 bundle、重复 run、过期 envelope 或超出总闸当前窗口的旧 raw、路径逃逸/hash 篡改、非单一 0050 MySQL、未绑定/未解析公网探针、仅服务名 SCM、缺少三角色/409/组织归档恢复浏览器语义和敏感正文。正式 CLI 完全拒绝时间覆盖；测试只能直接调用内部函数注入时钟。真实证据包、DSN、secret 和备份内容不得进入仓库；完整执行顺序见 `doc/04-部署指南.md`。

正式内容初始化：

```bash
cd backend
python -m scripts.init_content_pages --dry-run --publisher-user-id <admin_id>
python -m scripts.init_content_pages --publisher-user-id <admin_id> --allow-reviewed-scripts
```

脚本输出 JSON 报告；非 dry-run 写入前必须确认内置脚本引用已审核。内置本地脚本引用不依赖外部 host allowlist；若未来引入外部内容脚本，必须先配置 `ASTRA_CONTENT_SCRIPT_ALLOWED_HOSTS` 并满足 `https`、无 query/fragment、SRI、`crossorigin=anonymous` 和管理员审核契约。若不传 `--publisher-user-id`，脚本会选择第一个 active admin 作为发布归因；生产环境建议显式传入。

相关回归入口：`python -m pytest backend/tests/test_content_lifecycle_drill.py backend/tests/test_content_initialization.py backend/tests/test_content_publication.py -q`，其中生命周期用例覆盖只读演练报告和坏状态检出，初始化用例覆盖中文数据库路径，发布用例覆盖中文 URL slug 的创建、发布、公开读取、后台查询和版本历史过滤。
