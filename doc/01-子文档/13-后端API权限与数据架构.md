# 星序 Astra — 后端 API、权限与数据架构

> 子文档编号：13
> 上级文档：[01-开发者手册](../01-开发者手册.md)
> 文档状态：已从原始主文档迁移，保留原有技术事实
> 最近更新：2026-08-22
> 更新者：DOC 组（主开发单线兼任）

集中说明 C++ 静态服务、Python 业务后端、认证授权、接口、数据与存活探针等后端实现。

---
## 5. 后端架构

v6.5 起，项目进入“双服务过渡期”：`server/` 的 C++ 服务继续承担既有静态托管和部署 fallback，`backend/` 的 Python FastAPI 服务承担全部业务 API、内容协议、登录用户体系和三端平台能力。V6.6.60 已删除 C++ `/api/info` 与占位 `/api/eval`；不得在 C++ 静态进程上新增用户、课程、作业、学习数据或其他业务 API。

### 5.1 C++ 静态服务器

基于 `cpp-httplib` 的轻量级 HTTP 服务器。

**启动命令**：

```bash
cd server
cmake -B build -S .
cmake --build build --config Release --target verify_build_manifest
./build/Release/englab_server.exe -p 910 -r ..
```

cpp-httplib v0.18.3 不再只按 tag 获取：`server/CMakeLists.txt` 固定官方 commit `a7bc00e3307fecdb4d67545e93be7b88cfb1e186`，FetchContent 完成后必须以本地 Git 对象复核实际 HEAD。`ASTRA_DEPENDENCIES_OFFLINE=ON` 只接受显式 `FETCHCONTENT_SOURCE_DIR_HTTPLIB`，且同样复核完整 commit；空缓存、缺文件或错 commit 在配置阶段 fail closed。

Release 构建会在可执行文件旁生成 `englab_server.build-manifest.json`，记录产物名称/大小/SHA-256、CMake 与编译器版本、构建配置和 cpp-httplib 来源；`verify_build_manifest` 目标重新计算关键值。该清单提供来源与单产物可追踪性，不把不同构建目录下的 MSVC 二进制宣称为逐字节可复现。

**参数**：

| 参数        | 说明           | 默认值 |
| ----------- | -------------- | ------ |
| `-p PORT` | 监听端口       | 9527   |
| `--host HOST` | 监听地址；扩大到 `0.0.0.0` 前必须完成反代/防火墙评审 | `127.0.0.1` |
| `-r ROOT` | 静态文件根目录 | `..` |
| `-h`      | 显示帮助       | —     |

### 5.2 Python 业务后端

V6.6.47 起，`?backendSchema=1` 的前端试点会读取 `scriptManifest.embed` 并创建 iframe sandbox。V6.6.52 起，内置能量守恒实验由后端模板注册表提供独立 DOM/CSS，脚本只查询传入 root；父页严格校验 descriptor、sandbox URL、opaque origin、template/document contract 和消息元数据，终态失败会卸载 iframe 并恢复静态实验。该能力仍是 opt-in 接入层，不改变默认静态页面回退策略。

FastAPI 后端位于 `backend/`，当前首切片提供配置、数据库探针、健康检查、部署预检、部署 smoke、反向代理/服务注册拓扑报告脚本、API no-store 缓存边界、内容协议样例、内容 seed 启动初始化与读取无副作用边界、正式内容初始化入口、ContentDraft 草稿、脚本审核、脚本静态分析风险等级、脚本 sandbox 契约、脚本资产 allowlist/SRI 静态门禁、脚本资产下载校验证据、发布版本绑定的外部脚本资产镜像、管理端脚本资产供应链清单、内容脚本镜像一致性审计、内容脚本远端漂移扫描、内容脚本扫描 run 台账与远端漂移告警候选摘要、内容脚本远端漂移扫描调度与 CLI observe-only 首轮、内容脚本扫描 run 健康与队列摘要、内容脚本远端漂移告警 outbox 人工复核入队与状态流转、内容脚本 CDN host 信任治理首轮、公开 render 脚本 manifest 脱敏与沙箱执行契约头、稳定 `sectionId/sourceId` 内容身份、草稿编辑、提交/退回/撤回工作流、active 草稿数据库唯一约束、内容发布/版本记录/追加式回滚、发布/回滚冲突 409、脚本历史版本 rollback 重审门禁、内容页 current 指针、草稿 base version/hash、版本 previous 链、发布元数据、中文路径/中文 slug 回归、管理端版本 JSON path diff 敏感预览脱敏与带显式稳定 ID 字段的 semantic 富语义摘要、本地认证安全基线、活动会话列表与单会话撤销、会话设备标识与 last_seen 追踪/节流、管理员密码重置、用户自助密码重置令牌、密码重置 token 留存清理脚本、禁用用户会话撤销、用户名大小写规范化与 normalized key 数据库唯一约束、必填文本修剪后校验、学校班级加入申请审批、teacher direct join 审批收口、学校/班级/课程访问控制服务层、课程/作业/学习事件、普通提交批改、代码题目/不可变版本/源码提交/判题租约、跨班级提交唯一性、学生资源状态可见性、学生侧只读复盘、积分流水、个人进度摘要、知识状态/班级规则统计、个人/班级知识快照、知识快照周期重算脚本/运行记录/进程内调度器/数据库租约防重入/自动心跳、管理端知识快照运行列表/健康摘要/调度积压摘要/告警候选摘要/告警 outbox 人工复核台账、状态流转、队列摘要与批量复核、协作式取消与手动 requeue、管理端基础 API、管理端加入申请队列、管理端列表分页搜索、管理端内容页数据库侧分页、缺陷记录外部 issue 链接、审计元数据、认证事件审计、审计日志链式哈希、审计链完整性校验、审计日志 JSON/CSV 明细导出、报表摘要导出、审计高频候选摘要、审计留存预检、本地审计归档包导出/Manifest 校验与导出/摘要行为审计留痕、前端 opt-in schema 试点和测试入口。

**阶段状态读法**：

- 以可复核能力和阶段门禁读取进度，不再使用早期主观完成度百分比。账号、组织、课程作业、内容治理、知识快照、管理端基础、审计、部署预检/smoke/拓扑报告以及管理、教师、学生三端首轮入口均已有对应实现。
- 真实 MySQL、反向代理/四服务、重启恢复与首个 RC 回滚证据已经完成；当前发布前缺口是指定目标环境的域名/TLS/secret/备份/监控闭环和可重复三角色端到端门禁。强设备绑定、长期会话策略、正式告警和审计外部归档不属于当前 P0；邮件/短信/MFA 投递标记为 `P4 / 最低优先级 / 暂缓`。
- 新后端开发应先阅读 `02-更新规划.md` 的任务/版本、`09-后端阶段收束小版本开发安排.md` 的执行顺序与退出门禁、本文的服务边界和 `07-后端优化与设计.md` 的架构/风险表；全部历史完成项与验证事实统一以 `03-发布历史.md` 为准。

**服务层边界**：

| 服务 | 职责 |
| ---- | ---- |
| `app.services.access_control` | 学校、班级、课程可见性与两轴角色范围判断；课程 owner/admin 管理协作者，`editor` 可写单元/作业/全局积分规则，`content_editor` 可写单元/作业，`assessment_editor` 可写作业/全局积分规则，`viewer` 只读。课程角色不会自动授予班级成员、提交、评分或学情权限；班级挂课、成员、转班、提交、批改、事件、积分、进度和班级统计仍要求 active class teacher scope。班级策略写入同时要求课程编辑能力与目标班级 teacher scope；全局 admin 保留跨范围治理能力 |
| `app.services.learning_evidence` / `app.services.teacher_evidence_facts` | 前者持有完成规则、append-only 事实、追加式行政纠错、投影/恢复/聚合和教师逐学生证据发现；明细查询继续先复用 class teacher/admin、active `CourseClass` 与 active student membership，并按 `occurred_at DESC, id DESC` 稳定分页。后者是无 DB/API/schema/model 副作用的纯投影，只按 `activity_key + event_schema_version + event_type + exact leaf path` 产生最多 12 个固定表序中文 facts。schema v1 当前只支持力学与循环浅层真实 producer；其余四门、其他 activity、未知 schema/event 为空 facts 且 `truncated=true`。用户字符串只做 exact enum 比较而不回显；未知 nested leaf、原始 evidence、幂等键、请求哈希、凭据、源码、source/ref/revision/hash 均不出边界 |
| `app.schemas.course_status` / `app.api.endpoints.course_status` / `app.services.course_status` | DTO、`/courses/{id}/status` endpoint 与管理员课程状态治理的独立 owner；router 负责 `/courses` 注册，冻结 `courses.py/course.py` 不增长。写入按 `ADMIN_AUTHORITY_LOCK → school → course → active admin` 锁后重验、`expected_status` CAS、固定转换图和 `course.status.patch` 审计执行；单进程 SQLite 同领域事务锁保证同 expected 竞争为一成功一冲突，残余 locked/busy 归一为 `409`。响应返回课程与 active 挂班、单元、作业计数，不承担通用 Course PATCH |
| `app.schemas.course_unit_access` / `app.api.endpoints.course_unit_access` / `app.services.course_unit_access` | 学生已知活动访问处置的独立 owner；按精确 `class_id + course_id + activity_key` 复用 `resolve_student_course_class`、`get_plan_for_unit` 与 `effective_unit_access`。授权内只返回 `available/error_code`，hidden / locked / missing 均为安全 `200`；activity key 多匹配、目标 plan 缺失/关联不一致或未知发布态固定 `409`，无关 plan 漂移不阻断目标，不返回目录、内容、发布计划或锁定原因，也不发起写事务。正式唯一约束阻止正常重复 plan 写入，运行时 scalar 读取不承诺检测绕过约束的重复行 |
| `app.services.code_judge` | V7.5.6 题目版本、提交幂等、问题/资源策略快照、判题尝试原子 claim/租约/过期重排、终态写回和 runner 不可用恢复合同。默认 adapter 只有 availability=false，不执行、派发或外呼源码；未来 worker 只能在 API 进程外实现并消费冻结的 network=false/filesystem=none/CPU/墙钟/内存/输出/进程策略 |
| `app.api.endpoints.code_judge` | 教师/管理员题目与版本写入、稳定 course/activity/class 题目发现、学生 open 分块源码提交、本人/班级教师/管理员授权读取，以及班级/课程/活动数据库分页。学生隐藏/撤回发布资源不会通过列表或明细泄漏，审计只记录哈希、范围、语言和状态，不记录源码或测试正文 |
| `app.services.assignment_policies` | 解析作业在指定班级的 effective assigned/status/due_at/point rule，并提供查询使用的 assigned/status SQL 表达式；学生作业中心、提交、复盘、学习事件、批改积分、进度与知识统计必须复用同一口径。`all_attached_classes` 默认分配全部挂接班级，策略可排除；`selected_classes` 仅分配显式 `assigned=true` 的班级 |
| `app.services.points` | assignment 级积分规则规范化与批改积分计算；默认规则为 `enabled=true`、`points_per_score=1`、`max_points=null`，批改按“规则目标积分 - 当前 submission 已入账 assignment_grade 积分”写入差额流水，避免重复批改累计膨胀，并支持封顶或禁用规则后的反向校正 |
| `app.services.class_join_requests` | 班级加入申请的状态流转、成员关系补齐和审批审计 |
| `app.services.audit` | 审计日志写入、request_id、IP 哈希、user-agent、结果元数据和 `prev_hash/current_hash` 应用层链式哈希；写入前通过集中 redactor 兜底脱敏 payload、token、secret、原始 URL/SRI、镜像字节、复核备注、feedback/evidence 等高风险键；审计 IP 哈希默认不信任 `X-Forwarded-For`，需显式可信代理配置才读取转发链；管理端 JSON/CSV 明细导出默认剥离快照，但保留哈希字段，并用 `admin.audit.export` 反向记录导出格式与摘要；报表摘要用 `admin.audit.report` 记录格式、筛选与 bucket 数量；留存预检用 `admin.audit.retention_plan` 记录策略、候选数量、临期数量、bucket 数量和链边界；高频候选摘要用 `admin.audit.high_frequency` 记录筛选、时间窗、阈值、总量和维度命中数；离线归档包 Manifest 可复验 SHA-256、记录数和归档文件内部 hash 链 |
| `app.services.audit_archive_anchors` / `audit_anchor_delivery` | V6.6.56 审计归档 hash 回执控制面；先复验 Manifest/归档，再以幂等账本入统一任务队列。HTTPS adapter 使用 Bearer + HMAC-SHA256 + 稳定 Idempotency-Key + no-redirect，只发送 hash/范围/链边界；失败记录独立 attempt，不修改原始审计链、Manifest 或归档字节 |
| `app.services.external_issue_providers` | V6.6.57 外部 issue provider 协议与 GitHub REST 实现；校验 HTTPS/same-origin redirect、目标仓库 URL、响应 issue id/state、API 版本和限流/网络错误分类。当前仅 GitHub 可执行，Gitee/Jira 尚未实现 |
| `app.services.bug_external_sync` | V6.6.57 BugRecord 出站同步控制面；以稳定操作键和 `bug_external_sync_operations` 记录 create/status/comment 的 attempt/receipt/失败/ambiguous，成功操作可恢复读取。创建和评论遇未知结果不盲重试，不接收外部自动入站，不保存评论正文，不让外部状态覆盖本地权威字段 |
| `app.services.backend_performance` | V6.6.58 查询/索引/预算合同；检查 11 个高频 profile 的必要索引、EXPLAIN 访问方式和最多 50 行有界基准，报告分页上限、MySQL 连接池、worker 隔离和延期风险。响应/审计不返回 SQL、参数、结果值或数据库 URL；SQLite 结果不能替代真实 MySQL 证据 |
| `app.services.audit_archive_drill` | 审计归档/留存生产演练前后的只读姿态报告；检查数据库方言、留存 cutoff、候选/保留/临期数量、归档预览、候选链完整性、敏感字段扫描、操作边界和真实 MySQL/WORM/外部锚定待留证项。不写文件、不写审计、不删除或移动 `audit_logs`，不返回密码、token、密钥、原始快照正文或复核备注；`scripts.audit_archive_drill --require-mysql` 用于防止把 SQLite 回归误判为生产归档演练 |
| `app.services.backend_stage_gate` | V6.6.44 后端阶段门禁总账；聚合部署预检、部署 smoke、拓扑、认证、内容生命周期、知识快照调度、内容脚本远端漂移和审计归档报告，并把完整 pytest、核心手工路径、部署文档、admin bootstrap、回滚复核作为显式确认项。报告只读输出 `phase`、`gates`、`blockers`、`missing_evidence` 与“通过 / 延期 / 带风险通过”建议，不替代真实 MySQL、真实反向代理或人工验收证据 |
| `app.services.rc_external_scope` | V6.6.63 首个 RC 外部通道范围门禁；只读检查 Webhook/GitHub/audit anchor 的选择、启用、配置和 staging 读回确认，阻断范围漂移。报告不发起网络请求、不写库、不返回 URL、owner/repo、token 或回执正文；未选通道必须保持关闭 |
| `app.services.users` | 用户名修剪、小写规范化、规范化后长度校验与大小写不敏感账号查找 |
| `app.services.admin_common` | 管理领域共享管理员角色校验、数据库计数、分页游标、转义搜索模式、UTC 比较与最早/最晚时间聚合、审计变更快照和待批改提交状态口径；端点模块不得复制这些规则 |
| `app.services.admin_organization_stats` | V7.4.2 学校/班级统计查询服务，集中成员、课程、作业、学习事件、提交、积分和平均成绩聚合；端点只负责授权和响应编排 |
| `app.services.content_version_diff` | V7.4.3 内容版本结构 diff、稳定 section/source 身份语义 diff 与敏感路径预览脱敏；不依赖管理路由聚合器 |
| `app.api.endpoints.admin_presenters` | 跨管理领域复用的安全响应映射；当前集中 alert outbox 条目和写入摘要，不返回完整 payload/hash/复核备注 |
| `app.api.endpoints.admin_snapshot_tasks` | V7.4.4 知识快照 run 列表、health、queue、alerts/outbox、cancel/requeue 管理控制面；保留租约、调度窗口、脱敏 metadata 与协作式状态流转语义 |
| `app.api.endpoints.admin_alerts` | V7.4.5 alert outbox 列表/队列、dispatch dry-run/plan/validate/dispatch 与单条/批量人工复核；保持 payload/hash/备注脱敏和显式外投确认 |
| `app.api.endpoints.admin_background_tasks` | V7.4.6 告警 plan、知识快照与内容脚本扫描三类任务入队，以及 task/queue/attempt/retry/cancel 管理控制面；响应持续隐藏 payload 与 lease token |
| `app.api.endpoints.admin_audit` | V7.4.7 审计列表、JSON/CSV 导出、聚合报表、留存预检、链完整性和高频候选；保持公式中和、快照默认剥离和摘要反向留痕 |
| `app.api.endpoints.admin_overview` | V7.4.8 管理领域数据地图统计与后端性能报告；跨领域计数只返回聚合规模，不暴露数据库 URL/SQL/参数 |
| `app.api.endpoints.admin_governance` | V7.4.8 待批改权限队列、Bug CRUD、外部 issue posture/operation/create/status/comment 治理；本地 BugRecord 保持权威 |
| `app.api.endpoints.admin` 及管理子路由 | `admin.py` 仅按原顺序聚合 9 个领域 router；69 条路由/67 个 OpenAPI path 由兼容快照锁定。新增能力进入对应领域模块，不得把业务逻辑重新堆回聚合器 |
| `app.api.endpoints.auth` | 本地注册登录、会话治理和用户自助密码重置 token；重置请求泛化响应，按账号哈希/IP 哈希冷却，生产环境不回传 token，确认阶段行锁消费 token、重置密码、撤销会话、清理登录失败桶并写入脱敏审计；邮件/短信/MFA 投递暂列 `P4 / 最低优先级 / 暂缓` |
| `app.services.password_reset_tokens` | 过期或已用密码重置 token 的离线留存清理服务；默认 dry-run，显式 `apply` 才删除，候选口径为 `used_at <= cutoff` 或 `used_at IS NULL AND expires_at <= cutoff`，摘要不返回用户名、IP 哈希、user-agent 或 token hash |
| `app.services.auth_sessions` | 过期认证会话离线撤销服务；默认 dry-run，显式 `apply` 才把 expired+unrevoked 会话写入 `revoked_at`，不删除行，摘要不返回 token hash、IP hash、user-agent 或明文 token |
| `app.services.content_catalog` | 内容页 seed、正式内容初始化、published schema 读取和内容页摘要；GET 查询只读当前已发布记录并剥离原始脚本引用、SRI/crossorigin 元数据和 sandbox 原始字段，只保留带稳定 `sandboxId` 的 `scriptManifest`。可执行 embed 还必须通过 `app.services.content_script_sandbox_templates` 的 template/document contract allowlist；当前内置能量守恒模板固定生成独立 DOM/CSS 并只接受受控摩擦配置，raw HTML、任意 initializer、未知模板或非法配置 fail closed。前端只消费 descriptor，不拼装 sandbox endpoint；opaque iframe、CSP nonce、受控 bootstrap/assets、静态回退和 published 只读边界保持不变 |
| `app.services.content_lifecycle_drill` | 内容发布/初始化/回滚生产演练前后的只读姿态报告；检查 published current 指针、schema hash、版本 previous/rollback 链、active 草稿姿态、脚本镜像一致性、API no-store 配置，以及可选 render URL 与静态 fallback URL。报告不执行初始化、发布、回滚、外网下载或写库，不返回完整 schema、原始 CDN URL、完整 SRI、镜像字节、`content_bytes` 或 secret；`scripts.content_lifecycle_drill --require-mysql` 用于防止把 SQLite 回归误判为真实 MySQL 演练 |
| `app.services.content_identity` | 内容协议稳定身份契约；历史 schema 读取保持可选兼容，新写入草稿、草稿更新、发布和内置初始化要求每个 section/source 带稳定 `sectionId/sourceId`，并拒绝重复 ID 或章节 `props.sectionId/props.id` 与顶层 `sectionId` 冲突 |
| `app.services.content_script_policy` | 内容草稿脚本静态分析、脚本资产 allowlist/SRI 静态门禁、后端下载校验、public manifest 与 sandbox 契约；输出 policy version、policy context hash、schema hash、风险等级、sandbox 摘要和 findings，阻断危险协议、路径穿越、内联脚本、`<script>` 标签、缺失 sandbox 与不安全 sandbox 能力；外部脚本 URL 默认阻断，配置 `ASTRA_CONTENT_SCRIPT_ALLOWED_HOSTS` 后仍需显式 `https://`、无 query/fragment、合法 SRI 和 `crossorigin=anonymous`，并继续进入管理员审核；管理员批准外部脚本和发布已审核草稿时会下载资产并按声明 SRI 比对字节，下载失败、SRI mismatch 或发布前 CDN 字节漂移会阻断流程；校验 finding metadata 会保留资产 SHA-256、字节大小、SRI token 数量和匹配算法；公开 manifest 会按 `network=none/same-origin` 派生稳定 CSP、返回 enforcement/capabilities，并对 unsafe sandbox 防御性降级；sandbox HTML 响应会按单次请求生成 nonce，把响应级 `script-src` 收紧为 nonce source，并强制 `Content-Security-Policy`、`X-Content-Type-Options: nosniff` 和 `Referrer-Policy: no-referrer`，本地 JS 资产必须位于 `pages/`、`shared/js/`、`codevis/shared/js/` 或 `drafts/` 受控根并通过 bootstrap + `asset_sha256` 端点加载；外部脚本发布成功后由 `app.services.content_script_assets` 写入 `content_script_assets`，render 阶段只读取当前 published version 绑定的镜像字节，不联网、不代理任意 CDN、不暴露原始 URL；管理端 `GET /api/admin/content/script-assets` 可只读分页筛选镜像资产清单，响应与审计不返回原始 CDN URL、完整 SRI 或 `content_bytes`；默认下载器不跟随重定向；当前仍不承担实时监控或外部告警；前端 iframe 生命周期首轮和浏览器自动化隔离证明已由 BE-09 adapter 与 V6.6.48 drill 覆盖 |
| `app.services.content_script_assets` | 外部脚本发布版本绑定镜像、脚本引用提取、镜像一致性审计和手动远端漂移扫描；发布时把外部脚本字节以 `page_version_id + sandbox_id + reference_value_sha256` 绑定到 `content_script_assets`，render 阶段只按当前 published version 读取本地镜像字节；管理端 `GET /api/admin/content/script-assets/mirror-audit` 只读检查当前 published schema 与镜像表绑定、source/integrity 元数据、本地字节 SHA-256/大小/SRI 和重复引用；管理端 `POST /api/admin/content/script-assets/remote-drift-scan` 需要显式 `confirm_external_network=true`，按 `limit/offset` 小批量读取远端当前字节并与发布镜像 hash/大小/SRI 比对，沿用大小上限和 no-redirect 下载边界；响应与审计只返回 host/hash/问题码，不返回原始 CDN URL、完整 SRI、远端字节、异常明细或 `content_bytes`；这些审计/扫描不发外部告警、不自动修复/删除/重发资产、不自动信任或封禁 host |
| `app.services.content_script_asset_scan_runs` | 内容脚本远端漂移扫描 run 台账、租约生命周期和告警候选摘要；`content_script_asset_scan_runs` 记录 `remote_drift` 扫描的 run key、manual/scheduler/script 触发来源、running/success/failed 状态、可空触发人、筛选条件、扫描 totals、issue code/severity 聚合、限量脱敏 issue 摘要、`alert_status`、`attempt_count` 和 scheduler lease 元数据；管理端 run 列表与 alerts 只返回 host/hash/id/聚合数量、租约 owner/过期/心跳和 action hint，不记录或返回 `scheduler_lease_token`、原始 CDN URL、完整 SRI、远端字节、`content_bytes` 或异常原文；该服务只提供观察面，不自动封禁 host、不替换镜像、不重发布内容、不发送外部告警 |
| `app.services.content_script_asset_scan_scheduler` | V6.6.55 前的兼容进程内调度器；统一 worker 未启用时仍按 interval/lease/limit/slug/source_host 执行小批量 observe-only 扫描。统一 worker 启用后，同一 scheduler 开关只生成 DB-backed task，不再同时启动该旧调度器 |
| `app.services.content_script_remote_drift_drill` | 内容脚本远端漂移生产观察前后的只读姿态报告；检查数据库方言、调度配置、host policy 桶、mirror 记录、scan run ledger、queue/alerts/outbox 和真实观察待留证项。报告不触发外网、不写库、不写 outbox、不修改 host policy、不返回原始 CDN URL、完整 SRI、远端/镜像字节、`content_bytes`、异常原文、`scheduler_lease_token`、payload 或复核备注；`scripts.content_script_remote_drift_drill --require-mysql` 用于防止把 SQLite 回归误判为真实 MySQL 演练 |
| `app.services.content_script_host_policies` | 内容脚本 CDN source host 治理状态；`content_script_host_policies` 以 host 为粒度保存 `trusted/watch/blocked`、审阅原因、审阅人和审阅时间，管理端列表会合并已观测镜像资产 host、环境 allowlist host 和持久化 policy；`blocked` host 是草稿创建/编辑、脚本审核、发布、回滚、公开 render embed 注入和 sandbox document/bootstrap/asset 执行路径的 fail-closed 门禁，`trusted/watch` 只表达治理状态，不绕过 `ASTRA_CONTENT_SCRIPT_ALLOWED_HOSTS`、SRI、`crossorigin=anonymous`、管理员脚本审核或发布前下载校验；响应与审计只记录 host、状态、原因和聚合数量，不记录原始 CDN URL、完整 SRI、脚本字节或异常明细 |
| `app.services.knowledge_snapshot_runs` | 日/周窗口知识快照批量重算、运行记录、长循环 heartbeat checkpoint、过期租约 start/success/failure guard、token guarded 租约释放、admin 健康摘要、调度积压摘要、告警候选摘要、协作式取消和手动 requeue；管理端摘要只返回 allowlist，不暴露 lease token、原始 metadata 或重排原因明细 |
| `app.services.knowledge_snapshot_scheduler` | 知识快照进程内调度、数据库租约抢占、过期 running 接管、pending run 限流扫描和 owner/token guarded 自动续租；续租会拒绝已过期或字段不完整的租约，调度积压摘要会区分实际 dispatchable now 与仅符合租约抢占规则的 claimable by lease rule |
| `app.services.knowledge_snapshot_scheduler_drill` | 知识快照调度器生产演练前后的只读姿态报告；检查 scheduler 配置、run ledger、partial lease、lease/heartbeat、due/pending 队列、快照输出计数和真实 MySQL 待留证项。报告不执行 rebuild、不抢租约、不取消、不重排，不返回 `scheduler_lease_token`、`metadata_json`、异常原文或 secret；CLI 非法参数/时间返回 JSON；`scripts.knowledge_snapshot_scheduler_drill --require-mysql` 用于防止把 SQLite 回归误判为真实 MySQL 演练 |
| `app.services.admin_alert_outbox` | 管理端告警 outbox 人工复核台账；当前承接知识快照告警候选和内容脚本远端漂移告警候选，分别以 `knowledge_snapshot_run_alert`、`content_script_asset_scan_run_alert` 写入 `admin_alert_outbox_entries`，按 source/run/code/action 与内容脚本 hash 定位信息 dedupe 幂等刷新 `seen_count/last_seen_at`，重复入队不会覆盖已人工复核的 `planned/queued/suppressed/cancelled` 状态；payload 仅保留脱敏运行摘要、host 与 SHA-256/hash 定位信息，不保存原始 CDN URL、完整 SRI、远端字节、异常原文、`content_bytes` 或 `scheduler_lease_token`；普通列表、入队响应和单条复核响应均为安全摘要，不返回 dedupe key、完整 payload hash、payload JSON 或备注正文；`GET /api/admin/alert-outbox/queue` 只读汇总待复核、已计划、待执行、终态和 stale/due 状态，审计只记录聚合计数；`POST /api/admin/alert-outbox/dispatch-dry-run` 只读生成 queued due 执行预检，分类 ready/blocked/expired/not due，响应与审计只返回脱敏 delivery key、payload hash 前缀和 blocker 原因计数，不修改 outbox 状态或 attempt；`POST/GET /api/admin/alert-outbox/dispatch-plans` 按显式 ID 固化脱敏执行计划 ledger，保存筛选、policy、计数、有限 ready ID、ready entry payload hash 快照和 blocker 原因计数；`POST /api/admin/alert-outbox/dispatch-plans/{id}/validate` 用于执行计划再校验，重新检查 entry 存在、状态、due/expired、delivery 边界和 payload hash 漂移，老计划缺 hash 快照会被标记为不可完整校验；单条和批量复核分别由 `PATCH /api/admin/alert-outbox/{id}` 与 `PATCH /api/admin/alert-outbox/reviews` 写入 `reviewed_by_user_id/reviewed_at/review_note`，批量请求必须显式列出 ID 且 all-or-nothing；`external_delivery=false`、`dispatch_mode=manual_review`，不发送邮件/短信/Webhook、不自动处置 |
| `app.services.alert_delivery` | V6.6.54 外部告警适配器；默认关闭，只接受安全配置注入的 HTTPS Webhook URL 和 SecretStr token。显式或 worker plan dispatch 采用 Bearer + HMAC-SHA256 + 稳定 Idempotency-Key，只发送 `astra.alert-envelope.v1` 脱敏信封；网络/5xx/429 失败保留人工重排边界 |
| `app.services.background_tasks` | V6.6.55 DB-backed 任务控制面；负责幂等入队、优先级/available_at、原子 claim、owner/token/expires heartbeat、attempt、指数退避、dead-letter、过期接管、token guarded complete/fail、显式 retry/cancel 和 attempt 历史，不承载领域 payload 对外读取 |
| `app.services.background_task_worker` | V6.6.55 统一 worker 和调度生产者；执行告警 dispatch plan、知识快照和内容脚本扫描，复用领域 run 处理控制面提交歧义。worker 循环默认关闭，内容脚本外网执行另设 opt-in；启用后旧知识/脚本进程内 scheduler 退为兼容路径 |
| `app.services.alert_dispatch_tasks` | 后台告警 plan 执行器；复核 plan/entry/hash/due/expiry 后使用稳定幂等键外投，已终态 plan 只恢复控制面，`dispatching` 歧义 plan fail closed 并要求人工核对接收端账本，不盲重发 |
| `app.services.knowledge_snapshot_scheduler` | FastAPI lifespan 进程内调度、失败重试上限和单进程防重入 |

**启动命令**：

```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

**配置前缀**：`ASTRA_`

| 变量 | 说明 |
| ---- | ---- |
| `ASTRA_ENVIRONMENT` | 运行环境，默认 `development` |
| `ASTRA_ADMIN_BOOTSTRAP_ENABLED` | 首个管理员初始化开关，默认 `true`；完成初始化后生产建议改为 `false` |
| `ASTRA_ADMIN_BOOTSTRAP_TOKEN` | 首个管理员初始化 token；除 `dev/development/test/testing` 外，只要 bootstrap 开启就必须配置 |
| `ASTRA_API_PREFIX` | API 前缀，默认 `/api` |
| `ASTRA_API_CACHE_CONTROL` | API 响应缓存策略，默认 `no-store` |
| `ASTRA_SESSION_COOKIE_NAME` | 登录会话 cookie 名称，默认 `astra_session` |
| `ASTRA_SESSION_DAYS` | 登录会话有效天数，默认 `7` |
| `ASTRA_SESSION_LAST_SEEN_UPDATE_SECONDS` | 当前会话 last_seen 刷新节流窗口，默认 `300`；同一 IP 哈希在窗口内不重复写库，设为 `0` 可关闭节流 |
| `ASTRA_PASSWORD_RESET_TOKEN_TTL_SECONDS` | 用户自助密码重置 token 有效期，默认 `1800`，最低 `60` |
| `ASTRA_PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS` | 密码重置请求冷却窗口，默认 `300`；按账号哈希和客户端 IP 哈希检查最近请求，设为 `0` 可关闭冷却 |
| `ASTRA_PASSWORD_RESET_TOKEN_RETENTION_DAYS` | 过期或已用密码重置 token 默认留存天数，默认 `30`；清理脚本未传 `--before` 或 `--retention-days` 时据此计算 cutoff |
| `ASTRA_CONTENT_SCRIPT_ALLOWED_HOSTS` | 内容外部脚本 host allowlist，默认空；逗号分隔 host，配置变化会通过 `policy_context_hash` 触发草稿审核/发布前重分析 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ENABLED` | 是否随 FastAPI lifespan 启动内容脚本远端漂移扫描调度器，默认 `false` |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_RUN_ON_START` | 调度器启动后是否立即运行一次，默认 `false`；部署 smoke 会临时关闭 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_INTERVAL_SECONDS` | 调度器轮询间隔，默认 `3600`，最低 `60` |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_LEASE_SECONDS` | 内容脚本扫描 run 租约有效期，默认 `3600`，最低 `60` |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ACTOR_USER_ID` | 内容脚本外网调度归因的活动 admin 用户 id；为空、禁用或非 admin 时调度 fail closed 跳过 |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_SCAN_LIMIT` | 单轮最多扫描引用数量，默认 `25`，范围 `1` 到 `200` |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_SOURCE_HOST` | 可选调度筛选 source host |
| `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_SLUG` | 可选调度筛选内容页 slug |
| `ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV` | 本地/测试调试 token 回传开关，默认 `false`；生产环境即便误设为 `true` 也不会回传 token |
| `ASTRA_LOGIN_MAX_ATTEMPTS` | 登录失败锁定阈值，默认 `5` |
| `ASTRA_LOGIN_LOCKOUT_SECONDS` | 达到失败阈值后的锁定秒数，默认 `900` |
| `ASTRA_LOGIN_ATTEMPT_WINDOW_SECONDS` | 统计连续失败的时间窗口，默认 `900` |
| `ASTRA_AUDIT_LOG_RETENTION_DAYS` | 审计留存预检和 `scripts.archive_audit_logs` 默认保留天数，默认 `365`；只影响 observe-only 预览和本地只读归档候选选择 |
| `ASTRA_AUDIT_ANCHOR_ENABLED` / `PROVIDER` | 外部 hash 回执总开关和 provider；默认 `false` / `webhook`，未启用不会外发 |
| `ASTRA_AUDIT_ANCHOR_WEBHOOK_URL` / `TOKEN` | HTTPS 回执目标与 SecretStr token；仅由环境或安全配置注入，报告不回显 |
| `ASTRA_AUDIT_ANCHOR_TIMEOUT_SECONDS` / `MAX_ATTEMPTS` | 单次请求超时与统一任务最大尝试次数，默认 `5` / `5` |
| `ASTRA_EXTERNAL_ISSUE_SYNC_ENABLED` / `PROVIDER` | 外部 issue 同步总开关和 provider，默认 `false` / `github`；当前只实现 GitHub |
| `ASTRA_EXTERNAL_ISSUE_SYNC_GITHUB_API_URL` / `WEB_URL` | GitHub REST 与网页 HTTPS 基址；用于同源请求和绑定/回执 URL 校验 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_GITHUB_OWNER` / `REPO` / `TOKEN` | 目标仓库及 SecretStr token；启用时必填，token 需 Issues 写权限且不得写入仓库或普通日志 |
| `ASTRA_EXTERNAL_ISSUE_SYNC_GITHUB_API_VERSION` / `TIMEOUT_SECONDS` | GitHub REST 版本和超时，默认 `2026-03-10` / `10` 秒 |
| `ASTRA_DATABASE_POOL_SIZE` / `MAX_OVERFLOW` | MySQL 每进程连接池与溢出上限，默认 `10` / `10`；API 和独立 worker 分别计算 |
| `ASTRA_DATABASE_POOL_TIMEOUT_SECONDS` / `POOL_RECYCLE_SECONDS` | 获取连接等待与回收秒数，默认 `30` / `1800`；保留 pre-ping/LIFO |
| `ASTRA_DATABASE_CONNECT_TIMEOUT_SECONDS` / `READ_TIMEOUT_SECONDS` / `WRITE_TIMEOUT_SECONDS` | PyMySQL 建连/读/写超时，默认 `10` / `30` / `30` 秒；不自动重试业务写事务 |
| `ASTRA_PERFORMANCE_SLOW_QUERY_LOGGING_ENABLED` / `THRESHOLD_MS` | 慢 SQL 指纹日志，默认 `true` / `500`；不记录 SQL 或参数 |
| `ASTRA_PERFORMANCE_SLOW_REQUEST_LOGGING_ENABLED` / `THRESHOLD_MS` | 慢 API 路由模板日志，默认 `true` / `1000`；不记录 query/body |
| `ASTRA_PERFORMANCE_CORE_API_BUDGET_MS` / `ADMIN_API_BUDGET_MS` / `EXPORT_BUDGET_MS` | 核心、管理列表和有界导出预算，默认 `500` / `1000` / `5000` 毫秒 |
| `ASTRA_PERFORMANCE_PROBE_ITERATIONS` | 每个查询 profile 的基准轮数，默认 `3`，范围 1-20 |
| `ASTRA_AUDIT_IP_HASH_SALT` | 审计中客户端 IP 哈希盐，默认开发值；生产环境应替换 |
| `ASTRA_AUDIT_TRUST_FORWARDED_FOR` | 是否允许审计 IP 哈希读取 `X-Forwarded-For`，默认 `false`；生产反代部署需先配置可信代理来源 |
| `ASTRA_AUDIT_TRUSTED_PROXY_HOSTS` | 可信反向代理连接来源，逗号分隔；只有命中 `request.client.host` 时才信任 `X-Forwarded-For` 首个 IP |
| `ASTRA_CORS_ORIGINS` | 允许凭据型 API/CSP frame ancestor 的精确 origin，默认本地两个来源；允许方法固定为 `GET/POST/PUT/PATCH/DELETE/OPTIONS`，禁止 `*`、`null`、userinfo、路径、query 和 fragment |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_ENABLED` | 是否随 FastAPI lifespan 启动知识快照进程内调度器，默认 `false` |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_RUN_ON_START` | 调度器启动后是否立即检查到期窗口，默认 `false` |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_INTERVAL_SECONDS` | 调度器轮询间隔，默认 `300`，最低 `30` |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_LEASE_SECONDS` | 调度数据库租约有效期，默认 `3600`，最低 `60` |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_HEARTBEAT_SECONDS` | 调度器与 CLI 长重算循环的自动租约心跳间隔，默认 `120`，最低 `30` |
| `ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_PENDING_LIMIT` | 调度器每轮最多消费 pending run 数量，默认 `50`，范围 `1` 到 `1000` |
| `ASTRA_KNOWLEDGE_SNAPSHOT_DAILY_ENABLED` | 是否启用每日窗口调度，默认 `true` |
| `ASTRA_KNOWLEDGE_SNAPSHOT_DAILY_HOUR` | 每日调度 UTC 小时，默认 `3`，重算前一日窗口 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_WEEKLY_ENABLED` | 是否启用每周窗口调度，默认 `true` |
| `ASTRA_KNOWLEDGE_SNAPSHOT_WEEKLY_WEEKDAY` | 每周调度星期，默认 `0` 表示周一 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_WEEKLY_HOUR` | 每周调度 UTC 小时，默认 `4`，重算上一自然周 |
| `ASTRA_KNOWLEDGE_SNAPSHOT_RETRY_ATTEMPTS` | 失败窗口最大尝试次数，默认 `3` |
| `ASTRA_BACKGROUND_TASK_WORKER_ENABLED` | 是否随 FastAPI lifespan 启动统一后台 worker，默认 `false`；独立 worker 服务运行时 API 进程应保持关闭 |
| `ASTRA_BACKGROUND_TASK_WORKER_INTERVAL_SECONDS` | worker 空闲轮询间隔，默认 `5` 秒 |
| `ASTRA_BACKGROUND_TASK_WORKER_LEASE_SECONDS` | 统一任务租约时长，默认 `300` 秒；必须覆盖正常单任务耗时并结合 heartbeat/领域 run 恢复策略设置 |
| `ASTRA_BACKGROUND_TASK_WORKER_BATCH_SIZE` | 每轮最多处理任务数，默认 `10`，范围 `1` 到 `100` |
| `ASTRA_BACKGROUND_TASK_WORKER_BASE_BACKOFF_SECONDS` | 可重试失败的基础退避秒数，默认 `30` |
| `ASTRA_BACKGROUND_TASK_WORKER_MAX_BACKOFF_SECONDS` | 指数退避上限，默认 `3600` 秒 |
| `ASTRA_BACKGROUND_TASK_WORKER_CONTENT_SCAN_ENABLED` | 是否允许统一 worker 执行会访问外网的内容脚本扫描，默认 `false`；只启用 worker 不会自动放开网络 |
| `ASTRA_BACKGROUND_TASK_WORKER_AUDIT_ANCHOR_ENABLED` | 是否允许统一 worker 执行外部审计锚定，默认 `false`；需与锚定总开关和完整 HTTPS 配置同时启用 |
| `ASTRA_DATABASE_URL` | SQLAlchemy 数据库 URL，生产目标为 MySQL |
| `ASTRA_AUTO_CREATE_TABLES` | 是否随 FastAPI 启动自动建表，默认 `false`；只允许本地/测试临时使用，生产和 MySQL 试运行必须保持 `false` 并通过 Alembic 迁移 |

**部署预检**：

```bash
cd backend
python -m scripts.deploy_preflight --require-mysql
```

该命令检查数据库连通和 Alembic 当前 revision 是否到 head；生产环境追加 `--require-mysql` 时，还会要求连接为 MySQL、`ASTRA_AUTO_CREATE_TABLES=false`，并校验数据库/连接字符集为 `utf8mb4`、排序规则为 `utf8mb4_` 前缀。报告中的 `configuration` 会记录运行环境和自动建表状态，`compatibility` 会记录 MySQL 字符集、排序规则、时区、版本、`sql_mode`、`max_connections`、当前库和当前用户；其中时区、`sql_mode` 与连接数当前只报告不强制。部署前应先执行 `python -m alembic upgrade head`，再执行预检；本地 SQLite 或 CI 临时库只做快速验证时可不传 `--require-mysql`。真实 MySQL 历史证据写入 `03-发布历史.md`，当前未闭环任务只维护在 `02-更新规划.md`，阶段门禁读取 `09-后端阶段收束小版本开发安排.md`。

**反向代理/服务注册拓扑报告**：

```bash
python -m scripts.deploy_topology_drill --static-url https://your-domain.example/ --proxied-api-url https://your-domain.example/api/health --direct-api-url http://127.0.0.1:9011/api/health --public-direct-api-url http://your-public-ip:9011/api/health --external-probe-ref probe/external-change-001 --origin https://your-domain.example --api-bind-host 127.0.0.1 --api-bind-port 9011 --verify-windows-services --require-public-port-isolation
```

该命令检查静态主站、经反向代理的 FastAPI health、no-store、request id、CORS、直连 API 监听地址、公网直连端口暴露和四服务 SCM 状态。目标发布必须同时启用 `--verify-windows-services`、`--require-public-port-isolation` 并传入与 manifest 一致的 `--external-probe-ref`；缺少公网原始 API URL/外部执行引用、目标 host 无法解析到公网地址或任一 SCM 字段不合格都会失败。它不替代真实反向代理配置、安全组和重启恢复留证；完整参数和证据口径见 `04-部署指南.md`。

**认证安全姿态报告与会话清理**：

```bash
cd backend
python -m scripts.auth_security_drill --require-production --require-admin-bootstrap-token
python -m scripts.cleanup_auth_sessions --before 2026-07-08T00:00:00Z
python -m scripts.cleanup_auth_sessions --before 2026-07-08T00:00:00Z --apply
```

`auth_security_drill` 只返回配置布尔状态和策略判断，不回显 admin bootstrap token、审计盐或其他 secret；用于上线前检查 production-like 环境、cookie、password reset dev token 回传、localStorage 禁止敏感 token 和清理入口。`cleanup_auth_sessions` 默认 dry-run，显式 `--apply` 才撤销过期未撤销会话，不删除行、不返回 token hash、IP hash 或 user-agent。真实 MySQL 批量行为、锁等待、前端 storage 和生产 cookie 仍需实机留证。

**正式内容初始化**：

```bash
cd backend
python -m scripts.init_content_pages --dry-run --publisher-user-id <admin_id>
python -m scripts.init_content_pages --publisher-user-id <admin_id> --allow-reviewed-scripts
```

相关回归已覆盖中文数据库路径和中文 URL slug。需要单独验证时运行 `python -m pytest backend\tests\test_content_initialization.py backend\tests\test_content_publication.py -q`。

正式环境不依赖启动时自动 seed。初始化脚本默认先跑部署预检，只允许 active admin 归因；内置页面带脚本引用时，非 dry-run 必须显式传入 `--allow-reviewed-scripts`。内置本地脚本引用不依赖外部 host allowlist；若后续 seed 引入外部脚本 URL，必须同时满足 `ASTRA_CONTENT_SCRIPT_ALLOWED_HOSTS`、显式 `https://`、无 query/fragment、SRI、`crossorigin=anonymous` 和管理员审核。若已有当前版本与内置 schema 不同，默认报告冲突；确认以新版本推进时再使用 `--upgrade-existing`，且活跃草稿默认会阻断升级。

**内容生命周期演练报告**：

```bash
cd backend
python -m scripts.content_lifecycle_drill --require-mysql \
  --render-url https://your-domain.example/api/render/page/physics/energy-conservation \
  --static-url https://your-domain.example/physics/energy-conservation
```

该命令默认只读，用于初始化、发布、回滚演练前后检查 current 指针、schema hash、版本链、active 草稿、脚本镜像、API no-store 和可选静态 fallback。它不执行发布/回滚、不联网下载脚本、不写库，也不返回完整 schema、原始 CDN URL、完整 SRI、镜像字节或 `content_bytes`。历史实机证据见 `03-发布历史.md`；新环境必须按 `04-部署指南.md` 重新执行并保存本环境报告。

**知识快照调度器演练报告**：

```bash
cd backend
python -m scripts.knowledge_snapshot_scheduler_drill --require-mysql --expect-scheduler-enabled
```

该命令默认只读，用于真实调度演练前后检查 scheduler 配置、run ledger、partial lease、lease/heartbeat 姿态、due/pending 队列、快照输出计数和真实 MySQL 待留证项。它不执行 rebuild、不抢租约、不取消、不重排，不返回 `scheduler_lease_token`、`metadata_json`、异常原文或 secret；非法参数或非法 `--now` 会返回 JSON 错误。`--expect-scheduler-enabled` 只在需要证明生产调度器已启用时使用；未执行真实 MySQL 多 worker/cancel/requeue/锁等待前，不能把该报告解释为生产调度验收完成。

**内容脚本远端漂移观察演练报告**：

```bash
cd backend
python -m scripts.content_script_remote_drift_drill --require-mysql --expect-scheduler-enabled
```

该命令默认只读，用于真实内容脚本远端漂移观察前后检查数据库方言、调度配置、host policy 桶、mirror 记录、scan run ledger、queue/alerts/outbox 和真实观察待留证项。它不触发外网扫描、不写 outbox、不修改 host policy、不替换镜像、不下线/重发布内容，不返回原始 CDN URL、完整 SRI、远端/镜像字节、`content_bytes`、异常原文、`scheduler_lease_token`、payload 或复核备注；未执行真实安全 CDN 样本、真实 MySQL 和浏览器隔离留证前，不能把该报告解释为生产观察验收完成。

**知识快照周期重算**：

```bash
cd backend
python -m scripts.rebuild_knowledge_snapshots --granularity day
python -m scripts.rebuild_knowledge_snapshots --granularity week --date 2026-07-03
```

该脚本按日或自然周对齐时间窗，先抢占 `knowledge_snapshot_runs` 数据库租约，再重算活跃班级已挂接课程的个人/班级知识快照，并写入运行记录。V6.6.55 后，若 `ASTRA_BACKGROUND_TASK_WORKER_ENABLED=true`，知识 scheduler 开关改为生成统一 DB 任务，由 worker 再抢占领域 run；若统一 worker 关闭，则保留旧 lifespan 调度器兼容路径。两条路径都使用同一窗口 run key、owner/token/expiry/heartbeat guard，领域 success 已提交而控制面未完成时不会重复生成快照。真实 MySQL 长任务、多进程竞争、取消/重排延迟和锁等待仍需部署演练。

**统一后台任务 worker**：

```bash
cd backend
python -m scripts.run_background_tasks --once
python -m scripts.run_background_tasks
# 只有完成外网访问评审后才允许：
python -m scripts.run_background_tasks --enable-content-scan
python -m scripts.run_background_tasks --enable-audit-anchor
```

worker 可由 FastAPI lifespan 启动，也可作为独立服务运行，生产只选择一种。统一任务管理 API 位于 `/api/admin/background-tasks*`，可查看 queue、单项和 attempt，并显式 retry/cancel；响应不返回 payload 或 lease token。进程退出后 leased 任务在租约过期且 attempt 未耗尽时由其他 worker 接管；告警 plan 若停在 `dispatching`，必须先核对接收端幂等记录，再人工 suppress/cancel 已接收项或 requeue 确认未接收项并创建新 plan，禁止直接 retry 盲发。

**内容脚本远端漂移 CLI / 调度器**：

```bash
cd backend
python -m scripts.scan_content_script_asset_remote_drift --confirm-external-network --actor-user-id <admin_id> --limit 25
python -m scripts.scan_content_script_asset_remote_drift --confirm-external-network --source-host cdn.example.com --actor-user-id <admin_id>
```

CLI 必须显式传入 `--confirm-external-network`，否则只返回确认错误并不访问外网；成功运行会写入 `content_script_asset_scan_runs`，`trigger_source=script`。FastAPI lifespan 调度器由 `ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ENABLED=true` 显式开启，默认关闭；它与 CLI 共用 run 租约与脱敏规则，管理端 `health/queue/alerts` 只读观察 failed、stale running、lease expiring、当前 scheduler bucket 与 blocked run，不包含原始 CDN URL、完整 SRI、远端字节、异常原文或 `scheduler_lease_token`。管理员可通过 `POST /api/admin/content/script-assets/remote-drift-alerts/outbox` 将候选显式写入本地人工复核 outbox，并通过 `PATCH /api/admin/alert-outbox/{id}` 记录 planned/queued/suppressed/cancelled 等人工复核状态；入队和复核仍是 observe-only，不发送外部消息、不自动封禁 host 或处置 run。这一路径只是非交互 observe-only 扫描入口，不自动封禁 host、不替换镜像、不下线或重发布内容、不发送邮件/短信/Webhook。

**审计归档候选导出**：

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

`audit_archive_drill` 默认只读。Manifest v2 记录导出器/导出人/时间、范围、archive hash、链状态和生命周期审批边界；`--verify` 返回 Manifest hash 并复验归档。显式 `--confirm-external-anchor` 只负责幂等入队，只有锚定总开关、HTTPS URL/token 和 worker 锚定开关同时有效才会外发 hash-only 信封。源删除未实现且禁止；脱敏必须生成新派生归档/Manifest/锚点；恢复必须先复验归档、Manifest 和外部 receipt，再完成双人变更单与备份恢复确认。

**后端阶段门禁总账**：

```bash
cd backend
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
  --origin https://your-domain.example \
  --api-bind-host 127.0.0.1 \
  --api-bind-port 8000 \
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

`backend_stage_gate` 默认只读并保持 V6.6.44/14 项兼容；增加 `--run-rc-external-scope` 后输出 V6.6.63/15 项判定。它会聚合各类既有 drill/preflight/smoke 报告，并输出 `gates`、`blockers`、`missing_evidence`、`warnings` 和“通过 / 延期 / 带风险通过”建议。`--confirm-*` 参数只表示操作者已经另行完成并留存对应证据；脚本不会自动运行完整 pytest、浏览器 storage 检查、核心人工路径或真实回滚演练。未使用 `--require-mysql`、未运行真实拓扑、或缺少确认项时，报告应保持 `missing_evidence` / “延期”。

**当前 API**：

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/health` | 返回服务、版本、环境和数据库状态 |
| POST | `/api/admin/bootstrap` | 首个管理员初始化；复用密码策略，公开注册仍拒绝 admin |
| GET/PATCH | `/api/admin/users` / `/api/admin/users/{id}` | 管理端用户列表与角色/状态维护；列表返回 `items/total/limit/offset/next_offset`；置为 `disabled` 时撤销未撤销会话并在审计快照记录 `revoked_sessions` |
| POST | `/api/admin/users/{id}/password-reset` | 管理员重置用户密码；复用密码强度策略，成功后撤销目标用户未撤销会话、清理登录失败桶，并写入不含密码明文或 hash 的 `admin.user.password_reset` 审计 |
| GET | `/api/admin/schools` | 管理端学校基础查看；支持分页与关键字搜索 |
| GET | `/api/admin/schools/{id}/stats` | 学校深度统计；全局管理员或该校 active teacher/admin 读取 |
| GET | `/api/admin/classes` | 管理端班级基础查看；支持分页、学校过滤与关键字搜索 |
| GET | `/api/admin/classes/{id}/stats` | 班级深度统计；全局管理员或该班 active teacher 读取 |
| GET/PATCH | `/api/admin/class-join-requests` / `/api/admin/class-join-requests/{id}` | 管理端班级加入申请队列与审批；队列支持 school/class/user/role/status/q/时间窗过滤 |
| GET | `/api/admin/content/pages` | 管理端内容页状态查看；数据库侧支持 status 过滤、分页与内容关键字搜索，返回 current version、schema hash 和发布元数据 |
| GET | `/api/admin/content/drafts` | 管理端内容草稿队列；支持 status/script_review_status/script_risk_level/author/q 分页过滤，返回草稿 schema hash、base 版本元数据和脚本静态分析结果 |
| GET | `/api/admin/content/page-versions` | 管理端内容版本历史；支持 slug/source_draft/restored_from/q 分页过滤，返回显式 previous 链 |
| GET | `/api/admin/content/page-versions/{id}/diff` | 管理端版本 schema diff；默认沿显式 `previous_version_id` 链对比，`base_version_id` 可指定基线；响应保留 `changes` 并新增 `semantic` 摘要，sections/sources 优先按 `sectionId/sourceId` 识别，并逐条返回 before/after 稳定 ID 字段；token/key/secret/script/sandbox/integrity/crossorigin 等敏感字段在 raw changes 和 semantic field/prop changes 中返回结构化 redaction preview |
| GET | `/api/admin/content/script-assets` | 管理端内容脚本资产供应链清单；支持 slug/source_host/sandbox/page/version/发布人/policy/hash/时间窗/q 分页过滤，响应只返回 host、source URL hash、引用 hash、镜像字节 hash、大小和策略信息，不返回 `content_bytes`、原始 CDN URL 或完整 SRI |
| GET | `/api/admin/content/script-assets/mirror-audit` | 管理端内容脚本镜像一致性审计；只读扫描当前 published schema 与 `content_script_assets` 绑定，复核版本/sandbox/引用 hash、source/integrity 元数据、本地字节 SHA-256/大小/SRI 和重复引用，响应与审计只返回 host/hash/问题码，不返回 `content_bytes`、原始 CDN URL 或完整 SRI |
| POST | `/api/admin/content/script-assets/remote-drift-scan` | 管理端内容脚本远端漂移扫描；请求体需显式 `confirm_external_network=true`，按 `limit/offset` 小批量读取当前 published 外部脚本远端字节并比对发布镜像 hash/大小/SRI，响应与审计不返回 `content_bytes`、远端字节、原始 CDN URL、完整 SRI 或异常明细，不自动修复或告警 |
| GET | `/api/admin/content/script-assets/remote-drift-scan-runs` | 管理端内容脚本远端漂移扫描 run 台账；按 status/trigger_source/alert_status/时间窗分页读取 manual/scheduler/script run，可观察 running/failed/success、attempt count 与租约 owner/过期/心跳，不返回 `scheduler_lease_token`、原始 CDN URL、完整 SRI、远端字节、异常明细或 `content_bytes` |
| GET | `/api/admin/content/script-assets/remote-drift-scan-runs/health` | 管理端内容脚本远端漂移扫描 run 健康摘要；汇总 stale running、lease expiring、legacy running、failed、warning/critical issue run 和 problem runs，不返回 `scheduler_lease_token`、原始 CDN URL、完整 SRI、远端字节或 issue 明细 |
| GET | `/api/admin/content/script-assets/remote-drift-scan-runs/queue` | 管理端内容脚本远端漂移扫描队列摘要；按当前调度桶、failed/stale manual review、active/legacy blocked run 区分 dispatchable now、manual review 与 blocked，调度器关闭且无积压时返回 `disabled`；只读、不联网、不投递外部告警、不自动处置 |
| GET | `/api/admin/content/script-assets/remote-drift-alerts` | 管理端内容脚本远端漂移告警候选摘要；从最近 remote drift scan run、failed run 和 stale running run 派生 severity/action hint，不发送外部告警、不自动封禁 host、不修复或替换镜像 |
| POST | `/api/admin/content/script-assets/remote-drift-alerts/outbox` | 管理端内容脚本远端漂移告警 outbox 入队；请求体需 `confirm_observe_only=true`，按 `content_script_asset_scan_run_alert` source type 与候选 dedupe key 幂等创建或刷新 `pending_review` 人工复核项，不保存原始 CDN URL、完整 SRI、远端字节、异常明细、`content_bytes` 或 `scheduler_lease_token`，不发送邮件/短信/Webhook、不自动封禁 host 或处置 run |
| GET/PATCH | `/api/admin/content/script-host-policies` / `/api/admin/content/script-host-policies/{source_host}` | 管理端内容脚本 CDN host 信任治理；列表合并已观测 host、配置 allowlist host 和持久化 policy，更新支持 `trusted/watch/blocked` 状态与原因；`blocked` 会阻断草稿创建/编辑、脚本审核、发布和回滚，`trusted/watch` 不绕过 allowlist/SRI/审核/发布前下载校验 |
| GET | `/api/admin/stats` | 管理端全站统计摘要；仅全局管理员读取 |
| GET | `/api/admin/knowledge-snapshot-runs` | 管理端知识快照运行记录分页过滤；支持 status/granularity/trigger_source/时间窗，不返回 scheduler lease token 或原始 `metadata_json`，仅返回 `metadata_summary`/`metadata_redacted` |
| GET | `/api/admin/knowledge-snapshot-runs/health` | 管理端知识快照运行健康摘要；汇总 stale/partial/expiring/claimable/retryable/problem runs，不返回 scheduler lease token 或 metadata |
| GET | `/api/admin/knowledge-snapshot-runs/queue` | 管理端知识快照调度积压摘要；区分 dispatchable now、claimable by lease rule、manual requeue 和 blocked runs，不返回 scheduler lease token 或 metadata |
| GET | `/api/admin/knowledge-snapshot-runs/alerts` | 管理端知识快照告警候选摘要；从 health/queue 派生 severity/action hint，响应与审计不暴露 lease token、metadata 或重排原因明细，不发送外部告警 |
| POST | `/api/admin/knowledge-snapshot-runs/alerts/outbox` | 管理端知识快照告警 outbox 入队；请求体需 `confirm_observe_only=true`，按候选 dedupe key 幂等创建或刷新 `pending_review` 人工复核项，不发送邮件/短信/Webhook、不自动 requeue/cancel/清理 |
| GET | `/api/admin/alert-outbox` | 管理端告警 outbox 列表；支持 source_type/status/severity/action/event/time 分页过滤，当前仅为本地人工复核台账；响应不返回 dedupe key、完整 payload hash、payload JSON 或复核备注正文 |
| GET | `/api/admin/alert-outbox/queue` | 管理端告警 outbox 队列摘要；聚合 dispatching/failed/delivered 在内的状态桶、stale/due、severity 与安全配置姿态，响应和审计不返回 payload、复核备注、URL、token 或异常正文 |
| POST | `/api/admin/alert-outbox/dispatch-dry-run` | 管理端告警 outbox 执行预检；请求体需 `confirm_dry_run=true`，可选显式 `entry_ids` 或 source/time 筛选，只读分类 queued due、blocked、expired、not due 与终态项，不写 outbox 状态、不增加 attempt、不接 broker、不投递外部告警 |
| POST | `/api/admin/alert-outbox/dispatch-plans` | 管理端告警 outbox 执行计划台账；请求体需显式 `entry_ids` 与 `confirm_create_plan=true`，按 dry-run 口径落库脱敏计划摘要，不写 outbox 状态、不投递外部告警 |
| GET | `/api/admin/alert-outbox/dispatch-plans` | 管理端告警 outbox 执行计划列表；支持 plan/dry-run/source/time 分页过滤，只返回计划摘要、计数和有限 ready ID |
| GET | `/api/admin/alert-outbox/dispatch-plans/{id}` | 管理端告警 outbox 执行计划详情；按计划 ID 读取脱敏 ledger 摘要 |
| POST | `/api/admin/alert-outbox/dispatch-plans/{id}/validate` | 管理端告警 outbox 执行计划再校验；请求体需 `confirm_validate_plan=true`，重新校验 ready entry 当前状态、payload hash 快照、过期时间和 delivery 边界，仅返回脱敏计数/ID 与原因，不写 outbox 状态、不投递外部告警 |
| POST | `/api/admin/alert-outbox/dispatch-plans/{id}/dispatch` | 请求体需 `confirm_external_dispatch=true`；默认关闭，配置完整时显式执行再校验通过的 plan，逐项写 dispatching/delivered/failed、attempt 与脱敏审计，失败项由人工重新排队 |
| PATCH | `/api/admin/alert-outbox/reviews` | 管理端告警 outbox 批量人工复核；显式 ID 列表、目标状态和 `confirm_manual_review=true`，最多 100 条，all-or-nothing 更新，响应与审计不返回 payload 或备注正文 |
| PATCH | `/api/admin/alert-outbox/{id}` | 管理端告警 outbox 人工复核状态流转；请求体需 `confirm_manual_review=true`，可写入 `pending_review/planned/queued/suppressed/cancelled` 状态与 `reviewed_by_user_id/reviewed_at/review_note`；响应仅返回 `review_note_present`，不回显备注正文，审计仅保存脱敏状态摘要 |
| POST | `/api/admin/knowledge-snapshot-runs/{id}/cancel` | 管理端协作式取消 pending 或带 scheduler lease 的 running 知识快照 run；标记 `cancelled`、清空租约并写入管理端审计 |
| POST | `/api/admin/knowledge-snapshot-runs/{id}/requeue` | 管理端手动重排 failed、cancelled 或过期带租约 running 知识快照 run；重置为 pending，pending 幂等，active/legacy running 与 success 返回 `409` |
| GET | `/api/admin/audit-logs` | 管理端审计日志分页查询，可按 actor/action/resource/request_id/event_result/failure_reason/时间窗过滤；返回 `prev_hash/current_hash` |
| GET | `/api/admin/audit-logs/export` | 管理端审计日志 JSON 导出，复用审计筛选与排序；默认不含 `snapshot_json`，显式 `include_snapshot=true` 才返回快照，通过 `limit/truncated` 表示截断；响应保留 `prev_hash/current_hash`，成功导出后写入 `admin.audit.export`，只记录筛选条件和导出摘要 |
| GET | `/api/admin/audit-logs/export.csv` | 管理端审计日志 CSV 导出，复用 JSON 导出筛选、排序、截断和快照 opt-in；响应为下载附件并附 `X-Audit-Export-*` 元数据头，默认快照列为空，CSV 包含 `prev_hash/current_hash`，文本单元格会中和表格公式前缀；成功导出后写入 `admin.audit.export` 摘要 |
| GET | `/api/admin/audit-logs/report` | 管理端审计日志 JSON 报表摘要，复用审计筛选，按 action/resource_type/actor_role/event_result/failure_reason 聚合；`bucket_limit` 默认 20、最大 100；成功生成后写入 `admin.audit.report` 摘要 |
| GET | `/api/admin/audit-logs/report.csv` | 管理端审计日志 CSV 报表摘要，与 JSON 报表同源，响应为下载附件并附 `X-Audit-Report-*` 元数据头，只导出聚合行 |
| GET | `/api/admin/audit-logs/retention-plan` | 管理端审计留存预检，复用审计筛选，按配置或 `retention_days/before` 计算 cutoff、归档候选、临期数量、聚合桶和哈希链边界；成功后写入 `admin.audit.retention_plan`，不删除、不导出归档、不提供 WORM 或外部锚定 |
| GET | `/api/admin/audit-logs/chain-integrity` | 管理端审计链完整性校验，按时间窗和 `limit/issue_limit` 顺序扫描，重算 `current_hash`、检查相邻 `prev_hash`，返回 `valid/partial/invalid`、计数和受限 issue 样本；成功后写入 `admin.audit.chain_integrity` 摘要，不修复、不删除、不提供 WORM 或外部锚定 |
| GET | `/api/admin/audit-logs/high-frequency` | 管理端审计高频候选摘要，复用审计筛选，默认最近 24 小时；按 action、actor/action、ip/action、resource/action 和 failure_reason 生成候选，成功后写入 `admin.audit.high_frequency` 摘要且不记录候选明细 |
| GET | `/api/admin/submissions/pending` | 待批改队列；全局管理员可跨范围过滤，教师仅可读取本人任教班级内 `submitted/returned` 提交，`status=graded` 仍为管理员治理视图 |
| GET/POST/PATCH | `/api/admin/bugs` | 缺陷/风险清单基础维护；可记录外部 issue provider/id/url，列表支持分页、状态过滤和关键字搜索 |
| GET | `/api/admin/bugs/external-sync/posture` | 外部 issue 同步安全姿态；不回显 owner/repo/host/path/token |
| GET | `/api/admin/performance/report` | 索引/EXPLAIN/有界基准报告；可关闭 explain/benchmark 或要求 MySQL，不返回 SQL/参数/结果值/数据库 URL |
| GET | `/api/admin/bugs/{id}/external-sync-operations` | create/status/comment 同步账本；不返回评论正文或完整操作键 |
| POST | `/api/admin/bugs/{id}/external-sync/create` | 显式确认创建 GitHub issue；稳定键去重，未知结果 fail closed 为 ambiguous |
| POST | `/api/admin/bugs/{id}/external-sync/status` | 按本地 BugRecord 状态同步外部 open/closed，不接受外部反向覆盖 |
| POST | `/api/admin/bugs/{id}/external-sync/comments` | 显式安全评论同步；按评论 hash 幂等，敏感标记拒绝外发 |
| POST | `/api/auth/register` | 本地账号注册；拒绝弱密码 |
| POST | `/api/auth/login` | 登录并返回仅供显式非浏览器 API 客户端使用的兼容 Bearer token，同时写入 HttpOnly cookie；浏览器必须忽略 token。Cookie+Bearer、重复同名会话 Cookie、重复 Authorization 和畸形 Authorization 均 fail closed；连续失败达到阈值返回 `429`；成功登录记录 best-effort 设备摘要、登录 user-agent、`last_seen_at` 和 IP 哈希；成功、失败和锁定事件写入审计 |
| POST | `/api/auth/logout` | 注销当前用户活动会话并写入审计 |
| POST | `/api/auth/password-reset/request` | 用户自助密码重置请求；响应始终泛化为 `ok`，active 用户会生成哈希存储的一次性 token，并按账号哈希/IP 哈希冷却；生产环境不返回 token |
| POST | `/api/auth/password-reset/confirm` | 使用一次性 token 重置密码；行锁消费 token，复用密码强度策略，成功后撤销用户未撤销会话、清理登录失败桶，并写入不含明文密码或 token 的 `auth.password_reset.*` 审计 |
| GET | `/api/auth/sessions` | 当前用户活动会话列表；只返回未撤销、未过期会话，标记当前会话，并返回设备摘要、登录 user-agent 和 `last_seen_at` |
| DELETE | `/api/auth/sessions/{id}` | 撤销当前用户自己的单个活动会话；他人、已撤销或过期会话返回 `404`，成功写入 `auth.session.revoke` 审计 |
| GET | `/api/users/me` | 当前用户；已撤销、过期或非 active 用户会话返回 `401`；有效鉴权会按 `ASTRA_SESSION_LAST_SEEN_UPDATE_SECONDS` 节流刷新当前会话 last_seen |
| GET/POST | `/api/schools` | 当前用户可见学校 / 创建学校 |
| GET | `/api/schools/{id}/classes` | 学校内班级 |
| GET/POST | `/api/classes` | 当前用户可见班级 / 创建班级；`GET ?mine=true` 只返回当前用户 active membership 对应班级 |
| POST | `/api/classes/{id}/join` | legacy/direct join 兼容入口：学生可直接加入班级；teacher 角色 direct join 仅保留给全局 admin 或受控导入/邀请码路径，非 admin 教师必须走 join request 审批；若已有同角色 pending 申请，会同步批准该申请 |
| GET | `/api/classes/{id}/members/page` | 班级教师或管理员分页查看成员；默认 `status=active`，可按 `role/status` 过滤，返回 `items/total/limit/offset/next_offset` |
| GET | `/api/classes/{id}/members` | deprecated 数组兼容；保留相同 role/status 授权与过滤，最多返回 200 项，超出返回 `409 legacy_list_limit_exceeded` 与分页 URL |
| PATCH | `/api/classes/{id}/members/{membership_id}` | 维护成员状态；班级教师仅可维护 student membership，管理员可维护 student/teacher membership，均只支持 `active/inactive` 并写入审计 |
| PATCH | `/api/classes/{id}/members/batch-status` | 批量维护成员状态；班级教师仅可批量维护 student membership，全局 admin 可批量维护 student/teacher membership；整批 all-or-nothing，最终不能让 active teacher 归零 |
| POST | `/api/classes/{id}/students/{membership_id}/transfer` | 学生同校转班；要求源班与目标班双 active teacher scope，源关系软停用、目标关系创建或恢复，重复调用按状态幂等返回 |
| POST | `/api/classes/{id}/students/batch-import` | 按用户名批量导入 active 同校学生；逐项返回 created/restored/unchanged/failed，部分失败不回显目标账号学校归属 |
| POST | `/api/classes/{id}/teachers/transfer` | 班级 teacher membership 转让；仅全局 admin 可把源 active teacher 转给同校 active teacher/admin，目标 membership 不存在则创建、inactive 则恢复，可选择停用源 teacher |
| POST | `/api/classes/{id}/join-requests` | 审批流入口：创建班级加入申请；不立即生成成员关系 |
| GET | `/api/classes/{id}/join-requests` | 班级教师或管理员查看加入申请，可按 `status` 过滤 |
| PATCH | `/api/classes/{id}/join-requests/{request_id}` | 班级教师或管理员审批加入申请，支持 `approved` / `rejected` |
| GET/POST | `/api/courses` | 当前用户可见课程 / 教师创建课程；课程可声明稳定 `galaxy_key/course_key`，学生仅返回本人 active 班级内 published 课程 |
| POST | `/api/courses/{id}/classes` | 将课程挂接到班级 |
| PATCH | `/api/courses/{id}/owner` | 课程 owner 转让；课程创建者或全局 admin 可转给同校 active teacher/admin，目标原 active collaborator 会置为 inactive |
| PATCH | `/api/courses/{id}/status` | 仅 active global admin；严格接收 `expected_status/status/reason`，只允许 `draft/published/archived` 固定转换，stale/no-op/非法跳转为 `409`。服务在 authority、school、course 锁后重验管理员身份；成功返回 `course + impact` 并审计 `before/after/reason/impact`，同 expected 的 SQLite 并发只允许一个成功 |
| GET/POST | `/api/courses/{id}/collaborators` | 课程协作者列表与创建；owner/admin 管理 `editor/content_editor/assessment_editor/viewer`，任一 active collaborator 可读列表但不能治理协作者 |
| POST | `/api/courses/{id}/collaborators/batch` | owner/admin 批量 upsert 协作者；逐项返回 created/updated/unchanged/failed，激活时复核 active 同校 teacher/admin membership |
| PATCH | `/api/courses/{id}/collaborators/{collaborator_id}` | owner/admin 维护协作者角色与状态；重新激活时再次复核学校范围 |
| GET/POST | `/api/courses/{id}/units` | 课程单元列表 / owner、active editor/content_editor 或全局 admin 创建带稳定 `activity_key` 的单元；学生用 `class_id` 读取当前班级非 hidden 分块及有效状态，多班级歧义返回 `422` |
| GET | `/api/courses/{id}/unit-access?class_id=&activity_key=` | student-only 已知 deep-link 处置；授权内 open / hidden / locked / missing 统一 `200` 且只返回 `available/error_code`。未登录、非学生、未入班/跨范围、非 published 课程或 inactive school 沿用 `401/403`，非法查询为 `422`，activity key 多匹配、目标 plan 缺失/关联不一致或未知发布态为 `409`；不返回单元元数据、计划、原因、目录或其他 activity key |
| GET/PATCH | `/api/courses/{id}/classes/{class_id}/release-plan` | 班级课程发布计划；本班教师/管理员可读，PATCH 使用 `expected_version` 批量维护顺序、hidden/locked/open、计划开放和前置分块，冲突 409、no-op 不递增版本 |
| GET | `/api/courses/{id}/assignments` | 课程作业列表；学生按 published 单元和班级 effective assignment policy 读取 |
| POST | `/api/courses/{id}/units/{unit_id}/assignments` | owner、active editor/content_editor/assessment_editor 或全局 admin 创建作业，可声明 `audience_mode` |
| PATCH | `/api/assignments/{id}/audience` | owner/admin 在 `all_attached_classes` 与 `selected_classes` 间切换作业受众模式 |
| GET/PUT/DELETE | `/api/assignments/{id}/classes/{class_id}/policy` | 读取、全量写入或删除班级作业策略；支持 assigned、状态、截止时间和积分规则覆盖，写入要求课程 editor/assessment_editor 等能力与本班 teacher scope 同时成立 |
| POST | `/api/learning-events` | 记录访问、提交、完成等事件；学生写入除 published/active 规则外还要求当前班级分块为 open，并与发布计划在同一事务内锁定复核 |
| GET | `/api/learning-events/page` | 分页读取学习事件；学生默认排除 inactive/hidden 历史，显式 `include_inactive_locked=true` 可读取归档组织下的锁定历史；教师按本班 scope 收束 |
| GET | `/api/learning-events` | deprecated 数组兼容；保持旧学生锁定历史口径，最多 200 项，超出返回结构化 409 与分页 URL |
| GET | `/api/learning-evidence/classes/{class_id}/courses/{course_id}/events` | 本班 teacher 或全局 admin 按必填 `subject_user_id` 和可选 `activity_key/event_type` 发现 0051 事实；`limit=1—100`、`offset=0—100000`，稳定返回 `total/limit/offset/next_offset`、内部纠错 ID、纠错关联和有界 `evidence_summary`。响应结构、授权、分页和 correction 语义不变；service 把事件的 activity/schema/type/evidence 交给 `teacher_evidence_facts.py`。力学与循环当前 producer 通过 exact enum、数值范围 / 精度和组合原子门禁后返回固定中文串；其余 activity 不再返回可能被误认成课程事实的 `value_type/value_size`。直接源码、JWT、`sk_live`、API key、PEM 与任意未知 nested raw leaf 均不返回原值或片段 |
| POST | `/api/learning-evidence/events/{event_id}/corrections` | 本班 teacher 或全局 admin 对 learner / trusted-assessment 事实追加唯一行政纠错；发现页回读 `corrected_by_event_id`，原事实保持不变 |
| GET | `/api/assignments/me` | 学生作业中心；按 active 班级 membership 展开班级、课程、单元、作业、本人提交和复盘状态，支持 `class_id/course_id`、`filter=all/active/feedback/history` 与 `limit/offset` 分页 |
| POST | `/api/assignments/{id}/submissions` | 学生按班级提交作业；同一 `assignment/student/class` 只允许一次提交，唯一约束冲突统一返回 `409`；提交目标必须位于 published 课程和 published 单元下且作业 active |
| GET | `/api/assignments/{id}/review` | 学生侧作业复盘入口；多班级可见时必须显式传 `class_id`，否则返回 `422`；published 课程/单元内 closed / archived 作业只读且不可再次提交 |
| GET | `/api/assignments/{id}/submissions/page` | 学生按显式班级查看本人提交、教师按班级查看作业提交；返回统一分页响应 |
| GET | `/api/assignments/{id}/submissions` | deprecated 数组兼容；学生多班级历史必须显式传 `class_id`，最多 200 项，超出返回结构化 409 与分页 URL |
| GET | `/api/code-submissions` | 学生本人、班级教师或管理员按授权范围分页读取代码提交摘要；源码使用独立端点，默认判题状态可为 `runner_unavailable` |
| GET | `/api/code-submissions/{id}/attempts/page` | 分页读取授权提交的判题尝试；统一返回 `items/total/limit/offset/next_offset` |
| GET | `/api/code-submissions/{id}/attempts` | deprecated 数组兼容；最多 200 项，超出返回结构化 409 与分页 URL |
| PATCH | `/api/submissions/{id}/grade` | 教师批改作业，并按作业积分规则目标值与当前 submission 已入账 `assignment_grade` 积分差额生成流水 |
| GET | `/api/points/ledger` | 查询个人或班级范围积分流水；教师查询按本班 teacher scope 收束 |
| GET/PATCH | `/api/points/assignments/{id}/rule` | 读取/维护 assignment 全局积分规则；学校 teacher/admin 可读，owner、active editor/assessment_editor 或全局 admin 可写；班级 override 由 assignment class policy 承载 |
| GET | `/api/progress/me` | 当前用户个人进度摘要；学生个人口径仅计入 published 课程、published 单元和 active 作业 |
| GET | `/api/progress/users/{id}` | 教师查看班级内学生进度摘要；要求本班 teacher scope |
| GET | `/api/progress/courses/{course_id}/classes/{class_id}/students` | 教师/管理员分页查看班级内学生×课程分块矩阵，包含开始、完成、提交、评分、最近活动与有效发布状态；hidden 分块不暴露学生历史统计 |
| GET | `/api/knowledge/me` | 当前用户 `rule_version=v2` 多维知识统计，可按班级/课程/时间窗过滤；学生口径仅计入 effective active assignment-class pair，并输出 overall/course/unit/knowledge_point/assignment 维度 |
| POST | `/api/knowledge/me/snapshots` | 当前用户按时间窗重算并写入个人知识快照；学生快照沿用学生资源可见性口径 |
| GET | `/api/knowledge/me/snapshots` | 当前用户分页查看自己的知识快照；学生列表不暴露 hidden course 旧快照 |
| GET | `/api/classes/{id}/knowledge` | 教师查看班级 `rule_version=v2` 多维学习分析与作业/正确率聚合；隐藏、归档、关闭或未分配资源不进入当前分母 |
| POST | `/api/classes/{id}/knowledge/snapshots` | 教师或管理员按时间窗重算并写入班级知识快照 |
| GET | `/api/classes/{id}/knowledge/snapshots` | 教师或管理员分页查看班级知识快照 |
| GET | `/api/content/pages` | 返回当前可用内容页摘要 |
| GET | `/api/content/pages/{slug}` | 返回内容协议详情；公开响应剥离原始脚本引用、SRI/crossorigin 元数据和 sandbox 原始字段，只保留不可执行 `scriptManifest`，manifest 内含沙箱 enforcement/capabilities |
| POST | `/api/content/drafts` | 教师或管理员创建内容草稿；草稿不进入公开渲染，并记录当前 published base 版本、schema hash、脚本静态分析结果与 policy context hash；新写入 schema 必须为每个 section/source 提供稳定 `sectionId/sourceId`；同一作者同一目标页只允许一个 active 草稿 |
| GET | `/api/content/drafts/{id}` | 草稿作者或管理员读取单条草稿 |
| PATCH | `/api/content/drafts/{id}` | 草稿作者或管理员编辑 `draft` / `changes_requested` 草稿；编辑会复核稳定 `sectionId/sourceId`、重算 schema hash、脚本静态分析和脚本审核状态，并保留创建时 base 版本保护 |
| POST | `/api/content/drafts/{id}/submit` | 草稿作者或管理员提交审核；`draft` / `changes_requested` 可进入 `submitted` |
| POST | `/api/content/drafts/{id}/withdraw` | 草稿作者或管理员撤回活跃草稿；撤回后清空 active key，不再发布 |
| POST | `/api/content/drafts/{id}/request-changes` | 管理员退回已提交草稿并记录退回备注 |
| POST | `/api/content/drafts/{id}/publish` | 管理员发布已提交草稿到公开内容页；发布前会以 `409` 复核稳定 `sectionId/sourceId` 契约，并追加不可变版本记录、current 指针和 previous 链 |
| PATCH | `/api/content/drafts/{id}/script-review` | 管理员审核允许脚本的草稿，作者不能自审；阻断级脚本 policy 不能审核通过；allowlist 配置变化会导致审核/发布前按当前配置重分析 |
| POST | `/api/content/page-versions/{id}/rollback` | 管理员按历史版本追加式回滚，生成新的当前版本；带脚本 policy findings 的历史版本必须新建草稿重审 |
| GET | `/api/render/page/{slug}` | 返回前端可渲染页面结构；公开响应剥离原始脚本引用、SRI/crossorigin 元数据和 sandbox 原始字段，只保留带稳定 `sandboxId` 的 `scriptManifest`；可执行且全页唯一的 manifest 会带 `embed` 描述符，提供同源 iframe `src`、sandbox tokens、referrerPolicy、messageProtocol、capabilities 与 assetCount，并返回 `X-Astra-Content-Script-*` 沙箱契约头 |
| GET | `/api/render/script-sandboxes/{sandbox_id}/page/{slug}` | 返回内容脚本 sandbox HTML；除已发布 manifest 外还要求 `astra-sandbox-dom-v1` document contract、已登记 templateId 和合法受控 config，每次响应生成唯一 nonce，CSP `script-src` 与 bootstrap `<script nonce>` 同步绑定；missing/blocked/歧义/缺失镜像/未知模板 fail closed |
| GET | `/api/render/script-sandboxes/{sandbox_id}/bootstrap/page/{slug}` | 返回 sandbox 内 bootstrap JS；顺序加载受控资产、调用 allowlist initializer，只有初始化器显式返回 `{ready:true}` 才发送 ready；消息同时绑定 sandboxId、`bootstrap-v1`、templateId 和 document contract，安全响应头保持不变 |
| GET | `/api/render/script-sandboxes/{sandbox_id}/assets/{asset_sha256}/page/{slug}` | 返回 sandbox 内受控 JS 资产；按 published slug + 当前 page version + sandboxId + 引用 SHA-256 绑定，本地脚本只允许受控根内 `.js` 文件，外部脚本只允许读取发布版本绑定的镜像字节，响应 `application/javascript`、引用 hash、镜像字节 hash、`nosniff`、`no-store`、`no-referrer` 与 `Cross-Origin-Resource-Policy: cross-origin` |

**当前首个 schema**：`physics/energy-conservation`，作为工科试验室实验页后端生成试点。

**前端 schema 试点**：

- `shared/js/backend-content.js` 默认不启用；访问 URL 带 `?backendSchema=1` 或本地存储 `astra-backend-schema=1` 时才读取后端 schema。
- API origin 可从 `CONFIG.backend.apiBaseUrl`、`astra-api-base` 或开发用 `apiBase=` 查询参数指定；只接受受信精确 HTTP(S) origin，本地开发允许 localhost/127.0.0.1，拒绝路径、query、fragment、userinfo 和 HTTPS 降级。
- adapter 消费严格 `scriptManifest.embed` 创建 iframe sandbox 状态卡；父页只接受来自目标 iframe、opaque `origin=null` 且匹配 sandboxId、`bootstrap-v1`、templateId、document contract 的 postMessage。
- 状态卡区分 loading、bootstrapping、assets、ready、error、timeout、blocked；终态 error/timeout 会卸载 iframe、忽略迟到 ready 并恢复静态实验，在线恢复只重新读取 schema，不重放写入。
- V6.6.48 起先执行 `npm ci --ignore-scripts` 安装已锁定 Playwright，再从仓库根目录运行浏览器隔离证明：`node tools/browser/script-sandbox-isolation-proof.cjs --api http://127.0.0.1:8000 --web http://127.0.0.1:8766 --channel msedge --out test-screenshots\browser-isolation`；脚本使用目标机器已批准的 Edge channel，并留下 JSON 报告和页面/iframe 截图。
- 本地 smoke URL：`http://localhost:8766/?backendSchema=1&apiBase=http%3A%2F%2F127.0.0.1%3A8000#physics/energy-conservation`。
- 默认静态页面仍是回退路径；API 不可用时 adapter 保留静态实验并显示明确失败状态，不展示旧 schema 派生内容。

**统一浏览器 API 规则（V6.6.52）**：

- `shared/js/api-client.js` 是 schema adapter 与管理、教师、学生三端唯一 API 入口；强制 `credentials=include`、`cache=no-store`、12 秒超时、稳定 401/403/5xx/timeout/network 分类，禁止请求携带 `Authorization`，并清理已知历史 token key。
- V7.3.0 起，`shared/js/auth-ui.js` 是三端共享的第一方账号入口：学生/教师注册角色由页面固定，管理员不开放公开注册；登录响应中的兼容 token 必须丢弃，只允许通过 Cookie 后续读取 `/api/users/me`。组件还负责密码重置、活动会话、单会话撤销、退出与错角色切换，页面 destroy 时必须 unmount 并中止未完成请求。
- V7.4.0 起，`shared/js/app-session.js` 是主站认证协调器：它必须在 Router 之前调用 `/api/users/me`，只在内存保存 `UserPublic`，不得读取 Cookie、兼容 token 或任何浏览器认证存储。未认证时 Router 不得启动；学生/教师/管理员的导航、受保护 section 和 `pageScripts` 分别按 `student`、`teacher`、`admin` 能力守卫，管理员额外允许进入教师工作台。
- V7.4.23 起，角色页面 CSS/JS 统一由 `AstraPageRegistry` 登记：student 只允许 student，teacher 只允许 teacher，admin 允许 teacher+admin。`index.html`、APP_SHELL 和 HTTP fallback 禁止包含角色资源；Service Worker 对精确角色资源使用 network-only 且不得 `cache.put`。退出、运行中 401 或跨角色重新认证必须先清理旧角色样式与共享静态缓存，再整页重载；仅删除 DOM 样式不能卸载已执行脚本。该裁剪不是服务端授权的替代品。
- V7.4.29 起，三角色证明脚本有互斥双模式：隔离回归继续使用 `--confirm-isolated-environment`，只接受本地 URL 与 development/test/testing；指定 staging 使用 `--confirm-target-staging`，只接受 API/web 同一公开 DNS、标准 443 的 HTTPS origin，拒绝 IP、单标签、保留/示例域与非标准端口，并要求明确 `staging/production` health、干净冻结 Git、仓库外不存在或为空的显式 `--out`，只从 `ASTRA_ADMIN_BOOTSTRAP_TOKEN` 环境变量取得 bootstrap token。两种模式都记录 Git HEAD、dirty 集合、关键文件 SHA-256、真实 Edge channel/version 与 Service Worker 代际；目标成功运行另由 `target-browser-evidence.cjs` 将 12 项实际断言收束为 `target-browser-smoke.json`，绑定当前 40 位 `release_revision`，失败或缺任一检查时不生成 ready raw。目标模式完成后还必须独立执行 MySQL 权威总账并进入七证据封装。
- V7.4.27 的 QA-007 证明必须在任何业务写入前确认匿名登录层、SW ready/controller 和零角色资源响应；随后以注册→退出→新上下文显式登录覆盖教师/学生，执行教师建课/发布/真实批量导入/批改、学生入班/单次提交/反馈、管理员审批/用户角色状态与会话撤销/全领域数据地图/组织治理/审计，并核对 403、越权 hash 零资源、逐角色 CSS/JS network-only、CacheStorage 不含 `/api` 或角色资源。桌面与精确 390×844 生成学生、教师、管理员、组织对话框和学生反馈 5 张截图，console/pageerror/request、可见错误/loading 与根溢出必须为零。
- 浏览器报告 `ok=true` 后才可运行 `python tools/quality/sqlite-qa-ledger.py --database <same-isolated-db> --output <proof-dir>/sqlite-ledger.json`；helper 使用 SQLite `mode=ro`，从 `backend/alembic/versions` 的 revision 图动态解析唯一 head，再核对全部表计数、数据库 revision、审计链头和 `admin-authority` 单例锁；迁移图缺失、断裂、成环、多 head 或数据库漂移均失败关闭。报告仍以排他临时文件、fsync 和原子替换写入，并拒绝输出覆盖数据库或其硬链/符号链接。当前结论只证明一次性 SQLite 与本机真实 Edge，不替代 MySQL、staging 或 R6 目标环境发布证据。
- V7.4.28 起，真实 staging/production 只接受 `target-release-v2`。先用 `release-artifact-manifest-v1` 冻结 release version/revision、static/API/worker/proxy/migrations 五类制品引用/SHA/大小，再冻结 target environment/origin/instance、制品清单路径/SHA 与 evidence bundle ID；四份自动 raw 报告必须带真实执行时间，数据库恢复和运行时回滚从 fail-closed `template` 生成，目标浏览器模板只保留为 schema 参考，V7.4.29 起实际 ready raw 必须由 target proof 直接生成。`python -m scripts.target_release_evidence seal ... --run-id <unique>` 校验清单、raw 时间、浏览器 `release_revision` 与固定语义后生成同源 envelope；`python -m scripts.target_release_gate --manifest <bundle>/target-release.json` 固定执行 51 项校验，原始数组必须精确七份，不接受自选 `status_path/expected`、匿名/自定义第八 evidence、示例域名、跨目标/revision/bundle、超出当前闸窗口的旧 raw、空壳 `ok=true`、未绑定/未解析的公网探针、仅服务名 SCM、非单一 0047 MySQL，或缺少三角色/陈旧版本 409/组织归档恢复。正式 CLI 不提供时间覆盖；该闸只校验证据，不配置域名、证书、防火墙、secret、数据库或监控，真实证据包与 secret 不得提交仓库。
- V7.4.29 的 `windows_dpapi_secret_store.py` 从 stdin 接收 ASTRA 命名空间 JSON，使用 DPAPI LocalMachine 加密，并以 Windows 安全描述符从专用父目录和文件创建时关闭 ACL 继承，只授权 seal 时冻结的操作者 SID、SYSTEM、Administrators 和所选 LocalService/NetworkService；已存在但 ACL 不匹配的父目录拒绝使用，操作者 SID/服务账号同时绑定加密载荷和外层元数据。后续 LocalService 读取按冻结操作者 SID验证 ACL，不把服务当前 SID误当 Full Control owner。`inspect` 只返回 key 名称、数量、账号、ACL 与 operator-bound 布尔状态，不返回操作者 SID；`run` 先清除同库 key 再只向单个子进程注入显式 `--required-key`，不得把 secret 值写入普通日志或目标 evidence。
- 读取请求不保留跨请求业务缓存；401、离线或网络失败必须清空内存状态和敏感 dashboard DOM。恢复在线时只重新读取权威状态，不把旧数据伪装为实时结果。
- 写请求不得自动重试。发送后发生超时、取消或网络错误时视为结果未知，相关写入口保持锁定，直到显式刷新通过权威 GET 对账；已经收到 HTTP 状态或成功响应后 body/protocol 失败不应提示“可以安全重试”。
- Service Worker 必须在导航/扩展名判断之前旁路精确 `/api` 与 `/api/*`；FastAPI 必须为 API 的成功、错误和 OPTIONS 响应统一返回 `Cache-Control: no-store`、`Pragma: no-cache` 和 `X-Request-ID`。

**管理端治理 UI**：

- `#admin` 是主站内唯一的全局治理入口，属于 `astra` 身份工作区而非 englab 非课程页；在 `AstraPageRegistry` 中登记 `galaxy: 'astra'`、`roles: ['admin']`，不得加入 `course` 标签，避免触发 `ModuleSelector` 和实验工具链。
- `astra` 通用支持脚本必须加载本地 `shared/js/lucide.min.js`，保证直接进入 `#admin` 时图标按钮不会出现空占位；未通过 admin 门禁时 dashboard 必须保持 `hidden`，只展示受控门禁提示。
- `pages/admin/admin.js` 通过统一 API client 默认同源请求 `/api/*`，开发时可用受信 `?apiBase=http://127.0.0.1:8000` 或 localStorage `astra-admin-api-base` 指向独立 FastAPI；浏览器鉴权仅使用 HttpOnly Cookie，不再兼容或持久化调试 Bearer token。
- UI-003 / V7.9.4 当前实现中，`admin.js` 保持不超过 2485 行的 orchestrator；六领域固定为 `overview/organizations/identity/classes/courses/audit`。课程状态与次级能力分别由 `admin-course-governance.js`、`admin-secondary-governance.js` 持有，两个 owner 只能在 `admin.js` 自己重新读取 `/api/users/me` 并确认 `role=admin` 后动态加载和 mount。匿名、student、teacher 不得预热或缓存 owner；任一 owner 脚本加载失败会批量移除本轮两个节点并释放全部监听和共享 Promise，后续刷新创建全新节点重试，并发调用仍共享同一次有效加载；管理资源代际为 `20260729v794AdminGovernanceP0`。
- 首屏只读取治理总览所需的正式业务 API：待审关系、停用账号、学校/班级 active/archived、课程 `draft/published/archived` 分布、最近业务审计与统计；业务摘要必须位于数据地图之前，空数据、无匹配业务审计、403 或响应结构失败均如实展示，不用总量差值或演示值补齐。普通领域在进入时读取。`#planets` 的管理员首要任务按真实 pending join、真实 draft/archived 课程、最近业务审计顺序短路，均指向 `#admin`；加入分页、课程数组和审计分页必须校验元数据、必需标识与展示字段，管理员必需 ID 只接受原始有限正整数，审计 `resource_id/request_id` 只接受 string/number/null，任何对象、数组、布尔或字符串 ID 都使畸形 2xx 失败关闭。角色首页与治理总览都以每页 25 条、最多 4 页 / 100 条的 generation/Abort 有界读取寻找至多 3 条业务审计，因此第一页全为技术记录、业务记录位于第 26 条时仍能读取，达到上限且未耗尽则显示错误而非伪空态。业务审计必须命中精确 action/resource 配对；`class.join:class_membership` 与批量成员治理使用后端真实 `class_membership_batch`，诊断/运维记录不能充当首页任务。内容草稿、更多治理和高级诊断归 secondary owner，只有用户进入对应入口后才请求；高级诊断首次进入前请求数仍为 0。
- V7.4.0 新增用户、学校、班级分页面板和领域数据地图；UI-003 的首屏地图只展示 `/api/admin/stats` 汇总的实体规模与角色分布，health 已退入高级诊断且进入前零请求。stats 的 `pending_class_join_requests/total_users/total_schools/total_classes/total_courses/total_assignments/total_submissions/total_learning_events/total_audit_logs` 必须全部存在且为有限非负整数，`users_by_role` 只允许 `student/teacher/admin` 键及有限非负整数值；缺字段、未知角色或畸形 2xx 会同时清除统计和地图成功态。两者都不返回数据库 URL，也不提供任意表/SQL 编辑；用户角色/状态变更必须双确认，并保留服务端最后管理员保护、活动会话撤销、审计与权威对账。
- V7.4.25 将学校/班级卡片接入 `GET/PATCH /api/admin/schools/{id}` 与 `GET/PATCH /api/admin/classes/{id}`。数据地图和筛选必须使用后端 active/archived 统计；打开编辑器先精确 GET，ID、当前状态和版本保持只读，学校只编辑名称/地区/说明，班级只编辑名称/年级/学期/说明，状态通过独立归档/恢复动作处理。原因最长 500 字符；双确认后输入变化会撤销确认，no-op 为零写入。
- 每次组织动作只允许一次 PATCH 且不自动重试。2xx 后必须精确 GET 证明版本恰好递增 1 且提交字段一致；409 保留草稿并读取最新版本；发送后取消、超时或网络错误进入歧义锁。权威不一致、无法确认或请求因路由销毁中止时，锁跨 admin 重入保留，用户只能显式对账；只有证明未应用后才解锁，证明已应用则按权威结果收束。`operationOwner` 的 generation/controller 隔离旧生命周期，旧请求不得清除新页面 busy 或控件禁用状态。
- 加入申请批准/拒绝使用生产双确认执行器：第一次同签名点击为零写入，第二次发送恰一条带 UI 生成 `X-Request-ID` 的 PATCH，输入或上下文变化使确认失效。2xx 后必须回读精确申请、当前分页、`/api/admin/stats` 与精确审计；批准还必须分页找到对应 `class_id + user_id + role + active` 成员，拒绝不请求或伪造成员关系。完整回读会用本次精确审计替换并失效审计领域缓存；任一必要回读失败或发送结果歧义均进入写锁，只读对账且不重发。
- 课程 owner 只允许 BE-007 的 `draft/published/archived` 固定转换。提交体严格为 `expected_status + status + reason`；2xx 同时核对原课程 `id + school_id`、目标状态与 `attached_class_count/course_unit_count/assignment_count` 三个非负整数，并在精确审计 GET 前将 authority/impact/Request ID 固化到 mutation operation checkpoint。destroy/cancel 会把 checkpoint 转成保留 `writeConfirmed=true` 的锁；只有匹配 `course.status.patch/course/course_id/request_id/success/snapshot_json.after.status` 才显示完整成功事实，缺失、错配、读失败或旧状态回读均不能降级为“未生效”解锁。409 继续区分 no-op、stale、invalid、read-failed。
- 课程读取与 mutation/reconcile 使用独立 controller。允许切 Base 时必须先 abort/失效 active course read，再清空 pending、课程 authority/editor、旧 Base result，以及 secondary owner 的 overview/group controller、generation、loaded/data/errors/dialog/trigger；旧 Base 迟到响应不能设置 `loaded` 或复用旧 `expected_status`，新 Base 首次 activate 必须发新请求。active mutation 或任一 course lock 会禁止切换到其他课程、全部新 PATCH、owner/顶部刷新和 API Base 切换；当前锁课程行保持可聚焦、可用 Enter/点击重新打开只读 dialog，Escape 返焦，明确对账解锁后其他行才恢复。
- 审计面板开放 `action/resource_type/resource_id/request_id/from/to`；业务主路径不展示整块 raw JSON。六领域 tab 采用 roving `tabindex`，支持左右/上下方向键和 Home/End；移动课程检查器与次级治理使用原生 dialog，Escape 关闭并把焦点返还触发器。离页必须 abort 读取、释放 listener/RAF；已发送 mutation 则保留 unknown lock 语义。管理页不新增 Canvas、Three 或持续动画，并遵循 `prefers-reduced-motion`。
- V7.9.56 仅在 `pages/admin/admin.css` 以 `.admin-auth-state .astra-sessions button` 固定活动会话操作 `min-height: 44px`；共享 `auth-ui.css/js`、退出和单会话撤销逻辑不变。
- 上述条目描述已集成的 UI-003 代码边界；第七轮独立代码 / 合同复审已通过，但真实浏览器验收、DATA-001 演示样例和完整 V8.0 联调仍未完成。

**教师端工作台首轮**：

- `#teacher` 是星序内的教师端工作台入口，属于 `astra` 身份工作区；在 `AstraPageRegistry` 中登记 `galaxy: 'astra'`、`roles: ['teacher', 'admin']`，不得加入 `course` 标签或复用课程页 `[data-module]` / `.content-section` 语义，避免触发 `ModuleSelector` 和实验工具链。
- `pages/teacher/teacher.js` 通过统一 API client 默认同源请求 `/api/*`，开发时可用受信 `?apiBase=http://127.0.0.1:8000`、`CONFIG.backend.apiBaseUrl` 或 localStorage `astra-teacher-api-base` 指向独立 FastAPI；浏览器鉴权仅使用 HttpOnly Cookie。
- 课程刚创建但尚未挂班时，教师页必须先从 `/api/courses?class_id=...` 判断当前课程是否已挂接，再决定是否请求 course 维度班级学情；未挂接是可继续操作的产品状态，不能被误判为权威刷新失败并锁死“挂班”。
- 教师页先读取 `/api/users/me`，仅 `teacher/admin` 展示工作台；学生、未登录或 API 不可用时只展示门禁卡，dashboard 必须保持 `hidden`。
- 教师页消费学校/班级/课程、课程协作者、课程单元/作业、待批改、评分、积分、进度和班级知识 API；V6.6.53 新增学生软移除/同校转班/批量导入、多角色/批量协作者、作业受众与班级策略入口，并展示 `rule_version=v2` 统计口径和最弱维度。
- 班级策略 `PUT` 是全量替换语义；取消某个 override 会恢复全局继承。策略写入必须同时满足课程编辑能力与本班 teacher scope，前端可见入口不能代替服务端授权。课程/单元/班级通用 PATCH、完整关闭/归档编辑器、批量进度和提交列表学生姓名仍按后续版本单独设计。
- V7.4.25 起，教师页把归档学校、归档班级及其课程上下文显示为只读：成员加入/移除/转班、成绩和积分写入、班级作业策略 PUT/DELETE 均禁用；恢复动作只在服务端重新确认组织 active 后恢复资格。前端禁用是产品反馈，后端活动组织门禁仍是授权边界。
- V7.4.37 起，教师工作台首屏不再同时铺开 KPI 卡和全部创建表单。`TEACHER_VIEWS` 固定 `overview/structure/assignments/grading` 四个本地分区；教学总览显示身份、线性运行摘要、行动队列、当前教学范围和快速入口，其他分区按需渲染组织/课程、单元/作业、提交/学情。创建操作使用原生 `<details>`，一次只展开用户主动选择的操作。桌面共享 232px 星序 rail，390×844 隐藏 rail、显示三学习单元顶部条和固定角色 dock；`.page.astra-workspace-page.active` 必须清除基础页的 transform `will-change`，否则 fixed dock 会落到文档末尾。
- V7.5.7 起，`TEACHER_VIEWS` 扩展为 `overview/curriculum/structure/assignments/grading`。`curriculum` 先按星系、班级、课程建立显式 scope，再分别读取 release plan 与学生进度；分块 PATCH 必须携带 `expected_version`，不自动重试，409 后以权威响应重建草稿。代码空间课程另按班级/课程/活动分页显示提交，摘要不含源码，点击后才调用独立源码端点并以文本转义呈现，同时显示判题尝试和真实 `runner_unavailable` 状态。
- V7.5.8 起，学生进度和代码提交分页状态分别维护 `offset/limit/next_offset`，翻页重新请求服务端而不是只截取首个响应；进度百分比与代码筛选明确为“本页”口径，scope 或全量刷新变化会把 offset 归零并清除陈旧代码详情。
- V7.8.5 起，`TEACHER_VIEWS` 只保留 `overview/curriculum/grading` 三个主入口；`structure/assignments` 继续复用原实现，但只能从所属主入口的 `teacher-secondary-workflow` 按需展开，不再占用顶层 tab。教师账号只用 `GET /api/classes?school_id=...&mine=true` 取本人班级，管理员复用教师页时按学校读取；多班级或多课程不会静默选中，必须由用户明确范围。
- `shared/js/teacher-learning-evidence.js` 是学生进度、班级概况、逐学生证据、发布预览 dialog 与焦点生命周期 owner。桌面显示学生 × 非 hidden 分块语义表，移动端切换为逐学生 `<details>`；表格只在自身容器横向滚动，390×844 根级不得溢出。hidden 仅显示计数，locked 可查看历史但不可追加纠错；事件 ID 只存在于短期内存 token map，源码、原始 evidence 和任意未投影字符串都不进入 DOM。
- V7.8.7 起，该 owner 额外保存最近一次 `refreshSession` 实际消费的 `curriculumAttached` 布尔值，`evaluate()` 因而能在通用 scope key 未变时识别双向挂接边沿。false→true 复用原单 timer 并只发一组精确 progress + aggregate；true→false 即使对话框打开也会优先取消请求、关闭对话框并清空分页、表格 / disclosure、事实 token、选择、纠错、反馈、loading / error 和旧私有引用。挂接值不加入 scope key 或纠错 fence，false 状态不发教师私有读取。
- 发布编辑先写入内存草稿，预览完整比较顺序、呈现、开放时间、前置分块与调整说明；取消为零 PATCH，确认只发一次带 `expected_version` 的 PATCH。2xx 必须通过范围、版本和 items 校验后再次 GET；409 保留草稿并回读，歧义或畸形 2xx 锁定写入口且不重发。评分 / 退回 / 反馈同样每次只发一次 PATCH，再按同一 `assignment + class + offset` 回读目标 submission；success/409/歧义都不能用表单本地值冒充权威结果。
- 代码提交区把浏览器预检与正式 runner 分栏说明；只有 `accepted` 是正式成功，`queued/running` 是处理中，`runner_unavailable` 是中性未启用，其余状态均为失败。源码与 attempt 只保存在当前页面内存，切换学校、班级、课程、提交或销毁页面会同步清除并中止旧请求。三层教师样式统一保证核心控件至少 44px、原生 dialog Tab/Escape/返焦和 `prefers-reduced-motion`。

**学生端学习闭环**：

- `#student[/<subject>]` 是星序内的学生学习工作台入口，属于 `astra` 身份工作区；在 `AstraPageRegistry` 中登记 `galaxy: 'astra'`、`roles: ['student']`，活动脚本为 `pages/student/student-workbench.js`，不得加入 `course` 标签，也不得复用课程页 `[data-module]` / `.content-section` 语义。`<subject>` 只选择当前授权学科总览，页面继续使用星序侧栏并呈现进度、比例、分数和当前运行内存中的临时笔记；离页或登出即清理笔记。
- 学生页先读取 `/api/users/me`，仅 `student` 展示工作台；教师、管理员、未登录或 API 不可用时只展示门禁状态。认证 token、提交内容、成绩、反馈、学习事件、知识状态和快照等敏感学习数据不得写入 localStorage/sessionStorage；本地 API base 仅用于开发指向。
- 班级范围以 `GET /api/classes?mine=true` 的 active membership 为准。没有班级时不展示学校/班级公共目录，也不能进入 `#student`，只允许在不可跳过的首要 dialog 输入教师提供的 `class_id` 调用 direct join；只有入班后权威班级回读确认才恢复个人页、课程目录和作业中心。“教师提供”当前只是 UI/运营约定，后端不验证 ID 来源，不能当作邀请码安全边界；正式邀请模型与可猜 ID 风险仍需后续单独设计。
- 学生可以加入多个班级。工作台保留明确班级 selector，每次只渲染当前班级映射的授权课程；切班会清除旧课程、恢复、作业与统计 scope 后再请求新范围。星序总览把各班 published + exact-open 课程取并集，相同规范课程身份仅显示一次并保留全部 `class_ids`，所以班级之间的课程不会在目录形成重复条目。
- 作业中心消费分页 `GET /api/assignments/me`，支持 `all/active/feedback/history` 过滤，并保留每条记录的 `class.id`。同一作业关联多个班级时，复盘和提交必须使用当前记录的 `class_id`，不得让前端猜测班级。
- `GET /api/assignments/{id}/review` 返回的 `can_submit/read_only/submit_block_reason` 是提交能力的权威状态；`due_at` 当前只作展示，不得据此前端或后端自行拒绝提交。closed / archived 或已有提交的作业保持只读复盘。
- V7.4.25 起，班级归档导致的提交拒绝以 `submit_block_reason=class_archived` 显示为“班级已归档”，不得降级为模糊网络错误，也不得据此重发提交。
- 同班重复提交统一按 `409` 处理。提交请求出现未知网络结果时，应先重新读取 review / 作业中心确认服务端状态，不得自动重发；反馈与富文本内容必须以安全文本或受控渲染方式展示。
- 学生概览消费个人 progress、points、knowledge 与 snapshots；V6.6.53 起按 `rule_version=v2` 展示 overall 以及最弱 course/unit/knowledge_point/assignment 维度，并根据服务端 evidence 生成确定性补强建议。建议不得伪装为 AI 推断，也不得自动触发快照重算；hidden/draft/archived/closed/unassigned 资源不进入当前统计分母，v1 历史快照仍保持兼容读取。
- V7.5.7 起，学生页不再拥有未来星系发布 adapter 的私有会话监听，而是调用 `FutureGalaxyPublicationContext.refreshFromSession()`；共享控制器只保存内存态 `class_id/course_ids`，多班级无显式上下文、认证丢失、映射不完整或 API 异常均失败关闭，并在新会话 generation 到来时中止旧请求。

### 5.3 C++ 内部存活探针

| 方法 | 路径            | 响应                                      |
| ---- | --------------- | ----------------------------------------- |
| GET  | `/api/health` | `{"status":"ok","server":"englab-cpp"}` |

该端点只用于本机服务守护和拓扑诊断，不含用户上下文。公网 `/api/*` 必须由反向代理转发到 FastAPI；`/api/info` 与 `/api/eval` 已在 V6.6.60 删除。

### 5.4 替代方案（静态开发用）

```bash
# Python 临时服务器（推荐开发使用）
python -m http.server 8080
# 访问 http://localhost:8080

# Node.js
npx serve -p 8080
```

---
