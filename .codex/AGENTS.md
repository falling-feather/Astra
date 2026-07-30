# 星序 Astra 项目指引

## 当前基线

星序 Astra 是多星系全栈学习平台：

- 工科试验室：五大学科、88 个可视化实验。
- 代码空间：`codevis/` 独立子站与多语言运行时。
- 未来星系：六个跨学科探索方向。
- Python/FastAPI 业务后端：认证、学校/班级/课程、作业、内容、学习分析、任务与审计。
- Node/C++ 静态服务：只承担审核后的浏览器资源托管。

V6.6.63 后端阶段已经完成；V7.4 完成项目对接、注册 / 生命周期、认证与角色资源、组织治理、统一三星系总览、单一全局治理和 9001 一键入口；V7.5 完成代码空间、未来星系、课程编排、教师进度、OJ 诚实降级和全仓 review。V7.6 由 `主开发` 作为集成分支，`main@V7.5.11` 保持公开稳定。`FE-012 / V7.7.30` 已修复 Zoom 跨断点同步；V7.7.31 因指定 Python 锁依赖 BLOCKED / NOT-RUN，V7.7.32 又因 PM 身份合同过严而 BLOCKED / NOT-RUN，均未形成产品判断。V7.7.33 在 clean detached `qz33@73c034e87cdcbfa4c5b2c8a12b28a07fe45003ba` 完成全部可执行产品观察且 finding=0，但 external extension 无 reduced-motion 仿真和 main-realm Observer / listener / RAF 数字取证能力，最终仍为 BLOCKED / NOT-RUN、P0—P3=N/A；同类发包暂缓。QA-013 / V7.8.8 在 clean detached `qt88@98610934e8492a9687f6545b1f033d82d9a08f6d` 对产品 `848c1ed` 给出 RETURN FE-013、P0=0/P1=1/P2=0/P3=0：同一真实课程选择虽恢复 ready，却在约 0/4/8/12 秒形成 4 组 progress + aggregate。`V7.8.9` 已唯一分配给原 FE-013 的自主轮询移除；worktree `C:/Users/niu-h/.codex/worktrees/fr89/工科实验室` / `codex/fe-v7.8-teacher-request-coalesce @ 197bada` 当前保留 owner 与目标动态合同 2 个 tracked modified、0 staged、0 untracked。临时执行者已使两份 JS 语法和目标合同 PASS，fake clock / 可触发 MutationObserver 覆盖 >12 秒静置、dialog、manual、confirmed、容器替换、false 与 destroy；但同一 `doc/01-开发者文档.md` 的 apply_patch 连续悬停约 471.5 秒与 144.7 秒，均无文档差异。标准 FE 与临时执行者均已按 GLOBAL NO-APPROVAL 停止，V7.9.43 只记录阻断并冻结现场；V7.8.9 未提交、未集成、未进入独立复审。V7.9.44 / PM-016 只校准 Future 实施契约：Router 单 owner、单一 `page-frontier`、真实 owner 路径和 open-only 内容 / owner / evidence 延迟加载；不改变当前稳定实现。用户已于 2026-07-31 先确认 26 号视觉规格，再明确确认 V7.9.45 / PM-017 的桌面、精确 390×844 移动与人文观察区三图概念方向；V7.9.46 记录第二次产品确认与 FE-017 开放门禁，V7.9.47 登记 f017。FE-017 共享 shell 的首轮独立冻结复审以 P1=1 / P2=5 退回，原 FE 正在同一 f017 / V7.9.48 现场执行 R4；六方向三条 lane 只完成 V7.9.49 计划登记，尚未创建或写入。18 课程来源审计另证明 7 项链接 / 标准版本 / 事实边界需回到原 CONTENT-003 校准；`C:/Users/niu-h/.codex/worktrees/c003/工科实验室` / `codex/content-v7.9-frontier-source-calibration @ 97c7c86` 已建立且 clean，只有完整派单后才可写 25 号矩阵。其他已集成内容、Future 实施门禁与展示后边界保持 02 的唯一记录。

当前增量：V7.7.27 在 `f27a` 独立工作树形成精确候选 `b450e33b30f8151aae428b35db2e9aa41ed48d72`（父 `0e159932715d34d1e6cf15e242f67cb933c38c94`），修改登记的 15 个前端、合同及受影响 01/08 文件。物理力学现在以固定落高和 `e=.40/.80` 两次受控试验形成 learner corrected 与服务端派生 completed，自由探索不写证据；所有 known Physics 路由统一先过发布 gate；Guide 取得 document-level 首个 Escape owner；recovery 有 `first_started_at` 时不再追加 started。V7.7.29 在 clean detached `q28a@2d6a065` 验证了当时既定的 fresh learner、24/24 单元处置、双视口、44px、焦点、资源、console 与账本矩阵；随后从保留现场补充完成的移动→桌面保持打开探针发现 Zoom 最终 host 稳定后 backing store 未同步，正式 QA 回执记为 P2。V7.7.30 已复用既有父容器 Observer 与唯一 Canvas writer 修复并集成；旧 `f27a` / `d6b6` / `fz30` 均只保留审计，`a02c` 永久禁入。

DATA-001 与 DATA-002 已完成并集成；专业组保留在 `C:/Users/niu-h/.codex/worktrees/992d/工科实验室 / codex/data-v7.9-teacher-demo-sample @ a920642`，工作树 clean、写入关闭。V7.9.12 只为 `control-flow.loop-boundary` 增加 pending 作业样例及专项断言，通用初始化器 blob 保持不变；未新增模型、迁移、endpoint、service、router、直接数据库写入或修改前端 / UI / teacher / Future。

BE-011 已完成并集成；专业组保留在 `C:/Users/niu-h/.codex/worktrees/0dce/工科实验室 / codex/be-v7.8-unit-access @ 35fa219`，工作树 clean、写入关闭。`V7.8.2` 只新增独立 course-unit-access schema / endpoint / service、router 注册和专项测试，未修改模型、迁移、冻结课程 endpoint/schema 或前端。

CONTENT-004 / V7.8.3 已完成并集成：c04e 最终候选 `100a619b` 只修改 27、28 号冻结契约，定义六课 exact leaf / enum / numeric range / precision / 中文标签 / 权威依据与四课诚实降级。首候选因理想 e² 重判真实离散观测及 runtime error 文案错误被退回；原 owner amend 后第二轮独立复审 P0—P3=0。内容组写入关闭；后续 BE / DATA / FE 只能消费主线合同，不得自行扩充字段或冒充 producer。

DATA-003 / V7.9.19 已完成并集成：`da03` 最终候选 `31722c8899ffc7f7a56d14951a308f11c22a05d8`（父 `ddc186d`）建立 profile 单一来源、physics precise、control-flow shallow、四课 generic/unavailable 及结构化报告字段；独立复审 P0—P3=0。BE-013 / V7.8.4 也已完成并集成：`be13` 最终候选 `47ac53a9e46e3cbb1e31b772aa1de06110d06016`（同父）新增独立纯投影，保持 endpoint / DTO / 授权 / 分页 / correction 不变；根线另加组合测试直接绑定 DATA profile 与教师 facts。两组写入均关闭，四课继续诚实降级；`BE-012` 只有历史预提及、未正式发卡，永久不分配。

FE-013 / V7.8.5 已形成专业候选 `b34f007f5fd91428beb92e6598d4f2b80e3a7f21`（父 `41e929a`）并由主开发语义集成；精确 20 文件均在登记 allowlist 内，`teacher.js` 保持 2883 个逻辑行且未提高架构 ceiling。QA-013 / V7.8.6 随后在真实浏览器确认一项 P1：课程切换先把 `curriculumAttached=false`，owner 的 0ms 刷新缓存新 scope 的 `course_not_attached`，挂接回读变 true 后因 scope key 未变化不再重读。旧私有数据已 fail-closed 清空，没有越权或泄漏；但教师进度与证据主路径被阻断。失败退回既有 FE-013，不创建重复任务。V7.8.7 专业候选 `15c0e831e7890f7dc3bfd7089e8eb607433b3a5f`（父 `dc8e579`）已在既有 `AstraTeacherLearningEvidence` 内记录最近实际消费的 attachment 状态并识别同 scope 双向边沿，未修改 `teacher.js`、scope key、correction fence 或建立第二 owner；独立复审 P0—P3=0，现已语义集成并关闭 ft87 写入。V7.8.8 真实运行证明 attachment 边沿已恢复 ready，但 owner 成功后仍以固定 4 秒自续轮询；单次选择与单次重选均稳定产生 4 对私有请求，故再次 P1 退回原 FE-013。V7.8.9 已唯一分配，固定标题为 `V7.8.9 FE fix(teacher): 移除证据自主轮询（FE-013）`；fr89 已从精确 V7.9.40 控制提交创建并完成登记，最小修复只移除自主轮询与 `pollMs` 暴露，保留事件驱动的 0ms 合并、手动刷新、分页与 confirmed 刷新。

QA-013 / V7.8.6 已由标准长期任务“星序 Astra｜QA组｜长期对接”完成，固定结果标题为 `V7.8.6 QA test(teacher): 验收教师协同工作台（QA-013）`。精确对象为 detached `qe13@990f4e8` / 产品 `f47155d`，结论 RETURN FE-013、P0=0/P1=1/P2=0/P3=0。唯一 TEMP `astra-qa-v786-1f0ae4f658704c4fbbee933c8d17528b` 与 37 项证据原样保留，manifest SHA-256 为 `13C3601DA51FC014D05604F70B738E9ED76C364F5D4DF70E8FB841BD839A60A2`；Browser 已释放、Uvicorn 经 Ctrl+C 正常停止、9001=0，qe13 clean / detached / 无 `.venv`。

QA-013 / V7.8.8 已由同一标准长期任务完成，固定结果标题为 `V7.8.8 QA test(teacher): 复验课程挂接状态竞态（QA-013）`。精确对象为 detached `qt88@9861093` / 产品 `848c1ed`，结论 RETURN FE-013、P0=0/P1=1/P2=0/P3=0；唯一 TEMP `astra-qa-v788-64e55e028b93479e901170aef7681bef` 与证据原样保留，manifest SHA-256 为 `81aa66ef12d3efcc03fae6a83057859376dbf105bcc831cb45834c456242eb40`。Browser 已释放、服务正常 Ctrl+C、9001=0，qt88 clean / detached / 无 `.venv`；四个 pip scratch 子目录盘点受 ACL 拒绝，依 GLOBAL NO-APPROVAL 未重试、绕过或清理。

FE-012 / V7.7.27 已集成；后续同一产品树的补充运行证据确认 Zoom 保持打开时由 390×844 切至 1015×898 会把 863px backing store 自动放大到 943px，正式 QA 回执记为 P2。V7.7.30 专业候选 `30f7f189567e9dbd9d9aaef23e3a28af44d65044`（父 `876cb44`）已通过独立复审 P0—P3=0 并由主开发语义集成：复用既有父容器 ResizeObserver 把稳定通知交给 Zoom，继续由 `PhysicsSim.resizeForZoom()` 唯一写 CSS / backing / DPR / W/H / render，base scale 不超过 1。fz30 clean、写入关闭；正式外部 Edge 复验仍由 QA-014 完成。旧 `f27a@b450e33b` 与 `d6b6@5db1112e` 只保留审计，不得恢复写入、merge、push、rebase 或清理，不得触碰 Future 或 `a02c`。

QA-014 / V7.7.23、V7.7.24 的 BLOCKED / NOT-RUN 现场与 V7.7.26 产品 RETURN 证据保持不变。V7.7.29 使用 detached `q28a@2d6a065` 完成当时既定 A03a 矩阵；其后从保留的 V7.7.28 现场补充回传了可重复的 Zoom 移动→桌面保持打开 P2。V7.7.30 已集成。V7.7.31 在服务前受解释器锁依赖阻断；V7.7.32 在 PRECHECK 受 PM 过严身份合同阻断。V7.7.33 修正身份后通过 10/10 定向合同、正式 9001 / SQLite、fresh learner external Chrome 双向跨断点、44px / 九点命中、焦点 / Escape、三轮 DOM / Canvas 单例行为、非目标页和 console 0；低分辨率过渡画布不再拉伸，稳定桌面为 CSS `863×483.27` / backing `863×483` / scale 1，反向为 `318×320`，小 host 只下缩。但可信 external extension 不支持 reduced-motion 仿真，也不暴露 main-realm 精确 Observer / listener / RAF 数字，两个 mandatory NOT-RUN 使最终仍为 BLOCKED / NOT-RUN、P0—P3=N/A、产品 finding=0。Browser / 9001 已释放，qz33 clean、无 `.venv`；唯一 TEMP 与 33 文件证据只读保留。旧 `89e8`、`c91f`、`b56e`、`qz31`、`qz32`、`qz33` 与受保护 `a02c` 永久禁入。

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
2. 项目对接模式已经启用。CONTENT、FE、BE、QA 已按标准标题恢复；QA 只读，写入组只在收到主开发的精确任务 / 版本 / 文件包后写各自物理目录。CONTENT-004 / V7.8.3、DATA-003 / V7.9.19 与 BE-013 / V7.8.4 均已完成并暂停；原 CONTENT-003 因 18 课程来源审计发现 7 项链接 / 标准版本 / 事实边界校准而返修，唯一活动树为 `c003@97c7c86`，V7.9.51 只预留给该文档闭环。QA-013 / V7.8.8 已 RETURN FE-013。V7.8.9 的标准 FE 首次 fileChange 后平台权限态暂缓；V7.9.42 登记的唯一临时执行者随后在原 fr89 补齐动态合同并使目标合同 PASS，但写同一专业文档连续两次悬停且均无差异，已依 GLOBAL NO-APPROVAL 停止。fr89 现在只保留 owner 与目标合同 2 个 tracked modified、0 staged、0 untracked；三份专业文档、其余门禁、复审、提交与集成都未完成。V7.9.43 起 FE-013 / V7.8.9 整体暂缓、fr89 写入关闭，不得重试、换工具 / 目录、复制差异或建立新执行者。PM-016 / V7.9.44 已回填 FE-017 实施契约；用户现已完成 26 号规格与 PM-017 三图的两次产品确认。V7.9.46 记录确认；V7.9.47 已登记 `C:/Users/niu-h/.codex/worktrees/f017/工科实验室` / `codex/fe-v7.9-future-galaxy` 并开放完整派单；共享 shell 的首轮冻结复审为 P1=1 / P2=5，原 FE 正在同一任务 R4，尚未冻结。V7.9.48 唯一预留给 FE-017 最终产品提交；V7.9.49 只登记冻结后才可创建的三条课程 lane 计划，lane 当前不存在且不得提前写入。ft87 继续关闭。FE-012 的 fz30 已提交 `30f7f189` 并关闭写入；QA-014 / V7.7.31—33 均已 BLOCKED / NOT-RUN，qz31 / qz32 / qz33 及其现场只读冻结，V7.7.33 产品 finding=0，同类运行包因工具能力暂缓。qt88 已完成回执并关闭运行，Browser / 9001 已释放。q28a、c04e、da03、be13、fe13、qe13、qz31、qz32、qz33、qt88、ft87、fr89、fz30 与外部证据各守任务边界；不得复用旧 d6b6 / f27a / b56e。
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
9. 未来星系层级重构以 `doc/02-项目规划.md` 第 1.4、2.12—2.14 节、`doc/02-子文档/25-V7.7未来星系18课程内容与路由冻结矩阵.md`、`doc/02-子文档/26-V7.7未来星系页面视觉规格.md`、`FE-017`、`QA-015` 为唯一规划入口。18 门课程全部保留；原 CONTENT-003 只因来源审计的 7 项链接 / 标准版本 / 事实边界返修而重新进行，不改变课程数量、身份、教学闭环或代表课选择。目标只注册一个 `page-frontier` 并由共享 Router 独占 hash，canonical route 为 `#frontier/<direction>/<course>`，legacy 只 `replaceState` 一次。只有精确 open 课程可以加载自己的内容模块、唯一 owner 和 evidence；locked / hidden / unknown / mismatch / invalid / unavailable 的三者请求均为零，hidden 正文不得进入学生统一静态 bundle。六个真实 owner 目录是 `pages/cosmos`、`pages/engineering`、`pages/datascience`、`pages/infotech`、`pages/materials`、`pages/humanities`。FE-012 的 V7.7.33 产品观察 finding=0，但不得把平台能力导致的 BLOCKED / NOT-RUN 冒充 A03a PASS，同类取证暂缓至可用能力或最终综合 QA。26 号视觉规格与 PM-017 三图已完成两次产品确认；`f017` 独立树已经登记。只有标准 FE 长期组收到完整 `[ASSIGN]` 后，才可在该树修改产品代码。

## 验证要求

- 后端：`python -m pytest backend`。
- Python 依赖：新环境/CI 使用 `backend/requirements.lock` 和 `--require-hashes`；直接约束变化后以固定 uv 版本重生成，并执行 `python backend/scripts/compile_requirements_lock.py --check`。
- Node 工具链：使用 `.node-version` 的 Node 22.20.0、npm 10.9.3 和 `npm ci --ignore-scripts`；Playwright 只从 `package-lock.json` 安装，不在安装阶段下载浏览器。
- 前端契约与 JavaScript 语法：`npm test`，必须覆盖全部 Git 跟踪的 JS/CJS/MJS。
- 用户界面：桌面与 390×844 浏览器验收，检查页面身份、交互、console、重复 ID、遮罩和溢出。
- C++/CMake：合格 C++17 工具链构建 `verify_build_manifest`；FetchContent 必须复核完整 commit，离线模式必须显式提供已验证 source，公开面 smoke 保持 `/api/info`、`/api/eval` 和私有路径 404。
- 提交前：`git diff --check`，并确认无临时数据库、构建目录、截图或本机工作区。

## Git 提交

- `主开发` 及其任务分支使用 `Vx.y.z GROUP type(scope): 中文说明（TASK-ID）`；版本由 02 唯一分配。`V7.6.6`、`V7.6.7`、`V7.6.11`、`V7.6.12` 均为已取消的空预留，不得复用；`V7.6.15—16` 只属于 `PM-015`，`V7.7.0` 只属于 `CONTENT-003`，`V7.7.1—2`、`V7.7.6`、`V7.7.8`、`V7.7.10`、`V7.7.12`、`V7.7.17`、`V7.7.19`、`V7.7.22`、`V7.7.27` 与 `V7.7.30` 只属于 `FE-012`，`V7.7.3` 只属于 `FE-017` 的视觉规格提案而非产品实现，`V7.7.4` 只属于 `TOOLS-001`，`V7.7.25` 只属于 `TOOLS-002`；`V7.7.5`、`V7.7.7`、`V7.7.9`、`V7.7.11`、`V7.7.16`、`V7.7.18`、`V7.7.20`、`V7.7.21`、`V7.7.23`、`V7.7.24`、`V7.7.26`、`V7.7.28`、`V7.7.29`、`V7.7.31`、`V7.7.32` 与 `V7.7.33` 只属于 `QA-014 A03a`。`V7.8.0` 已由 `BE-007` 使用，`V7.8.2` 已由 `BE-011` 使用，`V7.8.3` 唯一分配给 `CONTENT-004`，`V7.8.4` 唯一分配给 `BE-013`，`V7.8.5` 唯一分配给 `FE-013`，`V7.8.6` 与 `V7.8.8` 只属于 `QA-013`，`V7.8.7` 唯一分配给 `FE-013` 的挂接状态竞态返修，`V7.8.9` 唯一分配给 FE-013 的证据自主轮询返修，均不得复用。`BE-012` 只属历史预提及、从未发卡，永久不分配。
- 增量版本对账：`V7.7.13—14`、`V7.9.2—3`、`V7.9.5—6`、`V7.9.8—11` 与 `V7.9.13—18`、`V7.9.20—47`、`V7.9.49—50` 属于 PM 控制面；V7.9.30—33 只控制前两轮 Zoom QA，`V7.9.34` 只登记 V7.8.8 教师返修复验，`V7.9.35` 只回填 qt88 实态，`V7.9.36` 只修正 Zoom 身份合同并登记 V7.7.33，`V7.9.37` 只回填 qz33，`V7.9.38` 只记录 V7.7.33 阻断并放行 V7.8.8，`V7.9.39` 只记录教师复验退回，`V7.9.40` 只登记 V7.8.9 写入包，`V7.9.41` 只回填新 FE worktree，`V7.9.42` 只记录标准 FE 平台阻断并授权唯一临时执行者续接原现场，`V7.9.43` 只记录续接者专业文档写入阻断并冻结 V7.8.9 现场，`V7.9.44` 只属于 PM-016 的 Future 实施边界校准，`V7.9.45—46` 只属于 PM-017 的 Future 三图概念与确认，`V7.9.47` 只用于 PM-017 回填 FE-017 工作树，`V7.9.48` 唯一预留给 FE-017 最终产品提交，`V7.9.49` 只属于 PM-009 的三条 Future 课程 lane 计划登记，`V7.9.50` 只属于 PM-009 的 CONTENT-003 来源校准树回填，`V7.9.51` 唯一预留给 CONTENT-003 来源校准。其他既有分配保持 02 唯一权威；`V7.7.15` 属于 `CONTENT-001`，`V7.9.4` 唯一分配给 `UI-003`。
- DATA 增量：`V7.9.6` 只属于 PM-009 的数据组实态登记，`V7.9.7` 唯一分配给 DATA-001 本地演示初始化器，`V7.9.12` 唯一分配给 DATA-002 单课程教师演示补样，`V7.9.19` 唯一分配给 DATA-003 producer profile 对齐；任何组不得自行猜测或复用。
- `review` 分支当前只保留 V7.5.11 冻结基线；新 review 周期经用户明确启动后使用 `reN：中文说明`。
- 不提交 `WIP`、`temp`、`checkpoint` 或无实际内容的提交。
