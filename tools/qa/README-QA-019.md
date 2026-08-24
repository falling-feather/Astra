# QA-019：Future 当前代表活动动态探针

QA-019 面向当前唯一 Future 代表活动 `engineering.load-path`。它不修改、覆盖或解释为已修复 QA-016 的历史 `qa016.future`；QA-016 的 runner、后端探针、说明和 `qa016-*` 证据均是不可变的已发生失败基线。

## 一键运行

在仓库根执行：

```powershell
node tools/qa/qa019-future-probe.cjs --mode probe --python python --format summary
```

同一次运行同时落机器 JSON 和人类摘要到仓库外目录：

```powershell
$qa019Out = Join-Path $env:TEMP 'astra-qa019-evidence'
node tools/qa/qa019-future-probe.cjs `
  --mode probe `
  --python python `
  --format summary `
  --output (Join-Path $qa019Out 'qa019-future-current.json') `
  --summary-output (Join-Path $qa019Out 'qa019-future-current.txt')
```

`human_summary`、`summary`、逐项 `checks[*].status` 和进程退出码由同一报告对象生成。退出码语义固定为：

- `PASS`：0；
- `FAIL`：1；
- `SKIP`：2；
- `NOT-RUN`：2。

Browser 是独立的附加证据项。没有形成可重复的新 QA-019 外部浏览器旅程时，它必须是 `NOT-RUN`；这不把 V8.0.4 的人工 Browser 证据继承为本次 PASS。必需的前端动态代码、FastAPI、SQLite 和变异门禁仍必须全部 PASS，整体核心才能 PASS。

## 探针实际执行的边界

前端部分不是静态字符串搜索。主探针通过 Node VM 执行工作树中的当前产品源码：

- `shared/js/learning-activity-catalog.js`：读取当前 Future 18 项和代表活动；
- `pages/frontier/frontier-manifest.js`：读取代表活动的课程、页面与 `#engineering/load-path` 路由；
- `pages/engineering/bridge-truss.js`：调用当前 `createLoadPathFlow`、真实桁架求解器、观察归一化和恢复函数；
- `shared/js/frontier-publication-context.js`：直接调用当前 `FutureGalaxyPublicationContext.sameLearningEvidenceAuthority`。

它捕获状态机实际交给 controller 的事件，而不是在 QA 中重新生成教学事件。标准链为：预测成功，拒绝跳过 B，观察 B、C，作出错误判断 `single-load-path`，拒绝缺 D 的纠正，观察 D，纠正并解释，最后只进入 `waiting-server`。捕获的 learner 类型必须精确为：

```text
predicted, attempted(B), attempted(C), attempted(D), corrected, explained
```

未操作反例使用单独的真实 flow 和真实捕获数组；`sensitive_event_count` 与 `client_completed_count` 均从该数组计算，不使用自证字面量。客户端完整链同样从捕获数组确认没有 `completed`。

权限反例为每个条件创建新的产品 flow。产品 comparator 必须逐项拒绝 identity、class、course、unit、activity、generation 和 access 漂移；未登录、route 失效以及 `pending_recovery_manual_intervention` 也必须在 controller 写入前关闭。

刷新只报告：确认写入后本地没有可证明的完整 pending 前缀，当前恢复函数安全回到 P0 `prediction`。报告固定为 `safe-fallback` 和 `exact_recovery_claimed=false`；ARCH-004 的精确跨刷新恢复不能由此探针冒充。

后端子探针从前端捕获的六条事件构造真实 API payload，并执行现有产品服务：

1. 在系统 TEMP 下以 `astra-qa019-*` 新建仓库外目录和 SQLite；
2. 从当前 Alembic script graph 读取唯一 head，用 Alembic 升级后断言数据库 `alembic_version` 与它相同；不得冻结某个历史 revision；
3. 用 `create_app()` 和 FastAPI `TestClient` 新建教师、学生、学校、班级、课程、课程单元和完成规则；
4. 不调用演示数据初始化器，写入前确认 evidence 表为空；
5. 一次性 ASGI 传输夹具在产品 handler 前对首个真实 evidence POST 返回 503，并确认 SQLite 零行；
6. 相同 `client_event_id` 再次 POST 得到 201 accepted，再次重放得到 200 duplicate 且 SQLite 仅一行，并核对 outcome、client/event identity；
7. 后续事件继续走正式 `/api/learning-evidence/events`；
8. 对账 learner 事件、rule producer 的唯一 `completed`、projection 和规则 witness；witness source IDs 必须与六个 learner receipts 是同一唯一集合；
9. 教师 class+course items 的 event IDs 必须等于六个 learner receipts，且每项 subject、producer、activity 与事件类型 multiset 均精确一致，再对账 aggregate；
10. 检查 `PRAGMA foreign_key_check`；
11. 默认只删除由本进程创建且再次验证过名称、父目录和非仓库重叠关系的 TEMP 目录。

`--keep-data` 仅用于明确的人工诊断；此时报告必须同时写明 `keep_data_requested=true` 与 `cleanup=retained-by-explicit-flag`。默认正式 probe 必须是子进程 exit 0 且 `cleanup=verified-removed`；`retained`、`refused`、缺失 cleanup 或非零子进程退出码都会让所有必需后端 checks 与整体 verdict 变为 FAIL。凭据随机生成且不进入报告。

## 变异自检

快速自检命令：

```powershell
node tools/qa/qa019-future-probe.cjs --mode self-test --format summary
node tools/tests/qa019-future-probe-contract.cjs
```

变异有三种层级，报告在每项 `mutation_level` 中如实标出：

- `product-callback`：真实执行当前 `createLoadPathFlow`，但把 authority comparator callback 控制为永真。错误 class 由此形成一次真实 controller 调用和错误推进；同一 evaluator 必须稳定报 `fail_closed:class_scope_invalid`。这是产品执行层的可控绕过，不是改报告字段。
- `structured-report`：逐一删除 predicted、B、C、D、corrected、explained，或把每个已观察到的 fail-closed 结果改成 fail-open；验证报告 evaluator 能拒绝证据缺叶和作用域缺叶。
- `structured-backend-result`：逐项篡改子进程退出码、cleanup、传输 outcome/identity、动态 Alembic head、learner multiset、rule witness 集合以及教师 item ID/subject/type/producer/activity/aggregate；验证任何缺叶都会让整体 FAIL。

只有未变异的当前产品结果通过，且所有变异均被 evaluator 拒绝，自检才 PASS。变异用于验证探针的检错能力，不是产品 PASS 证据；正式 `--mode probe` 的服务结论始终来自真实 FastAPI/SQLite 运行。

## 报告与验收映射

机器报告的核心检查如下：

- `current_showcase`：Future 数量、key 和独立演示样例选择；
- `no_action_zero_sensitive_facts`：未操作、乱序早期动作均零写，客户端零 completed；
- `ordered_observation_and_correction`：当前求解器的 B→C→D、错误判断、纠正、解释和等待投影；
- `refresh_semantics`：只声明安全回退；
- `authority_fail_closed`：产品 comparator 与未登录、身份、班课单元、generation、route、manual 全矩阵；
- `first_failure_same_id`：前端 retry ID 与真实 503→201→200 SQLite 幂等；
- `server_completion_owner`：learner 零 completed，rule producer 唯一 completed，witness 与六个 learner receipt IDs 精确对账；
- `teacher_exact_scope_readback`：教师 class+course 原始 items 的 event ID、subject、事件 multiset、producer、activity 与 aggregate 对账；
- `fresh_unseeded_sqlite`：仓库外新库、动态 Alembic 唯一 head、空初态、无演示 seed、FK、子进程退出码与 cleanup；
- `mutation_self_test`：产品 callback 绕过与结构化负向门禁；
- `browser_journey`：新 Browser 证据或诚实 `NOT-RUN`。

`--mode frontend` 只用于开发前端探针，它会把后端必需项标成 `SKIP`，退出码为 2，不能作为 QA-019 正式通过。`--mode probe` 才是完整非 Browser gate。
